#!/usr/bin/env python3
"""Local prototype server for the Macau A&A structural draft workflow.

Stdlib only. PDF export asks the local Google Chrome to print the draft.
No payment provider, no e-sign vendor, no remote model.
"""

import json
import os
import subprocess
import tempfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import quote, unquote, urlparse

ROOT = Path(__file__).resolve().parent
STATIC = ROOT / "static"
SAMPLE = ROOT / "sample"
HOST = "127.0.0.1"
PORT = int(os.environ.get("PORT", "8765"))

CHROME_CANDIDATES = [
    os.environ.get("CHROME_PATH"),
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
]

MIME = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".dxf": "application/dxf",
    ".txt": "text/plain; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".pdf": "application/pdf",
}


def find_chrome():
    for candidate in CHROME_CANDIDATES:
        if candidate and Path(candidate).is_file():
            return candidate
    return None


def render_pdf(fragment, css):
    chrome = find_chrome()
    if not chrome:
        raise RuntimeError("找不到 Google Chrome，無法在本機印出 PDF。")
    page = """<!doctype html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8">
<style>
%s
@page { size: A4; margin: 12mm; }
html, body { background: white !important; margin: 0; padding: 0; }
body { font-size: 12px; }
.sheet { box-shadow: none !important; margin: 0 !important; max-width: none !important; }
.noprint { display: none !important; }
</style>
</head>
<body>
%s
</body>
</html>
""" % (css, fragment)
    with tempfile.TemporaryDirectory(prefix="macau-proto-") as tmp:
        html_path = Path(tmp) / "report.html"
        pdf_path = Path(tmp) / "report.pdf"
        html_path.write_text(page, encoding="utf-8")
        proc = subprocess.run(
            [
                chrome,
                "--headless=new",
                "--disable-gpu",
                "--no-pdf-header-footer",
                "--no-first-run",
                "--disable-extensions",
                "--virtual-time-budget=8000",
                "--print-to-pdf=%s" % pdf_path,
                html_path.as_uri(),
            ],
            capture_output=True,
            timeout=50,
            text=True,
        )
        if not pdf_path.exists() or pdf_path.stat().st_size < 800:
            tail = (proc.stderr or proc.stdout or "PDF 產生失敗")[-400:]
            raise RuntimeError(tail.strip())
        return pdf_path.read_bytes()


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        print("[%s] %s" % (self.log_date_time_string(), fmt % args))

    def do_GET(self):
        path = unquote(urlparse(self.path).path)
        if path == "/favicon.ico":
            self.send_response(204)
            self.end_headers()
            return
        if path == "/":
            return self._send_file(STATIC / "index.html")
        if path == "/api/health":
            chrome = find_chrome()
            return self._send_json({"ok": True, "chrome": bool(chrome)})
        if path.startswith("/static/"):
            return self._send_file(self._safe(STATIC, path[len("/static/") :]))
        if path.startswith("/sample/"):
            return self._send_file(self._safe(SAMPLE, path[len("/sample/") :]))
        self.send_error(404)

    def do_POST(self):
        if urlparse(self.path).path != "/api/pdf":
            self.send_error(404)
            return
        length = int(self.headers.get("Content-Length", "0") or 0)
        if length <= 0 or length > 8_000_000:
            self.send_error(413 if length else 400)
            return
        raw = self.rfile.read(length)
        ctype = self.headers.get("Content-Type", "")
        try:
            if "application/json" in ctype:
                body = json.loads(raw.decode("utf-8"))
            else:
                from urllib.parse import parse_qs
                parsed = parse_qs(raw.decode("utf-8"), keep_blank_values=True, max_num_fields=20)
                body = {key: values[0] for key, values in parsed.items()}
        except (UnicodeDecodeError, json.JSONDecodeError, ValueError):
            self.send_error(400)
            return
        fragment = body.get("html") or ""
        css = body.get("css") or ""
        filename = body.get("filename") or "macau-structure-draft.pdf"
        if not fragment.strip():
            self._send_json({"error": "沒有可印的草稿"}, 400)
            return
        safe = "".join(ch if ch.isalnum() or ch in "._-" else "-" for ch in filename)
        if not safe.lower().endswith(".pdf"):
            safe += ".pdf"
        try:
            pdf = render_pdf(fragment, css)
        except Exception as exc:
            self._send_json({"error": "PDF 產生失敗：%s" % exc}, 500)
            return
        encoded = quote(safe)
        self.send_response(200)
        self.send_header("Content-Type", "application/pdf")
        self.send_header(
            "Content-Disposition",
            "attachment; filename=\"macau-structure-draft.pdf\"; filename*=UTF-8''%s" % encoded,
        )
        self.send_header("Content-Length", str(len(pdf)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(pdf)

    def _safe(self, root, rel):
        if not rel or rel.startswith("/") or ".." in rel.split("/"):
            return None
        candidate = (root / rel).resolve()
        if root.resolve() not in candidate.parents and candidate != root.resolve():
            return None
        return candidate

    def _send_file(self, path):
        if path is None or not path.is_file():
            self.send_error(404)
            return
        data = path.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", MIME.get(path.suffix.lower(), "application/octet-stream"))
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def _send_json(self, payload, status=200):
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


def main():
    if not find_chrome():
        print("警告：未找到 Chrome。頁面仍可瀏覽，簽署後的 PDF 下載會失敗。")
    httpd = ThreadingHTTPServer((HOST, PORT), Handler)
    print("澳門 A&A 結構原型")
    print("http://%s:%s" % (HOST, PORT))
    print("按 Ctrl+C 停止")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n已停止")
    finally:
        httpd.server_close()


if __name__ == "__main__":
    main()
