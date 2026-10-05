"""Реальный счёт и составы недели из Yahoo — для вкладки «Неделя» на xlynx.site/hockey.

    .venv/bin/python tools/yahoo_week.py              # текущая неделя: сыгранные дни, которых ещё нет
    .venv/bin/python tools/yahoo_week.py --week 1     # неделя 1 целиком заново
    .venv/bin/python tools/yahoo_week.py --dry        # только напечатать, на lynx не писать
    ... --out путь                                    # ещё и копия файла локально

Зачем. Сыгранные дни соперника сайт восстанавливает лучшей расстановкой по
факту NHL, а люди расставляют хуже: на неделе 1 Огр по факту NHL забивал 10
голов, в Yahoo — 8; сайт показал поражение, в Yahoo была ничья 5–5. Дневные
вкладки матчапа (Tue 9/29 …) отдают состав каждой команды на день — кто в
каком слоте, кто на лавке — и итог дня. Шесть матчапов недели — все 12 команд.

День снимаю, только когда все его матчи NHL закончены (api-web): иначе в итог
попадёт половина матча. Прошедшую неделю — ещё раз во вторник: в понедельник
Yahoo вносит правки статистики («stat corrections»), тогда final: true.

Сессия — .pw-profile, как у scrape.py (умерла — tools/login.py). Страницы по
одной, с паузой: на частые запросы Yahoo отвечает «Request denied».

Пишет data/hockey_yahoo.json на lynx — сайт отдаёт его в /api/hockey/live:
  weeks[понедельник] = { week, at, final,
    totals: { слот: { s, cw } },                       — вкладка Totals, cw — взятые категории
    days: { дата: { at, teams: { слот: { s, gs, sk, r } } } } }
  s — g a pm ppp sog fw hit blk w sv sa sho за день (только активные слоты),
  gs — выходов вратарей в слоте G, sk — выходов полевых в активных слотах,
  r — [[слот Yahoo, имя, клуб, играл 0/1], …] — весь состав на день.
Слот сайта — по названию команды (hockey.json → yahoo).
"""
import argparse, difflib, functools, json, pathlib, re, subprocess, sys, time, urllib.request
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
PROFILE = ROOT / ".pw-profile"
LEAGUE = "105022"
B = f"https://hockey.fantasysports.yahoo.com/hockey/{LEAGUE}"
LYNX = "myrtyx@lynx"
DATA = "/home/myrtyx/workspace/life-dash/data"
STATE, OUT = f"{DATA}/hockey.json", f"{DATA}/hockey_yahoo.json"
WEEK1 = date(2026, 9, 28)  # понедельник недели 1 (сезон с вт 29.09)
PAUSE = 4.0
SK = ["g", "a", "pm", "ppp", "sog", "fw", "hit", "blk"]
GK = ["w", "sv", "sho"]
COL = {"G": "g", "A": "a", "+/-": "pm", "PPP": "ppp", "SOG": "sog", "FW": "fw", "HIT": "hit", "BLK": "blk",
       "W": "w", "SV": "sv", "SA*": "sa", "SV%": "svpct", "SHO": "sho"}
BENCH = {"BN", "IR", "IR+", "NA", ""}

# Разбор страницы матчапа целиком в браузере: таблица итогов недели и таблицы
# состава (полевые, вратари) — по строке на слот, слева mid1, справа mid2.
PARSE = r"""() => {
  const txt = (el) => (el?.innerText || '').trim();
  const tables = [...document.querySelectorAll('table')];
  const tot = tables.find((t) => txt(t.querySelector('th, td')) === 'Team');
  const totals = tot ? [...tot.querySelectorAll('tr')].map((r) => [...r.children].map(txt)) : null;
  const side = (cs) => {
    const a = cs[1]?.querySelector('a.name');
    return {
      pos: cs[0]?.querySelector('[data-pos]')?.dataset.pos ?? txt(cs[0]),
      name: a ? txt(a) : null,
      // «PIT - RW»; метка травмы (DTD, IR, O…) — соседний элемент того же класса.
      tp: [...(cs[1]?.querySelectorAll('.ysf-player-name .Fz-xxs') || [])].map(txt).find((t) => / - /.test(t)) || '',
      stats: cs.slice(2).map(txt),
    };
  };
  const grids = tables.filter((t) => t.querySelector('.ysf-player-name')).map((t) => {
    const rows = [...t.querySelectorAll('tr')];
    const head = [...rows[0].children].map(txt);
    const keys = [];
    for (const h of head.slice(2)) { if (!h) break; keys.push(h); }
    const body = rows.slice(1).map((r) => {
      const cells = [...r.children];
      const mid = cells.findIndex((c) => c.classList.contains('Bdrstart'));
      return { mid: txt(cells[mid]), l: side(cells.slice(0, mid)), r: side(cells.slice(mid + 1)) };
    });
    return { keys, body };
  });
  return { totals, grids, url: location.href };
}"""


