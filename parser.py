import argparse
import hashlib
import os
import re
from concurrent.futures import ThreadPoolExecutor
from urllib.parse import urljoin
import requests
from bs4 import BeautifulSoup

DEFAULT_BASE_URL = "https://credoautoprieks.lv/noderigi/mcibu-materiali/csn/"
DEFAULT_OUTPUT_DIR = "csn_materials"

headers = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML,"
        " like Gecko) Chrome/120.0.0.0 Safari/537.36"
    )
}

session = requests.Session()
session.headers.update(headers)


def create_dir(dir_name):
    if not os.path.exists(dir_name):
        os.makedirs(dir_name, exist_ok=True)


def get_image_filename(url):
    clean_url = url.split("?")[0]
    base_name = os.path.basename(clean_url)
    if not base_name:
        base_name = "image.png"
    # Добавляем короткий хеш полного URL во избежание коллизий одинаковых имен
    url_hash = hashlib.md5(url.encode("utf-8")).hexdigest()[:8]
    return f"{url_hash}_{base_name}"


def download_file(url, folder):
    try:
        filename = get_image_filename(url)
        filepath = os.path.join(folder, filename)
        if os.path.exists(filepath) and os.path.getsize(filepath) > 0:
            return filepath

        response = session.get(url, stream=True, timeout=20)
        if response.status_code == 200:
            with open(filepath, "wb") as f:
                for chunk in response.iter_content(1024 * 32):
                    f.write(chunk)
            return filepath
        else:
            print(f"Статус {response.status_code} при скачивании {url}")
    except Exception as e:
        print(f"Ошибка при скачивании файла {url}: {e}")
    return None


