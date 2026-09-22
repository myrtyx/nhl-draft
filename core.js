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

const MULTI_BONUS = 0.08;             // за каждую позицию сверх первой
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
let BASE = null; // средний z игрока на каждом слоте

// Симуляция лиги. Раньше топ-игроков просто раздавали змейкой по рангу, но
// так команда могла остаться без вратаря, а слоты — без хозяев. Теперь каждая
// команда 12 раундов берёт лучшего доступного, который закрывает пустой
// стартовый слот, и 4 раунда добирает скамейку. Отсюда сразу два числа:
// разброс сумм по лиге и средний уровень игрока на каждом слоте.
const STARTERS = Object.values(SLOT_COUNT).reduce((s,n)=>s+n,0);   // 12

function simulate(all){
  const byRank = [...all].sort((a,b)=>(a.rank_pre??9999)-(b.rank_pre??9999));
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
    const sums = teams.map(t => t[key].reduce((s,p)=>s+p.z[c.k],0));
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
  const teams = simulate([...d.skaters, ...d.goalies]);
  LG   = {sk: spread(teams, SK_CATS, 'sk'), gk: spread(teams, G_CATS, 'gk')};
  BASE = slotBase(teams);
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

// Профиль = прогноз состава на конец драфта: мои игроки плюс средний уровень
// слота на каждом ещё пустом месте. Именно поэтому сравнение честное: два
// разных пика сравниваются как два готовых ростера, а не как два полуфабриката.
function profile(pool, taken){
  const mine = pool.filter(p => taken[p.name] === 'ME');
  const {used, at} = assign(mine);
  const z = {};
  for (const c of [...SK_CATS, ...G_CATS]) z[c.k] = 0;
  for (const p of mine){
    const cats = p.isG ? G_CATS : SK_CATS;
    for (const c of cats) z[c.k] += p.z[c.k];
  }
  const free = {};
  for (const [pos, n] of Object.entries(SLOT_COUNT))
    free[pos] = Math.max(0, n - used[pos]);
  free.BN = benchFree(used);
  for (const [pos, n] of Object.entries(free)){
    if (!n) continue;
    const cats = pos === 'G' ? G_CATS : SK_CATS;
    for (const c of cats) z[c.k] += BASE[pos][c.k] * n;
  }
  const p = {};
  let exp = 0;
  for (const c of SK_CATS){ p[c.k] = pWin(c, z[c.k], false); exp += p[c.k]; }
  for (const c of G_CATS) { p[c.k] = pWin(c, z[c.k], true ); exp += p[c.k]; }
  const nG = mine.filter(x=>x.isG).length;
  return {z, p, pFull: p, expected: exp, used, at, free,
          nSk: mine.length - nG, nG};
}

// Прирост вероятностей по категориям, если игрок встанет на свой слот вместо
// среднего игрока, который занял бы это место. Защитник сравнивается с
// защитником: слот D форвардом не закрыть, его всё равно кто-то займёт.
function catDelta(p, pr){
  const slot = slotFor(p, pr.used);
  const out = [];
  if (p.isG){
    for (const c of G_CATS){
      // на слоте G меняю средний уровень вратаря на этого; третий вратарь
      // садится на скамейку и ничего не вытесняет из вратарских категорий
      const base = slot === 'G' ? BASE.G[c.k] : 0;
      out.push({n:c.n, k:c.k, rel:c.rel,
                d: pWin(c, pr.z[c.k] - base + p.z[c.k], true) - pWin(c, pr.z[c.k], true)});
    }
    if (slot !== 'G')   // третьим вратарём плачу одним полевым со скамейки
      for (const c of SK_CATS)
        out.push({n:c.n, k:c.k, rel:c.rel,
                  d: pWin(c, pr.z[c.k] - BASE.BN[c.k], false) - pWin(c, pr.z[c.k], false)});
  } else {
    const base = BASE[slot];
    for (const c of SK_CATS)
      out.push({n:c.n, k:c.k, rel:c.rel,
                d: pWin(c, pr.z[c.k] - base[c.k] + p.z[c.k], false) - pWin(c, pr.z[c.k], false)});
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
    p.score = 100 * s * (1 + MULTI_BONUS * ((p.pos ? p.pos.length : 1) - 1));
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

const API = {TEAMS, MY_SLOT, ROUNDS, MY_PICKS, TEAM_NAMES, SLOTS, SK_CATS, G_CATS, MULTI_BONUS,
             prepare, scoreAll, profile, pWin, catDelta, assign, teamOf, rosters, runs, SLOT_COUNT, fillRoster, withScarcity, groupOf,
             get LG(){return LG;}};
if (typeof module !== 'undefined' && module.exports) module.exports = API;
root.NHL = API;
})(typeof globalThis !== 'undefined' ? globalThis : this);
