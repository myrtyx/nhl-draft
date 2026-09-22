#!/bin/sh
# Выкат. Браузер держит core.js в кэше, поэтому свежий код до открытой вкладки
# не доезжает и страница падает на функциях, которых в старом файле ещё нет.
# Метка времени в теге снимает это раз и навсегда.
set -e
cd "$(dirname "$0")/.."
sed -i '' "s|core\.js?v=[0-9]*|core.js?v=$(date +%s)|" index.html
git add -A
git commit -q -m "${1:-выкат}" || true
git push -q origin main
echo "запушено, жду сборку…"
for i in $(seq 10); do
  [ "$(gh api repos/myrtyx/nhl-draft/pages/builds/latest --jq .status 2>/dev/null)" = built ] && {
    echo "собрано: https://myrtyx.github.io/nhl-draft/"; exit 0; }
  sleep 12
done
echo "сборка не дождалась"; exit 1