def num(v):
    v = (v or "").strip()
    if v in ("", "-", "--"):
        return None
    try:
        return float(v) if "." in v else int(v)
    except ValueError:
        return None


def ssh(cmd, inp=None):
    return subprocess.run(["ssh", LYNX, cmd], input=inp, capture_output=True, text=True, check=True).stdout


def nhl_days(monday):
    """дата → регулярные матчи дня (без перенесённых)."""
    req = urllib.request.Request(f"https://api-web.nhle.com/v1/schedule/{monday}", headers={"User-Agent": "Mozilla/5.0"})
    raw = json.load(urllib.request.urlopen(req, timeout=20))
    return {d["date"]: [g for g in d.get("games", []) if g.get("gameType") == 2 and g.get("gameScheduleState") not in ("PPD", "CNCL", "SUSP")]
            for d in raw.get("gameWeek", [])}


def go(pg, url, wait=3500):
    for _ in range(4):
        time.sleep(PAUSE)
        pg.goto(url, timeout=60000, wait_until="domcontentloaded")
        pg.wait_for_timeout(wait)
        if "login.yahoo.com" in pg.url:
            sys.exit("сессия Yahoo умерла — tools/login.py, потом снова")
        if "Request denied" in pg.inner_text("body")[:600]:
            print("  Request denied, жду 90 с", flush=True)
            time.sleep(90)
            continue
        return
    sys.exit("Yahoo не пускает: " + url)


def side_day(grids, half):
    """Итог дня одной стороны: суммы активных слотов, выходы, состав."""
    s = {k: 0 for k in SK + GK + ["sa"]}
    roster, gs, sk = [], 0, 0
    for grid in grids:
        keys = [COL.get(k, k) for k in grid["keys"]]
        goalie = "sv" in keys
        for row in grid["body"]:
            x = row[half]
            if row["mid"] == "TOTAL" or not x["name"]:
                continue
            st = dict(zip(keys, (num(v) for v in x["stats"])))
            played = st.get("sv" if goalie else "g") is not None
            # «PIT - RW»; у травмированных перед клубом бывает метка («IR PIT - RW»).
            m = re.search(r"\b([A-Za-z]{2,3}) - ", x["tp"] or "")
            team = m.group(1).upper() if m else None
            roster.append([x["pos"], x["name"], team, 1 if played else 0])
            if not played or x["pos"] in BENCH:
                continue
            if goalie:
                gs += 1
                for k in GK:
                    s[k] += st.get(k) or 0
                pct = st.get("svpct")
                s["sa"] += round(st["sv"] / pct) if pct else st["sv"]
            else:
                sk += 1
                for k in SK:
                    s[k] += st.get(k) or 0
    return {"s": s, "gs": gs, "sk": sk, "r": roster}


def check_total(grids, half, rec, label):
    """Сумма строк против строки TOTAL Yahoo — разбор не съехал."""
    for grid in grids:
        keys = [COL.get(k, k) for k in grid["keys"]]
        for row in grid["body"]:
            if row["mid"] != "TOTAL":
                continue
            for k, v in zip(keys, (num(v) for v in row[half]["stats"])):
                if k in rec["s"] and v is not None and k != "sa" and abs(rec["s"][k] - v) > 1e-9:
                    print(f"  ! {label}: {k} по строкам {rec['s'][k]}, в TOTAL {v}", flush=True)


