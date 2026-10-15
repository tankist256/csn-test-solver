import argparse
import hashlib
import json
import os
import re
import sys
import time
from urllib.parse import urljoin, urlsplit
import requests
from bs4 import BeautifulSoup
import urllib3

try:
    from .thumbnails import generate_missing_thumbnails
except ImportError:
    from thumbnails import generate_missing_thumbnails

urllib3.disable_warnings()

BASE_URL = "https://csnt2.csdd.lv"
OUTPUT_DIR = os.path.dirname(os.path.abspath(__file__))
MEDIA_DIR = os.path.join(OUTPUT_DIR, "media")
DB_JSON_PATH = os.path.join(OUTPUT_DIR, "questions.json")
DB_JS_PATH = os.path.join(OUTPUT_DIR, "questions.js")

headers = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML,"
        " like Gecko) Chrome/120.0.0.0 Safari/537.36"
    )
}


def ensure_dirs():
    os.makedirs(MEDIA_DIR, exist_ok=True)


def load_database():
    if os.path.exists(DB_JSON_PATH):
        try:
            with open(DB_JSON_PATH, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            print(f"[!] Ошибка чтения {DB_JSON_PATH}: {e}")
    return []


def save_database(questions):
    with open(DB_JSON_PATH, "w", encoding="utf-8") as f:
        json.dump(questions, f, ensure_ascii=False, indent=2)

    # Сохраняем также questions.js для прямого открытия в браузере без веб-сервера
    js_content = "window.CSDD_QUESTIONS = " + json.dumps(questions, ensure_ascii=False, indent=2) + ";\n"
    with open(DB_JS_PATH, "w", encoding="utf-8") as f:
        f.write(js_content)
    generate_missing_thumbnails(questions)


def question_id(question, options, img, video):
    """Keep visually distinct situations separate even when their text matches."""
    option_texts = "|".join(sorted(option["text"] for option in options))
    media_key = "|".join((img or "", video or ""))
    key_raw = f"{question}||{option_texts}||{media_key}"
    return hashlib.md5(key_raw.encode("utf-8")).hexdigest()[:12]


def legacy_question_id(question, options):
    """ID used by the previous database format, also used by saved bookmarks."""
    option_texts = "|".join(sorted(option["text"] for option in options))
    key_raw = f"{question}||{option_texts}"
    return hashlib.md5(key_raw.encode("utf-8")).hexdigest()[:12]


def download_media(session, url):
    if not url:
        return ""
    clean_url = url.split("?")[0]
    base_name = os.path.basename(clean_url)
    if not base_name:
        base_name = "media.jpg"
    
    url_hash = hashlib.md5(url.encode("utf-8")).hexdigest()[:8]
    filename = f"{url_hash}_{base_name}"
    filepath = os.path.join(MEDIA_DIR, filename)
    rel_path = f"media/{filename}"

    if os.path.exists(filepath) and os.path.getsize(filepath) > 0:
        return rel_path

    try:
        r = session.get(url, stream=True, timeout=20, verify=False)
        if r.status_code == 200:
            with open(filepath, "wb") as f:
                for chunk in r.iter_content(32 * 1024):
                    f.write(chunk)
            return rel_path
    except Exception as e:
        print(f" [!] Ошибка скачивания {url}: {e}")
    return url


def normalize_question_text(value):
    """Normalize insignificant whitespace while preserving the actual wording."""
    value = " ".join((value or "").split())
    return re.sub(r"^Video jautājums\s*", "", value, flags=re.IGNORECASE)


def media_filename(value):
    return os.path.basename(urlsplit(value or "").path).lower()


def review_media_filenames(soup):
    sources = [tag.get("src", "") for tag in soup.find_all(["img", "source"])]
    for node in soup.find_all(style=True):
        match = re.search(r"url\(['\"]?(.*?)['\"]?\)", node.get("style", ""))
        if match:
            sources.append(match.group(1))
    return {name for name in map(media_filename, sources) if name}


def match_review_question(soup, session_questions):
    """Match a review page to exactly one collected question.

    Generic prompts recur for different road scenes, so identify the media
    first and use option IDs to break any remaining ties.
    """
    q_h3 = soup.find("h3")
    if not q_h3:
        return None
    prompt = normalize_question_text(q_h3.get_text(" ", strip=True))
    page_option_ids = {
        inp.get("value")
        for inp in soup.select("input[value]")
        if inp.get("value")
    }
    page_media = review_media_filenames(soup)
    candidates = []
    for sq in session_questions.values():
        option_ids = {option["id"] for option in sq["options"]}
        if normalize_question_text(sq["question"]) == prompt:
            question_media = {
                name for name in (media_filename(sq["img_url"]), media_filename(sq["video_url"])) if name
            }
            candidates.append((bool(page_media & question_media), len(option_ids & page_option_ids), sq))
    if not candidates:
        return None
    if page_media and any(media_match for media_match, _, _ in candidates):
        candidates = [candidate for candidate in candidates if candidate[0]]
    best_score = max(score for _, score, _ in candidates)
    best = [sq for _, score, sq in candidates if score == best_score]
    if len(best) == 1 and (best_score > 0 or len(candidates) == 1):
        return best[0]
    return None


def run_single_session(session):
    # 0. Сброс куков для новой сессии
    session.cookies.clear()
    
    # 1. Стартовая страница
    session.get(f"{BASE_URL}/", verify=False)

    # 2. Выбор категории B (ext_id=52, LAT)
    r_kat = session.post(
        f"{BASE_URL}/sbm_kat",
        data={"perform": "confirm", "ext_id": "52", "valoda": "LAT"},
        verify=False,
    )
    if r_kat.status_code != 200:
        return []

    # 3. Прохождение 3 пробных вопросов
    trials = [("17552", "52634"), ("761", "2264"), ("17335", "51986")]
    for exj_id, ans_id in trials:
        session.post(
            f"{BASE_URL}/LAT/parb_ins",
            data={
                "perform": "confirm",
                "exj_id": exj_id,
                "atbildes[0][exa_id]": ans_id,
                "atbildes[0][sel]": "true",
            },
            verify=False,
        )

    # 4. Переход к первому реальному вопросу
    r = session.get(f"{BASE_URL}/LAT", verify=False)
    if "location.href" in r.text:
        r = session.get(f"{BASE_URL}/LAT", verify=False)

    session_questions = {}

    # 5. Проходим 30 вопросов экзамена
    for q_idx in range(30):
        soup = BeautifulSoup(r.text, "html.parser")
        form = soup.find("form", id="atb")
        if not form:
            break

        exj_id = form.find("input", id="exj_id")["value"]
        ece_id = form.find("input", id="ece_id")["value"]
        eceja_id = form.find("input", id="eceja_id")["value"]

        q_h3 = soup.find("h3")
        q_text = q_h3.get_text(strip=True) if q_h3 else ""

        options = []
        for lbl in form.find_all("label", class_="block-label"):
            inp = lbl.find("input")
            if inp:
                options.append(
                    {
                        "id": inp["value"],
                        "text": lbl.get_text(" ", strip=True),
                    }
                )

        if not options:
            break

        # Картинка
        img_url = ""
        img_div = soup.find("div", class_="lightbox-image")
        if img_div and "background-image:url(" in img_div.get("style", ""):
            img_url = img_div["style"].split("url('")[1].split("')")[0]
        elif soup.find("img", class_="lightbox-image"):
            img_url = soup.find("img", class_="lightbox-image").get("src", "")

        # Видео
        video_url = ""
        video_tag = soup.find("video")
        if video_tag:
            src_tag = video_tag.find("source")
            if src_tag:
                video_url = src_tag.get("src", "")

        img_url = urljoin(BASE_URL, img_url) if img_url else ""
        video_url = urljoin(BASE_URL, video_url) if video_url else ""

        # Выбираем первый вариант
        selected_opt = options[0]["id"]

        session_questions[eceja_id] = {
            "question": q_text,
            "options": options,
            "img_url": img_url,
            "video_url": video_url,
            "selected_id": selected_opt,
            "correct_id": None,
        }

        # Отправляем ответ
        pdata = {
            "perform": "confirm",
            "eceja_id": eceja_id,
            "ece_id": ece_id,
            "exj_id": exj_id,
            "atbildes[0][exa_id]": selected_opt,
            "atbildes[0][sel]": "true",
        }
        for o_i, opt in enumerate(options[1:], start=1):
            pdata[f"atbildes[{o_i}][exa_id]"] = opt["id"]
            pdata[f"atbildes[{o_i}][sel]"] = "false"

        session.post(f"{BASE_URL}/LAT/atb_ins", data=pdata, verify=False)
        r = session.get(f"{BASE_URL}/LAT", verify=False)
        if "location.href" in r.text:
            r = session.get(f"{BASE_URL}/LAT", verify=False)

    if not session_questions:
        return []

    # 6. Открываем /LAT/parskats для разбора ошибок
    r_par = session.get(f"{BASE_URL}/LAT/parskats", verify=False)
    if r_par.status_code != 200:
        raise RuntimeError(f"CSDD не отдал просмотр ответов: HTTP {r_par.status_code}")
    cur_page = r_par
    visited_ids = set()
    reviewed_question_ids = set()

    while True:
        if cur_page.status_code != 200:
            raise RuntimeError(f"Ошибка страницы просмотра ответов: HTTP {cur_page.status_code}")
        soup_par = BeautifulSoup(cur_page.text, "html.parser")
        q_h3 = soup_par.find("h3")
        if not q_h3:
            raise RuntimeError("Не удалось прочитать вопрос на странице проверки ответов; раунд не сохранён")

        sq = match_review_question(soup_par, session_questions)
        if sq is None:
            page_prompt = normalize_question_text(q_h3.get_text(" ", strip=True))
            raise RuntimeError(
                "Не удалось однозначно связать вопрос со страницей проверки CSDD "
                f"(текст: {page_prompt!r}); раунд не сохранён"
            )
        question_key = next(key for key, value in session_questions.items() if value is sq)
        if question_key in reviewed_question_ids:
            raise RuntimeError("CSDD повторил страницу ошибки; раунд не сохранён")
        reviewed_question_ids.add(question_key)

        # На странице ошибки CSDD помечает официальный ответ классом "pareizi".
        correct_lbl = soup_par.find("label", class_="pareizi")
        if correct_lbl and correct_lbl.find("input"):
            c_id = correct_lbl.find("input")["value"]
            if c_id not in {option["id"] for option in sq["options"]}:
                raise RuntimeError("Правильный ответ CSDD не совпал с вариантами вопроса; раунд не сохранён")
            if c_id == sq["selected_id"]:
                raise RuntimeError("Страница ошибки CSDD противоречит выбранному ответу; раунд не сохранён")
            sq["correct_id"] = c_id
        else:
            raise RuntimeError("CSDD не отметил правильный ответ на странице ошибки; раунд не сохранён")

        # Переходим строго на СЛЕДУЮЩУЮ ошибку через li.next
        next_li = soup_par.find("li", class_="next")
        if not next_li:
            break
        next_btn = next_li.find("a", class_="jautbtn")
        if not next_btn or not next_btn.get("id_sel"):
            raise RuntimeError("Не удалось перейти к следующей ошибке CSDD; раунд не сохранён")
        next_id = next_btn["id_sel"]
        if next_id in visited_ids:
            raise RuntimeError("Обнаружен цикл в списке ошибок CSDD; раунд не сохранён")
        visited_ids.add(next_id)
        cur_page = session.post(
            f"{BASE_URL}/LAT/parskats", data={"exj_id": next_id}, verify=False
        )

    # 7. Отсутствие ошибки означает, что первый выбранный вариант засчитан.
    # Это допустимо только после полного, непрерывного чтения списка ошибок.
    for sq in session_questions.values():
        if sq["correct_id"] is None:
            sq["correct_id"] = sq["selected_id"]
        if sq["correct_id"] not in {option["id"] for option in sq["options"]}:
            raise RuntimeError("Не найден ответ среди вариантов вопроса; раунд не сохранён")

    # 8. Скачиваем медиа и форматируем итоговые записи
    final_questions = []
    for sq in session_questions.values():
        local_img = download_media(session, sq["img_url"]) if sq["img_url"] else ""
        local_vid = download_media(session, sq["video_url"]) if sq["video_url"] else ""

        # Находим текст правильного ответа
        correct_text = ""
        for o in sq["options"]:
            if o["id"] == sq["correct_id"]:
                correct_text = o["text"]
                break

        # Different visual situations can share the same prompt and answer text.
        q_id = question_id(sq["question"], sq["options"], local_img, local_vid)

        final_questions.append(
            {
                "id": q_id,
                "question": sq["question"],
                "options": sq["options"],
                "correct_id": sq["correct_id"],
                "correct_text": correct_text,
                "img": local_img,
                "video": local_vid,
                "verified": True,
            }
        )

    return final_questions


def main():
    parser = argparse.ArgumentParser(description="CSDD Question Collector & Bank")
    parser.add_argument("--rounds", type=int, default=10, help="Количество тестов для прогона (по 30 вопросов каждый)")
    parser.add_argument("--loop", action="store_true", help="Крутить сбор бесконечно, пока не нажат Ctrl+C")
    args = parser.parse_args()

    ensure_dirs()
    existing_db = load_database()
    db_map = {}
    for question in existing_db:
        # Legacy IDs ignored the image/video, merging different road scenes.
        # Re-key by media and require an official re-encounter before showing
        # a legacy answer as confirmed.
        legacy_id = question.get("legacy_id") or legacy_question_id(
            question.get("question", ""), question.get("options", [])
        )
        question["id"] = question_id(
            question.get("question", ""),
            question.get("options", []),
            question.get("img", ""),
            question.get("video", ""),
        )
        if legacy_id and legacy_id != question["id"]:
            question.setdefault("legacy_id", legacy_id)
        question["verified"] = question.get("verified") is True
        prior = db_map.get(question["id"])
        if prior and prior.get("correct_text") != question.get("correct_text"):
            question["verified"] = False
            prior["verified"] = False
        db_map[question["id"]] = question
    print(f"[*] Загружена текущая база: {len(db_map)} уникальных вопросов.")

    session = requests.Session()
    session.headers.update(headers)

    round_idx = 0
    total_added = 0

    try:
        while True:
            round_idx += 1
            if not args.loop and round_idx > args.rounds:
                break

            print(f"\n--- Раунд {round_idx}{'' if args.loop else f'/{args.rounds}'}: Запуск теста... ---")
            t0 = time.time()
            try:
                round_questions = run_single_session(session)
            except Exception as e:
                print(f"[!] Ошибка раунда: {e}, пауза 3 сек...")
                time.sleep(3)
                continue

            new_in_round = 0
            corrected_in_round = 0
            for q in round_questions:
                if q["id"] not in db_map:
                    db_map[q["id"]] = q
                    new_in_round += 1
                    total_added += 1
                elif db_map[q["id"]].get("correct_text") != q.get("correct_text"):
                    old_answer = db_map[q["id"]].get("correct_text", "?")
                    if db_map[q["id"]].get("legacy_id"):
                        q["legacy_id"] = db_map[q["id"]]["legacy_id"]
                    db_map[q["id"]] = q
                    corrected_in_round += 1
                    print(f"[!] Исправлен ответ: {q['question']} | было: {old_answer} | стало: {q['correct_text']}")
                else:
                    # Refresh option IDs and media URLs even when the answer text is unchanged.
                    if db_map[q["id"]].get("legacy_id"):
                        q["legacy_id"] = db_map[q["id"]]["legacy_id"]
                    db_map[q["id"]] = q

            save_database(list(db_map.values()))
            dt = time.time() - t0
            print(
                f"[✓] Раунд {round_idx} завершен за {dt:.1f}с. Новых: {new_in_round} | Исправлено: {corrected_in_round} | Всего в базе: {len(db_map)}"
            )

    except KeyboardInterrupt:
        print("\n[!] Остановлено пользователем.")

    print(f"\n==========================================")
    print(f"ИТОГ: Всего уникальных вопросов в базе: {len(db_map)}")
    print(f"База сохранена в: {DB_JSON_PATH}")
    print(f"JS-модуль сохранен в: {DB_JS_PATH}")
    print(f"==========================================")


if __name__ == "__main__":
    main()
