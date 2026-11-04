"""Record real demo segments of the builder UI (headless Chromium video + step screenshots).
Usage: record_demo.py <outdir> [A] [B] [D]"""
import sys, shutil, os
from playwright.sync_api import sync_playwright
OUT = sys.argv[1]; os.makedirs(OUT, exist_ok=True)
URL = "http://localhost:8787/"

def shot(pg, name): pg.screenshot(path=f"{OUT}/{name}.png")
def wait_step(pg, text, timeout=240):
    pg.wait_for_function("t => [...document.querySelectorAll('#tl li:not(.start) .t')].some(e => e.textContent.startsWith(t))", arg=text, timeout=timeout * 1000)
def click_visible(pg, fr, pred, limit):
    btns = fr.locator("button"); k = 0
    for i in range(btns.count()):
        if k >= limit: break
        bt = btns.nth(i)
        try:
            if bt.is_visible() and pred((bt.inner_text() or "").strip()):
                bt.click(timeout=2000); k += 1; pg.wait_for_timeout(600)
        except Exception as e: print("click:", str(e)[:100])

with sync_playwright() as p:
    b = p.chromium.launch()
    def seg():
        ctx = b.new_context(viewport={"width": 1600, "height": 900}, record_video_dir=f"{OUT}/_v", record_video_size={"width": 1600, "height": 900})
        return ctx, ctx.new_page()
    def save(ctx, pg, name):
        v = pg.video; ctx.close(); shutil.move(v.path(), f"{OUT}/{name}.webm")

    def segA():  # café sketch full run with injected fault -> Muse Wonder repair
        ctx, pg = seg(); pg.goto(URL); pg.wait_for_timeout(1200)
        pg.click("#samples img >> nth=0"); pg.wait_for_timeout(800); shot(pg, "01-input-juniper-sketch")
        pg.check("#fault"); pg.click("#go")
        wait_step(pg, "Scout input"); shot(pg, "02-scout")
        wait_step(pg, "SAM 3.1"); pg.wait_for_timeout(600); shot(pg, "03-sam-segments-sketch")
        wait_step(pg, "App Intent"); pg.click("#tabs button[data-v=intent]"); pg.wait_for_timeout(800); shot(pg, "04-app-intent-json")
        wait_step(pg, "InSpatial project"); pg.click("#tabs button[data-v=code]"); pg.wait_for_timeout(800); shot(pg, "05-inspatial-project")
        wait_step(pg, "Build + run check"); pg.wait_for_timeout(500); shot(pg, "06-build-fail-injected")
        wait_step(pg, "Repair #1"); pg.wait_for_timeout(300); shot(pg, "07-wonder-repair")
        wait_step(pg, "Complete"); pg.wait_for_timeout(1500); shot(pg, "08-running-app-and-fidelity")
        fr = pg.frame_locator("#frame")
        click_visible(pg, fr, lambda t: t.startswith("+") or t in ("＋", "Add"), 3); shot(pg, "09-app-items-added")
        click_visible(pg, fr, lambda t: "order" in t.lower(), 1); pg.wait_for_timeout(1500); shot(pg, "10-order-placed")
        pg.wait_for_timeout(1500); save(ctx, pg, "segA-sketch-to-running-app-with-repair")

    def segB():  # shelf photo: SAM counts -> inventory app, then Muse Image mock + edit
        ctx, pg = seg(); pg.goto(URL); pg.wait_for_timeout(1000)
        pg.click("#samples img >> nth=1"); pg.wait_for_timeout(600); pg.click("#go")
        wait_step(pg, "SAM 3.1"); pg.wait_for_timeout(800); shot(pg, "11-sam-shelf-counts")
        wait_step(pg, "Complete"); pg.wait_for_timeout(1500); shot(pg, "12-shelf-inventory-app")
        fr = pg.frame_locator("#frame")
        click_visible(pg, fr, lambda t: True, 3); shot(pg, "13-shelf-app-interaction")
        pg.click("#tabs button[data-v=mock]"); pg.wait_for_timeout(500); pg.click("#mockgo")
        pg.wait_for_function("document.querySelectorAll('#mocks img').length>=1", timeout=120000); pg.wait_for_timeout(2000); shot(pg, "14-muse-image-mock")
        pg.click("#editgo")
        pg.wait_for_function("document.querySelectorAll('#mocks img').length>=2", timeout=120000); pg.wait_for_timeout(2000); shot(pg, "15-muse-image-edit-darker-green")
        save(ctx, pg, "segB-shelf-sam-counts-and-muse-image")

    def segD():
        ctx, pg = seg(); pg.goto(URL); pg.wait_for_timeout(800); pg.click("#tabs button[data-v=eval]"); pg.wait_for_timeout(3000); shot(pg, "16-eval-dashboard")
        save(ctx, pg, "segD-eval-dashboard")

    for name in (sys.argv[2:] or ["A", "B", "D"]): {"A": segA, "B": segB, "D": segD}[name]()
    b.close()
shutil.rmtree(f"{OUT}/_v", ignore_errors=True)
print("done")
