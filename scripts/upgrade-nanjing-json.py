#!/usr/bin/env python3
import argparse
import hashlib
import json
import re
import uuid
from datetime import datetime, timezone
from pathlib import Path

GENERATOR_NAME = "nanjing-json-upgrader"
GENERATOR_VERSION = "1.0.0"
NAMESPACE = uuid.UUID("c8c31efb-d3da-59f4-bf84-30e5575dc0a5")


def normalize_for_hash(text: str) -> str:
    return re.sub(r"\s+", "", text.strip())


def short_hash(text: str, length: int = 16) -> str:
    return hashlib.sha256(normalize_for_hash(text).encode("utf-8")).hexdigest()[:length]


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def stable_id(kind: str, *parts: object) -> str:
    raw = "::".join([kind, *[str(part) for part in parts]])
    return str(uuid.uuid5(NAMESPACE, raw))


def estimate_source_range(chapter_index: int, paragraph_index: int) -> dict:
    # The legacy Nan Jing JSON came from one XHTML spine entry and did not keep
    # line offsets. Preserve a deterministic synthetic range for traceability.
    line = chapter_index * 1000 + paragraph_index
    return {"startPage": 1, "endPage": 1, "startLine": line, "endLine": line}


def upgrade(data: dict, source_hash: str) -> dict:
    now = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
    title = data["title"]
    source_path = data["source"]
    source_entry = data.get("sourceEntry")
    book_id = stable_id("book", title, source_hash[:16])
    chapters = []

    for legacy_chapter in data["chapters"]:
        sequence = legacy_chapter["index"]
        chapter_title = legacy_chapter["title"]
        chapter_id = stable_id("chapter", book_id, sequence, chapter_title)
        paragraphs = []

        for legacy_paragraph in legacy_chapter["paragraphs"]:
            order_index = legacy_paragraph["index"] - 1
            text = legacy_paragraph["text"].strip()
            parse_hash = short_hash(text)
            paragraphs.append(
                {
                    "id": stable_id("paragraph", chapter_id, order_index, parse_hash),
                    "chapterId": chapter_id,
                    "orderIndex": order_index,
                    "text": text,
                    "blockType": "p",
                    "parseHash": parse_hash,
                    "sourceRange": estimate_source_range(sequence, legacy_paragraph["index"]),
                    "quality": {"flag": "ok", "notes": []},
                }
            )

        body = "\n".join(p["text"] for p in paragraphs)
        chapters.append(
            {
                "id": chapter_id,
                "bookId": book_id,
                "parentId": None,
                "orderIndex": sequence - 1,
                "level": "篇",
                "title": chapter_title,
                "canonicalTitle": chapter_title,
                "collection": "难经",
                "sequence": sequence,
                "sourceRange": {
                    "startPage": 1,
                    "endPage": 1,
                    "startLine": sequence * 1000,
                    "endLine": sequence * 1000 + max(len(paragraphs), 1),
                },
                "contentHash": short_hash(body),
                "quality": {"flag": "ok", "notes": []},
                "paragraphs": paragraphs,
            }
        )

    paragraph_count = sum(len(c["paragraphs"]) for c in chapters)
    warnings = []
    if len(chapters) != 81:
        warnings.append(f"章节数为 {len(chapters)}，预期 81。")
    if paragraph_count != data.get("paragraphCount"):
        warnings.append(f"段落数为 {paragraph_count}，旧结构记录为 {data.get('paragraphCount')}。")

    return {
        "schemaVersion": 1,
        "generator": {"name": GENERATOR_NAME, "version": GENERATOR_VERSION, "generatedAt": now},
        "book": {
            "id": book_id,
            "title": title,
            "author": None,
            "category": "难经",
            "language": "zh-Hans",
            "sourceFormat": "epub",
            "importedAt": now,
        },
        "source": {
            "path": source_path,
            "sha256": source_hash,
            "format": "epub",
            "entries": [source_entry] if source_entry else [],
        },
        "parse": {
            "parser": GENERATOR_NAME,
            "parserVersion": GENERATOR_VERSION,
            "params": {
                "chapterHeading": "沿用旧 JSON 的 81 个“一难”至“八十一难”章节。",
                "paragraphSplit": "沿用旧 JSON 中已切好的段落。",
                "textNormalization": ["去除段落首尾空白"],
            },
        },
        "quality": {
            "status": "ok" if not warnings else "suspect",
            "chapterCount": len(chapters),
            "paragraphCount": paragraph_count,
            "warnings": warnings,
        },
        "chapters": chapters,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", default="data/nanjing-original.json")
    parser.add_argument("--source-file", default="books/黄帝八十一难.epub")
    parser.add_argument("--output", default="data/nanjing-original.json")
    args = parser.parse_args()

    input_path = Path(args.input)
    source_path = Path(args.source_file)
    output_path = Path(args.output)
    legacy = json.loads(input_path.read_text(encoding="utf-8"))
    upgraded = upgrade(legacy, sha256_file(source_path))
    output_path.write_text(json.dumps(upgraded, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(
        json.dumps(
            {
                "output": str(output_path),
                "chapters": upgraded["quality"]["chapterCount"],
                "paragraphs": upgraded["quality"]["paragraphCount"],
                "status": upgraded["quality"]["status"],
                "warnings": upgraded["quality"]["warnings"],
            },
            ensure_ascii=False,
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
