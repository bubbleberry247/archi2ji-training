#!/usr/bin/env python3
"""Restore R4 cloze-choice separators verified against the official PDF.

The R4 OCR source loses the vertical table-cell boundaries when it is cleaned.
This is intentionally a qId-scoped canonical-data generator: it changes only
the presentation text of Q_R4_5 and Q_R4_6, and never answer keys, rubrics,
question metadata, or attempt data.

Source checked:
  https://www.fcip-shiken.jp/pdf/r04_1kj_mondai.pdf
  (repo mirror: output/question-images/pdfs/r04_1kj_mondai.pdf)
"""

from __future__ import annotations

import argparse
import copy
import json
import re
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parent.parent
CANONICAL_FILE = REPO_ROOT / "data" / "kenchiku2ji_mondai_all.json"
OFFICIAL_SOURCE = "https://www.fcip-shiken.jp/pdf/r04_1kj_mondai.pdf"


# Problem 5, PDF pages 8-11. Each tuple is (a, b, c), transcribed from the
# official table. The circled row numbers are added as display-only labels.
Q5_TABLES: list[list[tuple[str, str, str]]] = [
    [
        ("30", "載荷係数", "2.0"),
        ("30", "沈下量", "2.0"),
        ("20", "載荷係数", "3.0"),
        ("20", "沈下量", "3.0"),
        ("30", "沈下量", "3.0"),
    ],
    [
        ("平状", "水締め", "水平"),
        ("爪状", "水締め", "鉛直"),
        ("平状", "転圧", "水平"),
        ("爪状", "転圧", "水平"),
        ("平状", "転圧", "鉛直"),
    ],
    [
        ("10", "ハンマーグラブ", "沈殿バケット"),
        ("5", "ハンマーグラブ", "沈殿バケット"),
        ("5", "ドリリングバケット", "底ざらいバケット"),
        ("10", "ドリリングバケット", "沈殿バケット"),
        ("5", "ハンマーグラブ", "底ざらいバケット"),
    ],
    [
        ("2", "酸化炎", "3"),
        ("2", "酸化炎", "2"),
        ("2", "中性炎", "2"),
        ("5", "中性炎", "2"),
        ("5", "酸化炎", "3"),
    ],
    [
        ("大きく", "大きい", "大きい"),
        ("小さく", "小さい", "大きい"),
        ("大きく", "小さい", "大きい"),
        ("小さく", "大きい", "小さい"),
        ("大きく", "大きい", "小さい"),
    ],
    [
        ("破断", "内側", "近接させる"),
        ("圧縮", "外側", "近接させる"),
        ("破断", "外側", "近接させる"),
        ("破断", "内側", "離す"),
        ("圧縮", "外側", "離す"),
    ],
    [
        ("30", "90", "直後"),
        ("35", "120", "直前"),
        ("35", "90", "直後"),
        ("30", "90", "直前"),
        ("30", "120", "直後"),
    ],
    [
        ("150", "2", "5"),
        ("150", "3", "15"),
        ("100", "2", "15"),
        ("100", "2", "5"),
        ("100", "3", "5"),
    ],
]

# Exact compact rows produced by the legacy R4 OCR parser. Some numeric cells
# are absent because the PDF text layer encoded them as control characters.
# These values are accepted only when the parser explicitly enables the OCR
# source mode; canonical repair remains strict.
Q5_OCR_TABLE_ROWS: list[list[str]] = [
    ["30載荷係数2.0", "30沈下量2.0", "20載荷係数3.0", "20沈下量3.0", "30沈下量3.0"],
    ["平状水締め水平", "爪状水締め鉛直", "平状転圧水平", "爪状転圧水平", "平状転圧鉛直"],
    [
        "10ハンマーグラブ沈殿バケット",
        "5ハンマーグラブ沈殿バケット",
        "5ドリリングバケット底ざらいバケット",
        "10ドリリングバケット沈殿バケット",
        "5ハンマーグラブ底ざらいバケット",
    ],
    ["酸化炎", "酸化炎", "中性炎", "中性炎", "酸化炎"],
    ["大きく大きい大きい", "小さく小さい大きい", "大きく小さい大きい", "小さく大きい小さい", "大きく大きい小さい"],
    ["破断内側近接させる", "圧縮外側近接させる", "破断外側近接させる", "破断内側離す", "圧縮外側離す"],
    ["3090直後", "35120直前", "3590直後", "3090直前", "30120直後"],
    ["1505", "15015", "10015", "1005", "1005"],
]


# Problem 6, PDF pages 12-13. These are the five alternatives for each
# blank; separators make the original choice boundaries explicit.
Q6_CHOICES: dict[str, list[str]] = {
    "①": ["注文者", "発注者", "依頼者", "事業者", "受注者"],
    "②": ["20", "30", "40", "50", "60"],
    "③": ["3", "4", "5", "6", "7"],
    "④": ["3", "4", "5", "6", "7"],
    "⑤": ["破損", "損壊", "危険", "労働災害", "事故"],
    "⑥": ["教育", "技術", "施工", "作業", "安全"],
}

Q6_OCR_CHOICES: dict[str, str] = {
    "①": "注文者発注者依頼者事業者受注者",
    "②": "2030405060",
    "③": "&4",
    "④": "&4",
    "⑤": "破損損壊危険労働災害事故",
    "⑥": "教育技術施工作業安全",
}


def compact(value: str) -> str:
    """Compare OCR rows without treating whitespace as content."""

    return re.sub(r"\s+", "", value)


def format_row(parts: tuple[str, str, str], row_number: int) -> str:
    return f"{chr(0x2460 + row_number)} {' ／ '.join(parts)}"


