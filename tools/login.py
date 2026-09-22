"""Открывает окно Chrome с отдельным профилем и ждёт, пока пользователь залогинится в Yahoo."""
import sys, time, pathlib
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
PROFILE = ROOT / ".pw-profile"
LEAGUE = "105022"
URL = f"https://hockey.fantasysports.yahoo.com/hockey/{LEAGUE}"

with sync_playwright() as p:
    ctx = p.chromium.launch_persistent_context(
        user_data_dir=str(PROFILE), channel="chrome", headless=False,
        viewport={"width": 1500, "height": 950},
        args=["--no-first-run", "--no-default-browser-check"],
    )
    pg = ctx.pages[0] if ctx.pages else ctx.new_page()
    pg.goto(URL, timeout=60000)
    print("WINDOW OPEN — log in to Yahoo in it", flush=True)
    deadline = time.time() + 900
    while time.time() < deadline:
        try:
            if f"/hockey/{LEAGUE}" in pg.url and "login" not in pg.url:
                body = pg.inner_text("body")[:4000]
                if "BETBY" in body.upper() or "My Team" in body:
                    print("LOGGED IN ok | url:", pg.url, flush=True)
                    time.sleep(2)
                    ctx.close()
                    sys.exit(0)
        except Exception:
            pass
        time.sleep(3)
    print("TIMEOUT — not logged in", flush=True)
    ctx.close()
    sys.exit(1)
