# Renders docs/how-it-works.html to PDF with Playwright (python -m pip install playwright; python -m playwright install chromium).
# Usage: python docs/render-pdf.py docs/how-it-works.html "Home Lab Hub - How It Works.pdf"
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright
src = Path(sys.argv[1]).resolve(); out = Path(sys.argv[2]).resolve()
with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page()
    pg.goto(src.as_uri()); pg.wait_for_load_state("networkidle")
    pg.pdf(path=str(out), format="Letter", print_background=True, prefer_css_page_size=True,
           display_header_footer=True, header_template="<span></span>",
           footer_template='<div style="font-size:8px;color:#888;width:100%;text-align:center;font-family:Segoe UI,Arial">Home Lab Hub — How It Works · page <span class="pageNumber"></span> of <span class="totalPages"></span></div>')
    b.close()
print(out, out.stat().st_size)
