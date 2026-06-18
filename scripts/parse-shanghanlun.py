#!/usr/bin/env python3
"""把 books/伤寒论.mobi 解析成 data/shanghanlun-original.json。

来源是 MOBI（实际由 calibre/coay 生成），通过 `mobi` 包解包为 EPUB3 后再解析。
正文为繁体宋本《伤寒论》，共 22 篇（辨脉法第一 … 辨發汗吐下後病脉證并治第二十二），
篇标题在正文中以「◆...第X．」标记，每条原文一个 <p>，夹杂大量空 <p> 与 witxt.com 水印。

输出遵循 docs/dev/book-import-json.md 的 ImportedBookJson 规范（schemaVersion 1）。
"""
import argparse
import hashlib
import json
import re
import uuid
from datetime import datetime, timezone
from pathlib import Path

from bs4 import BeautifulSoup

import mobi

PARSER_NAME = "shanghanlun-mobi-parser"
PARSER_VERSION = "1.0.0"
# 独立命名空间，避免与 nanjing/suwen 脚本的 stable_id 冲突
NAMESPACE = uuid.UUID("7f4a2c19-3b6e-5d8a-9f10-8a1b7d0f0000")


CN_NUM = "一二三四五六七八九十百千"

# 篇标题：「◆辨脉法第一．」——◆ 开头，末尾全角句点（．或。）
HEADING_RE = re.compile(r"^◆\s*(.+?)\s*第\s*([一二三四五六七八九十百千零〇]+)\s*[．。．]\s*$")
# witxt / coay 等来源水印噪声
NOISE_RE = re.compile(
    r"(witxt|coay|ireadweek|www\.|http|整理制作|更多txt|好书|加小编|微信|QQ|QQ：|电子书|周读|幸福的味道|会冬眠的米米|bbs\.)",
    re.IGNORECASE,
)


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def normalize_for_hash(text: str) -> str:
    """与 nanjing/suwen 脚本一致：去除全部空白后再哈希。"""
    return re.sub(r"\s+", "", text.strip())


def short_hash(text: str, length: int = 16) -> str:
    return hashlib.sha256(normalize_for_hash(text).encode("utf-8")).hexdigest()[:length]


def stable_id(kind: str, *parts: object) -> str:
    raw = "::".join([kind, *[str(p) for p in parts]])
    return str(uuid.uuid5(NAMESPACE, raw))


def cn_to_int(text: str) -> int | None:
    if not text:
        return None
    if text == "十":
        return 10
    if text.startswith("十"):
        return 10 + (cn_to_int(text[1:]) or 0)
    if "十" in text:
        left, right = text.split("十", 1)
        tens = cn_to_int(left) or 1
        return tens * 10 + (cn_to_int(right) or 0)
    digits = {"一": 1, "二": 2, "三": 3, "四": 4, "五": 5,
              "六": 6, "七": 7, "八": 8, "九": 9, "零": 0, "〇": 0}
    value = 0
    for ch in text:
        if ch not in digits:
            return None
        value = value * 10 + digits[ch]
    return value if value != 0 else None


def extract_epub_from_mobi(mobi_path: Path) -> tuple[list[str], list[str]]:
    """返回 (xhtml 相对名列表, 对应正文 HTML 字符串列表)，按 spine 正文顺序。"""
    _, epub_path = mobi.extract(str(mobi_path))
    epub_path = Path(epub_path)
    import zipfile

    with zipfile.ZipFile(epub_path) as z:
        opf_name = None
        try:
            container = z.read("META-INF/container.xml").decode("utf-8")
            m = re.search(r'full-path="([^"]+)"', container)
            opf_name = m.group(1) if m else None
        except KeyError:
            pass
        if not opf_name:
            for n in z.namelist():
                if n.endswith(".opf"):
                    opf_name = n
                    break
        opf_dir = str(Path(opf_name).parent) if opf_name else ""
        opf_xml = z.read(opf_name).decode("utf-8")
        all_data = {n: z.read(n) for n in z.namelist()}

    # 解析 manifest 与 spine，只取正文 part0003/4/5 这类文件
    soup = BeautifulSoup(opf_xml, "xml")
    manifest: dict[str, str] = {}
    for item in soup.find_all("item"):
        if item.get("media-type") == "application/xhtml+xml":
            item_id = item.get("id", "")
            href = item.get("href", "")
            full = str((Path(opf_dir) / href)) if opf_dir else href
            manifest[item_id] = full

    spine_ids = [s.get("idref") for s in soup.find_all("itemref")]
    names: list[str] = []
    contents: list[str] = []
    seen = set()
    # 跳过封面/版权页/目录页/尾页
    skip_parts = {"part0000.xhtml", "part0001.xhtml", "part0002.xhtml", "part0006.xhtml"}
    for sid in spine_ids:
        rel = manifest.get(sid)
        if not rel or rel in seen:
            continue
        base = Path(rel).name
        if not base.startswith("part") or base in skip_parts:
            continue
        seen.add(rel)
        names.append(rel)
        contents.append(all_data.get(rel, b"").decode("utf-8", errors="replace"))
    return names, contents


