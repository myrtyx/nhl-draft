import pathlib, re, json
from playwright.sync_api import sync_playwright
ROOT = pathlib.Path(__file__).resolve().parent.parent
PROFILE = ROOT / ".pw-profile"
URL = "https://hockey.fantasysports.yahoo.com/hockey/105022/players"
with sync_playwright() as p:
    ctx = p.chromium.launch_persistent_context(str(PROFILE), channel="chrome", headless=True,
                                               viewport={"width":1600,"height":1000})
    pg = ctx.pages[0] if ctx.pages else ctx.new_page()
    pg.goto(URL, timeout=60000, wait_until="domcontentloaded")
    pg.wait_for_timeout(3000)
    print("URL:", pg.url)
    print("TITLE:", pg.title())
    body = pg.inner_text("body")
    print("LOGGED_IN:", "Sign in" not in body[:2000] and "login" not in pg.url)
    # таблицы
    tables = pg.query_selector_all("table")
    print("tables:", len(tables))
    for i,t in enumerate(tables[:4]):
        rows = t.query_selector_all("tr")
        print(f"  table[{i}] rows={len(rows)} cls={t.get_attribute('class')}")
        if rows:
            print("   head:", " | ".join(c.inner_text().strip() for c in rows[0].query_selector_all("th,td"))[:300])
            if len(rows)>1:
                print("   row1:", " | ".join(c.inner_text().strip().replace("\n"," ") for c in rows[1].query_selector_all("th,td"))[:300])
    # селекты фильтров -> узнать код stat1
    for sel in pg.query_selector_all("select"):
        nm = sel.get_attribute("name")
        opts = [(o.get_attribute("value"), o.inner_text().strip()) for o in sel.query_selector_all("option")]
        if nm and any("proj" in (o[1] or "").lower() for o in opts):
            print("SELECT", nm, opts[:12])
    ctx.close()
