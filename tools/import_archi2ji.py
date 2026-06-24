"""
import_archi2ji.py — archi2jiのQuestionBankに問題データを投入する

使い方:
  python tools/import_archi2ji.py --url <exec_url> [--maintenance-token <token>] [--dry-run]

  --dry-run: GASにPOSTせずデータ変換結果のみ表示
"""
import argparse
import json
import os
from pathlib import Path
import sys
import time
import urllib.request
import urllib.error
import urllib.parse

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

REPO_ROOT = Path(__file__).resolve().parent.parent
DATA_FILE = str(REPO_ROOT / "data" / "kenchiku2ji_mondai_all.json")
BATCH_SIZE = 6


def normalize_image_urls(value) -> list[str]:
    if not value:
        return []
    if isinstance(value, list):
        return [str(v).strip() for v in value if str(v).strip()]
    if isinstance(value, dict):
        return [str(v).strip() for v in value.values() if str(v).strip()]
    return [v.strip() for v in str(value).split(",") if v.strip()]


def load_questions(path: str) -> list[dict]:
    with open(path, encoding="utf-8") as f:
        data = json.load(f)

    questions = []
    for q in data:
        year = str(q.get("year", "")).strip()
        number = q.get("questionNumber", 0)
        q_type = str(q.get("questionType", "essay")).strip()
        stem = str(q.get("stem", "")).strip()

        # modelAnswer: JSON側の学習用参考答案を優先し、正答キーのみの問題は変換する
        model_answer = str(q.get("modelAnswer", "")).strip()
        if not model_answer and "correctAnswers" in q and q["correctAnswers"]:
            ca = q["correctAnswers"]
            if isinstance(ca, list):
                model_answer = ", ".join(str(x) for x in ca)
            elif isinstance(ca, dict):
                model_answer = json.dumps(ca, ensure_ascii=False)

        # tags: JSON側のタグを保持し、questionTypeも必ず含める
        raw_tags = q.get("tags", [])
        if not isinstance(raw_tags, list):
            raw_tags = [raw_tags]
        tags = []
        for tag in [q_type] + raw_tags:
            tag = str(tag or "").strip()
            if tag and tag not in tags:
                tags.append(tag)

        questions.append({
            "qId": str(q.get("qId", f"Q_{year}_{number}")).strip(),
            "year": year,
            "questionNumber": number,
            "questionType": q_type,
            "stem": stem,
            "modelAnswer": model_answer,
            "tags": tags,
            "imageRequired": bool(q.get("imageRequired", False)),
            "imageUrls": normalize_image_urls(q.get("imageUrls") or q.get("imageUrl") or q.get("images")),
        })

    return questions


def get_token(exec_url: str, maintenance_token: str = "") -> str:
    params = {"action": "initImportToken"}
    if maintenance_token:
        params["maintenanceToken"] = maintenance_token
    sep = "&" if "?" in exec_url else "?"
    url = f"{exec_url}{sep}{urllib.parse.urlencode(params)}"
    safe_params = dict(params)
    if "maintenanceToken" in safe_params:
        safe_params["maintenanceToken"] = "****"
    print(f"[*] トークン取得: {exec_url}{sep}{urllib.parse.urlencode(safe_params)}")
    req = urllib.request.Request(url)
    with urllib.request.urlopen(req, timeout=30) as resp:
        body = json.loads(resp.read().decode("utf-8"))
    token = body.get("token", "")
    if not token:
        raise RuntimeError(f"トークン取得失敗: {body}")
    print(f"[+] トークン取得成功")
    return token


def post_batch(exec_url: str, token: str, batch: list[dict]) -> dict:
    payload = json.dumps({
        "token": token,
        "action": "importQuestions",
        "questionsJson": json.dumps(batch, ensure_ascii=False),
    }, ensure_ascii=False).encode("utf-8")

    req = urllib.request.Request(
        exec_url,
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        return json.loads(resp.read().decode("utf-8"))


def main():
    parser = argparse.ArgumentParser(description="archi2ji 問題データ投入")
    parser.add_argument("--url", required=True, help="GAS exec URL")
    parser.add_argument("--dry-run", action="store_true", help="データ変換のみ（POSTしない）")
    parser.add_argument("--data", default=DATA_FILE, help=f"データJSONファイルパス (default: {DATA_FILE})")
    parser.add_argument("--maintenance-token", default="", help="GAS maintenance token（未指定時は環境変数 MAINTENANCE_TOKEN）")
    args = parser.parse_args()
    maintenance_token = args.maintenance_token or os.environ.get("MAINTENANCE_TOKEN", "")

    # データ読み込み
    data_file = args.data
    print(f"[*] データ読み込み: {data_file}")
    questions = load_questions(data_file)
    print(f"[+] {len(questions)}問 読み込み完了")

    years = sorted(set(q["year"] for q in questions))
    print(f"    年度: {years}")

    if args.dry_run:
        print("\n[DRY RUN] 最初の3問のサンプル:")
        for q in questions[:3]:
            print(json.dumps(q, ensure_ascii=False, indent=2))
        print(f"\n合計 {len(questions)} 問をインポート予定（--dry-run のため実行せず）")
        return

    # トークン取得
    token = get_token(args.url, maintenance_token)

    # バッチ送信
    total_imported = 0
    total_updated = 0
    total_skipped = 0
    batches = [questions[i:i+BATCH_SIZE] for i in range(0, len(questions), BATCH_SIZE)]
    print(f"[*] {len(batches)}バッチ（{BATCH_SIZE}問/バッチ）で送信開始")

    for i, batch in enumerate(batches, 1):
        print(f"[*] バッチ {i}/{len(batches)} ({len(batch)}問) 送信中...")
        try:
            result = post_batch(args.url, token, batch)
            if result.get("_error"):
                print(f"[!] エラー: {result.get('message')}", file=sys.stderr)
                sys.exit(1)
            imported = result.get("imported", 0)
            updated = result.get("updated", 0)
            skipped = result.get("skipped", 0)
            total_imported += imported
            total_updated += updated
            total_skipped += skipped
            print(f"[+] バッチ {i} 完了: {imported}問インポート, {updated}問更新, {skipped}問スキップ")
        except urllib.error.HTTPError as e:
            print(f"[!] HTTP {e.code}: {e.read().decode()}", file=sys.stderr)
            sys.exit(1)

        if i < len(batches):
            time.sleep(2)  # GAS rate limit対策

    print(f"\n[OK] 完了: 合計 {total_imported} 問インポート, {total_updated} 問更新, {total_skipped} 問スキップ")


if __name__ == "__main__":
    main()