def repair_q5(stem: str, *, allow_ocr_source: bool = False) -> str:
    lines = stem.splitlines()
    header_indices = [i for i, line in enumerate(lines) if line == "ａｂｃ"]
    if len(header_indices) != len(Q5_TABLES):
        raise ValueError(
            f"Q_R4_5 expected {len(Q5_TABLES)} a/b/c tables, found {len(header_indices)}"
        )

    # Replace in reverse order so this remains safe if a future row formatter
    # changes the number of lines in a table.
    for table_no, (header_index, expected_rows) in reversed(
        list(enumerate(zip(header_indices, Q5_TABLES)))
    ):
        current_rows = lines[header_index + 1 : header_index + 6]
        if len(current_rows) != 5 or any(not row.strip() for row in current_rows):
            raise ValueError(f"Q_R4_5 table {table_no + 1} does not have five rows")
        formatted_rows = [
            format_row(row, row_no) for row_no, row in enumerate(expected_rows)
        ]
        if current_rows == formatted_rows:
            continue
        for row_no, (current, expected) in enumerate(zip(current_rows, expected_rows)):
            accepted = {compact("".join(expected))}
            if allow_ocr_source:
                accepted.add(compact(Q5_OCR_TABLE_ROWS[table_no][row_no]))
            if compact(current) not in accepted:
                raise ValueError(
                    f"Q_R4_5 table {table_no + 1} source mismatch: "
                    f"{current!r} != {''.join(expected)!r}"
                )
        lines[header_index + 1 : header_index + 6] = formatted_rows
    return "\n".join(lines)


def repair_q6(stem: str, *, allow_ocr_source: bool = False) -> str:
    lines = stem.splitlines()
    for key, values in Q6_CHOICES.items():
        expected_compact = compact("".join(values))
        formatted = f"{key} {' ／ '.join(values)}"
        if lines.count(formatted) == 1:
            continue
        accepted = {expected_compact}
        if allow_ocr_source:
            accepted.add(compact(Q6_OCR_CHOICES[key]))
        candidates = [
            i
            for i, line in enumerate(lines)
            if line.startswith(key) and compact(line[len(key) :]) in accepted
        ]
        if len(candidates) != 1:
            raise ValueError(f"Q_R4_6 expected one choice row for {key}, found {len(candidates)}")
        index = candidates[0]
        current = lines[index][len(key) :]
        if compact(current) not in accepted:
            raise ValueError(
                f"Q_R4_6 source mismatch for {key}: {current!r} != {''.join(values)!r}"
            )
        lines[index] = f"{key} {' ／ '.join(values)}"
    return "\n".join(lines)


def postprocess_parser_questions(questions: list[dict]) -> list[dict]:
    """Apply the verified R4 layout after OCR parsing and before JSON output."""

    out = copy.deepcopy(questions)
    matches = {
        5: [q for q in out if q.get("year") == "R4" and q.get("questionNumber") == 5],
        6: [q for q in out if q.get("year") == "R4" and q.get("questionNumber") == 6],
    }
    for number, rows in matches.items():
        if len(rows) != 1:
            raise ValueError(f"R4 question {number} expected exactly once, found {len(rows)}")
    matches[5][0]["stem"] = repair_q5(str(matches[5][0].get("stem", "")), allow_ocr_source=True)
    matches[6][0]["stem"] = repair_q6(str(matches[6][0].get("stem", "")), allow_ocr_source=True)
    return out


def repaired_questions(data: list[dict]) -> list[dict]:
    out = copy.deepcopy(data)
    by_id = {str(q.get("qId", "")): q for q in out}
    for qid in ("Q_R4_5", "Q_R4_6"):
        if qid not in by_id:
            raise ValueError(f"missing canonical question: {qid}")
    by_id["Q_R4_5"]["stem"] = repair_q5(str(by_id["Q_R4_5"].get("stem", "")))
    by_id["Q_R4_6"]["stem"] = repair_q6(str(by_id["Q_R4_6"].get("stem", "")))
    return out


def changed_fields(before: list[dict], after: list[dict]) -> list[tuple[str, str]]:
    changes: list[tuple[str, str]] = []
    for old, new in zip(before, after):
        qid = str(old.get("qId", ""))
        for key in old.keys() | new.keys():
            if old.get(key) != new.get(key):
                changes.append((qid, key))
    return changes


def serialize_like_original(path: Path, data: list[dict]) -> bytes:
    original = path.read_bytes()
    newline = "\r\n" if b"\r\n" in original else "\n"
    text = json.dumps(data, ensure_ascii=False, indent=2) + "\n"
    if newline == "\r\n":
        text = text.replace("\n", "\r\n")
    return text.encode("utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--write",
        action="store_true",
        help="write the verified qId-scoped repair to the canonical JSON",
    )
    args = parser.parse_args()

    before = json.loads(CANONICAL_FILE.read_text(encoding="utf-8"))
    after = repaired_questions(before)
    changes = changed_fields(before, after)
    allowed = {("Q_R4_5", "stem"), ("Q_R4_6", "stem")}
    if not set(changes).issubset(allowed):
        raise AssertionError(f"unexpected canonical changes: {changes}")

    print(f"source: {OFFICIAL_SOURCE}")
    print("targets: Q_R4_5, Q_R4_6")
    if changes:
        print("changed fields: " + ", ".join(f"{qid}.{field}" for qid, field in changes))
    else:
        print("changed fields: none (canonical already repaired)")
    print("other question/metadata/answer fields: unchanged")
    if args.write:
        CANONICAL_FILE.write_bytes(serialize_like_original(CANONICAL_FILE, after))
        print(f"written: {CANONICAL_FILE}")
    else:
        print("dry-run: no files written")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
