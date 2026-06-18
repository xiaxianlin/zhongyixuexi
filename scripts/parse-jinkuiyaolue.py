#!/usr/bin/env python3
"""把 books/金匮要略.epub 解析成 data/jinkuiyaolue-original.json。

来源是 EPUB2（calibre 制作，含 NCX 目录）。正文为简体《金匮要略》，
NCX 共 27 项：简介、金匮要略方论序、25 篇正文（卷上/卷中/卷下）。
每个 spine 文件中 <p class="calibre_4"> 是标题，其余 <p> 为正文，
含 <br class="calibre3"/> 的 <p> 需按 <br> 切成多段（问答/方剂条目天然分隔）。

输出遵循 docs/dev/book-import-json.md 的 ImportedBookJson 规范（schemaVersion 1）。
"""
import argparse
import hashlib
import json
import re
import uuid
import zipfile
from datetime import datetime, timezone
from pathlib import Path

from bs4 import BeautifulSoup, NavigableString, Tag

PARSER_NAME = "jinkuiyaolue-epub-parser"
PARSER_VERSION = "1.0.0"
# 独立命名空间，避免与其它脚本 stable_id 冲突
NAMESPACE = uuid.UUID("b2c3d4e5-4c7f-6e9b-a021-9b3c4d5e6f70")

CN_NUM = "一二三四五六七八九十百千零〇"

# 标题里提取「第X」（篇序）
SEQ_RE = re.compile(r"第\s*([一二三四五六七八九十百千零〇]+)\s*(?:篇|$)")
# 标题里提取「卷上/卷中/卷下」
JUAN_RE = re.compile(r"(卷[上中下])")
# 水印噪声（calibre/ikandou/ireadweek 等）
NOISE_RE = re.compile(
    r"(ikandou|ireadweek|coay|witxt|www\.|http|加小编|微信|QQ|整理制作|更多txt|周读|幸福的味道|电子书|行行)",
    re.IGNORECASE,
)


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def normalize_for_hash(text: str) -> str:
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
    if "百" in text:
        left, right = text.split("百", 1)
        hundreds = cn_to_int(left) or 1
        return hundreds * 100 + (cn_to_int(right) or 0)
    digits = {"一": 1, "二": 2, "三": 3, "四": 4, "五": 5,
              "六": 6, "七": 7, "八": 8, "九": 9, "零": 0, "〇": 0}
    value = 0
    for ch in text:
        if ch not in digits:
            return None
        value = value * 10 + digits[ch]
    return value if value != 0 else None


def clean_text(text: str) -> str:
    text = text.replace("\u3000", " ")
    text = re.sub(r"[ \t]+", "", text)
    text = re.sub(r"\n{2,}", "\n", text)
    text = text.strip()
    # 源 EPUB 把引用标记 ">" 误转义成字面 ">"，正文不应以 > 开头
    text = re.sub(r"^>+\.?", "", text)
    return text.strip()


def is_noise(text: str) -> bool:
    if not text:
        return True
    if NOISE_RE.search(text):
        return True
    if re.fullmatch(r"[\s\d\-—_．。、]+", text):
        return True
    return False


def split_by_br(p_tag: Tag) -> list[str]:
    """把含 <br> 的 <p> 按 <br> 切成多段文本。每个 <br> 之间为一段。"""
    segments: list[str] = []
    buf: list[str] = []
    for node in p_tag.children:
        if isinstance(node, NavigableString):
            buf.append(str(node))
        elif isinstance(node, Tag):
            if node.name == "br":
                seg = clean_text("".join(buf))
                if seg:
                    segments.append(seg)
                buf = []
            else:
                # <span> 等内联标签：取其文本
                buf.append(node.get_text())
    last = clean_text("".join(buf))
    if last:
        segments.append(last)
    return segments


def split_long(text: str, max_chars: int = 500) -> list[str]:
    text = clean_text(text)
    if len(text) <= max_chars:
        return [text] if text else []
    sentences = re.split(r"(?<=[。．；；！？!?])", text)
    out: list[str] = []
    buf = ""
    for s in sentences:
        if not s:
            continue
        if not buf or len(buf) + len(s) <= max_chars:
            buf += s
        else:
            out.append(buf)
            buf = s
    if buf:
        out.append(buf)
    return out


