# Builds the quick guide PDF from guide.html. Links stay clickable.
# Run:  python3 build/guide/make.py     (needs Python Playwright with Chromium)
import pathlib
from playwright.sync_api import sync_playwright
here = pathlib.Path(__file__).resolve().parent
out = here.parent.parent / 'src' / 'docs' / 'Orbie Studio Quick Guide.pdf'
out.parent.mkdir(parents=True, exist_ok=True)
with sync_playwright() as p:
    b = p.chromium.launch()
    page = b.new_page()
    page.goto((here / 'guide.html').as_uri())
    page.pdf(path=str(out), format='Letter', print_background=True, prefer_css_page_size=True, tagged=True, outline=True)
    b.close()
print('wrote', out)
