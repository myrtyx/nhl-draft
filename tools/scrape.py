"""Сбор проекций Yahoo (Remaining Games proj) по всем игрокам лиги."""
import pathlib, re, json, sys, time
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
PROFILE = ROOT / ".pw-profile"
LEAGUE = "105022"
BASE = f"https://hockey.fantasysports.yahoo.com/hockey/{LEAGUE}/players"

SKATER_COLS = ["gp","rank_pre","rank_cur","ros_pct","g","a","pm","ppp","sog","fw","hit","blk"]
GOALIE_COLS = ["gp","rank_pre","rank_cur","ros_pct","w","sv","sa","svpct","sho"]

def parse_player_cell(txt):
    """'Connor McDavid\nEDM - C,LW' -> (name, team, [pos])"""
    lines = [l.strip() for l in txt.split("\n") if l.strip()]
    lines = [l for l in lines if l not in ("Note","Notes","O","IR","IR+","DTD","NA")]
    if lines:
        lines[0] = re.sub(r"(No new player Notes|New Player Notes?|Player Notes?)\s*$", "", lines[0]).strip()
    if not lines: return None, None, []
    name = lines[0]
    team, pos = None, []
    for l in lines[1:]:
        m = re.match(r"^([A-Za-z\.]{2,4})\s*-\s*([A-Za-z,]+)$", l)
        if m:
            team = m.group(1).upper()
            pos = [x.strip().upper() for x in m.group(2).split(",") if x.strip()]
            break
    return name, team, pos

def num(s):
    s = (s or "").strip().replace(",", "").replace("%", "")
    if s in ("", "-", "--", "N/A"): return None
    try:
        return float(s) if "." in s else int(s)
    except ValueError:
        return None

def scrape(pg, pos_filter, cols, pages, label):
    out = []
    for i in range(pages):
        count = i * 25
        url = f"{BASE}?status=ALL&pos={pos_filter}&stat1=S_PSR&sort=AR&sdir=1&count={count}"
        pg.goto(url, timeout=60000, wait_until="domcontentloaded")
        try:
            pg.wait_for_selector("table.Table-interactive", timeout=25000)
        except Exception:
            print("  !! table did not render", flush=True)
        pg.wait_for_timeout(500)
        rows = pg.query_selector_all("table.Table-interactive tr")
        got = 0
        for r in rows:
            cells = r.query_selector_all("td")
            if len(cells) < 8: continue
            name, team, poss = parse_player_cell(cells[2].inner_text())
            if not name: continue
            status = cells[4].inner_text().strip().split("\n")[0]
            vals = [num(c.inner_text()) for c in cells[5:5+len(cols)]]
            rec = {"name": name, "team": team, "pos": poss, "status": status}
            rec.update(dict(zip(cols, vals)))
            out.append(rec); got += 1
        print(f"  {label} page {i+1}/{pages} count={count} -> {got} rows", flush=True)
        if got == 0: break
        time.sleep(0.6)
    return out

with sync_playwright() as p:
    ctx = p.chromium.launch_persistent_context(str(PROFILE), channel="chrome", headless=True,
                                               viewport={"width":1700,"height":1000})
    pg = ctx.pages[0] if ctx.pages else ctx.new_page()
    print("skaters:", flush=True)
    skaters = scrape(pg, "P", SKATER_COLS, 16, "SK")
    print("goalies:", flush=True)
    goalies = scrape(pg, "G", GOALIE_COLS, 4, "G")
    ctx.close()

data = {"league": LEAGUE, "source": "yahoo S_PSR", "skaters": skaters, "goalies": goalies}
(ROOT/"data").mkdir(exist_ok=True)
json.dump(data, open(ROOT/"data/yahoo_proj.json","w"), ensure_ascii=False, indent=1)
print(f"\nSAVED skaters={len(skaters)} goalies={len(goalies)}")
