// Ядро оценки. Без DOM — используется и страницей, и проверочными скриптами.
//
// Модель. В формате One Win неделя — это одна победа/поражение по большинству
// из 12 категорий, значит цель ровно одна: выигрывать 7 категорий из 12.
// Перевес сверх победы не стоит ничего, безнадёжное отставание — тоже.
// Поэтому ценность игрока считается не «суммой хороших цифр», а приростом
// ожидаемого числа выигранных категорий:
//
//   P(кат) = Φ((моя сумма z − средняя по лиге) / σ по лиге)
//   ценность игрока = Σ по категориям [ P(моя сумма + его z) − P(моя сумма) ]
//
// Среднее и σ берутся из симуляции: топ-игроки Yahoo раздаются змейкой
// по 12 командам, и считается реальный разброс сумм по каждой категории.
// Отсюда само собой выходит и насыщение (категория уже взята → прирост ≈ 0),
// и отказ (категория провалена → прирост ≈ 0), без ручных правил.
(function (root) {
'use strict';

const TEAMS = 12, MY_SLOT = 2, ROUNDS = 16;
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

// разброс сумм z по лиге, если топ-игроков раздать змейкой по 12 командам
function league(list, cats, perTeam){
  const ranked = [...list].sort((a,b)=>(a.rank_pre??9999)-(b.rank_pre??9999))
                          .slice(0, TEAMS*perTeam);
  const teams = Array.from({length:TEAMS},()=>[]);
  ranked.forEach((p,i)=>{
    const r = Math.floor(i/TEAMS), s = i%TEAMS;
    teams[r%2 ? TEAMS-1-s : s].push(p);
  });
  const out = {};
  for (const c of cats){
    const sums = teams.map(t=>t.reduce((s,p)=>s+p.z[c.k],0));
    // cum[k] — сколько в среднем набирает команда первыми k пиками.
    // Нужно, чтобы понимать, что мне ещё достанется на оставшихся пиках.
    const cum = [];
    for (let k = 0; k <= perTeam; k++)
      cum.push(mean(teams.map(t => t.slice(0,k).reduce((s,p)=>s+p.z[c.k],0))));
    out[c.k] = {m: mean(sums), sd: std(sums), cum, sorted:[...sums].sort((a,b)=>b-a)};
  }
  return out;
}

let LG = null;   // {sk:{...}, gk:{...}}

function prepare(d){
  d.skaters.forEach(p => { p.isG = false; });
  d.goalies.forEach(p => { p.isG = true; if (!p.pos || !p.pos.length) p.pos = ['G']; });
  buildZ(d.skaters, SK_CATS, SK_DEPTH);
  buildZ(d.goalies, G_CATS, G_DEPTH);
  LG = {sk: league(d.skaters, SK_CATS, SK_PER_TEAM),
        gk: league(d.goalies, G_CATS, G_PER_TEAM)};
  return [...d.skaters, ...d.goalies];
}

// Вероятность выиграть категорию по итогам сезона, когда у меня набрано n игроков
// с суммой z = v. Пустые слоты добиваются тем, что в среднем достаётся команде
// на оставшихся пиках — иначе ранний элитный игрок выглядит как уже выигранная
// категория, и модель перестаёт ценить голы после первого же пика.
function pWin(cat, v, isG, n){
  const L = (isG ? LG.gk : LG.sk)[cat.k];
  const full = isG ? G_PER_TEAM : SK_PER_TEAM;
  const k = Math.max(0, Math.min(n == null ? full : n, full));
  const rest = L.cum[full] - L.cum[k];     // что ещё доберу
  return Phi((v + rest - L.m) / L.sd);
}

// суммарный z моего ростера по каждой категории
function myZ(pool, taken, cats, isG){
  const mine = pool.filter(p => taken[p.name] === 'ME' && !!p.isG === isG);
  const out = {};
  for (const c of cats) out[c.k] = mine.reduce((s,p)=>s + ((p.z && p.z[c.k]) || 0), 0);
  return out;
}

// профиль ростера: сумма z, вероятность и ожидаемое число категорий
function profile(pool, taken){
  const mine = pool.filter(p => taken[p.name] === 'ME');
  const nSk = mine.filter(p => !p.isG).length, nG = mine.filter(p => p.isG).length;
  const have = {isSk: myZ(pool, taken, SK_CATS, false),
                isG:  myZ(pool, taken, G_CATS, true)};
  const p = {}, pFull = {};
  let exp = 0;
  for (const c of SK_CATS){
    p[c.k] = pWin(c, have.isSk[c.k], false, nSk);
    pFull[c.k] = pWin(c, have.isSk[c.k], false);
    exp += p[c.k];
  }
  for (const c of G_CATS){
    p[c.k] = pWin(c, have.isG[c.k], true, nG);
    pFull[c.k] = pWin(c, have.isG[c.k], true);
    exp += p[c.k];
  }
  return {z: {...have.isSk, ...have.isG}, p, pFull, expected: exp, nSk, nG};
}

// ценность игрока = прирост ожидаемого числа выигранных категорий
function scoreAll(pool, taken){
  const pr = profile(pool, taken);
  for (const p of pool){
    const cats = p.isG ? G_CATS : SK_CATS;
    const n = p.isG ? pr.nG : pr.nSk;
    let s = 0;
    for (const c of cats){
      const cur = pr.z[c.k], add = (p.z && p.z[c.k]) || 0;
      s += c.rel * (pWin(c, cur + add, !!p.isG, n + 1) - pWin(c, cur, !!p.isG, n));
    }
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

function fillRoster(pool, taken){
  const mine = pool.filter(p => taken[p.name] === 'ME');
  const used = new Set(), out = [];
  for (const slot of SLOTS){
    const pick = slot === 'BN'
      ? mine.find(p => !used.has(p.name))
      : mine.find(p => !used.has(p.name) &&
          (slot === 'G' ? p.isG : (!p.isG && p.pos.includes(slot))));
    if (pick) used.add(pick.name);
    out.push([slot, pick || null]);
  }
  return out;
}

const API = {TEAMS, MY_SLOT, ROUNDS, MY_PICKS, SLOTS, SK_CATS, G_CATS, MULTI_BONUS,
             prepare, scoreAll, profile, pWin, myZ, fillRoster, withScarcity, groupOf,
             get LG(){return LG;}};
if (typeof module !== 'undefined' && module.exports) module.exports = API;
root.NHL = API;
})(typeof globalThis !== 'undefined' ? globalThis : this);
