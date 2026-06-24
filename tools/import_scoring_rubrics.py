"""
import_scoring_rubrics.py - archi2jiの採点ルーブリックをGASへ投入する

使い方:
  python tools/import_scoring_rubrics.py --url <exec_url> [--maintenance-token <token>] [--dry-run]

  --dry-run: GASにPOSTせずデータ検証結果のみ表示
"""
import argparse
import json
import os
from pathlib import Path
import sys
import time
import urllib.error
import urllib.request
import urllib.parse

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

REPO_ROOT = Path(__file__).resolve().parent.parent
DATA_FILE = str(REPO_ROOT / "data" / "scoring_rubrics.json")
BATCH_SIZE = 20


def load_rubrics(path: str) -> list[dict]:
    with open(path, encoding="utf-8") as f:
        data = json.load(f)

    if not isinstance(data, list):
        raise ValueError("scoring_rubrics.json must be a list")

    rubrics = []
    for item in data:
        qid = str(item.get("qId", "")).strip()
        if not qid:
            raise ValueError("qId is required")
        rubric_json = item.get("rubricJson") or {}
        if not isinstance(rubric_json, dict):
            raise ValueError(f"{qid}: rubricJson must be an object")
        rubrics.append({
            "qId": qid,
            "responseType": str(item.get("responseType", "")).strip(),
            "sourceQuality": str(item.get("sourceQuality", "")).strip(),
            "scoreMode": str(item.get("scoreMode", "")).strip(),
            "maxScore": item.get("maxScore", 10),
            "rubricJson": rubric_json,
            "reviewStatus": str(item.get("reviewStatus", "")).strip(),
        })
    return rubrics


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
    print("[+] トークン取得成功")
    return token


def post_batch(exec_url: str, token: str, batch: list[dict]) -> dict:
    payload = json.dumps({
        "token": token,
        "action": "importRubrics",
        "rubricsJson": json.dumps(batch, ensure_ascii=False),
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
    parser = argparse.ArgumentParser(description="archi2ji 採点ルーブリック投入")
    parser.add_argument("--url", required=True, help="GAS exec URL")
    parser.add_argument("--dry-run", action="store_true", help="データ検証のみ（POSTしない）")
    parser.add_argument("--data", default=DATA_FILE, help=f"ルーブリックJSONファイルパス (default: {DATA_FILE})")
    parser.add_argument("--maintenance-token", default="", help="GAS maintenance token（未指定時は環境変数 MAINTENANCE_TOKEN）")
    args = parser.parse_args()
    maintenance_token = args.maintenance_token or os.environ.get("MAINTENANCE_TOKEN", "")

    print(f"[*] データ読み込み: {args.data}")
    rubrics = load_rubrics(args.data)
    print(f"[+] {len(rubrics)}件 読み込み完了")
    print(f"    scoreMode: {sorted(set(r['scoreMode'] for r in rubrics))}")

    if args.dry_run:
        print("\n[DRY RUN] 最初の3件のサンプル:")
        for item in rubrics[:3]:
            print(json.dumps(item, ensure_ascii=False, indent=2))
        print(f"\n合計 {len(rubrics)} 件をインポート予定（--dry-run のため実行せず）")
        return

    token = get_token(args.url, maintenance_token)
    total_imported = 0
    total_updated = 0
    total_skipped = 0
    batches = [rubrics[i:i+BATCH_SIZE] for i in range(0, len(rubrics), BATCH_SIZE)]
    print(f"[*] {len(batches)}バッチ（{BATCH_SIZE}件/バッチ）で送信開始")

    for i, batch in enumerate(batches, 1):
        print(f"[*] バッチ {i}/{len(batches)} ({len(batch)}件) 送信中...")
        try:
            result = post_batch(args.url, token, batch)
            if result.get("_error"):
                print(f"[!] エラー: {result.get('message')}", file=sys.stderr)
                sys.exit(1)
            total_imported += int(result.get("imported", 0))
            total_updated += int(result.get("updated", 0))
            total_skipped += int(result.get("skipped", 0))
            print(f"[+] バッチ {i} 完了: imported={result.get('imported', 0)}, updated={result.get('updated', 0)}, skipped={result.get('skipped', 0)}")
        except urllib.error.HTTPError as e:
            print(f"[!] HTTP {e.code}: {e.read().decode()}", file=sys.stderr)
            sys.exit(1)

        if i < len(batches):
            time.sleep(2)

    print(f"\n[OK] 完了: imported={total_imported}, updated={total_updated}, skipped={total_skipped}")


if __name__ == "__main__":
    main()
