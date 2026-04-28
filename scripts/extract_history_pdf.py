from __future__ import annotations

import argparse
import json
import re
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Iterable

from pypdf import PdfReader


VOLUME_RE = re.compile(r"([七八九]年级（[上下]册）)")
LESSON_RE = re.compile(r"★\s*(第\s*[一二三四五六七八九十百零〇两\d０-９]+\s*课\s+[^\n]+)")
PAGE_MARK_RE = re.compile(r"第\s*\d+\s*页\s*共\s*\d+\s*页")


@dataclass
class Lesson:
    id: str
    grade: int
    volume: str
    title: str
    source_title: str
    text: str
    keywords: list[str]
    candidate_nodes: list[dict]


def normalize_text(text: str) -> str:
    text = text.replace("\u3000", " ")
    text = PAGE_MARK_RE.sub("", text)
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def chinese_grade_to_int(volume_title: str) -> int:
    return {"七": 7, "八": 8, "九": 9}[volume_title[0]]


def make_id(*parts: str) -> str:
    raw = "-".join(parts)
    raw = raw.replace("年级", "grade").replace("（", "-").replace("）", "")
    raw = raw.replace("上册", "vol-a").replace("下册", "vol-b")
    raw = re.sub(r"\s+", "-", raw)
    raw = re.sub(r"[^\w\-\u4e00-\u9fff]", "", raw)
    return raw.lower()


def extract_keywords(text: str, limit: int = 18) -> list[str]:
    candidates: list[str] = []
    patterns = [
        r"《[^》]{2,18}》",
        r"“[^”]{2,16}”",
        r"[一二三四五六七八九十百千万\d]+年(?:代)?",
        r"公元前\s*\d+\s*年",
        r"\d+\s*年",
    ]
    for pattern in patterns:
        candidates.extend(re.findall(pattern, text))

    nounish = re.findall(r"[\u4e00-\u9fff]{2,12}(?:运动|战争|变法|革命|条约|制度|会议|改革|文化|思想|路线|政策|工程|王朝|国家|文明|战役)", text)
    candidates.extend(nounish)

    seen = set()
    result = []
    for item in candidates:
        clean = re.sub(r"\s+", "", item.strip(" ，。、；：()（）"))
        if not clean or clean in seen:
            continue
        seen.add(clean)
        result.append(clean)
        if len(result) >= limit:
            break
    return result


def split_numbered_items(text: str) -> list[str]:
    pieces = re.split(r"(?=\n?\d+[．.])", text)
    return [re.sub(r"\s+", " ", p).strip() for p in pieces if len(p.strip()) > 12]


def infer_node_title(item: str) -> str:
    item = re.sub(r"^\d+[．.]\s*", "", item).strip()
    explicit = re.match(r"([^：:。（，,]{2,24})[：:]", item)
    if explicit:
        return explicit.group(1).strip()
    quoted = re.search(r"(《[^》]{2,18}》|“[^”]{2,16}”)", item)
    if quoted:
        return quoted.group(1)
    event = re.search(r"([\u4e00-\u9fff]{2,16}(?:运动|战争|变法|革命|条约|制度|会议|改革|工程|战役))", item)
    if event:
        return event.group(1)
    return item[:18].strip(" ，。、；：")


def classify_fact(item: str) -> dict[str, list[str]]:
    buckets = {
        "time": [],
        "people": [],
        "background": [],
        "process": [],
        "result": [],
        "influence": [],
        "exam_phrases": [],
    }
    if re.search(r"时间|公元|世纪|\d+\s*年|年代", item):
        buckets["time"].append(item)
    if re.search(r"人物|代表|主张|提出|接受|任用|领导|创立|建立", item):
        buckets["people"].append(item)
    if re.search(r"背景|原因|目的|为了", item):
        buckets["background"].append(item)
    if re.search(r"内容|措施|过程|包括|实行|推行|开通|发动", item):
        buckets["process"].append(item)
    if re.search(r"结果|标志|建立|灭亡|失败|胜利|形成", item):
        buckets["result"].append(item)
    if re.search(r"作用|意义|影响|促进|推动|加强|奠定|开端|确立", item):
        buckets["influence"].append(item)
    if re.search(r"最早|第一|开端|标志|根本|重要|意义|作用", item):
        buckets["exam_phrases"].append(item)
    return buckets


