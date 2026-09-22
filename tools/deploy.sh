#!/bin/sh
# Выкат. Браузер держит core.js в кэше, поэтому свежий код до открытой вкладки
# не доезжает и страница падает на функциях, которых в старом файле ещё нет.
# Метка времени в теге снимает это раз и навсегда.
#
# Скрипт раньше смотрел только на статус ПОСЛЕДНЕЙ сборки и писал «собрано»,
# когда это была ещё прошлая, успешная, а новая не начиналась. Хуже того, он
# не отличал errored от «ещё идёт»: 22.09 Pages дважды упал без изменений в
# коде, а выкат отрапортовал успех. Теперь ждём сборку ИМЕННО нашего коммита,
# при ошибке просим пересобрать, а в конце проверяем не статус, а сам файл на
# проде — метка в нём должна совпасть с тем, что мы записали.
set -e
cd "$(dirname "$0")/.."
REPO=myrtyx/nhl-draft
STAMP=$(date +%s)
sed -i '' "s|core\.js?v=[0-9]*|core.js?v=$STAMP|" index.html
git add -A
git commit -q -m "${1:-выкат}" || true
git push -q origin main
SHA=$(git rev-parse HEAD)
echo "запушено ${SHA%"${SHA#???????}"}, жду сборку…"

retried=0
for i in $(seq 25); do
  line=$(gh api "repos/$REPO/pages/builds/latest" --jq '.commit + " " + .status' 2>/dev/null || echo "? ?")
  bsha=${line%% *}; bst=${line##* }
  if [ "$bsha" = "$SHA" ]; then
    case "$bst" in
      built) break ;;
      errored)
        [ "$retried" = 1 ] && { echo "сборка упала дважды — смотри $REPO/deployments"; exit 1; }
        echo "сборка упала, прошу пересобрать…"
        gh api -X POST "repos/$REPO/pages/builds" >/dev/null; retried=1 ;;
    esac
  fi
  sleep 12
done

# Единственное честное доказательство: то, что отдаёт прод.
for i in $(seq 10); do
  got=$(curl -sH 'Cache-Control: no-cache' "https://myrtyx.github.io/nhl-draft/index.html?x=$STAMP$i" \
        | sed -n 's|.*core\.js?v=\([0-9]*\).*|\1|p' | head -1)
  [ "$got" = "$STAMP" ] && { echo "на проде: https://myrtyx.github.io/nhl-draft/"; exit 0; }
  sleep 10
done
echo "прод отдаёт старую версию (метка $got вместо $STAMP)"; exit 1
