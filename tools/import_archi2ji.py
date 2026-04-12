"""
import_archi2ji.py — archi2jiのQuestionBankに問題データを投入する

使い方:
  python tools/import_archi2ji.py --url <exec_url> [--dry-run]

  --dry-run: GASにPOSTせずデータ変換結果のみ表示
"""
import argparse
import json
import sys
import time
import urllib.request
import urllib.error

DATA_FILE = "C:/tmp/kakomon/kenchiku2ji/kenchiku2ji_mondai_all.json"
BATCH_SIZE = 20


def load_questions(path: str) -> list[dict]:
    with open(path, encoding="utf-8") as f:
        data = json.load(f)

    questions = []
    for q in data:
        year = str(q.get("year", "")).strip()
        number = q.get("questionNumber", 0)
        q_type = str(q.get("questionType", "essay")).strip()
        stem = str(q.get("stem", "")).strip()

        # modelAnswer: correctAnswersがある場合は変換
        model_answer = ""
        if "correctAnswers" in q and q["correctAnswers"]:
            ca = q["correctAnswers"]
            if isinstance(ca, list):
                model_answer = ", ".join(str(x) for x in ca)
            elif isinstance(ca, dict):
                model_answer = json.dumps(ca, ensure_ascii=False)

        # tags: questionTypeを基準に設定
        tags = [q_type] if q_type else []

        questions.append({
            "year": year,
            "questionNumber": number,
            "questionType": q_type,
            "stem": stem,
            "modelAnswer": model_answer,
            "tags": tags,
        })

    return questions


def get_token(exec_url: str) -> str:
    url = f"{exec_url}?action=initImportToken"
    print(f"[*] トークン取得: {url}")
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
    args = parser.parse_args()

    # データ読み込み
    print(f"[*] データ読み込み: {DATA_FILE}")
    questions = load_questions(DATA_FILE)
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
    token = get_token(args.url)

    # バッチ送信
    total_imported = 0
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
            total_imported += imported
            print(f"[+] バッチ {i} 完了: {imported}問インポート")
        except urllib.error.HTTPError as e:
            print(f"[!] HTTP {e.code}: {e.read().decode()}", file=sys.stderr)
            sys.exit(1)

        if i < len(batches):
            time.sleep(2)  # GAS rate limit対策

    print(f"\n✅ 完了: 合計 {total_imported} 問インポート")


if __name__ == "__main__":
    main()
