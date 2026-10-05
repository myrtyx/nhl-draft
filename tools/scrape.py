"""Проекции Yahoo по всем игрокам лиги: .venv/bin/python tools/scrape.py (~6 мин).

Логин живёт в .pw-profile (отдельный Chrome). Умерла сессия — tools/login.py,
Мартин входит в окне сам, дальше снова фоном. Вкладки строго по одной и с
паузой: на параллельных Yahoo отвечает «Request denied» на несколько минут.

Пишет два файла:
  data/yahoo_proj.json — Remaining Games (proj), приведённые к полному сезону
      клуба: движок читает gp/84 как долю выходов, stat/gp — как игру.
      Полевые: ×84 / сколько клубу осталось игр. Вратарям Yahoo в остатке
      сезона недодаёт выходов, их привожу к полному сезону клуба — см.
      per_club_goalies.
  data/yahoo_p7.json — Next 7 Days (proj) как есть: доступные (лучшие по
      проекции) и все взятые в лиге.
В обоих: status — владелец по Yahoo (команда, FA, W), inj — метка травмы.

Кого Yahoo больше не отдаёт, переносится из прошлого yahoo_proj.json со
stale: true — пики и трансферы сайта ссылаются на игроков по имени.
"""
import asyncio, json, pathlib, re, sys, time, urllib.request
from datetime import datetime, timezone
from playwright.async_api import async_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
PROFILE = ROOT / ".pw-profile"
LEAGUE = "105022"
BASE = f"https://hockey.fantasysports.yahoo.com/hockey/{LEAGUE}/players"
SEASON_GP = 84
GOALIE_CLUB_GP = 88   # выходов вратарей клуба за сезон: 84 игры + замены (предсезонка Yahoo: медиана 88)
GOALIE_MAX_GP = 65    # потолок основного: 2022/23–2025/26 никто не сыграл больше 64 из 82 (≈ 65 из 84)
PAUSE = 4.0

SKATER_COLS = ["gp","rank_pre","rank_cur","ros_pct","g","a","pm","ppp","sog","fw","hit","blk"]
GOALIE_COLS = ["gp","rank_pre","rank_cur","ros_pct","w","sv","sa","svpct","sho"]
COUNTING = {"gp","g","a","pm","ppp","sog","fw","hit","blk","w","sv","sa","sho"}
FLAGS = {"O","IR","IR+","IR-LT","IR-NR","DTD","NA","SUSP"}
NHL_CODE = {"LA": "LAK", "NJ": "NJD", "SJ": "SJS", "TB": "TBL"}
# (проекция, поз, status, страниц по 25); везде sort=AR — ранг по этой проекции.
# Полевых 28 страниц = 700: со 400 сайт не видел свободных за ~440-м местом
# (четвёртые звенья, кто набирает хиты и блоки), а недельная замена — чаще они.
PLAN = [("S_PSR", "P", "ALL", 28), ("S_PSR", "G", "ALL", 5),
        ("S_PSR", "P", "T", 9),    ("S_PSR", "G", "T", 2),
        ("S_PS7", "P", "A", 4),    ("S_PS7", "G", "A", 2),
        ("S_PS7", "P", "T", 9),    ("S_PS7", "G", "T", 2)]

def parse_player_cell(txt):
    """'Bryan RustIR\nPIT - RW' -> ('Bryan Rust', 'PIT', ['RW'], 'IR')"""
    lines = [l.strip() for l in txt.split("\n") if l.strip()]
    inj = next((l for l in lines if l in FLAGS), None)
    lines = [l for l in lines if l not in FLAGS and l not in ("Note","Notes")]
    if not lines: return None, None, [], None
    name = lines[0]
    while True:  # хвосты имени: заметка и метка травмы, приклеенная без пробела
        cut = re.sub(r"(No new player Notes|New Player Notes?|Player Notes?)\s*$", "", name).strip()
        m = re.search(r"(IR-LT|IR-NR|IR\+|IR|DTD|SUSP|NA|O)$", cut)
        if m and cut[:m.start()].rstrip()[-1:].islower():
            inj, cut = inj or m.group(1), cut[:m.start()].strip()
        if cut == name: break
        name = cut
    team, pos = None, []
    for l in lines[1:]:
        m = re.match(r"^([A-Za-z\.]{2,4})\s*-\s*([A-Za-z,]+)$", l)
        if m:
            team = m.group(1).upper()
            pos = [x.strip().upper() for x in m.group(2).split(",") if x.strip()]
            break
    return name, team, pos, inj

