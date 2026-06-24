"""
parse_archi2ji_r1r4.py — R1-R4 OCR text JSON から問題データを生成

使い方:
  python tools/parse_archi2ji_r1r4.py [--dry-run]

出力:
  C:/tmp/kakomon/kenchiku2ji/kenchiku2ji_r1r4_questions.json
"""
import argparse
import json
from pathlib import Path
import re
import sys

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

YEARS = ["R1", "R2", "R3", "R4"]
REPO_ROOT = Path(__file__).resolve().parent.parent
SOURCE_DIR = REPO_ROOT / "data"
OUTPUT_FILE = SOURCE_DIR / "kenchiku2ji_r1r4_questions.json"

# Year label mapping (for GAS: "R1" etc.)
YEAR_LABEL = {
    "R1": "R1",
    "R2": "R2",
    "R3": "R3",
    "R4": "R4",
}


def clean_ocr(text: str) -> str:
    """OCRアーティファクトを除去してクリーンなテキストを返す。"""
    # "亜" → "、" (Japanese comma artifact)
    text = text.replace("亜", "、")
    # "唖" → "。" (Japanese period artifact)
    text = text.replace("唖", "。")
    # Control characters (\x00-\x1f) except newline/tab/return
    text = re.sub(r'[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]', '', text)
    # Page markers like "P ― 3", "P - 3", "P―3"
    text = re.sub(r'\bP\s*[―\-]+\s*\d+\b', '', text)
    # Multiple blank lines → single blank line
    text = re.sub(r'\n{3,}', '\n\n', text)
    return text.strip()


def is_question_start(text: str) -> bool:
    """問題開始ページかどうか判定（先頭が '問題' で始まる）。"""
    stripped = text.strip()
    return stripped.startswith("問題")


def extract_question_stem(text: str) -> str:
    """問題テキストから stem を抽出（先頭の "問題" を除去）。"""
    stripped = text.strip()
    # Remove leading "問題" prefix
    if stripped.startswith("問題"):
        stripped = stripped[2:].strip()
    return stripped


def parse_year(year: str) -> list[dict]:
    """1年度分のOCR JSONを読み込み、問題リストを返す。"""
    path = SOURCE_DIR / f"kenchiku2ji_{year}_text.json"
    with open(path, encoding="utf-8") as f:
        data = json.load(f)

    pages = data.get("pages", [])
    questions = []
    current_parts = []
    question_num = 0

    for i, page_text in enumerate(pages):
        if i == 0:
            # Skip cover page
            continue

        cleaned = clean_ocr(page_text)

        if not cleaned:
            # Empty page (usually last page)
            continue

        if is_question_start(cleaned):
            # Save previous question
            if current_parts:
                stem = "\n\n".join(current_parts).strip()
                question_num += 1
                questions.append({
                    "year": YEAR_LABEL[year],
                    "questionNumber": question_num,
                    "questionType": "essay",
                    "stem": stem,
                    "modelAnswer": "",
                    "tags": ["essay"],
                })
                current_parts = []

            # Start new question — strip "問題" prefix
            stem_part = extract_question_stem(cleaned)
            if stem_part:
                current_parts = [stem_part]
        else:
            # Continuation page
            if current_parts:
                current_parts.append(cleaned)
            # If no current question yet (shouldn't happen after skipping cover),
            # skip this page

    # Save last question
    if current_parts:
        stem = "\n\n".join(current_parts).strip()
        question_num += 1
        questions.append({
            "year": YEAR_LABEL[year],
            "questionNumber": question_num,
            "questionType": "essay",
            "stem": stem,
            "modelAnswer": "",
            "tags": ["essay"],
        })

    return questions


def main():
    parser = argparse.ArgumentParser(description="R1-R4 OCR → 問題JSON変換")
    parser.add_argument("--dry-run", action="store_true",
                        help="変換結果を表示するだけ（ファイル書き出しなし）")
    args = parser.parse_args()

    all_questions = []
    for year in YEARS:
        try:
            qs = parse_year(year)
            print(f"[{year}] {len(qs)}問 抽出完了")
            for q in qs:
                print(f"  問題{q['questionNumber']}: {q['stem'][:60]}...")
            all_questions.extend(qs)
        except FileNotFoundError:
            print(f"[{year}] ファイルが見つかりません: kenchiku2ji_{year}_text.json",
                  file=sys.stderr)

    print(f"\n合計: {len(all_questions)}問")

    if args.dry_run:
        print("\n[DRY RUN] ファイル書き出しをスキップ")
        return

    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        json.dump(all_questions, f, ensure_ascii=False, indent=2)
    print(f"\n[+] 出力完了: {OUTPUT_FILE}")
    print("次のステップ:")
    print(f"  python tools/import_archi2ji.py --url <exec_url>")
    print(f"  ※ import_archi2ji.py の DATA_FILE を {OUTPUT_FILE} に変更するか --data オプションを使用してください")


if __name__ == "__main__":
    main()
