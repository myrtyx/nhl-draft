#!/bin/sh
# Ночной снимок Yahoo — на lynx, cron myrtyx 09:05, 10:05, 12:05 по Риге
# (последние матчи NHL кончаются около 08:30 по Риге). Мартин приходит —
# данные уже свежие, tools/refresh.sh на маке это видит и не ждёт.
#   tools/nightly.sh            тихо выходит, если NHL не сыграл дней, которых нет в снимке
#   tools/nightly.sh --force    снять, даже если нечего (проверка)
# Дальше как refresh.sh: проекции → check.js → коммит и push data/yahoo_*.json
# (deploy key lynx), счёт недели → hockey_yahoo.json сайта.
# Звонит в Life Dash: сразу — если умерла сессия Yahoo (на маке login.py, потом
# yahoo_state.py), иначе — если не вышло и в последний заход дня (12:05).
set -u
cd "$(dirname "$0")/.."
export YAHOO_STATE="$HOME/.config/nhl-yahoo/state.json"
PY=.venv/bin/python
ALERT="$HOME/.nhl-nightly-alert"
echo "== $(date '+%F %T')"

alert() {  # $1 — тег, $2 — текст; один звонок на тег, пока не починится
  [ "$(cat "$ALERT" 2>/dev/null)" = "$1" ] && return
  echo "$1" > "$ALERT"
  TEXT="$2" TAG="$1" python3 - <<'EOF'
import json, os, re, urllib.request
env = open(os.path.expanduser("~/workspace/life-dash/app/.env")).read()
token = re.search(r"^KANBAN_INGEST_TOKEN=(.*)$", env, re.M).group(1).strip().strip('"')
body = {"text": os.environ["TEXT"], "source": "system", "important": True,
        "title": "Хоккей: ночной снимок Yahoo", "tag": "nhl-nightly-" + os.environ["TAG"]}
req = urllib.request.Request("http://127.0.0.1:3001/api/ingest/notify", data=json.dumps(body).encode(),
                             headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"})
urllib.request.urlopen(req, timeout=20).read()
EOF
}

fail() {  # $1 — код выхода шага, $2 — шаг
  if [ "$1" -eq 4 ]; then
    alert dead "Сессия Yahoo на lynx умерла. На маке: tools/login.py (войти в окне), потом tools/yahoo_state.py."
  elif [ "$(date +%H)" -ge 12 ]; then
    alert "fail-$2" "Сегодня не снялся ($2, код $1). Лог: ~/logs/nhl-nightly.log на lynx."
  fi
  echo "!! $2: код $1"
  exit "$1"
}

if [ "${1:-}" != "--force" ]; then
  $PY tools/yahoo_week.py --check; rc=$?
  [ $rc -eq 3 ] && exit 0
  [ $rc -ne 0 ] && fail $rc check
fi

git pull -q --rebase origin main || fail $? pull
$PY tools/scrape.py || fail $? scrape
CHECK_PREPARE_MS=6000 node tools/check.js || fail $? check.js  # проц lynx медленнее мака
if ! git diff --quiet -- data/yahoo_proj.json data/yahoo_p7.json; then
  git -c user.name=Martins -c user.email=martins.rots@gmail.com commit -q \
    -m "Yahoo-проекции $(date +%d.%m) (lynx)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" \
    -- data/yahoo_proj.json data/yahoo_p7.json
  git push -q origin main || { git pull -q --rebase origin main && git push -q origin main; } || fail $? push
fi
$PY tools/yahoo_week.py || fail $? yahoo_week
rm -f "$ALERT"
echo "== готово $(date '+%T')"