def clean_text(text: str) -> str:
    text = text.replace("\u3000", " ")
    text = re.sub(r"[ \t]+", "", text)
    text = re.sub(r"\n{2,}", "\n", text)
    return text.strip()


def is_noise(text: str) -> bool:
    if not text:
        return True
    if NOISE_RE.search(text):
        return True
    if re.fullmatch(r"[◆\s\d\-—_．。]+", text):
        return True
    return False


def parse_chapter_heading(text: str) -> dict | None:
    """识别「◆辨脉法第一．」式标题。"""
    m = HEADING_RE.match(text)
    if not m:
        return None
    title_body = "第" + m.group(2) + " " + m.group(1).rstrip()
    # 规范标题：去掉 ◆ 与末尾标点，保留「辨脉法第一」这种自然读法
    canonical = m.group(1).strip() + "第" + m.group(2)
    return {
        "title": m.group(1).strip() + "第" + m.group(2),
        "canonicalTitle": canonical,
        "sequence": cn_to_int(m.group(2)),
        "level": "篇",
    }


def split_paragraphs_from_block(text: str, max_chars: int = 500) -> list[str]:
    """伤寒论每条原文已天然成段（问答/方剂一句一条）；超长段按句末标点二次切分。"""
    text = clean_text(text)
    if not text:
        return []
    if len(text) <= max_chars:
        return [text]
    # 按句末标点切分（。．；：！？及全角形式），尽量不切断
    sentences = re.split(r"(?<=[。．；；！？!?])", text)
    out: list[str] = []
    buf = ""
    for s in sentences:
        if not s:
            continue
        if len(buf) + len(s) <= max_chars or not buf:
            buf += s
        else:
            out.append(buf)
            buf = s
    if buf:
        out.append(buf)
    return out


