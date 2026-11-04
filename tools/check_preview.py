"""Headless run-check for a generated preview app: loads it, records JS errors, clicks the
first action button, screenshots. Prints JSON. Usage: check_preview.py <html> <png>"""
import json, sys
from playwright.sync_api import sync_playwright
html, png = sys.argv[1], sys.argv[2]
errors = []
with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={"width": 390, "height": 844}, device_scale_factor=2)
    pg.on("pageerror", lambda e: errors.append("pageerror: " + str(e)))
    pg.on("console", lambda m: errors.append("console.error: " + m.text) if m.type == "error" else None)
    pg.goto("file://" + html)
    pg.wait_for_timeout(800)
    text_len = len(pg.inner_text("body").strip())
    buttons = pg.locator("button").count()
    pg.screenshot(path=png, full_page=True)
    clicked = False
    if buttons:
        try:
            pg.locator("button").first.click(timeout=1500); clicked = True; pg.wait_for_timeout(300)
        except Exception as e:
            errors.append("click: " + str(e)[:200])
    b.close()
ok = not errors and text_len > 20 and buttons > 0
print(json.dumps({"ok": ok, "errors": errors[:10], "textLen": text_len, "buttons": buttons, "clicked": clicked}))