def parse_nav(epub_path: Path) -> tuple[list[dict], dict[str, str]]:
    """解析 NCX -> [(title, src_file), ...]；返回 nav 列表与 zip 内文件内容缓存。"""
    with zipfile.ZipFile(epub_path) as z:
        ncx_name = None
        container = z.read("META-INF/container.xml").decode("utf-8")
        m = re.search(r'full-path="([^"]+)"', container)
        opf_name = m.group(1) if m else "content.opf"
        opf_xml = z.read(opf_name).decode("utf-8")
        opf_dir = str(Path(opf_name).parent)
        # OPF metadata
        opf = BeautifulSoup(opf_xml, "xml")
        title_tag = opf.find("dc:title")
        creator_tag = opf.find("dc:creator")
        meta = {
            "title": title_tag.get_text(strip=True) if title_tag else epub_path.stem,
            "author": creator_tag.get_text(strip=True) if creator_tag else None,
        }
        # 找 NCX
        ncx_item = opf.find("item", attrs={"media-type": "application/x-dtbncx+xml"})
        ncx_name = str((Path(opf_dir) / ncx_item["href"])) if ncx_item else f"{opf_dir}/toc.ncx"
        ncx_xml = z.read(ncx_name).decode("utf-8")
        cache = {n: z.read(n).decode("utf-8", errors="replace") for n in z.namelist()}
    navs: list[dict] = []
    ncx = BeautifulSoup(ncx_xml, "xml")
    # navMap 下顶层 navPoint（金匮是扁平结构，playOrder 决定顺序）
    points = ncx.find_all("navPoint", recursive=True)
    # 仅取顶层（没有 navPoint 祖先）；金匮 NCX depth=2 但实际扁平
    top = [p for p in points if p.find_parent("navPoint") is None]
    for np in top:
        label = np.navLabel.get_text(strip=True) if np.navLabel else ""
        src = np.content.get("src", "").split("#")[0] if np.content else ""
        # 标准化路径（去掉目录前缀差异）
        src_base = Path(src).name
        navs.append({"title": label, "src": src, "src_base": src_base})
    return navs, cache, meta


def build_chapter(nav: dict, book_id: str, order_index: int, cache: dict[str, str]) -> dict:
    title = nav["title"]
    src_base = nav["src_base"]
    # 从标题解析卷次与篇序
    juan_m = JUAN_RE.search(title)
    seq_m = SEQ_RE.search(title)
    sequence = cn_to_int(seq_m.group(1)) if seq_m else None
    is_preface_like = title in {"简介", "金匮要略方论序"} or sequence is None

    # 章节级 id：卷次 + 篇序 + 标题
    chapter_id = stable_id("chapter", book_id, "金匮要略", juan_m.group(1) if juan_m else "",
                           sequence if sequence else title)

    # 取正文：src_base 对应的 html 内容
    content = ""
    for key, val in cache.items():
        if Path(key).name == src_base:
            content = val
            break
    soup = BeautifulSoup(content, "html.parser")
    body = soup.find("body")
    paragraphs_raw: list[str] = []
    if body:
        # 块级容器：<p> 与 <blockquote>（金匮部分篇目正文塞在 blockquote 里）
        for block in body.find_all(["p", "blockquote"]):
            classes = block.get("class") or []
            # calibre_4 是标题段，跳过（标题用 NCX 的）
            if "calibre_4" in classes:
                continue
            # 含 <br> 的块按段切；否则整段取文本
            if block.find("br"):
                paragraphs_raw.extend(split_by_br(block))
            else:
                t = clean_text(block.get_text())
                if t:
                    paragraphs_raw.append(t)

    # 二次切超长段 + 过滤噪声
    paragraphs: list[dict] = []
    order = 0
    for raw in paragraphs_raw:
        for text in split_long(raw):
            if is_noise(text):
                continue
            p_hash = short_hash(text)
            flag = "ok"
            notes: list[str] = []
            if len(text) > 900:
                flag = "suspect"
                notes.append("段落较长，建议人工复核切分。")
            block_type = "preface" if is_preface_like else "p"
            paragraphs.append({
                "id": stable_id("paragraph", chapter_id, order, p_hash),
                "chapterId": chapter_id,
                "orderIndex": order,
                "text": text,
                "blockType": block_type,
                "parseHash": p_hash,
                "sourceRange": {"startPage": 1, "endPage": 1, "startLine": order, "endLine": order},
                "quality": {"flag": flag, "notes": notes},
            })
            order += 1

    body_text = "\n".join(p["text"] for p in paragraphs)
    if not paragraphs:
        quality = {"flag": "suspect", "notes": ["章节未解析出正文段落。"]}
    elif any(p["quality"]["flag"] != "ok" for p in paragraphs):
        quality = {"flag": "suspect", "notes": ["章节内存在需复核段落。"]}
    else:
        quality = {"flag": "ok", "notes": []}

    level = "序" if title in {"简介", "金匮要略方论序"} else "篇"
    canonical_title = title
    # 规范标题：去掉「卷上/中/下 」前缀，保留篇名
    canonical_title = re.sub(r"^卷[上中下]\s*", "", title)

    return {
        "id": chapter_id,
        "bookId": book_id,
        "parentId": None,
        "orderIndex": order_index,
        "level": level,
        "title": title,
        "canonicalTitle": canonical_title,
        "collection": juan_m.group(1) if juan_m else None,
        "sequence": sequence,
        "sourceRange": {"startPage": 1, "endPage": 1, "startLine": 0, "endLine": order},
        "contentHash": short_hash(body_text),
        "quality": quality,
        "paragraphs": paragraphs,
    }


