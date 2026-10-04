"""Build docs/PROJECT_DOCUMENTATION.pdf from docs/PROJECT_DOCUMENTATION.md.

    pip install -r docs/build/requirements.txt      # the 'markdown' package
    (cd web && npm ci)                              # playwright-core, once
    python docs/build/gen_tables.py --write         # refresh the result tables from reports/
    python docs/build/make_figures.py               # refresh figures (needs numpy, pandas, matplotlib, scikit-learn)
    python docs/build/build_pdf.py                  # writes the PDF and prints the page count

Markdown -> HTML (python-markdown) -> A4 PDF (headless Chromium). Fonts used: Liberation Sans and DejaVu
Sans Mono, which the PDF embeds. The submission limit is 6 pages; this script fails if the PDF is longer.
"""
import re
import subprocess
import sys
import tempfile
from pathlib import Path

import markdown

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "docs" / "PROJECT_DOCUMENTATION.md"
OUT = ROOT / "docs" / "PROJECT_DOCUMENTATION.pdf"
MAX_PAGES = 6


def to_html(text: str) -> str:
    body = markdown.markdown(text, extensions=["tables", "sane_lists", "attr_list"], output_format="html5")
    body = re.sub(r"<p><em>(Figure \d)", r'<p class="cap"><em>\1', body)  # figure captions
    body = re.sub(r"<p><em>([^<]*)</em></p>", r'<p class="cap">\1</p>', body)  # table captions: a paragraph that is all italic
    css = (ROOT / "docs" / "build" / "style.css").read_text()
    return (f'<!doctype html><html lang="en"><head><meta charset="utf-8"><title>RiskAtlas project documentation</title>'
            f'<base href="{(ROOT / "docs").as_uri()}/"><style>{css}</style></head><body>{body}</body></html>')


def page_count(pdf: Path) -> int:
    info = subprocess.run(["pdfinfo", str(pdf)], capture_output=True, text=True, check=True).stdout
    return int(re.search(r"^Pages:\s+(\d+)", info, re.M).group(1))


def main() -> None:
    html = to_html(SRC.read_text(encoding="utf-8"))
    with tempfile.TemporaryDirectory() as tmp:
        page = Path(tmp) / "doc.html"
        page.write_text(html, encoding="utf-8")
        subprocess.run(["node", str(ROOT / "docs" / "build" / "print_pdf.mjs"), str(page), str(OUT)], check=True)
    n = page_count(OUT)
    print(f"{OUT.relative_to(ROOT)}: {n} page(s)")
    if n > MAX_PAGES:
        sys.exit(f"too long: {n} > {MAX_PAGES} pages")


if __name__ == "__main__":
    main()