def parse_csn(base_url=DEFAULT_BASE_URL, output_dir=DEFAULT_OUTPUT_DIR):
    create_dir(output_dir)
    img_dir = os.path.join(output_dir, "images")
    create_dir(img_dir)

    print(f"Загружаем главную страницу с разделами: {base_url} ...")
    response = session.get(base_url)
    if response.status_code != 200:
        print(f"Не удалось загрузить главную страницу, код {response.status_code}")
        return

    soup = BeautifulSoup(response.text, "html.parser")

    # Ищем все ссылки на главы внутри основного контейнера или по шаблону
    main_container = soup.find("div", class_="simple-page") or soup.find("article") or soup.body
    links = []
    normalized_base = base_url.rstrip("/")

    for a in main_container.find_all("a", href=True):
        href = a["href"]
        if "/mcibu-materiali/csn/" in href:
            full_url = urljoin(base_url, href)
            # Исключаем ссылку на саму главную страницу и переключатели языка
            if full_url.rstrip("/") != normalized_base and full_url not in links:
                # Убедимся, что это подраздел того же языка
                if ("/ru/" in base_url and "/ru/" in full_url) or ("/ru/" not in base_url and "/ru/" not in full_url):
                    links.append(full_url)

    print(f"Найдено разделов: {len(links)}")
    if not links:
        print("Разделы не найдены. Проверьте адрес страницы.")
        return

    # Собираем данные страниц
    chapters_data = []

    print("\nЗагрузка глав...")
    for idx, link in enumerate(links, start=1):
        print(f"[{idx}/{len(links)}] Загрузка: {link}")
        res = session.get(link, timeout=20)
        if res.status_code != 200:
            print(f"  Ошибка загрузки (код {res.status_code})")
            continue

        page_soup = BeautifulSoup(res.text, "html.parser")

        # Находим основной контейнер со статьей
        content_div = (
            page_soup.find("div", class_="simple-page")
            or page_soup.find("article")
            or page_soup.find("div", class_="entry-content")
            or page_soup.find("main")
            or page_soup.body
        )

        if not content_div:
            continue

        # Удаляем лишние кнопки навигации следующая/предыдущая глава для чистоты книги
        for nav in content_div.find_all("div", class_="csdd-menu-nav"):
            nav.decompose()

        # Собираем список картинок для скачивания
        image_tasks = []
        for img in content_div.find_all("img"):
            img_src = img.get("src")
            if img_src:
                full_img_url = urljoin(link, img_src)
                image_tasks.append((img, full_img_url))

        chapters_data.append((idx, link, content_div, image_tasks))

    # Пул параллельного скачивания картинок для ускорения
    all_image_tasks = []
    for idx, link, content_div, image_tasks in chapters_data:
        for img_tag, full_img_url in image_tasks:
            all_image_tasks.append((img_tag, full_img_url))

    print(f"\nВсего найдено картинок во всех главах: {len(all_image_tasks)}")
    print("Скачивание картинок...")

    unique_urls = list({url for _, url in all_image_tasks})
    url_to_local_path = {}

    def fetch_img(url):
        local_path = download_file(url, img_dir)
        return url, local_path

    # Скачиваем до 10 картинок параллельно
    with ThreadPoolExecutor(max_workers=10) as executor:
        for url, local_path in executor.map(fetch_img, unique_urls):
            if local_path:
                url_to_local_path[url] = os.path.relpath(local_path, output_dir)

    print(f"Успешно скачано/проверено уникальных картинок: {len(url_to_local_path)}")

    # Подменяем ссылки на картинки в HTML
    for img_tag, full_img_url in all_image_tasks:
        if full_img_url in url_to_local_path:
            img_tag["src"] = url_to_local_path[full_img_url]

    # Стили для красивого отображения книги
    book_style = """
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            line-height: 1.6;
            color: #222;
            background-color: #f8f9fa;
            margin: 0;
            padding: 20px;
        }
        .container {
            max-width: 900px;
            margin: 0 auto;
            background: #fff;
            padding: 40px 50px;
            border-radius: 8px;
            box-shadow: 0 4px 16px rgba(0,0,0,0.06);
        }
        h1, h2, h3 {
            color: #1a365d;
            margin-top: 1.5em;
        }
        img {
            max-width: 100%;
            height: auto;
            display: inline-block;
            margin: 10px auto;
            border-radius: 4px;
        }
        table {
            border-collapse: collapse;
            width: 100%;
            margin: 20px 0;
        }
        th, td {
            border: 1px solid #ddd;
            padding: 8px 12px;
            text-align: left;
        }
        th {
            background-color: #f1f5f9;
        }
        hr.chapter-divider {
            margin: 50px 0 30px;
            border: 0;
            border-top: 2px dashed #cbd5e1;
        }
        .chapter-header {
            background: #e2e8f0;
            padding: 10px 16px;
            border-radius: 6px;
            font-size: 1.1em;
            color: #334155;
            margin-bottom: 20px;
        }
        .toc {
            background: #f1f5f9;
            padding: 20px 30px;
            border-radius: 8px;
            margin-bottom: 40px;
        }
        .toc ul {
            list-style-type: decimal;
            padding-left: 20px;
        }
        .toc a {
            color: #2563eb;
            text-decoration: none;
        }
        .toc a:hover {
            text-decoration: underline;
        }
    </style>
    """

    # Формируем оглавление
    toc_html = "<div class='toc'><h2>Содержание / Satura rādītājs</h2><ul>"
    for idx, link, content_div, _ in chapters_data:
        h1 = content_div.find(["h1", "h2", "h3"])
        title = h1.get_text(strip=True) if h1 else f"Раздел {idx}"
        toc_html += f"<li><a href='#chapter-{idx}'>{title}</a></li>"
    toc_html += "</ul></div>"

    full_html_content = (
        "<!DOCTYPE html><html><head><meta charset='utf-8'>"
        "<meta name='viewport' content='width=device-width, initial-scale=1.0'>"
        f"<title>CSN Materials</title>{book_style}</head><body><div class='container'>"
        "<h1>Ceļu satiksmes noteikumi (CSN)</h1>"
        f"{toc_html}"
    )

    for idx, link, content_div, _ in chapters_data:
        full_html_content += f"<hr class='chapter-divider' id='chapter-{idx}'>"
        full_html_content += f"<div class='chapter-header'>Раздел {idx} &bull; <a href='{link}' target='_blank'>Оригинал</a></div>"
        full_html_content += str(content_div)

    full_html_content += "</div></body></html>"

    output_html_path = os.path.join(output_dir, "all_csn_materials.html")
    with open(output_html_path, "w", encoding="utf-8") as f:
        f.write(full_html_content)

    print(f"\n Готово! Все материалы выкачаны в папку '{output_dir}'.")
    print(f"Главная книга сохранена в: {output_html_path}")


def main():
    parser = argparse.ArgumentParser(description="Парсер материалов CSN")
    parser.add_argument(
        "--lang",
        choices=["lv", "ru", "all"],
        default="lv",
        help="Язык материалов: lv (по умолчанию), ru или all",
    )
    parser.add_argument(
        "--output",
        default=DEFAULT_OUTPUT_DIR,
        help="Папка для сохранения (по умолчанию: csn_materials)",
    )
    args = parser.parse_args()

    if args.lang == "lv":
        parse_csn(
            base_url="https://credoautoprieks.lv/noderigi/mcibu-materiali/csn/",
            output_dir=args.output,
        )
    elif args.lang == "ru":
        parse_csn(
            base_url="https://credoautoprieks.lv/ru/noderigi/mcibu-materiali/csn/",
            output_dir=f"{args.output}_ru",
        )
    elif args.lang == "all":
        print("--- Скачивание на латышском языке ---")
        parse_csn(
            base_url="https://credoautoprieks.lv/noderigi/mcibu-materiali/csn/",
            output_dir=f"{args.output}_lv",
        )
        print("\n--- Скачивание на русском языке ---")
        parse_csn(
            base_url="https://credoautoprieks.lv/ru/noderigi/mcibu-materiali/csn/",
            output_dir=f"{args.output}_ru",
        )


if __name__ == "__main__":
    main()
