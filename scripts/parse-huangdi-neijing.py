#!/usr/bin/env python3
import argparse
import hashlib
import json
import re
import uuid
from datetime import datetime, timezone
from pathlib import Path

import pdfplumber

PARSER_NAME = "huangdi-neijing-pdf-parser"
PARSER_VERSION = "1.0.0"
NAMESPACE = uuid.UUID("6c6e30f3-51a3-53e3-98c8-63f2c14ab315")

CN_NUM = "一二三四五六七八九十百"
LINGSHU_TAILS = "天地人时音律星民野"


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def short_hash(text: str, length: int = 16) -> str:
    normalized = normalize_for_hash(text)
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()[:length]


def stable_id(kind: str, *parts: object) -> str:
    raw = "::".join([kind, *[str(p) for p in parts]])
    return str(uuid.uuid5(NAMESPACE, raw))


def cn_to_int(text: str) -> int | None:
    if not text:
        return None
    if text == "十":
        return 10
    if text.startswith("十"):
        tail = cn_to_int(text[1:]) or 0
        return 10 + tail
    if "十" in text:
        left, right = text.split("十", 1)
        tens = cn_to_int(left) or 1
        ones = cn_to_int(right) or 0
        return tens * 10 + ones
    if text == "百":
        return 100
    if "百" in text:
        left, right = text.split("百", 1)
        hundreds = cn_to_int(left) or 1
        rest = cn_to_int(right) or 0
        return hundreds * 100 + rest
    digits = {
        "一": 1,
        "二": 2,
        "三": 3,
        "四": 4,
        "五": 5,
        "六": 6,
        "七": 7,
        "八": 8,
        "九": 9,
    }
    if len(text) == 1:
        return digits.get(text)
    value = 0
    for ch in text:
        if ch not in digits:
            return None
        value = value * 10 + digits[ch]
    return value


