// Ядро оценки. Без DOM — используется и страницей, и проверочными скриптами.
//
// Модель. В формате One Win неделя — это одна победа/поражение по большинству
// из 12 категорий, значит цель ровно одна: выигрывать 7 категорий из 12.
// Перевес сверх победы не стоит ничего, безнадёжное отставание — тоже.
// Поэтому ценность игрока считается не «суммой хороших цифр», а приростом
// ожидаемого числа выигранных категорий:
//
//   P(кат) = Φ((моя сумма z − средняя по лиге) / σ по лиге)
//   ценность игрока = Σ [ P(с ним на слоте) − P(со средним на слоте) ]
//
// Сравнение позиционное: пустые слоты заранее добиты средним уровнем
// своей позиции, поэтому защитник меряется с защитником, а не с форвардом.
//
// Среднее и σ берутся из симуляции: топ-игроки Yahoo раздаются змейкой
// по 12 командам, и считается реальный разброс сумм по каждой категории.
// Отсюда само собой выходит и насыщение (категория уже взята → прирост ≈ 0),
// и отказ (категория провалена → прирост ≈ 0), без ручных правил.
(function (root) {
'use strict';

const TEAMS = 12, MY_SLOT = 2, ROUNDS = 16;
// Порядок колонок на доске Fantrax. myrtyx второй — отсюда и MY_SLOT.
const TEAM_NAMES = ['Bacha2201','myrtyx','sergei87','TOMIKS','Kris282828','Tomashek',
                    'AleksandrsZ','Dias','unwill','vlzsy','BATONS BAKERY','klavs'];
const MY_PICKS = [];
for (let r = 1; r <= ROUNDS; r++)
  MY_PICKS.push((r - 1) * TEAMS + (r % 2 ? MY_SLOT : TEAMS - MY_SLOT + 1));

const SLOTS = ['C','C','LW','LW','RW','RW','D','D','D','D','G','G','BN','BN','BN','BN'];

// rel = насколько категории можно доверять как цели.
// +/- и SHO занижены: проекция предсказывает их заметно хуже остальных.
const SK_CATS = [
  {k:'g',   n:'G',   rel:1},
  {k:'a',   n:'A',   rel:1},
  {k:'pm',  n:'+/-', rel:0.4},
  {k:'ppp', n:'PPP', rel:1},
  {k:'sog', n:'SOG', rel:1},
  {k:'fw',  n:'FW',  rel:1},
  {k:'hit', n:'HIT', rel:1},
  {k:'blk', n:'BLK', rel:1},
];
const G_CATS = [
  {k:'w',     n:'W',   rel:1},
  {k:'sv',    n:'SV',  rel:1},
  {k:'svpct', n:'SV%', rel:1},
  {k:'sho',   n:'SHO', rel:0.5},
];

const MULTI_BONUS = 0.08;
// Запасной выходит только вместо стартера: за неделю это примерно треть игр.
// Раньше он считался наравне со стартером — отсюда и лез шестой вратарь.
const W_BN = 0.35;
// Процент отражённых — не сумма, а отношение. Складывать z двух вратарей
// нельзя: у пары он равен общим сэйвам на общие броски, и добавить вратаря
// хуже текущей пары значит ОПУСТИТЬ команду, хотя сумма z при этом растёт.
const RATIO = 'svpct';
const ratioOf = gs => {
  let sv = 0, sa = 0;
  for (const [g, w] of gs){ sv += w * (g.sv || 0); sa += w * (g.sa || 0); }
  return sa ? sv / sa : 0;
};             // за каждую позицию сверх первой
// Сколько игроков каждой позиции реально нужно лиге: слотов × 12 команд.
// Отсюда берётся уровень «кто займёт этот слот, если я его не усилю».
const SLOT_COUNT = {C:2, LW:2, RW:2, D:4, G:2};
const SK_DEPTH = 250, G_DEPTH = 40;   // глубина пула для нормировки
const SK_PER_TEAM = 14, G_PER_TEAM = 2;

const mean = a => a.reduce((s,x)=>s+x,0)/a.length;
const std  = a => { const m = mean(a); return Math.sqrt(mean(a.map(x=>(x-m)**2))) || 1; };

// Φ — функция нормального распределения
function Phi(x){
  const t = 1/(1+0.2316419*Math.abs(x));
  const d = 0.3989422804014327*Math.exp(-x*x/2);
  let p = d*t*(0.319381530+t*(-0.356563782+t*(1.781477937+t*(-1.821255978+t*1.330274429))));
  return x >= 0 ? 1-p : p;
}

function buildZ(list, cats, depth){
  const pool = [...list].sort((a,b)=>(a.rank_pre??9999)-(b.rank_pre??9999)).slice(0, depth);
  for (const c of cats){
    const v = pool.map(p => +p[c.k] || 0), m = mean(v), s = std(v);
    for (const p of list) (p.z ||= {})[c.k] = ((+p[c.k] || 0) - m) / s;
  }
}

let LG = null;   // разброс сумм по лиге: {sk:{...}, gk:{...}}
let BASE = null;
let ORDER = [];   // порядок уже сделанных пиков, ставится страницей // средний z игрока на каждом слоте

// Симуляция лиги. Раньше топ-игроков просто раздавали змейкой по рангу, но
// так команда могла остаться без вратаря, а слоты — без хозяев. Теперь каждая
// команда 12 раундов берёт лучшего доступного, который закрывает пустой
// стартовый слот, и 4 раунда добирает скамейку. Отсюда сразу два числа:
// разброс сумм по лиге и средний уровень игрока на каждом слоте.
const STARTERS = Object.values(SLOT_COUNT).reduce((s,n)=>s+n,0);   // 12

function simulate(all, jitter){
  const key = p => (p.rank_pre ?? 9999) +
    (jitter ? (Math.random()+Math.random()+Math.random()-1.5) * jitter : 0);
  const byRank = [...all].map(p=>[p, key(p)]).sort((a,b)=>a[1]-b[1]).map(x=>x[0]);
  const teams = Array.from({length:TEAMS}, ()=>({
    used:{C:0,LW:0,RW:0,D:0,G:0,BN:0}, at:{C:[],LW:[],RW:[],D:[],G:[],BN:[]},
    sk:[], gk:[]
  }));
  const gone = new Set();
  for (let r = 0; r < ROUNDS; r++){
    const bench = r >= STARTERS;
    for (let i = 0; i < TEAMS; i++){
      const t = teams[r % 2 ? TEAMS - 1 - i : i];
      let pick = null, slot = 'BN';
      for (const p of byRank){
        if (gone.has(p.name)) continue;
        if (bench){ if (p.isG) continue; pick = p; break; }   // скамейку добирают полевыми
        const sl = slotFor(p, t.used);
        if (sl === 'BN') continue;
        pick = p; slot = sl; break;
      }
      if (!pick) continue;
      gone.add(pick.name);
      t.used[slot]++; t.at[slot].push(pick);
      (pick.isG ? t.gk : t.sk).push(pick);
    }
  }
  return teams;
}

// разброс сумм z по лиге для каждой категории
function spread(teams, cats, key){
  const out = {};
  for (const c of cats){
    const sums = teams.map(t => {
      let v = 0;
      for (const sl of (key === 'gk' ? ['G'] : ['C','LW','RW','D']))
        for (const q of t.at[sl]) v += q.z[c.k];
      if (key === 'sk') for (const q of t.at.BN) v += W_BN * q.z[c.k];
      if (c.k === RATIO) return ratioOf(t.at.G.map(q => [q, 1]));
      return v;
    });
    out[c.k] = {m: mean(sums), sd: std(sums), sorted:[...sums].sort((a,b)=>b-a)};
  }
  return out;
}

// Свести много раздач в одно распределение: среднее по всем, разброс — тоже
// по всем сразу, так что в него входит и случайность самого драфта.
function pool(runs, cats, key){
  const start = key === 'gk' ? ['G'] : ['C','LW','RW','D'];
  const out = {};
  for (const c of cats){
    const sums = [];
    for (const teams of runs) for (const t of teams){
      let v = 0;
      for (const sl of start) for (const q of t.at[sl]) v += q.z[c.k];
      if (key === 'sk') for (const q of t.at.BN) v += W_BN * q.z[c.k];
      if (c.k === RATIO) v = ratioOf(t.at.G.map(q => [q, 1]));
      sums.push(v);
    }
    out[c.k] = {m: mean(sums), sd: std(sums), sorted:[...sums].sort((a,b)=>b-a)};
  }
  return out;
}

// средний z игрока, реально занявшего этот слот в симуляции
function slotBase(teams){
  const B = {};
  for (const slot of ['C','LW','RW','D','G','BN']){
    const src = teams.flatMap(t => t.at[slot]);
    const cats = slot === 'G' ? G_CATS : SK_CATS;
    B[slot] = {};
    for (const c of cats) B[slot][c.k] = src.length ? mean(src.map(p=>p.z[c.k])) : 0;
  }
  return B;
}

// какой слот займёт игрок: лучший свободный из его позиций
function slotFor(p, used){
  if (p.isG) return used.G < SLOT_COUNT.G ? 'G' : 'BN';
  for (const pos of p.pos) if ((used[pos]||0) < (SLOT_COUNT[pos]||0)) return pos;
  return 'BN';
}

function prepare(d){
  d.skaters.forEach(p => { p.isG = false; });
  d.goalies.forEach(p => { p.isG = true; if (!p.pos || !p.pos.length) p.pos = ['G']; });
  buildZ(d.skaters, SK_CATS, SK_DEPTH);
  buildZ(d.goalies, G_CATS, G_DEPTH);
  const all = [...d.skaters, ...d.goalies];
  // Одна раздача строго по рангу — это одна точка, а не разброс. Живой драфт
  // тасует порядок: соперники тянутся, ошибаются, добирают по нужде. Поэтому
  // гоняю раздачу много раз с шумом и усредняю — иначе узкие категории
  // (PPP, голевые передачи) выглядят решаемыми, а они шумные.
  const runs = [];
  for (let i = 0; i < 80; i++) runs.push(simulate(all, i ? 25 : 0));
  LG   = {sk: pool(runs, SK_CATS, 'sk'), gk: pool(runs, G_CATS, 'gk')};
  BASE = slotBase(runs[0]);
  return [...d.skaters, ...d.goalies];
}

// Вероятность выиграть категорию по итогам сезона, если моя финальная сумма
// по ней будет v. Сравнение всегда между готовыми составами: незаполненные
// слоты заранее добиты средним уровнем этого слота (см. profile).
function pWin(cat, v, isG){
  const L = (isG ? LG.gk : LG.sk)[cat.k];
  return Phi((v - L.m) / L.sd);
}

// Разложить моих игроков по слотам Yahoo. Негибких ставим первыми — иначе
// мультипозиционный займёт слот, который больше некому закрыть.
function assign(mine){
  const used = {C:0, LW:0, RW:0, D:0, G:0, BN:0}, at = new Map();
  const order = [...mine].sort((a,b)=>
    (a.pos.length - b.pos.length) || ((a.rank_pre??9999)-(b.rank_pre??9999)));
  for (const p of order){
    const slot = slotFor(p, used);
    used[slot]++; at.set(p.name, slot);
  }
  return {used, at};
}

// Скамейка: 4 места. Третий вратарь садится сюда же, поэтому за него
// платишь одним полевым — это учитывается само собой.
function benchFree(used){ return Math.max(0, 4 - used.BN); }

// Чем реально закроется пустой слот, если не брать игрока прямо сейчас.
// Раньше сюда подставлялся средний стартер лиги — и слот выходил бесплатно
// лучше любого живого игрока позднего раунда: модель переставала брать
// крайних вовсе. Теперь слот закрывает тот, кто доживёт до моего пика,
// а если пики кончились — слот остаётся пустым и не даёт ничего.
// Досимулировать остаток драфта за все двенадцать команд сразу и вернуть то,
// что достанется мне. Иначе прогноз выходит оптимистичным: если считать, что
// на пике N доступен игрок ранга N, то к концу драфта я «беру» 191-го, а в
// живой раздаче к этому моменту разобраны ранги до 245 — слоты вынуждают
// команды пропускать и уходить глубже по списку.
function futureFill(pool, taken, used){
  const done  = Object.keys(taken).length;
  const byRank = pool.filter(q => !taken[q.name])
                     .sort((a,b)=>(a.rank_pre??9999)-(b.rank_pre??9999));
  const by = new Map(pool.map(q => [q.name, q]));

  // чем заняты слоты у каждой команды на текущий момент
  const st = Array.from({length: TEAMS}, () => ({C:0,LW:0,RW:0,D:0,G:0,BN:0}));
  ORDER.slice(0, done).forEach((nm, i) => {
    const q = by.get(nm); if (!q) return;
    const u = st[teamOf(i + 1) - 1];
    u[slotFor(q, u)]++;
  });
  if (!ORDER.length) for (const nm of Object.keys(taken)){      // порядка нет — всё моё
    const q = by.get(nm); if (!q) continue;
    const u = st[MY_SLOT - 1]; u[slotFor(q, u)]++;
  }

  const gone = new Set(), out = [], byPos = {};
  for (let n = done + 1; n <= TEAMS * ROUNDS; n++){
    const u = st[teamOf(n) - 1];
    const bench = (u.C+u.LW+u.RW+u.D+u.G) >= STARTERS;
    let pick = null, slot = 'BN';
    for (const q of byRank){
      if (gone.has(q.name)) continue;
      if (bench){ if (q.isG) continue; pick = q; break; }
      const sl = slotFor(q, u);
      if (sl === 'BN') continue;
      pick = q; slot = sl; break;
    }
    if (!pick) continue;
    gone.add(pick.name); u[slot]++;
    if (teamOf(n) === MY_SLOT){
      out.push({pos: slot, p: pick});
      if (!byPos[slot]) byPos[slot] = pick;
    }
  }
  return {list: out, byPos};
}

// Профиль = прогноз состава на конец драфта: мои игроки плюс то, чем реально
// добьются пустые места. Сравнение честное: два пика сравниваются как два
// готовых ростера, а не как два полуфабриката.
function profile(pool, taken){
  const mine = pool.filter(p => taken[p.name] === 'ME');
  const {used, at} = assign(mine);
  const z = {};
  for (const c of [...SK_CATS, ...G_CATS]) z[c.k] = 0;
  for (const p of mine){
    const cats = p.isG ? G_CATS : SK_CATS;
    const w = at.get(p.name) === 'BN' ? W_BN : 1;
    for (const c of cats) z[c.k] += w * p.z[c.k];
  }
  const fill = futureFill(pool, taken, used);
  for (const {pos, p} of fill.list){
    const cats = p.isG ? G_CATS : SK_CATS;
    const w = pos === 'BN' ? W_BN : 1;
    for (const c of cats) z[c.k] += w * p.z[c.k];
  }
  const free = {};
  for (const [pos, n] of Object.entries(SLOT_COUNT))
    free[pos] = Math.max(0, n - used[pos]);
  free.BN = benchFree(used);
  // вратари, что реально встанут в ворота, плюс третий со скамейки
  const gs = [];
  for (const q of mine) if (q.isG) gs.push([q, at.get(q.name) === 'G' ? 1 : W_BN]);
  for (const {pos, p: q} of fill.list) if (q.isG) gs.push([q, pos === 'G' ? 1 : W_BN]);
  z[RATIO] = ratioOf(gs);
  const p = {};
  let exp = 0;
  for (const c of SK_CATS){ p[c.k] = pWin(c, z[c.k], false); exp += p[c.k]; }
  for (const c of G_CATS) { p[c.k] = pWin(c, z[c.k], true ); exp += p[c.k]; }
  const nG = mine.filter(x=>x.isG).length;
  return {z, p, pFull: p, expected: exp, used, at, free, fill, gs,
          nSk: mine.length - nG, nG};
}

// Прирост вероятностей по категориям, если игрок встанет на свой слот вместо
// среднего игрока, который занял бы это место. Защитник сравнивается с
// защитником: слот D форвардом не закрыть, его всё равно кто-то займёт.
function catDelta(p, pr){
  const slot = slotFor(p, pr.used);
  const w = slot === 'BN' ? W_BN : 1;
  const alt = pr.fill.byPos[slot] || null;   // кто занял бы этот слот без меня
  const out = [];
  const push = (cats, isG, mine) => {
    for (const c of cats)
      out.push({n:c.n, k:c.k, rel:c.rel,
                d: pWin(c, pr.z[c.k] + mine(c), isG) - pWin(c, pr.z[c.k], isG)});
  };
  if (p.isG){
    // третий вратарь садится на скамейку: выходит редко и сгоняет оттуда полевого
    push(G_CATS.filter(c => c.k !== RATIO), true,
         c => w * (p.z[c.k] - (alt && alt.isG ? alt.z[c.k] : 0)));
    const gs = pr.gs.filter(([q]) => !(alt && alt.isG && q === alt));
    const c = G_CATS.find(x => x.k === RATIO);
    out.push({n:c.n, k:c.k, rel:c.rel,
              d: pWin(c, ratioOf([...gs, [p, w]]), true) - pWin(c, pr.z[RATIO], true)});
    if (slot !== 'G' && alt && !alt.isG)
      push(SK_CATS, false, c => -w * alt.z[c.k]);
  } else {
    push(SK_CATS, false, c => w * (p.z[c.k] - (alt && !alt.isG ? alt.z[c.k] : 0)));
  }
  return out;
}

// ценность игрока = прирост ожидаемого числа выигранных категорий
function scoreAll(pool, taken){
  const pr = profile(pool, taken);
  for (const p of pool){
    p.slot = slotFor(p, pr.used);
    const s = catDelta(p, pr).reduce((acc,x)=>acc + x.rel*x.d, 0);
    // ×100 — чтобы читалось как «сотые доли категории»
    // бонус за гибкость всегда в плюс: умножение делало слабого игрока с двумя
    // позициями ещё хуже слабого с одной, а нужно ровно наоборот
    const base = 100 * s;
    p.score = base + Math.abs(base) * MULTI_BONUS * ((p.pos ? p.pos.length : 1) - 1);
  }
  return pr;
}

// Группа дефицита: вратарь / защитник / нападающий.
// Слотов 2G, 4D, 6F — ждать замену в разных группах стоит по-разному.
function groupOf(p){
  if (p.isG) return 'G';
  return p.pos.some(x => x !== 'D') ? 'F' : 'D';
}

// Поправка на дефицит. Абсолютный прирост отвечает «кто лучше», но не «кого
// брать сейчас»: если такой же игрок доживёт до следующего моего пика, брать
// его сейчас незачем. Поэтому ценность = прирост минус прирост того, кто
// вероятно будет свободен на следующем моём пике в той же группе.
// Соперники моделируются как берущие по рангу Yahoo.
function withScarcity(pool, taken){
  const free = pool.filter(p => !taken[p.name]);
  const done = Object.keys(taken).length;
  const cur  = MY_PICKS.find(x => x >= done + 1);     // мой ближайший пик
  const next = MY_PICKS.find(x => x > cur);           // и следующий за ним
  const gap  = (cur && next) ? next - cur - 1 : 0;    // чужих пиков между ними

  // кого соперники, вероятно, заберут за это время (берут по рангу Yahoo)
  const byRank = [...free].sort((a,b)=>(a.rank_pre??9999)-(b.rank_pre??9999));
  const gone = new Set(byRank.slice(0, gap).map(p=>p.name));

  // Для каждой группы — двое лучших доживающих. Второй нужен затем, что
  // сам игрок не может быть себе заменой: если я беру лучшего, на следующем
  // пике меня ждёт второй.
  const repl = {};
  for (const g of ['G','D','F']){
    const rest = free.filter(p => groupOf(p) === g && !gone.has(p.name))
                     .sort((a,b)=>b.score-a.score);
    repl[g] = [rest[0] || null, rest[1] || null];
  }
  for (const p of pool){
    if (taken[p.name]) { p.vorp = p.score; continue; }
    const [r1, r2] = repl[groupOf(p)] || [null, null];
    const r = (r1 && r1.name === p.name) ? r2 : r1;
    p.vorp = p.score - (r ? r.score : 0);
  }
  const lvl = {};
  for (const g of ['G','D','F']) lvl[g] = repl[g][0] ? repl[g][0].score : 0;
  return {gap, cur, next, repl, lvl};
}

// Раскладка моего ростера по слотам — той же логикой, что и в оценке,
// иначе на экране одно, а в расчёте другое.
function fillRoster(pool, taken){
  const mine = pool.filter(p => taken[p.name] === 'ME');
  const {at} = assign(mine);
  const bucket = {};
  for (const p of mine) (bucket[at.get(p.name)] ||= []).push(p);
  return SLOTS.map(slot => [slot, (bucket[slot] || []).shift() || null]);
}


// ——— чужие команды ———
// Драфт идёт змейкой, значит по номеру пика однозначно известно, чья это
// команда. Поэтому достаточно вести один список пиков по порядку — ростеры
// всех 12 команд восстанавливаются сами.
function teamOf(n){
  const r = Math.floor((n - 1) / TEAMS), s = (n - 1) % TEAMS;
  return r % 2 ? TEAMS - s : s + 1;
}

// Профиль каждой команды: кто взят, суммы z по категориям, какие слоты пусты.
function rosters(pool, order){
  const by = new Map(pool.map(p => [p.name, p]));
  const out = Array.from({length: TEAMS}, (_, i) => ({
    slot: i + 1, mine: i + 1 === MY_SLOT, players: [], z: {}
  }));
  for (const t of out) for (const c of [...SK_CATS, ...G_CATS]) t.z[c.k] = 0;
  order.forEach((name, i) => {
    const p = by.get(name); if (!p) return;
    const t = out[teamOf(i + 1) - 1];
    t.players.push(p);
    for (const c of (p.isG ? G_CATS : SK_CATS)) t.z[c.k] += p.z[c.k];
  });
  for (const t of out){
    t.name = TEAM_NAMES[t.slot-1] || ('K'+t.slot);
    const {used} = assign(t.players);
    t.used = used;
    t.need = {};
    for (const [pos, n] of Object.entries(SLOT_COUNT)) t.need[pos] = Math.max(0, n - used[pos]);
  }
  // Место каждой команды в каждой категории — так видно, кто за что борется.
  // Команды без игроков нужного типа в расчёт не идут: иначе двенадцать нулей
  // выстроились бы в фальшивый рейтинг 1…12.
  for (const t of out){
    t.nSk = t.players.filter(p=>!p.isG).length;
    t.nG  = t.players.length - t.nSk;
    t.rank = {};
  }
  for (const c of [...SK_CATS, ...G_CATS]){
    const isG = G_CATS.includes(c);
    const live = out.filter(t => isG ? t.nG : t.nSk).sort((a,b)=>b.z[c.k]-a.z[c.k]);
    live.forEach((t,i)=>{ t.rank[c.k] = i + 1; });
    for (const t of out) if (!(isG ? t.nG : t.nSk)) t.rank[c.k] = null;
  }
  return out;
}

// Сколько игроков каждой позиции ушло и сколько осталось в верхушке пула.
// Нужно, чтобы поймать забег: если вратарей разбирают, ждать дороже.
function runs(pool, taken, depth){
  const free = pool.filter(p => !taken[p.name])
                   .sort((a,b)=>(a.rank_pre??9999)-(b.rank_pre??9999)).slice(0, depth || 60);
  const out = {};
  for (const pos of ['C','LW','RW','D','G']){
    out[pos] = {
      gone: pool.filter(p => taken[p.name] && (pos === 'G' ? p.isG : (!p.isG && p.pos.includes(pos)))).length,
      left: free.filter(p => pos === 'G' ? p.isG : (!p.isG && p.pos.includes(pos))).length
    };
  }
  return out;
}

function setOrder(o){ ORDER = Array.isArray(o) ? o : []; }

const API = {TEAMS, MY_SLOT, ROUNDS, MY_PICKS, TEAM_NAMES, SLOTS, SK_CATS, G_CATS, MULTI_BONUS,
             prepare, setOrder, scoreAll, profile, pWin, catDelta, assign, teamOf, rosters, runs, SLOT_COUNT, fillRoster, withScarcity, groupOf,
             get LG(){return LG;}};
if (typeof module !== 'undefined' && module.exports) module.exports = API;
root.NHL = API;
})(typeof globalThis !== 'undefined' ? globalThis : this);
