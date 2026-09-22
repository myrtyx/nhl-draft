// Порядок пиков для инструментов. С 22.09 пики отмечаются на сайте
// (xlynx.site/hockey), и правда лежит в его hockey.json на lynx; SEED в
// index.html больше не обновляется и годится только в запас, когда lynx
// недоступен. ORDER_SRC=seed — считать от SEED нарочно.
// Откуда взят порядок, пишется в stderr: прогон «не от того списка» уже
// однажды стоил разбора (см. DECISIONS.md про board.js и OUT).
const fs = require('fs');
const { execFileSync } = require('child_process');

const H = __dirname + '/..';
const LYNX_FILE = '/home/myrtyx/workspace/life-dash/data/hockey.json';

const fromSeed = () => {
  const m = fs.readFileSync(H + '/index.html', 'utf8').match(/const SEED\s*=\s*(\[[\s\S]*?\n\];)/);
  return eval(m[1].replace(/;$/, '')).map(x => Array.isArray(x) ? x[0] : x);
};

const fromSite = () => {
  const out = execFileSync('ssh', ['-o', 'ConnectTimeout=5', 'myrtyx@lynx', 'cat', LYNX_FILE],
    { encoding: 'utf8', timeout: 10000, stdio: ['ignore', 'pipe', 'ignore'] });
  const st = JSON.parse(out);
  if (!Array.isArray(st.order)) throw new Error('в hockey.json нет order');
  return { order: st.order, moves: st.moves || [], injured: st.injured || [], updatedAt: st.updatedAt };
};

let order, moves = [], injured = [], source;
if (process.env.ORDER_SRC === 'seed') {
  order = fromSeed(); source = 'SEED index.html (ORDER_SRC=seed)';
} else {
  try {
    const st = fromSite();
    ({ order, moves, injured } = st);
    source = `сайт, hockey.json${st.updatedAt ? ' от ' + st.updatedAt.slice(0, 16).replace('T', ' ') : ''}`;
  } catch (e) {
    order = fromSeed(); source = `SEED index.html — сайт не ответил (${e.message.split('\n')[0]})`;
  }
}
process.stderr.write(`[пики] ${order.length} · ${source}\n`);

module.exports = { order, moves, injured, source };