def num(s):
    s = (s or "").strip().replace(",", "").replace("%", "")
    if s in ("", "-", "--", "N/A"): return None
    try:
        return float(s) if "." in s else int(s)
    except ValueError:
        return None

async def grab(pg, stat, pos, status, i):
    cols = SKATER_COLS if pos == "P" else GOALIE_COLS
    url = f"{BASE}?status={status}&pos={pos}&stat1={stat}&sort=AR&sdir=1&count={i*25}"
    for attempt in range(5):
        try:
            await pg.goto(url, timeout=60000, wait_until="domcontentloaded")
            if "Request denied" in (await pg.inner_text("body"))[:500]:
                raise RuntimeError("Request denied")
            # пустая страница — таблица без строк, бывает невидимой
            await pg.wait_for_selector("table.Table-interactive", state="attached", timeout=25000)
            rows = await pg.eval_on_selector_all("table.Table-interactive tbody tr",
                "trs => trs.map(tr => [...tr.children].map(td => td.innerText))")
            break
        except Exception as e:
            if attempt == 4:
                raise RuntimeError(f"{stat} {status} {pos} стр. {i+1}: {e}\n{pg.url}")
            wait = 90 if "denied" in str(e) else 3
            print(f"  {stat} {status} {pos} стр. {i+1}: {str(e)[:40]} — жду {wait} с", flush=True)
            await asyncio.sleep(wait)
    await asyncio.sleep(PAUSE)
    out = []
    for cells in rows:
        if len(cells) < 8: continue
        name, team, poss, inj = parse_player_cell(cells[2])
        if not name: continue
        rec = {"name": name, "team": team, "pos": poss, "status": cells[4].strip().split("\n")[0]}
        if inj: rec["inj"] = inj
        rec.update(zip(cols, (num(c) for c in cells[5:5+len(cols)])))
        out.append(rec)
    return out

async def scrape_all():
    got = {}
    async with async_playwright() as p:
        ctx = await p.chromium.launch_persistent_context(str(PROFILE), channel="chrome", headless=True,
                                                         viewport={"width": 1700, "height": 1000})
        pg = ctx.pages[0] if ctx.pages else await ctx.new_page()
        await pg.goto(f"{BASE}?status=ALL&pos=G&count=0", timeout=60000, wait_until="domcontentloaded")
        if "login" in pg.url:
            await ctx.close()
            sys.exit("Сессия Yahoo умерла: .venv/bin/python tools/login.py — войти в окне, потом снова scrape.py")
        for stat, pos, status, pages in PLAN:
            for i in range(pages):
                recs = await grab(pg, stat, pos, status, i)
                for r in recs: got.setdefault((stat, pos), {}).setdefault((r["name"], r["team"]), r)
                if not recs: break
        await ctx.close()
    return {s: (list(got.get((s, "P"), {}).values()), list(got.get((s, "G"), {}).values()))
            for s in ("S_PSR", "S_PS7")}

def club_games_played():
    req = urllib.request.Request("https://api-web.nhle.com/v1/standings/now", headers={"User-Agent": "curl/8.7.1"})
    st = json.load(urllib.request.urlopen(req, timeout=30))
    return {t["teamAbbrev"]["default"]: t["gamesPlayed"] for t in st["standings"]}

