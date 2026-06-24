"""
live_import_check.py - archi2ji GAS live import diagnostic

Usage:
  python tools/live_import_check.py --url <exec_url> --run

Set MAINTENANCE_TOKEN in the environment, or pass --maintenance-token.
This script does not print the maintenance token or import token.
"""
import argparse
import json
import os
from pathlib import Path
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

REPO_ROOT = Path(__file__).resolve().parent.parent
QUESTIONS_FILE = REPO_ROOT / "data" / "kenchiku2ji_mondai_all.json"
RUBRICS_FILE = REPO_ROOT / "data" / "scoring_rubrics.json"
BATCH_SIZE = 20
QUESTION_BATCH_SIZE = 6


def normalize_image_urls(value) -> list[str]:
    if not value:
        return []
    if isinstance(value, list):
        return [str(v).strip() for v in value if str(v).strip()]
    if isinstance(value, dict):
        return [str(v).strip() for v in value.values() if str(v).strip()]
    return [v.strip() for v in str(value).split(",") if v.strip()]


def request_json(url: str, *, data: dict | None = None, timeout: int = 60) -> dict:
    body = None
    headers = {}
    method = "GET"
    if data is not None:
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        headers["Content-Type"] = "application/json"
        method = "POST"
    req = urllib.request.Request(url, data=body, headers=headers, method=method)
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        text = resp.read().decode("utf-8")
    return json.loads(text)


def add_query(url: str, params: dict) -> str:
    sep = "&" if "?" in url else "?"
    return f"{url}{sep}{urllib.parse.urlencode(params)}"


def get_diag(exec_url: str) -> dict:
    return request_json(add_query(exec_url, {"action": "diag"}), timeout=30)


def get_import_token(exec_url: str, maintenance_token: str) -> str:
    params = {"action": "initImportToken"}
    if maintenance_token:
        params["maintenanceToken"] = maintenance_token
    data = request_json(add_query(exec_url, params), timeout=30)
    if data.get("_error"):
        raise RuntimeError(f"initImportToken failed: {data}")
    token = str(data.get("token", ""))
    if not token:
        raise RuntimeError(f"initImportToken returned no token: {data}")
    return token


def load_questions() -> list[dict]:
    data = json.loads(QUESTIONS_FILE.read_text(encoding="utf-8"))
    rows = []
    for q in data:
        rows.append({
            "qId": str(q.get("qId", "")).strip(),
            "year": str(q.get("year", "")).strip(),
            "questionNumber": q.get("questionNumber", 0),
            "questionType": str(q.get("questionType", "essay")).strip(),
            "stem": str(q.get("stem", "")).strip(),
            "modelAnswer": str(q.get("modelAnswer", "")).strip(),
            "tags": q.get("tags", []),
            "imageRequired": bool(q.get("imageRequired", False)),
            "imageUrls": normalize_image_urls(q.get("imageUrls") or q.get("imageUrl") or q.get("images")),
        })
    return rows


def load_rubrics() -> list[dict]:
    data = json.loads(RUBRICS_FILE.read_text(encoding="utf-8"))
    rows = []
    for r in data:
        rows.append({
            "qId": str(r.get("qId", "")).strip(),
            "responseType": str(r.get("responseType", "")).strip(),
            "sourceQuality": str(r.get("sourceQuality", "")).strip(),
            "scoreMode": str(r.get("scoreMode", "")).strip(),
            "maxScore": r.get("maxScore", 10),
            "rubricJson": r.get("rubricJson", {}),
            "reviewStatus": str(r.get("reviewStatus", "")).strip(),
        })
    return rows


def post_import(exec_url: str, token: str, action: str, key: str, rows: list[dict], batch_size: int = BATCH_SIZE) -> dict:
    totals = {"imported": 0, "updated": 0, "skipped": 0}
    batches = [rows[i:i + batch_size] for i in range(0, len(rows), batch_size)]
    for i, batch in enumerate(batches, 1):
        result = request_json(exec_url, data={
            "token": token,
            "action": action,
            key: json.dumps(batch, ensure_ascii=False),
        })
        print(f"  batch {i}/{len(batches)}: {result}")
        if result.get("_error"):
            raise RuntimeError(f"{action} failed: {result}")
        for name in totals:
            totals[name] += int(result.get(name, 0) or 0)
        if i < len(batches):
            time.sleep(1)
    return totals


def main() -> int:
    parser = argparse.ArgumentParser(description="archi2ji live import diagnostic")
    parser.add_argument("--url", required=True, help="GAS exec URL")
    parser.add_argument("--maintenance-token", default="", help="未指定時は MAINTENANCE_TOKEN 環境変数")
    parser.add_argument("--run", action="store_true", help="実際に問題とルーブリックを投入する")
    args = parser.parse_args()

    maintenance_token = args.maintenance_token or os.environ.get("MAINTENANCE_TOKEN", "")
    print(f"URL: {args.url}")
    print(f"maintenance token: {'SET' if maintenance_token else 'MISSING'}")

    try:
      before = get_diag(args.url)
      print(f"diag before: {json.dumps(before, ensure_ascii=False)}")
    except Exception as exc:
      print(f"[ERROR] diag before failed: {exc}", file=sys.stderr)
      return 1

    if not args.run:
        print("dry check only. Add --run to import questions and rubrics.")
        return 0
    if not maintenance_token:
        print("[ERROR] MAINTENANCE_TOKEN is missing", file=sys.stderr)
        return 1

    try:
        token = get_import_token(args.url, maintenance_token)
        print("import token: OK")
        questions = load_questions()
        rubrics = load_rubrics()
        print(f"local questions: {len(questions)}")
        print(f"local rubrics: {len(rubrics)}")

        print("importQuestions:")
        question_totals = post_import(args.url, token, "importQuestions", "questionsJson", questions, QUESTION_BATCH_SIZE)
        print(f"question totals: {question_totals}")

        print("importRubrics:")
        rubric_totals = post_import(args.url, token, "importRubrics", "rubricsJson", rubrics)
        print(f"rubric totals: {rubric_totals}")

        after = get_diag(args.url)
        print(f"diag after: {json.dumps(after, ensure_ascii=False)}")
        if int(after.get("questionCount", 0) or 0) != 60:
            print("[WARN] questionCount is not 60. Check deployment URL and import errors above.", file=sys.stderr)
            return 2
        print("[OK] live questionCount is 60")
        return 0
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        print(f"[ERROR] HTTP {exc.code}: {body}", file=sys.stderr)
        return 1
    except Exception as exc:
        print(f"[ERROR] {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