def normalize_text(text: str) -> str:
    text = text.replace("\u3000", " ")
    text = re.sub(r"[ \t]+", "", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def normalize_for_hash(text: str) -> str:
    return re.sub(r"\s+", "", text)


def clean_line(line: str) -> str:
    line = line.strip()
    line = line.replace("\u3000", " ")
    line = re.sub(r"[ \t]+", "", line)
    return line


def is_noise_line(line: str) -> bool:
    if not line:
        return True
    if re.fullmatch(r"\d+", line):
        return True
    if re.fullmatch(r"[-—_]+", line):
        return True
    return False


def detect_heading(line: str, collection: str | None) -> dict | None:
    if len(line) > 28:
        return None
    if any(p in line for p in "，。；：、？?！!"):
        return None

    suwen = re.fullmatch(rf"(.+?篇第([{CN_NUM}]+))", line)
    if suwen:
        seq_cn = suwen.group(2)
        return {
            "title": line,
            "canonicalTitle": line,
            "collection": "素问",
            "sequence": cn_to_int(seq_cn),
            "level": "篇",
        }

    lingshu = re.fullmatch(rf"(.+?第([{CN_NUM}]+))", line)
    if lingshu:
        seq_cn = lingshu.group(2)
        title = line
        canonical = title
        if collection == "灵枢" and title[-1:] in LINGSHU_TAILS:
            canonical = title[:-1]
        return {
            "title": title,
            "canonicalTitle": canonical,
            "collection": "灵枢" if collection == "灵枢" else collection,
            "sequence": cn_to_int(seq_cn),
            "level": "篇",
        }

    early_lingshu = re.fullmatch(rf"(.+?第)([{CN_NUM}]+)(法[{LINGSHU_TAILS}]?|法)", line)
    if collection == "灵枢" and early_lingshu:
        seq_cn = early_lingshu.group(2)
        sequence = cn_to_int(seq_cn)
        if sequence is not None and 1 <= sequence <= 9:
            tail = early_lingshu.group(3)
            return {
                "title": line,
                "canonicalTitle": line[: -len(tail)],
                "collection": "灵枢",
                "sequence": sequence,
                "level": "篇",
            }

    return None


def extract_lines(pdf_path: Path) -> tuple[int, list[dict]]:
    rows: list[dict] = []
    with pdfplumber.open(str(pdf_path)) as pdf:
        for page_index, page in enumerate(pdf.pages, start=1):
            text = page.extract_text(x_tolerance=1, y_tolerance=3) or ""
            for line_index, raw in enumerate(text.splitlines(), start=1):
                line = clean_line(raw)
                if is_noise_line(line):
                    continue
                rows.append({"page": page_index, "line": line_index, "text": line})
        return len(pdf.pages), rows


def is_preface_heading(line: str) -> bool:
    return line in {"素问序", "灵枢经叙"}


def is_collection_marker(line: str) -> str | None:
    if line in {"《素问》", "素问"}:
        return "素问"
    if line in {"《灵枢》", "灵枢"}:
        return "灵枢"
    return None


def line_should_break_paragraph(line: str) -> bool:
    if re.match(r"^(黄帝|帝|岐伯|雷公|少师|伯高|歧伯|公)曰", line):
        return True
    if re.match(r"^(问曰|答曰|曰)", line):
        return True
    if re.match(r"^故曰", line):
        return True
    return False


def split_paragraphs(lines: list[dict]) -> list[dict]:
    paragraphs: list[dict] = []
    current: list[dict] = []

    def flush() -> None:
        nonlocal current
        if not current:
            return
        text = normalize_text("".join(item["text"] for item in current))
        if text:
            paragraphs.append(
                {
                    "text": text,
                    "sourceRange": {
                        "startPage": current[0]["page"],
                        "endPage": current[-1]["page"],
                        "startLine": current[0]["line"],
                        "endLine": current[-1]["line"],
                    },
                }
            )
        current = []

    for item in lines:
        line = item["text"]
        if current and line_should_break_paragraph(line):
            flush()
        current.append(item)
        if line.endswith(("。", "矣。", "也。", "耳。")) and len("".join(x["text"] for x in current)) >= 180:
            flush()
        elif len("".join(x["text"] for x in current)) >= 420:
            flush()
    flush()
    return paragraphs


def build_chapters(rows: list[dict], book_id: str) -> tuple[list[dict], list[str]]:
    chapters: list[dict] = []
    warnings: list[str] = []
    collection: str | None = None
    current: dict | None = None
    current_lines: list[dict] = []

    def flush() -> None:
        nonlocal current, current_lines
        if current is None:
            current_lines = []
            return

        paragraphs_raw = split_paragraphs(current_lines)
        chapter_id = current["id"]
        paragraphs = []
        for order_index, p in enumerate(paragraphs_raw):
            p_hash = short_hash(p["text"])
            flag = "ok"
            notes: list[str] = []
            if len(p["text"]) > 900:
                flag = "suspect"
                notes.append("段落较长，可能需要人工复核切分。")
            paragraphs.append(
                {
                    "id": stable_id("paragraph", chapter_id, order_index, p_hash),
                    "chapterId": chapter_id,
                    "orderIndex": order_index,
                    "text": p["text"],
                    "blockType": "preface" if current["level"] == "序" else "p",
                    "parseHash": p_hash,
                    "sourceRange": p["sourceRange"],
                    "quality": {"flag": flag, "notes": notes},
                }
            )

        body = "\n".join(p["text"] for p in paragraphs)
        if not paragraphs:
            current["quality"] = {"flag": "suspect", "notes": ["章节未解析出正文段落。"]}
        elif any(p["quality"]["flag"] != "ok" for p in paragraphs):
            current["quality"] = {"flag": "suspect", "notes": ["章节内存在需复核段落。"]}
        else:
            current["quality"] = {"flag": "ok", "notes": []}

        current["sourceRange"]["endPage"] = current_lines[-1]["page"] if current_lines else current["sourceRange"]["startPage"]
        current["sourceRange"]["endLine"] = current_lines[-1]["line"] if current_lines else current["sourceRange"]["startLine"]
        current["contentHash"] = short_hash(body)
        current["paragraphs"] = paragraphs
        chapters.append(current)
        current = None
        current_lines = []

    for row in rows:
        line = row["text"]
        marker = is_collection_marker(line)
        if marker:
            collection = marker
            continue

        if re.fullmatch(r"(论篇|内容)\d+-\d+(法)?", line):
            continue
        if re.fullmatch(r"卷之[一二三四五六七八九十]+", line):
            continue

        heading = detect_heading(line, collection)
        if is_preface_heading(line):
            heading = {
                "title": line,
                "canonicalTitle": line,
                "collection": collection,
                "sequence": None,
                "level": "序",
            }

        if heading:
            flush()
            if heading["collection"]:
                collection = heading["collection"]
            chapter_id = stable_id(
                "chapter",
                book_id,
                heading.get("collection") or "unknown",
                heading.get("sequence") or "preface",
                heading["canonicalTitle"],
            )
            current = {
                "id": chapter_id,
                "bookId": book_id,
                "parentId": None,
                "orderIndex": len(chapters),
                "level": heading["level"],
                "title": heading["title"],
                "canonicalTitle": heading["canonicalTitle"],
                "collection": heading.get("collection"),
                "sequence": heading.get("sequence"),
                "sourceRange": {
                    "startPage": row["page"],
                    "endPage": row["page"],
                    "startLine": row["line"],
                    "endLine": row["line"],
                },
            }
            current_lines = []
            continue

        if current is None:
            # Skip cover/title and orphan text before the first explicit heading.
            continue
        current_lines.append(row)

    flush()

    for name in ["素问", "灵枢"]:
        seqs = sorted(c["sequence"] for c in chapters if c.get("collection") == name and c.get("sequence"))
        missing = [n for n in range(1, 82) if n not in seqs]
        if missing:
            warnings.append(f"{name} 缺少篇序标题: {missing}")
        duplicate = sorted(n for n in set(seqs) if seqs.count(n) > 1)
        if duplicate:
            warnings.append(f"{name} 存在重复篇序标题: {duplicate}")

    return chapters, warnings


def build_json(pdf_path: Path) -> dict:
    source_hash = sha256_file(pdf_path)
    book_id = stable_id("book", "黄帝内经", source_hash[:16])
    page_count, rows = extract_lines(pdf_path)
    chapters, warnings = build_chapters(rows, book_id)
    paragraph_count = sum(len(c["paragraphs"]) for c in chapters)

    expected_chapters = 2 + 81 + 81 - 2
    if len(chapters) != expected_chapters:
        warnings.append(f"解析得到章节 {len(chapters)} 个，按当前源 PDF 可见标题预期为 {expected_chapters} 个。")
    if paragraph_count == 0:
        warnings.append("未解析出段落。")

    status = "ok" if not warnings else "suspect"
    now = datetime.now(timezone.utc).replace(microsecond=0).isoformat()

    return {
        "schemaVersion": 1,
        "generator": {"name": PARSER_NAME, "version": PARSER_VERSION, "generatedAt": now},
        "book": {
            "id": book_id,
            "title": "黄帝内经",
            "author": None,
            "category": "内经",
            "language": "zh-Hans",
            "sourceFormat": "pdf",
            "importedAt": now,
        },
        "source": {
            "path": str(pdf_path),
            "sha256": source_hash,
            "format": "pdf",
            "pageCount": page_count,
            "extractedPages": {"start": 2, "end": page_count},
        },
        "parse": {
            "parser": PARSER_NAME,
            "parserVersion": PARSER_VERSION,
            "params": {
                "chapterHeading": "识别《素问》“...篇第X”和《灵枢》“...第X/第X法Y”标题行。",
                "paragraphSplit": "遇问答起始语另起段；长段按句号和长度阈值切分。",
                "textNormalization": ["去除行内空白", "移除页码/卷标/目录标记", "合并 PDF 换行"],
            },
        },
        "quality": {
            "status": status,
            "chapterCount": len(chapters),
            "paragraphCount": paragraph_count,
            "warnings": warnings,
        },
        "chapters": chapters,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", default="books/黄帝内经.pdf")
    parser.add_argument("--output", default="data/huangdi-neijing-original.json")
    args = parser.parse_args()

    pdf_path = Path(args.input)
    out_path = Path(args.output)
    out_path.parent.mkdir(parents=True, exist_ok=True)

    data = build_json(pdf_path)
    out_path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(
        json.dumps(
            {
                "output": str(out_path),
                "chapters": data["quality"]["chapterCount"],
                "paragraphs": data["quality"]["paragraphCount"],
                "status": data["quality"]["status"],
                "warnings": data["quality"]["warnings"],
            },
            ensure_ascii=False,
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
