"""Create compact previews while preserving the original road scene files."""

import json
import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
MEDIA_DIR = BASE_DIR / "media"
THUMB_DIR = MEDIA_DIR / "thumbs"
DB_PATH = BASE_DIR / "questions.json"


def generate_missing_thumbnails(questions=None):
    try:
        from PIL import Image, ImageOps
    except ImportError:
        print("[!] Pillow nav instalēts. Priekšskatījumu vietā tiks rādīti oriģinālie attēli.")
        return 0

    if questions is None:
        if not DB_PATH.exists():
            return 0
        try:
            with DB_PATH.open(encoding="utf-8") as database:
                questions = json.load(database)
        except (OSError, ValueError) as error:
            print(f"[!] Neizdevās nolasīt priekšskatījumu datubāzi: {error}")
            return 0

    THUMB_DIR.mkdir(parents=True, exist_ok=True)
    created = 0
    seen = set()
    media_root = MEDIA_DIR.resolve()
    for question in questions:
        image_path = question.get("img", "")
        if not image_path.startswith("media/"):
            continue
        source = (BASE_DIR / image_path).resolve()
        if source in seen or not source.is_relative_to(media_root) or not source.is_file():
            continue
        seen.add(source)
        thumb = THUMB_DIR / (source.name + ".webp")
        if thumb.exists() and thumb.stat().st_mtime >= source.stat().st_mtime:
            continue
        temporary = thumb.with_name(thumb.name + ".tmp")
        try:
            with Image.open(source) as original:
                preview = ImageOps.exif_transpose(original)
                preview.thumbnail((720, 560), Image.Resampling.LANCZOS)
                preview.convert("RGB").save(temporary, format="WEBP", quality=72, method=4)
            os.replace(temporary, thumb)
            created += 1
        except Exception as error:
            temporary.unlink(missing_ok=True)
            print(f"[!] Neizdevās izveidot priekšskatījumu {source.name}: {error}")
    if created:
        print(f"[*] Izveidoti priekšskatījumi: {created}")
    return created


if __name__ == "__main__":
    generate_missing_thumbnails()
