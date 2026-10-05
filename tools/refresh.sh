#!/bin/sh
# Начало хоккейной сессии, одной командой: tools/refresh.sh
#   1. проекции Yahoo (scrape.py, ~6 мин) → check.js → коммит data/yahoo_*.json
#      и push: сайт берёт их с GitHub Pages;
#   2. счёт недели по дням (yahoo_week.py) → прямо на прод, hockey_yahoo.json.
#      Со вторника он сам переснимает прошлую неделю (после правок статистики).
# Аргументы уходят в yahoo_week.py (--dry, --week N). Коммитит только два файла
# данных: чужая незакоммиченная работа в репо не трогается.
set -e
cd "$(dirname "$0")/.."
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