def build_json(epub_path: Path) -> dict:
    source_sha = sha256_file(epub_path)
    book_id = stable_id("book", "金匮要略", source_sha[:16])
    navs, cache, meta = parse_nav(epub_path)
    chapters = [build_chapter(nav, book_id, i, cache) for i, nav in enumerate(navs)]
    paragraph_count = sum(len(c["paragraphs"]) for c in chapters)

    warnings: list[str] = []
    seqs = sorted(c["sequence"] for c in chapters if c.get("sequence"))
    missing = [n for n in range(1, 26) if n not in seqs]
    if missing:
        warnings.append(f"金匮要略缺少篇序：{missing}")
    duplicate = sorted(n for n in set(seqs) if seqs.count(n) > 1)
    if duplicate:
        warnings.append(f"金匮要略存在重复篇序：{duplicate}")
    # 预期 2（简介+序）+ 25 = 27 章
    if len(chapters) != 27:
        warnings.append(f"解析得到章节 {len(chapters)} 个，预期 27 个。")
    if paragraph_count == 0:
        warnings.append("未解析出段落。")
    status = "ok" if not warnings else "suspect"
    now = datetime.now(timezone.utc).replace(microsecond=0).isoformat()

    return {
        "schemaVersion": 1,
        "generator": {"name": PARSER_NAME, "version": PARSER_VERSION, "generatedAt": now},
        "book": {
            "id": book_id,
            "title": meta["title"],
            "author": meta["author"],
            "category": "金匮要略",
            "language": "zh-Hans",
            "sourceFormat": "epub",
            "importedAt": now,
        },
        "source": {
            "path": str(epub_path),
            "sha256": source_sha,
            "format": "epub",
            "entries": [n["src_base"] for n in navs],
        },
        "parse": {
            "parser": PARSER_NAME,
            "parserVersion": PARSER_VERSION,
            "params": {
                "chapterHeading": "采用 NCX 目录 27 项（简介、序、卷上/中/下共 25 篇）。",
                "paragraphSplit": "按 <br> 切分问答/方剂条目；超长段按句末标点二次切分（≤500 字）。",
                "textNormalization": ["去除行内空白", "过滤 ikandou/水印与空段", "标题取自 NCX"],
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
    parser.add_argument("--input", default="books/金匮要略.epub")
    parser.add_argument("--output", default="data/jinkuiyaolue-original.json")
    args = parser.parse_args()

    epub_path = Path(args.input)
    out_path = Path(args.output)
    out_path.parent.mkdir(parents=True, exist_ok=True)

    data = build_json(epub_path)
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
