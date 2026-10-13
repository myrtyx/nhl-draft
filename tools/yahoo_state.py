"""Сессию Yahoo из .pw-profile — на lynx для ночного снимка (tools/nightly.sh).

    .venv/bin/python tools/yahoo_state.py

Запускать после tools/login.py, когда ночной снимок позвонил «сессия Yahoo
умерла». Cookies уходят в ~/.config/nhl-yahoo/state.json на lynx (только
myrtyx может читать), туда же user agent мака: lynx ходит в Yahoo как этот Chrome.
"""
import json, subprocess, sys
from playwright.sync_api import sync_playwright
from yahoo_browser import PROFILE

LYNX = "myrtyx@lynx"
DEST = ".config/nhl-yahoo/state.json"
URL = "https://hockey.fantasysports.yahoo.com/hockey/105022"

with sync_playwright() as p:
    ctx = p.chromium.launch_persistent_context(str(PROFILE), channel="chrome", headless=True)
    pg = ctx.pages[0] if ctx.pages else ctx.new_page()
    pg.goto(URL, timeout=60000, wait_until="domcontentloaded")
    if "login" in pg.url:
        ctx.close()
        sys.exit("на маке сессии тоже нет: сначала .venv/bin/python tools/login.py")
    ua = pg.evaluate("navigator.userAgent").replace("HeadlessChrome", "Chrome")
    st = ctx.storage_state()
    ctx.close()

body = json.dumps({**st, "userAgent": ua})
subprocess.run(["ssh", LYNX, f"mkdir -p -m 700 $(dirname {DEST}) && umask 077 && cat > {DEST}.tmp && mv {DEST}.tmp {DEST}"],
               input=body, text=True, check=True)
print(f"сессия на lynx: {len(st['cookies'])} cookies, {ua}")