def build_candidate_nodes(lesson_id: str, lesson_text: str) -> list[dict]:
    nodes = []
    for index, item in enumerate(split_numbered_items(lesson_text), start=1):
        title = infer_node_title(item)
        if len(title) < 2:
            continue
        facts = classify_fact(item)
        nodes.append(
            {
                "id": f"{lesson_id}-node-{index:02d}",
                "title": title,
                "sourceExcerpt": item,
                "keywords": extract_keywords(item, 8),
                "timeText": "；".join(facts["time"]) or None,
                "people": facts["people"],
                "background": facts["background"],
                "process": facts["process"],
                "result": facts["result"],
                "influence": facts["influence"],
                "examPhrases": facts["exam_phrases"],
                "needsHumanReview": True,
            }
        )
    return nodes


def iter_lessons(full_text: str) -> Iterable[Lesson]:
    volume_matches = list(VOLUME_RE.finditer(full_text))
    for volume_index, volume_match in enumerate(volume_matches):
        volume_title = volume_match.group(1)
        volume_start = volume_match.end()
        volume_end = volume_matches[volume_index + 1].start() if volume_index + 1 < len(volume_matches) else len(full_text)
        volume_text = full_text[volume_start:volume_end].strip()
        lesson_matches = list(LESSON_RE.finditer(volume_text))
        for lesson_index, lesson_match in enumerate(lesson_matches):
            lesson_title = lesson_match.group(1).strip()
            start = lesson_match.end()
            end = lesson_matches[lesson_index + 1].start() if lesson_index + 1 < len(lesson_matches) else len(volume_text)
            lesson_text = normalize_text(volume_text[start:end])
            lesson_id = make_id(volume_title, lesson_title)
            yield Lesson(
                id=lesson_id,
                grade=chinese_grade_to_int(volume_title),
                volume="上" if "上册" in volume_title else "下",
                title=lesson_title,
                source_title=volume_title,
                text=lesson_text,
                keywords=extract_keywords(lesson_text),
                candidate_nodes=build_candidate_nodes(lesson_id, lesson_text),
            )


def write_markdown(out_file: Path, lessons: list[Lesson]) -> None:
    lines = [
        "# 初中历史 PDF 提取文本",
        "",
        "> 说明：本文件由 PDF 自动提取，仅作为知识库整理参考。进入 App 前需要人工校对、改写解释和补充考点关系。",
        "",
    ]
    current_volume = None
    for lesson in lessons:
        if lesson.source_title != current_volume:
            current_volume = lesson.source_title
            lines.extend([f"## {current_volume}", ""])
        lines.extend([f"### {lesson.title}", "", lesson.text, ""])
    out_file.write_text("\n".join(lines), encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--pdf", required=True, type=Path)
    parser.add_argument("--out-dir", required=True, type=Path)
    args = parser.parse_args()

    reader = PdfReader(str(args.pdf))
    pages = [normalize_text(page.extract_text() or "") for page in reader.pages]
    full_text = normalize_text("\n".join(pages))
    lessons = list(iter_lessons(full_text))

    source_dir = args.out_dir / "source"
    app_dir = args.out_dir / "app"
    source_dir.mkdir(parents=True, exist_ok=True)
    app_dir.mkdir(parents=True, exist_ok=True)

    (source_dir / "history-pdf-full-text.txt").write_text(full_text, encoding="utf-8")
    write_markdown(source_dir / "history-pdf-extracted.md", lessons)
    (source_dir / "history-pdf-lessons.json").write_text(
        json.dumps([asdict(lesson) for lesson in lessons], ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    nodes = []
    for lesson in lessons:
        for node in lesson.candidate_nodes:
            nodes.append(
                {
                    **node,
                    "period": None,
                    "textbook": {
                        "grade": lesson.grade,
                        "volume": lesson.volume,
                        "lesson": lesson.title,
                    },
                    "sourceLessonId": lesson.id,
                }
            )
    (app_dir / "history-nodes.candidate.json").write_text(
        json.dumps(nodes, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    (source_dir / "history-pdf-manifest.json").write_text(
        json.dumps(
            {
                "sourcePdf": str(args.pdf),
                "pageCount": len(reader.pages),
                "charCount": len(full_text),
                "lessonCount": len(lessons),
                "candidateNodeCount": len(nodes),
                "outputs": [
                    "source/history-pdf-full-text.txt",
                    "source/history-pdf-extracted.md",
                    "source/history-pdf-lessons.json",
                    "app/history-nodes.candidate.json",
                ],
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    print(f"pages={len(reader.pages)} lessons={len(lessons)} candidate_nodes={len(nodes)}")


if __name__ == "__main__":
    main()
