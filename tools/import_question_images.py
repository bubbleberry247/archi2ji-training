"""
import_question_images.py - 建築2次の図表PDFページをPNG化してGAS/Driveへ登録する

Usage:
  python tools/import_question_images.py --url <exec_url> --maintenance-token <token>
  python tools/import_question_images.py --dry-run
  python tools/import_question_images.py --pdf-dir C:\tmp\archi2ji-pdfs --only Q_R7_3 --dry-run

PDFのダウンロードがネットワーク制限で失敗する場合は、--pdf-dir にPDFを置く。
"""
import argparse
import base64
import json
import os
from pathlib import Path
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

try:
    import fitz
except Exception as exc:  # pragma: no cover - dependency check
    raise SystemExit("PyMuPDF(fitz) が必要です: pip install pymupdf") from exc

try:
    from PIL import Image
except Exception as exc:  # pragma: no cover - dependency check
    raise SystemExit("Pillow が必要です: pip install pillow") from exc

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

REPO_ROOT = Path(__file__).resolve().parent.parent
DATA_FILE = REPO_ROOT / "data" / "kenchiku2ji_mondai_all.json"
DEFAULT_OUTPUT_DIR = REPO_ROOT / "output" / "question-images"

IMAGE_SPECS = [
    {
        "qId": "Q_H28_5",
        "pdfUrl": "https://dobokujira.com/wp-content/uploads/2024/09/H28_1kentiku_02_mondai.pdf",
        "pdfName": "H28_1kentiku_02_mondai.pdf",
        "pages": [9],
        "detectTerms": ["工程表中の鉄骨工事", "2～5F外部建具", "2〜5F外部建具"],
    },
    {
        "qId": "Q_H29_5",
        "pdfUrl": "https://dobokujira.com/wp-content/uploads/2024/09/H29_1kentiku_02_mondai.pdf",
        "pdfName": "H29_1kentiku_02_mondai.pdf",
        "pages": [9],
        "detectTerms": ["作業Bの作業内容", "作業E", "作業G"],
    },
    {
        "qId": "Q_H30_5",
        "pdfUrl": "https://www.fcip-shiken.jp/pdf/h30_1kj_mondai.pdf",
        "pdfName": "h30_1kj_mondai.pdf",
        "pages": [9],
        "detectTerms": ["作業A8", "作業B8", "作業B2"],
    },
    {
        "qId": "Q_R1_5",
        "pdfUrl": "https://www.fcip-shiken.jp/pdf/r01_1kj_mondai.pdf",
        "pdfName": "r01_1kj_mondai.pdf",
        "pages": [9],
    },
    {
        "qId": "Q_R2_5",
        "pdfUrl": "https://www.fcip-shiken.jp/pdf/r02_1kj_mondai.pdf",
        "pdfName": "r02_1kj_mondai.pdf",
        "pages": [9],
    },
    {
        "qId": "Q_R3_3",
        "pdfUrl": "https://www.fcip-shiken.jp/pdf/r03_1kj_mondai.pdf",
        "pdfName": "r03_1kj_mondai.pdf",
        "pages": [5],
    },
    {
        "qId": "Q_R4_3",
        "pdfUrl": "https://www.fcip-shiken.jp/pdf/r04_1kj_mondai.pdf",
        "pdfName": "r04_1kj_mondai.pdf",
        "pages": [5],
    },
    {
        "qId": "Q_R5_3",
        "pdfUrl": "https://www.fcip-shiken.jp/pdf/r05_1kj_mondai.pdf",
        "pdfName": "r05_1kj_mondai.pdf",
        "pages": [5],
    },
    {
        "qId": "Q_R6_3",
        "pdfUrl": "https://www.fcip-shiken.jp/pdf/r06_1kj_mondai.pdf",
        "pdfName": "r06_1kj_mondai.pdf",
        "pages": [7],
    },
    {
        "qId": "Q_R7_3",
        "pdfUrl": "https://www.fcip-shiken.jp/pdf/r07_1kj_mondai.pdf",
        "pdfName": "r07_1kj_mondai.pdf",
        "pages": [7],
    },
]


def request_json(url: str, *, data: dict | None = None, timeout: int = 120) -> dict:
    body = None
    headers = {}
    method = "GET"
    if data is not None:
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        headers["Content-Type"] = "application/json"
        method = "POST"
    req = urllib.request.Request(url, data=body, headers=headers, method=method)
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def add_query(url: str, params: dict) -> str:
    sep = "&" if "?" in url else "?"
    return f"{url}{sep}{urllib.parse.urlencode(params)}"


