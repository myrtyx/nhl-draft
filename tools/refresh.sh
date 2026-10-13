#!/bin/sh
# Начало хоккейной сессии, одной командой: tools/refresh.sh
# С 13.10 то же самое ночью делает lynx (tools/nightly.sh): здесь сначала
# подтягиваю его коммит проекций, и если все сыгранные дни уже сняты, а
# проекциям меньше суток — ничего не жду. Иначе по-старому:
#   1. проекции Yahoo (scrape.py, ~6 мин) → check.js → коммит data/yahoo_*.json
#      и push: сайт берёт их с GitHub Pages;
#   2. счёт недели по дням (yahoo_week.py) → прямо на прод, hockey_yahoo.json.
#      Со вторника он сам переснимает прошлую неделю (после правок статистики).
# Аргументы уходят в yahoo_week.py (--dry, --week N) и снимают всё заново.
# Коммитит только два файла данных: чужая незакоммиченная работа в репо не трогается.
set -e
cd "$(dirname "$0")/.."
git fetch -q origin && git merge -q --ff-only origin/main 2>/dev/null \
  || echo "! main разошёлся с GitHub — ночные проекции lynx не подтянул"
if [ $# -eq 0 ]; then
  age=$(.venv/bin/python -c "import json, datetime as d; f = json.load(open('data/yahoo_proj.json'))['fetched']; print(int((d.datetime.now(d.timezone.utc) - d.datetime.fromisoformat(f)).total_seconds() // 3600))")
  rc=0; .venv/bin/python tools/yahoo_week.py --check >/dev/null || rc=$?
  if [ $rc -eq 3 ] && [ "$age" -lt 24 ]; then
    echo "свежее: проекциям $age ч, все сыгранные дни сняты — снимать нечего"
    exit 0
  fi
fi
.venv/bin/python tools/scrape.py
node tools/check.js
if ! git diff --quiet -- data/yahoo_proj.json data/yahoo_p7.json; then
  git -c user.name=Martins -c user.email=martins.rots@gmail.com commit -q \
    -m "Yahoo-проекции $(date +%d.%m)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" \
    -- data/yahoo_proj.json data/yahoo_p7.json
  git push -q origin main
  echo "проекции запушены — Pages обновит сайт за ~1 мин"
fi
.venv/bin/python tools/yahoo_week.py "$@"
