"""Журнал трансферов Yahoo → журнал сайта (hockey.json → moves), все 12 команд.

    .venv/bin/python tools/yahoo_moves.py          # дописать недостающие ходы на прод
    .venv/bin/python tools/yahoo_moves.py --dry    # только напечатать

Зачем. Ходы соперников сайт знал только с моих рук. 13–19.10 я не внёс 25 ходов,
и сайт советовал взять Landeskog и Knight, которых давно забрали, а неделю
против Springfield считал без Hill и Lehkonen (74,4 % вместо 69,6 %).

Как. Страницы /transactions по 25, от свежих к старым, пока на странице не
встретится ход, который в журнале уже есть (не больше 4 страниц). Всё, что
новее самого старого такого хода и чего в журнале нет, дописываю. Ход ищу по
(команда, взят, отчислен). Если Мартин отметил свой ход на сайте с другим
drop (берёт подсказку сайта) — запись с той же командой, тем же взятым или
отчисленным, ±1 день, — правлю её по Yahoo, а не дублирую.

Дата хода — дата трансфера в Yahoo, время там EDT (настройка лиги). Год в
журнале Yahoo не пишет: сентябрь–декабрь — 2026, остальное — 2027.
Обмены (trade) не разбираю: встретится — выйду с ошибкой, разобрать руками.

Сессия и страницы — как у yahoo_week.py: на маке .pw-profile, на lynx файл
YAHOO_STATE; на lynx файлы сайта читаются и пишутся без ssh.
"""
import argparse, json, re, sys, unicodedata, uuid
from datetime import date, datetime, timezone
from playwright.sync_api import sync_playwright
from yahoo_browser import open_sync
from yahoo_week import B, STATE, go, ssh

MAX_PAGES = 4
WHEN = re.compile(r"^([A-Z][a-z]{2}) (\d{1,2}), (\d{1,2}):(\d{2}) ([ap]m)$")
PLAYER = re.compile(r"^(.*?) [A-Z]{2,3} - [A-Z,]+(?: .*)?$")
ICON = re.compile(r"^[-\s]+$")  # иконки-глифы Yahoo в innerText
ADD, DROP = {"Free Agent", "Waiver"}, {"To Waivers", "To Free Agents", "To Free Agent"}


def norm(s):
    return unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode().lower().strip()


def parse(text, slots):
    """Текст страницы журнала → [{ts, team, date, add, drop}], от свежих к старым."""
    lines = [l.strip() for l in text.splitlines() if l.strip() and not ICON.match(l.strip())]
    marks = [i for i, l in enumerate(lines) if l == "Previous 25 Next 25"]
    if len(marks) < 2:
        return []
    out, cur = [], []
    for l in lines[marks[0] + 1:marks[-1]]:
        m = WHEN.match(l)
        if not m:
            cur.append(l)
            continue
        team, pairs, cur = cur[-1], cur[:-1], []
        if team not in slots or len(pairs) % 2:
            sys.exit(f"не разобрал ход: {pairs} {team} {l}")
        mon, d, h, mi, ap = m.groups()
        month = datetime.strptime(mon, "%b").month
        ts = datetime(2026 if month >= 9 else 2027, month, int(d), int(h) % 12 + (12 if ap == "pm" else 0), int(mi))
        mv = {"ts": ts.isoformat(), "team": slots[team], "date": ts.date().isoformat(), "add": None, "drop": None}
        for i in range(0, len(pairs), 2):
            p, act = PLAYER.match(pairs[i]), pairs[i + 1]
            key = "add" if act in ADD else "drop" if act in DROP else None
            if not p or not key or mv[key]:
                sys.exit(f"не разобрал ход (обмен?): {pairs} {team} {l}")
            mv[key] = p.group(1)
        out.append(mv)
    return out


def key(m):
    return (m["team"], norm(m["add"]), norm(m["drop"]))


def merge(state, fetched):
    """Ходы Yahoo → (новые записи журнала, правки старых). fetched — от свежих к старым."""
    moves = state.get("moves") or []
    have = {key(m) for m in moves}
    known = [i for i, y in enumerate(fetched) if key(y) in have]
    if not known:
        sys.exit(f"на {len(fetched)} последних ходах Yahoo нет ни одного из журнала сайта — разобрать руками")
    window = fetched[:known[-1]]  # новее самого старого известного
    matched = {key(y) for y in fetched}
    loose = [m for m in moves if key(m) not in matched]  # записи сайта без пары в Yahoo
    add, fix = [], []
    for y in reversed(window):
        if key(y) in have:
            continue
        near = next((m for m in loose if m["team"] == y["team"]
                     and abs((date.fromisoformat(m["date"]) - date.fromisoformat(y["date"])).days) <= 1
                     and ((y["add"] and norm(m["add"]) == norm(y["add"])) or (y["drop"] and norm(m["drop"]) == norm(y["drop"])))), None)
        if near:
            loose.remove(near)
            fix.append((near, y))
        else:
            add.append(y)
        have.add(key(y))
    return add, fix


def apply(state, add, fix):
    now = datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
    moves = [dict(m) for m in state.get("moves") or []]
    for old, y in fix:
        m = next(m for m in moves if m["id"] == old["id"])
        m.update(date=y["date"], add=y["add"], drop=y["drop"])
    moves += [{"id": str(uuid.uuid4()), "team": y["team"], "date": y["date"], "add": y["add"], "drop": y["drop"], "createdAt": now} for y in add]
    return {**state, "moves": moves, "rev": (state.get("rev") or 0) + 1, "updatedAt": now}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry", action="store_true")
    a = ap.parse_args()
    state = json.loads(ssh(f"cat {STATE}"))
    slots = {v["team"]: int(k) for k, v in (state.get("yahoo") or {}).items()}
    have = {key(m) for m in state.get("moves") or []}
    fetched = []
    with sync_playwright() as p:
        ctx, close = open_sync(p, {"width": 1600, "height": 1000})
        pg = ctx.pages[0] if ctx.pages else ctx.new_page()
        try:
            for page in range(MAX_PAGES):
                go(pg, f"{B}/transactions?transactionsfilter=all&count={25 * page}")
                got = parse(pg.inner_text("body"), slots)
                fetched += got
                if not got or any(key(y) in have for y in got):
                    break
        finally:
            close()
    add, fix = merge(state, fetched)
    name = {v: k for k, v in slots.items()}
    for old, y in fix:
        print(f"  правлю {y['date']} {name[y['team']]}: +{old['add']} −{old['drop']} → +{y['add']} −{y['drop']}")
    for y in add:
        print(f"  {y['date']} {name[y['team']]}: +{y['add'] or '—'} −{y['drop'] or '—'}")
    print(f"ходы Yahoo: просмотрено {len(fetched)}, дописать {len(add)}, поправить {len(fix)}", flush=True)
    if not (add or fix) or a.dry:
        if a.dry and (add or fix):
            print("--dry: на сайт не пишу")
        return
    fresh = json.loads(ssh(f"cat {STATE}"))  # сайт мог записать, пока я ходил в Yahoo
    if fresh.get("rev") != state.get("rev"):
        add, fix = merge(fresh, fetched)
    body = json.dumps(apply(fresh, add, fix), ensure_ascii=False, indent=2)
    ssh(f"cat > {STATE}.moves.tmp && mv {STATE}.moves.tmp {STATE}", inp=body)
    print(f"записал: rev {fresh.get('rev')} → {(fresh.get('rev') or 0) + 1}")


if __name__ == "__main__":
    main()