def get_import_token(exec_url: str, maintenance_token: str) -> str:
    data = request_json(add_query(exec_url, {
        "action": "initImportToken",
        "maintenanceToken": maintenance_token,
    }), timeout=30)
    if data.get("_error"):
        raise RuntimeError(f"initImportToken failed: {data}")
    token = str(data.get("token", ""))
    if not token:
        raise RuntimeError(f"initImportToken returned no token: {data}")
    return token


def parse_page_overrides(values: list[str]) -> dict[str, list[int]]:
    out: dict[str, list[int]] = {}
    for value in values:
        qid, sep, pages = value.partition("=")
        if not sep:
            raise ValueError(f"--pages は Q_R7_3=6,7 の形式で指定してください: {value}")
        out[qid.strip()] = [int(p.strip()) for p in pages.split(",") if p.strip()]
    return out


def normalize_for_detect(text: str) -> str:
    return "".join(str(text or "").replace("〜", "～").split())


def detect_pages(pdf_path: Path, spec: dict) -> list[int]:
    terms = [normalize_for_detect(t) for t in spec.get("detectTerms", [])]
    if not terms:
        raise RuntimeError(f"{spec['qId']}: pages未指定でdetectTermsもありません")
    doc = fitz.open(pdf_path)
    try:
        hits: list[int] = []
        for i, page in enumerate(doc):
            text = normalize_for_detect(page.get_text("text"))
            if any(term in text for term in terms):
                hits.append(i + 1)
                if i + 2 <= doc.page_count:
                    hits.append(i + 2)
                break
        if not hits:
            raise RuntimeError(f"{spec['qId']}: PDF本文からページを検出できません。--pages {spec['qId']}=n,m を指定してください")
        return sorted(set(hits))[:2]
    finally:
        doc.close()


def resolve_pdf(spec: dict, pdf_dir: Path, cache_dir: Path, download: bool) -> Path:
    candidates = [
        pdf_dir / spec["pdfName"],
        pdf_dir / f"{spec['qId']}.pdf",
        cache_dir / spec["pdfName"],
    ]
    for candidate in candidates:
        if candidate.exists():
            return candidate
    if not download:
        raise FileNotFoundError(f"{spec['qId']}: PDFが見つかりません: {spec['pdfName']}")
    cache_dir.mkdir(parents=True, exist_ok=True)
    target = cache_dir / spec["pdfName"]
    print(f"[*] download {spec['qId']}: {spec['pdfUrl']}")
    req = urllib.request.Request(spec["pdfUrl"], headers={"User-Agent": "archi2ji-image-importer/1.0"})
    with urllib.request.urlopen(req, timeout=60) as resp:
        body = resp.read()
    if not body.startswith(b"%PDF"):
        raise RuntimeError(f"{spec['qId']}: PDFではない応答です")
    target.write_bytes(body)
    return target


def crop_rendered_image(path: Path) -> tuple[int, int]:
    image = Image.open(path).convert("RGB")
    width, height = image.size
    scan_bottom = max(0, height - int(height * 0.05))
    scan = image.crop((0, 0, width, scan_bottom))
    mask = scan.convert("L").point(lambda p: 255 if p < 246 else 0)
    bbox = mask.getbbox()
    if not bbox:
        return image.size

    pad_x = int(width * 0.025)
    pad_y = int(height * 0.025)
    left = max(0, bbox[0] - pad_x)
    top = max(0, bbox[1] - pad_y)
    right = min(width, bbox[2] + pad_x)
    bottom = min(scan_bottom, bbox[3] + pad_y)
    cropped = image.crop((left, top, right, bottom))
    cropped.save(path)
    return cropped.size


def render_pages(pdf_path: Path, spec: dict, pages: list[int], output_dir: Path, scale: float, crop: bool) -> list[Path]:
    qid_dir = output_dir / spec["qId"]
    qid_dir.mkdir(parents=True, exist_ok=True)
    doc = fitz.open(pdf_path)
    try:
        paths: list[Path] = []
        for page_no in pages:
            if page_no < 1 or page_no > doc.page_count:
                raise ValueError(f"{spec['qId']}: page {page_no} はPDF範囲外です（1-{doc.page_count}）")
            page = doc.load_page(page_no - 1)
            pix = page.get_pixmap(matrix=fitz.Matrix(scale, scale), alpha=False)
            suffix = "figure" if crop else "page"
            out = qid_dir / f"{spec['qId']}_{suffix}_p{page_no:02d}.png"
            if out.exists():
                out = qid_dir / f"{spec['qId']}_{suffix}_p{page_no:02d}_{int(time.time())}.png"
            pix.save(out)
            if crop:
                crop_rendered_image(out)
            paths.append(out)
        return paths
    finally:
        doc.close()


