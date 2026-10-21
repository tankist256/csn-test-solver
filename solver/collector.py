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

CSN_REQUEST_TIMEOUT = (8, 30)


class LatvianArgumentParser(argparse.ArgumentParser):
    def format_help(self):
        help_text = super().format_help()
        return (
            help_text.replace("usage:", "Lietojums:", 1)
            .replace("options:", "Opcijas:", 1)
            .replace("optional arguments:", "Opcijas:", 1)
            .replace("show this help message and exit", "Parāda šo palīdzību un iziet", 1)
        )


class TimedSession(requests.Session):
    """Bound every CSDD request so an unreachable host cannot hang a batch."""

    def request(self, method, url, **kwargs):
        kwargs.setdefault("timeout", CSN_REQUEST_TIMEOUT)
        return super().request(method, url, **kwargs)


def ensure_dirs():
    os.makedirs(MEDIA_DIR, exist_ok=True)


def load_database():
    if os.path.exists(DB_JSON_PATH):
        try:
            with open(DB_JSON_PATH, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            print("[!] Neizdevās nolasīt jautājumu datubāzi.")
    return []


def save_database(questions):
    with open(DB_JSON_PATH, "w", encoding="utf-8") as f:
        json.dump(questions, f, ensure_ascii=False, indent=2)

    # Save questions.js too, so the page can open without a web server.
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
    except Exception:
        print(" [!] Neizdevās lejupielādēt multivides failu.")
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
    # 0. Clear cookies for the new session.
    session.cookies.clear()
    
    # 1. Open the start page.
    session.get(f"{BASE_URL}/", verify=False)

    # 2. Select category B (ext_id=52, LAT).
    r_kat = session.post(
        f"{BASE_URL}/sbm_kat",
        data={"perform": "confirm", "ext_id": "52", "valoda": "LAT"},
        verify=False,
    )
    if r_kat.status_code != 200:
        return []

    # 3. Answer the three sample questions.
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

    # 4. Go to the first exam question.
    r = session.get(f"{BASE_URL}/LAT", verify=False)
    if "location.href" in r.text:
        r = session.get(f"{BASE_URL}/LAT", verify=False)

    session_questions = {}

    # 5. Answer the 30 exam questions.
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

        # Handle an image.
        img_url = ""
        img_div = soup.find("div", class_="lightbox-image")
        if img_div and "background-image:url(" in img_div.get("style", ""):
            img_url = img_div["style"].split("url('")[1].split("')")[0]
        elif soup.find("img", class_="lightbox-image"):
            img_url = soup.find("img", class_="lightbox-image").get("src", "")

        # Handle a video.
        video_url = ""
        video_tag = soup.find("video")
        if video_tag:
            src_tag = video_tag.find("source")
            if src_tag:
                video_url = src_tag.get("src", "")

        img_url = urljoin(BASE_URL, img_url) if img_url else ""
        video_url = urljoin(BASE_URL, video_url) if video_url else ""

        # Select the first answer.
        selected_opt = options[0]["id"]

        session_questions[eceja_id] = {
            "question": q_text,
            "options": options,
            "img_url": img_url,
            "video_url": video_url,
            "selected_id": selected_opt,
            "correct_id": None,
        }

        # Submit the answer.
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

    # 6. Open /LAT/parskats to review incorrect answers.
    r_par = session.get(f"{BASE_URL}/LAT/parskats", verify=False)
    if r_par.status_code != 200:
        raise RuntimeError(f"CSDD neatvēra atbilžu pārskatu: HTTP {r_par.status_code}")
    cur_page = r_par
    visited_ids = set()
    reviewed_question_ids = set()

    while True:
        if cur_page.status_code != 200:
            raise RuntimeError(f"Kļūda atbilžu pārskata lapā: HTTP {cur_page.status_code}")
        soup_par = BeautifulSoup(cur_page.text, "html.parser")
        q_h3 = soup_par.find("h3")
        if not q_h3:
            raise RuntimeError("Neizdevās nolasīt jautājumu atbilžu pārbaudes lapā; kārta netika saglabāta.")

        sq = match_review_question(soup_par, session_questions)
        if sq is None:
            page_prompt = normalize_question_text(q_h3.get_text(" ", strip=True))
            raise RuntimeError(
                "Neizdevās nepārprotami sasaistīt jautājumu ar CSDD pārbaudes lapu "
                f"(teksts: {page_prompt!r}); kārta netika saglabāta."
            )
        question_key = next(key for key, value in session_questions.items() if value is sq)
        if question_key in reviewed_question_ids:
            raise RuntimeError("CSDD atkārtoti parādīja to pašu kļūdas lapu; kārta netika saglabāta.")
        reviewed_question_ids.add(question_key)

        # CSDD marks the correct answer with the class "pareizi".
        correct_lbl = soup_par.find("label", class_="pareizi")
        if correct_lbl and correct_lbl.find("input"):
            c_id = correct_lbl.find("input")["value"]
            if c_id not in {option["id"] for option in sq["options"]}:
                raise RuntimeError("CSDD pareizā atbilde neatbilst jautājuma variantiem; kārta netika saglabāta.")
            if c_id == sq["selected_id"]:
                raise RuntimeError("CSDD kļūdu lapa neatbilst izvēlētajai atbildei; kārta netika saglabāta.")
            sq["correct_id"] = c_id
        else:
            raise RuntimeError("CSDD kļūdu lapā nav atzīmējis pareizo atbildi; kārta netika saglabāta.")

        # Move to the next error with li.next.
        next_li = soup_par.find("li", class_="next")
        if not next_li:
            break
        next_btn = next_li.find("a", class_="jautbtn")
        if not next_btn or not next_btn.get("id_sel"):
            raise RuntimeError("Neizdevās atvērt nākamo CSDD kļūdu; kārta netika saglabāta.")
        next_id = next_btn["id_sel"]
        if next_id in visited_ids:
            raise RuntimeError("CSDD kļūdu sarakstā atrasts cikls; kārta netika saglabāta.")
        visited_ids.add(next_id)
        cur_page = session.post(
            f"{BASE_URL}/LAT/parskats", data={"exj_id": next_id}, verify=False
        )

    # 7. No error means the first selected answer was correct.
    # This is valid only after reading the full error list in order.
    for sq in session_questions.values():
        if sq["correct_id"] is None:
            sq["correct_id"] = sq["selected_id"]
        if sq["correct_id"] not in {option["id"] for option in sq["options"]}:
            raise RuntimeError("Atbilde nav atrasta starp jautājuma variantiem; kārta netika saglabāta.")

    # 8. Download media and prepare the final records.
    final_questions = []
    for sq in session_questions.values():
        local_img = download_media(session, sq["img_url"]) if sq["img_url"] else ""
        local_vid = download_media(session, sq["video_url"]) if sq["video_url"] else ""

        # Find the correct answer text.
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
    parser = LatvianArgumentParser(description="CSDD jautājumu ievācējs un datubāze")
    parser.add_argument("--rounds", type=int, default=10, help="Testu skaits vienā reizē (katrā testā ir 30 jautājumi)")
    parser.add_argument("--loop", action="store_true", help="Atkārtot ievākšanu, līdz tiek nospiests Ctrl+C")
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
    print(f"[*] Ielādēta pašreizējā datubāze: {len(db_map)} unikāli jautājumi.")

    session = TimedSession()
    session.headers.update(headers)

    round_idx = 0
    total_added = 0
    connection_failed = False
    completed_rounds = 0
    interrupted = False

    try:
        while True:
            round_idx += 1
            if not args.loop and round_idx > args.rounds:
                break

            print(f"\n--- Kārta {round_idx}{'' if args.loop else f'/{args.rounds}'}: sāk testu... ---")
            t0 = time.time()
            try:
                round_questions = run_single_session(session)
            except (requests.exceptions.ConnectionError, requests.exceptions.Timeout):
                print(
                    "[!] CSDD nav sasniedzams no šī tīkla. Ievākšana apturēta; "
                    "iepriekšējā datubāze nav dzēsta. Pārbaudiet tīkla savienojumu."
                )
                connection_failed = True
                break
            except Exception:
                print("[!] Neizdevās apstrādāt testu. Mēģināšu vēlreiz pēc 3 sekundēm.")
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
                    print(f"[!] Labota atbilde: {q['question']} | bija: {old_answer} | tagad: {q['correct_text']}")
                else:
                    # Refresh option IDs and media URLs even when the answer text is unchanged.
                    if db_map[q["id"]].get("legacy_id"):
                        q["legacy_id"] = db_map[q["id"]]["legacy_id"]
                    db_map[q["id"]] = q

            save_database(list(db_map.values()))
            completed_rounds += 1
            dt = time.time() - t0
            print(
                f"[✓] Kārta {round_idx} pabeigta {dt:.1f} sekundēs. Jauni jautājumi: {new_in_round} | Labotas atbildes: {corrected_in_round} | Kopā datubāzē: {len(db_map)}"
            )

    except KeyboardInterrupt:
        print("\n[!] Lietotājs apturēja ievākšanu.")
        interrupted = True

    print(f"\n==========================================")
    print(f"KOPSAVILKUMS: Unikālo jautājumu skaits datubāzē: {len(db_map)}")
    print(f"Datubāze saglabāta: {DB_JSON_PATH}")
    print(f"JS modulis saglabāts: {DB_JS_PATH}")
    print(f"==========================================")
    if connection_failed or interrupted or (not args.loop and completed_rounds != args.rounds):
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