def build_chapters(names: list[str], contents: list[str], book_id: str) -> tuple[list[dict], list[str]]:
    chapters: list[dict] = []
    warnings: list[str] = []
    current: dict | None = None
    current_paragraphs: list[str] = []  # 累积文本，等遇到下一篇/结束时落段

    def flush_chapter() -> None:
        nonlocal current, current_paragraphs
        if current is None:
            current_paragraphs = []
            return
        chapter_id = current["id"]
        paragraphs: list[dict] = []
        order = 0
        for raw in current_paragraphs:
            for text in split_paragraphs_from_block(raw):
                if not text or is_noise(text):
                    continue
                p_hash = short_hash(text)
                flag = "ok"
                notes: list[str] = []
                if len(text) > 900:
                    flag = "suspect"
                    notes.append("段落较长，建议人工复核切分。")
                paragraphs.append({
                    "id": stable_id("paragraph", chapter_id, order, p_hash),
                    "chapterId": chapter_id,
                    "orderIndex": order,
                    "text": text,
                    "blockType": "p",
                    "parseHash": p_hash,
                    "sourceRange": {
                        "startPage": 1, "endPage": 1,
                        "startLine": order, "endLine": order,
                    },
                    "quality": {"flag": flag, "notes": notes},
                })
                order += 1
        body = "\n".join(p["text"] for p in paragraphs)
        if not paragraphs:
            current["quality"] = {"flag": "failed", "notes": ["篇章未解析出正文段落。"]}
        elif any(p["quality"]["flag"] != "ok" for p in paragraphs):
            current["quality"] = {"flag": "suspect", "notes": ["篇章内存在需复核段落。"]}
        else:
            current["quality"] = {"flag": "ok", "notes": []}
        current["contentHash"] = short_hash(body)
        current["paragraphs"] = paragraphs
        chapters.append(current)
        current = None
        current_paragraphs = []

    for _name, content in zip(names, contents):
        soup = BeautifulSoup(content, "html.parser")
        for p in soup.find_all("p"):
            text = clean_text(p.get_text())
            heading = parse_chapter_heading(text) if text.startswith("◆") else None
            if heading:
                flush_chapter()
                chapter_id = stable_id("chapter", book_id, heading["sequence"] or "unknown",
                                        heading["canonicalTitle"])
                current = {
                    "id": chapter_id,
                    "bookId": book_id,
                    "parentId": None,
                    "orderIndex": len(chapters),
                    "level": heading["level"],
                    "title": heading["title"],
                    "canonicalTitle": heading["canonicalTitle"],
                    "collection": "伤寒论",
                    "sequence": heading["sequence"],
                    "sourceRange": {"startPage": 1, "endPage": 1, "startLine": 0, "endLine": 0},
                }
                current_paragraphs = []
                continue
            if current is None:
                # 封面/版权页等前言噪声，跳过
                continue
            if is_noise(text):
                continue
            current_paragraphs.append(text)
    flush_chapter()

    # 篇序完整性校验：伤寒论共 22 篇
    seqs = sorted(c["sequence"] for c in chapters if c.get("sequence"))
    expected = 22
    missing = [n for n in range(1, expected + 1) if n not in seqs]
    if missing:
        warnings.append(f"伤寒论缺少篇序：{missing}")
    duplicate = sorted(n for n in set(seqs) if seqs.count(n) > 1)
    if duplicate:
        warnings.append(f"伤寒论存在重复篇序：{duplicate}")
    if len(chapters) != expected:
        warnings.append(f"解析得到章节 {len(chapters)} 个，预期 {expected} 个。")

    return chapters, warnings


def build_json(mobi_path: Path) -> dict:
    source_sha = sha256_file(mobi_path)
    book_id = stable_id("book", "伤寒论", source_sha[:16])
    names, contents = extract_epub_from_mobi(mobi_path)
    chapters, warnings = build_chapters(names, contents, book_id)
    paragraph_count = sum(len(c["paragraphs"]) for c in chapters)
    if paragraph_count == 0:
        warnings.append("未解析出段落。")
    status = "ok" if not warnings else "suspect"
    now = datetime.now(timezone.utc).replace(microsecond=0).isoformat()

    return {
        "schemaVersion": 1,
        "generator": {"name": PARSER_NAME, "version": PARSER_VERSION, "generatedAt": now},
        "book": {
            "id": book_id,
            "title": "伤寒论",
            "author": "张仲景",
            "category": "伤寒论",
            "language": "zh-Hant",
            "sourceFormat": "mobi",
            "importedAt": now,
        },
        "source": {
            "path": str(mobi_path),
            "sha256": source_sha,
            "format": "mobi",
            "entries": names,
        },
        "parse": {
            "parser": PARSER_NAME,
            "parserVersion": PARSER_VERSION,
            "params": {
                "chapterHeading": "识别正文中「◆...第X．」式 22 篇标题。",
                "paragraphSplit": "每条原文自然成段；超长段按句末标点二次切分（≤500 字）。",
                "textNormalization": ["去除行内空白", "过滤 witxt/coay 水印与空段", "保留繁体原文"],
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
    parser.add_argument("--input", default="books/伤寒论.mobi")
    parser.add_argument("--output", default="data/shanghanlun-original.json")
    args = parser.parse_args()

    mobi_path = Path(args.input)
    out_path = Path(args.output)
    out_path.parent.mkdir(parents=True, exist_ok=True)

    data = build_json(mobi_path)
    out_path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({
        "output": str(out_path),
        "chapters": data["quality"]["chapterCount"],
        "paragraphs": data["quality"]["paragraphCount"],
        "status": data["quality"]["status"],
        "warnings": data["quality"]["warnings"],
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