def scale(rec, k):
    for c in COUNTING:
        if rec.get(c) is not None: rec[c] = round(rec[c] * k, 1)

def to_full_season(recs, played):
    for r in recs:
        left = SEASON_GP - played.get(NHL_CODE.get(r["team"], r["team"]), 0)
        scale(r, SEASON_GP / left if left > 0 else 1)

def per_club_goalies(gl):
    """Yahoo в остатке сезона даёт вратарям мало выходов и неровно (основным
    ~60 % предсезонных, сменщикам ~35 %), а полевым — полный сезон. Беру у
    Yahoo только расклад внутри клуба: выходы его вратарей в сумме
    GOALIE_CLUB_GP, у основного не больше GOALIE_MAX_GP (лишнее — остальным
    поровну их долям), стата за выход как у Yahoo."""
    club = {}
    for r in gl:
        if r.get("gp"): club.setdefault(r["team"], []).append(r)
    raw = {t: sum(r["gp"] for r in rs) for t, rs in club.items()}
    for t, rs in club.items():
        gp = [r["gp"] * GOALIE_CLUB_GP / raw[t] for r in rs]
        top = max(range(len(rs)), key=gp.__getitem__)
        rest = raw[t] - rs[top]["gp"]
        if gp[top] > GOALIE_MAX_GP and rest > 0:
            extra, gp[top] = gp[top] - GOALIE_MAX_GP, GOALIE_MAX_GP
            gp = [g if i == top else g + extra * rs[i]["gp"] / rest for i, g in enumerate(gp)]
        for r, g in zip(rs, gp): scale(r, g / r["gp"])
    return raw

def carry_stale(cur, prev):
    have = {r["name"] for r in cur}
    stale = [{**r, "stale": True} for r in prev if r["name"] not in have]
    return cur + stale, [r["name"] for r in stale]

def by_rank(xs):
    return sorted(xs, key=lambda r: (r.get("rank_pre") or 9999, r["name"]))

def finish_proj(sk, gl, prev, fetched):
    """S_PSR → формат движка; prev — прошлый yahoo_proj.json."""
    to_full_season(sk, club_games_played())
    club = per_club_goalies(gl)
    sk, st_sk = carry_stale(sk, prev["skaters"])
    gl, st_gl = carry_stale(gl, prev["goalies"])
    lo, hi = min(club, key=club.get), max(club, key=club.get)
    print(f"вратари: у Yahoo клуб в сумме {club[lo]:.0f} ({lo}) … {club[hi]:.0f} ({hi}) игр, привёл к {GOALIE_CLUB_GP}")
    if st_sk + st_gl:
        print(f"нет у Yahoo, взяты из прошлого файла ({len(st_sk + st_gl)}): {', '.join(st_sk + st_gl)}")
    return {"league": LEAGUE, "source": "yahoo S_PSR → полный сезон", "fetched": fetched,
            "skaters": by_rank(sk), "goalies": by_rank(gl)}

def save(res, fetched):
    path = ROOT / "data/yahoo_proj.json"
    proj = finish_proj(*res["S_PSR"], json.load(open(path)), fetched)
    json.dump(proj, open(path, "w"), ensure_ascii=False, indent=1)
    sk7, gl7 = res["S_PS7"]
    json.dump({"league": LEAGUE, "source": "yahoo S_PS7", "fetched": fetched,
               "skaters": by_rank(sk7), "goalies": by_rank(gl7)},
              open(ROOT / "data/yahoo_p7.json", "w"), ensure_ascii=False, indent=1)
    print(f"остаток сезона: {len(proj['skaters'])} полевых, {len(proj['goalies'])} вратарей; "
          f"next 7: {len(sk7)}, {len(gl7)}")

def main():
    t0 = time.time()
    fetched = datetime.now(timezone.utc).isoformat(timespec="seconds")
    save(asyncio.run(scrape_all()), fetched)
    print(f"за {time.time() - t0:.0f} с")

if __name__ == "__main__":
    main()