def upload_images(exec_url: str, token: str, qid: str, paths: list[Path]) -> list[str]:
    items = []
    for path in paths:
        items.append({
            "qId": qid,
            "filename": path.name,
            "mimeType": "image/png",
            "base64Data": base64.b64encode(path.read_bytes()).decode("ascii"),
        })
    data = request_json(exec_url, data={
        "token": token,
        "action": "importQuestionImages",
        "replaceExisting": True,
        "imagesJson": json.dumps(items, ensure_ascii=False),
    }, timeout=180)
    if data.get("_error"):
        raise RuntimeError(f"{qid}: importQuestionImages failed: {data}")
    if data.get("errors"):
        raise RuntimeError(f"{qid}: image import errors: {data['errors']}")
    return [str(v) for v in (data.get("imageUrlsByQId", {}).get(qid) or [])]


def update_local_data(urls_by_qid: dict[str, list[str]]) -> None:
    data = json.loads(DATA_FILE.read_text(encoding="utf-8"))
    touched = 0
    for q in data:
        qid = str(q.get("qId", ""))
        if qid not in urls_by_qid:
            continue
        q["imageRequired"] = True
        q["imageUrls"] = urls_by_qid[qid]
        touched += 1
    DATA_FILE.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"[+] local data updated: {touched} questions")


def main() -> int:
    parser = argparse.ArgumentParser(description="建築2次 図表画像インポート")
    parser.add_argument("--url", default="", help="GAS exec URL")
    parser.add_argument("--maintenance-token", default="", help="未指定時は MAINTENANCE_TOKEN 環境変数")
    parser.add_argument("--pdf-dir", default=str(DEFAULT_OUTPUT_DIR / "pdfs"), help="手動配置PDFディレクトリ")
    parser.add_argument("--output-dir", default=str(DEFAULT_OUTPUT_DIR), help="生成PNG出力先")
    parser.add_argument("--only", action="append", default=[], help="対象qId。複数指定可")
    parser.add_argument("--pages", action="append", default=[], help="ページ上書き。例: --pages Q_R7_3=6,7")
    parser.add_argument("--scale", type=float, default=2.0, help="PDFレンダリング倍率")
    parser.add_argument("--dry-run", action="store_true", help="PDF確認とPNG生成まで。GASにはPOSTしない")
    parser.add_argument("--no-download", action="store_true", help="PDFをダウンロードせず --pdf-dir のみ使う")
    parser.add_argument("--no-update-data", action="store_true", help="アップロード後にローカルJSONを更新しない")
    parser.add_argument("--full-page", action="store_true", help="図表領域に切り抜かず、PDFページ全体を登録する")
    args = parser.parse_args()

    maintenance_token = (args.maintenance_token or os.environ.get("MAINTENANCE_TOKEN", "")).strip()
    selected = set(args.only)
    overrides = parse_page_overrides(args.pages)
    pdf_dir = Path(args.pdf_dir)
    output_dir = Path(args.output_dir)
    cache_dir = output_dir / "pdfs"
    specs = [s for s in IMAGE_SPECS if not selected or s["qId"] in selected]
    if not specs:
        raise SystemExit("対象がありません")

    rendered: dict[str, list[Path]] = {}
    print(f"[*] target questions: {len(specs)}")
    for spec in specs:
        pdf_path = resolve_pdf(spec, pdf_dir, cache_dir, download=not args.no_download)
        pages = overrides.get(spec["qId"]) or spec.get("pages") or detect_pages(pdf_path, spec)
        pngs = render_pages(pdf_path, spec, pages, output_dir, args.scale, crop=not args.full_page)
        rendered[spec["qId"]] = pngs
        print(f"[+] {spec['qId']}: {pdf_path.name} pages={pages} images={[str(p) for p in pngs]}")

    if args.dry_run:
        print("[DRY RUN] upload skipped")
        return 0
    if not args.url:
        raise SystemExit("--url is required unless --dry-run")
    if not maintenance_token:
        raise SystemExit("MAINTENANCE_TOKEN is required unless --dry-run")

    print("[*] import token request")
    token = get_import_token(args.url, maintenance_token)
    print("[+] import token OK")
    urls_by_qid: dict[str, list[str]] = {}
    for qid, paths in rendered.items():
        print(f"[*] upload {qid}: {len(paths)} image(s)")
        urls = upload_images(args.url, token, qid, paths)
        urls_by_qid[qid] = urls
        print(f"[+] {qid}: {len(urls)} url(s)")
        time.sleep(1)

    if not args.no_update_data:
        update_local_data(urls_by_qid)
    print("[OK] question images imported")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
