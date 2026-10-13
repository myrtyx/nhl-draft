"""Браузер с сессией Yahoo для scrape.py и yahoo_week.py.

На маке — Chrome с профилем .pw-profile (вход: tools/login.py). На lynx (ночной
снимок, tools/nightly.sh) Chrome нет: там Chromium Playwright, а сессия — файл
YAHOO_STATE с cookies из .pw-profile (выгружает tools/yahoo_state.py). После
прогона файл перезаписывается: Yahoo продлевает cookies.
"""
import json, os, pathlib, sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
PROFILE = ROOT / ".pw-profile"
STATE = os.environ.get("YAHOO_STATE")
DEAD = 4  # код выхода «сессия Yahoo умерла»: nightly.sh по нему зовёт Мартина войти


def dead(msg):
    print(msg, file=sys.stderr, flush=True)
    sys.exit(DEAD)


def _load():
    st = json.loads(pathlib.Path(STATE).read_text())
    return st, st.pop("userAgent", None)


def _save(st, ua):
    path = pathlib.Path(STATE)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps({**st, "userAgent": ua}))
    tmp.chmod(0o600)
    tmp.replace(path)


def open_sync(p, viewport):
    """(контекст, закрыть) для sync_playwright."""
    if not STATE:
        ctx = p.chromium.launch_persistent_context(str(PROFILE), channel="chrome", headless=True, viewport=viewport)
        return ctx, ctx.close
    st, ua = _load()
    br = p.chromium.launch(headless=True)
    ctx = br.new_context(storage_state=st, user_agent=ua, viewport=viewport)

    def close():
        _save(ctx.storage_state(), ua)
        br.close()
    return ctx, close


async def open_async(p, viewport):
    """(контекст, закрыть) для async_playwright."""
    if not STATE:
        ctx = await p.chromium.launch_persistent_context(str(PROFILE), channel="chrome", headless=True, viewport=viewport)
        return ctx, ctx.close
    st, ua = _load()
    br = await p.chromium.launch(headless=True)
    ctx = await br.new_context(storage_state=st, user_agent=ua, viewport=viewport)

    async def close():
        _save(await ctx.storage_state(), ua)
        await br.close()
    return ctx, close