def week_totals(table):
    """Вкладка итогов: команда → суммы и взятые категории."""
    head = [COL.get(h, h) for h in table[0]]
    out = {}
    for row in table[1:]:
        vals = dict(zip(head[1:], (num(v) for v in row[1:])))
        cw = num(row[-1])
        out[row[0]] = {"s": {k: vals.get(k) for k in SK + GK + ["sa", "svpct"]}, "cw": cw}
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--week", type=int)
    ap.add_argument("--dry", action="store_true")
    ap.add_argument("--out", help="копия файла локально")
    a = ap.parse_args()

    et = datetime.now(ZoneInfo("America/New_York")).date()
    state = json.loads(ssh(f"cat {STATE}"))
    teams = {k: v["team"] for k, v in (state.get("yahoo") or {}).items()}
    norm = lambda t: re.sub(r"[^a-z0-9]", "", t.lower())

    # Название в Yahoo и на сайте может разойтись (сайт: «Springfield Ice
    # Donuts», Yahoo: «…Iced…») — ближайшее по написанию, но не наугад.
    @functools.cache
    def slot_of(name):
        by = {norm(t): k for k, t in teams.items()}
        if norm(name) in by:
            return by[norm(name)]
        near = difflib.get_close_matches(norm(name), list(by), n=1, cutoff=0.85)
        if near:
            print(f"  «{name}» = «{teams[by[near[0]]]}» на сайте", flush=True)
        return by[near[0]] if near else None
    try:
        store = json.loads(ssh(f"cat {OUT} 2>/dev/null || echo '{{}}'"))
    except json.JSONDecodeError:
        store = {}
    store.setdefault("weeks", {})

    def monday_of(n):
        for m, v in (state.get("matchups") or {}).items():
            if v.get("week") == n:
                return date.fromisoformat(m)
        return WEEK1 + timedelta(days=7 * (n - 1))

    cur = (et - WEEK1).days // 7 + 1
    plan = []  # (неделя, понедельник, заново целиком)
    if a.week:
        plan.append((a.week, monday_of(a.week), True))
    else:
        plan.append((cur, monday_of(cur), False))
        # Прошлая неделя после правок статистики (понедельник) — один раз заново.
        prev = store["weeks"].get(monday_of(cur - 1).isoformat()) if cur > 1 else None
        if prev is not None and not prev.get("final") and et >= monday_of(cur - 1) + timedelta(days=8):
            plan.insert(0, (cur - 1, monday_of(cur - 1), True))

    with sync_playwright() as p:
        ctx = p.chromium.launch_persistent_context(str(PROFILE), channel="chrome", headless=True, viewport={"width": 1600, "height": 1000})
        pg = ctx.pages[0] if ctx.pages else ctx.new_page()
        for n, monday, redo in plan:
            key = monday.isoformat()
            wk = store["weeks"].setdefault(key, {"week": n, "days": {}, "totals": {}})
            games = nhl_days(key)
            dates = [(monday + timedelta(days=i)).isoformat() for i in range(7)]
            todo = [d for d in dates if games.get(d) and all(g.get("gameState") in ("OFF", "FINAL") for g in games[d])
                    and (redo or d not in wk["days"])]
            live = [d for d in dates if any(g.get("gameState") in ("LIVE", "CRIT") for g in games.get(d, []))]
            print(f"неделя {n} ({key}): снимаю {', '.join(todo) or 'нечего'}" + (f"; идут матчи {', '.join(live)}" if live else ""), flush=True)
            if not todo:
                continue
            go(pg, f"{B}?matchup_week={n}&module=matchups")
            pairs = set()
            for el in pg.query_selector_all("a"):
                h = el.get_attribute("href") or ""
                if "matchup?" in h and f"week={n}" in h and "mid2=" in h:
                    q = dict(x.split("=", 1) for x in h.split("?", 1)[1].split("&") if "=" in x)
                    pairs.add((q["mid1"], q["mid2"]))
            if len(pairs) != 6:
                sys.exit(f"матчапов недели {n}: {len(pairs)}, ждал 6")
            at = datetime.now(timezone.utc).isoformat(timespec="seconds")
            for m1, m2 in sorted(pairs, key=lambda x: int(x[0])):
                for d in todo:
                    go(pg, f"{B}/matchup?week={n}&date={d}&mid1={m1}&mid2={m2}")
                    page = pg.evaluate(PARSE)
                    names = [row[0] for row in (page["totals"] or [])[1:3]]
                    if len(names) != 2 or len(page["grids"]) < 2:
                        sys.exit(f"страница не разобралась: {page['url']}")
                    for half, name in zip(("l", "r"), names):
                        slot = slot_of(name)
                        if not slot:
                            print(f"  ! команды «{name}» нет в hockey.json → yahoo, пропускаю", flush=True)
                            continue
                        rec = side_day(page["grids"], half)
                        check_total(page["grids"], half, rec, f"{name} {d}")
                        wk["days"].setdefault(d, {"teams": {}})["teams"][slot] = rec
                        wk["days"][d]["at"] = at
                    if d == todo[-1]:
                        for name, t in week_totals(page["totals"]).items():
                            if slot_of(name):
                                wk["totals"][slot_of(name)] = t
                    print(f"  {d} {names[0]} — {names[1]}", flush=True)
            wk["at"] = at
            wk["week"] = n
            if redo and et >= monday + timedelta(days=8):
                wk["final"] = True
            # Сверка: сумма дней = вкладка итогов.
            for slot, t in sorted(wk["totals"].items(), key=lambda x: int(x[0])):
                tot = {k: sum(day["teams"].get(slot, {}).get("s", {}).get(k, 0) for day in wk["days"].values()) for k in SK + GK + ["sa"]}
                bad = [f"{k} {tot[k]}≠{t['s'][k]}" for k in SK + GK if t["s"].get(k) is not None and abs(tot[k] - t["s"][k]) > 1e-9]
                team = teams[slot]
                print(f"  {team:24s} кат. {t['cw']}  " + (f"! дни ≠ итог: {', '.join(bad)}" if bad else "дни = итог"), flush=True)
        ctx.close()

    body = json.dumps(store, ensure_ascii=False, separators=(",", ":"))
    if a.out:
        pathlib.Path(a.out).write_text(body)
        print(f"записал {a.out}")
    if a.dry:
        print("--dry: на lynx не пишу")
        return
    ssh(f"cat > {OUT}.tmp && mv {OUT}.tmp {OUT}", inp=body)
    print(f"записал {OUT} ({len(body) // 1024} КБ)")


if __name__ == "__main__":
    main()
