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
// Fantrax развернул третий раунд: после обратного второго он идёт обратным
// ещё раз, и дальше змейка отсчитывается уже от него. Проверено по доске —
// R1 прямой, R2 и R3 обратные, R4 прямой, R5 обратный, R6 прямой.
// Начиная с третьего раунда направление просто отстаёт на раунд.
const reversed = r => (r <= 2 ? r : r - 1) % 2 === 0;
const MY_PICKS = [];
for (let r = 1; r <= ROUNDS; r++)
  MY_PICKS.push((r - 1) * TEAMS + (reversed(r) ? TEAMS - MY_SLOT + 1 : MY_SLOT));

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

// Как часто игрок вообще доступен: его же прогноз игр, разложенный по дням
// сезона. Раньше тут стояли две круглые цифры (0.5 и 0.3), и обе врали —
// 0.5 означало бы 3.5 игры за матчап, тогда как в модели их ровно 3.0.
// Заодно уходит целый класс ошибок: хрупкий игрок и вратарь-сменщик сами
// становятся реже доступны, без отдельной поправки.
// Сезон 2026-27: у каждого клуба ровно 84 игры, с 29 сентября по 10 апреля.
// Календарь клуба сидит в DAY_BINS, а здесь — только здоровье самого игрока:
// какую долю игр СВОЕГО клуба он проведёт. Раньше тут стояла круглая 0.5,
// одинаковая для железного и для хрупкого.
const SEASON_GP = 84, DAYS = 194;
const pDay = p => Math.min(1, (p.gp || 0) / SEASON_GP);

// Лига требует три выхода вратарей за неделю. Не выбрал — теряешь ВСЕ четыре
// вратарские категории сразу, а не одну. Один вратарь, даже лучший в лиге,
// даёт всего два выхода и минимум не берёт в принципе. Считаю вероятность
// выбрать: свёртка семи дней по каждому вратарю состава.
const G_MIN = 3;
// Здесь календарь входит иначе, чем в playShare. Там важен разброс густоты
// дней, тут — сколько раз клуб выйдет на лёд за неделю, а это число куда
// ровнее случайного: 56% недель ровно три игры, и почти никогда меньше двух.
// Независимые дни завышали риск на 7 пунктов, потому что выдумывали недели
// по одной игре, которых в расписании нет. Посчитано по 26 полным неделям
// пн-вс сезона 2026-27, среднее 3.02 игры.
const WEEK_GAMES = [[0,0.0168],[1,0.0264],[2,0.1358],[3,0.5625],[4,0.2584]];
function gMinOK(roster){
  let v = [1];
  for (const g of roster){
    if (!g.isG) continue;
    const hp = pDay(g);
    // сколько выходов даст этот вратарь: сперва сколько сыграет клуб, потом
    // сколько из них достанется ему
    const own = [];
    for (const [k, w] of WEEK_GAMES){
      let c = 1;
      for (let j = 0; j <= k; j++){
        own[j] = (own[j] || 0) + w * c * Math.pow(hp, j) * Math.pow(1 - hp, k - j);
        c = c * (k - j) / (j + 1);
      }
    }
    const n = [];
    for (let a = 0; a < v.length; a++)
      for (let b = 0; b < own.length; b++) n[a+b] = (n[a+b] || 0) + v[a] * own[b];
    v = n;
  }
  let fail = 0;
  for (let k = 0; k < G_MIN && k < v.length; k++) fail += v[k];
  return Math.max(0, 1 - fail);
}

// Игрок попадает в состав, только если на его позиции есть свободный слот,
// а сильнейших ставят первыми. Значит его доля игр — это шанс, что сегодня
// играет меньше сильных конкурентов, чем у него слотов.
// Сверено с прямой симуляцией расстановки по дням (алгоритм Куна, 5000
// недель): третий центр 0.750 против 0.740, четвёртый 0.500 против 0.486,
// шестой защитник 0.813 против 0.800.
// Календарь НХЛ рваный: бывает день на 2 команды и день на все 32. Посчитано
// по расписанию 2026-27 — 185 игровых дней, 32 команды, ровно 84 игры у каждой.
// Усреднять его нельзя: шанс, что слот займут, выпукл по числу играющих, и
// плоская неделя завышала выход запасного на 4-10 пунктов. Пары [доля команд,
// доля дней].
const DAY_BINS = [[0.0625,0.0054],[0.125,0.0595],[0.1875,0.1351],[0.25,0.1297],
  [0.3125,0.1081],[0.375,0.0703],[0.4375,0.0541],[0.5,0.0486],[0.5625,0.0595],
  [0.625,0.0649],[0.6875,0.0865],[0.75,0.0703],[0.8125,0.0378],[0.875,0.0486],
  [0.9375,0.0108],[1,0.0108]];

// Шанс выйти в один день, когда играет доля q соперников за слот.
function shareAt(slots, better, q){
  let s = 0, c = 1;
  for (let j = 0; j < slots && j <= better; j++){
    s += c * Math.pow(q, j) * Math.pow(1 - q, better - j);
    c = c * (better - j) / (j + 1);
  }
  return s;
}

// Доля игр, в которых игрок реально попадёт в состав. Прохожу по настоящему
// разбросу игровых дней: в густой день конкуренты играют все разом и слот
// уходит, в редкий — слот свободен, но и сам он чаще отдыхает. Здоровье (hp)
// отделено от календаря: это его собственные пропуски, не расписание клуба.
function playShare(slots, better, hp){
  if (slots <= 0) return 0;
  if (better <= 0) return 1;
  let num = 0, den = 0;
  for (const [f, w] of DAY_BINS){
    const q = Math.min(1, f * hp);
    const mine = w * q;
    num += mine * shareAt(slots, better, q);
    den += mine;
  }
  return den > 0 ? num / den : 0;
}

// Вес игрока внутри конкретного состава. Заменил сразу два выдуманных числа:
// плоский бонус за вторую позицию и фиксированный вес скамейки. Вторая
// позиция стоит ровно столько, насколько забита первая: первому центру она
// не даёт ничего, четвёртому удваивает выход на лёд.
// Веса всего состава сразу, точным перебором состояний. Считать игрока в
// одиночку нельзя: раньше крайний с двумя позициями числился занятым сразу на
// обеих, и чистый правый крайний выходил 0.48 вместо настоящих 0.85 — модель
// душила именно тех, кем живёт эта лига. Состояние — сколько слотов каждого
// вида занято (135 штук), игроки идут по рангу, как их и ставит тренер.
const SLOT_ORDER = ['C','LW','RW','D'];
const stIdx = (c,l,r,d) => ((c*3+l)*3+r)*5+d;
let wCacheKey = null, wCache = null;

function rosterWeights(roster){
  const sk = roster.filter(q => !q.isG)
                   .sort((a,b)=>(a.rank_pre??9999)-(b.rank_pre??9999));
  const n = sk.length;
  // предрасчёт: позиции числами и сколько желающих придёт следом
  const POS = {C:0, LW:1, RW:2, D:3}, CAP = [SLOT_COUNT.C, SLOT_COUNT.LW, SLOT_COUNT.RW, SLOT_COUNT.D];
  const myPos = sk.map(q => q.pos.map(x => POS[x]).filter(x => x !== undefined));
  const rest = [];
  for (let i = 0; i < n; i++){
    const r = [0,0,0,0];
    for (let j = i + 1; j < n; j++) for (const x of myPos[j]) r[x]++;
    rest.push(r);
  }
  const hp = sk.map(q => pDay(q));
  const num = new Float64Array(n), den = new Float64Array(n);
  let st = new Float64Array(135), nx = new Float64Array(135);
  for (const [f, w] of DAY_BINS){
    st.fill(0); st[0] = 1;
    for (let pi = 0; pi < n; pi++){
      const q = Math.min(1, f * hp[pi]), pp = myPos[pi], rr = rest[pi];
      nx.fill(0);
      let fit = 0;
      for (let i = 0; i < 135; i++){
        const v = st[i]; if (!v) continue;
        const d = i % 5, r = ((i/5)|0) % 3, l = ((i/15)|0) % 3, c = (i/45)|0;
        nx[i] += v * (1 - q);
        // Куда его поставить: туда, где свободных мест больше, чем желающих
        // занять их следом. Иначе игрок с двумя позициями садится на слот,
        // который больше некому закрыть, и вытесняет того, у кого позиция одна.
        let best = -1, bs = -1e9;
        for (let k = 0; k < pp.length; k++){
          const sl = pp[k];
          const used = sl === 0 ? c : sl === 1 ? l : sl === 2 ? r : d;
          const free = CAP[sl] - used;
          if (free <= 0) continue;
          const sc = free - rr[sl];
          if (sc > bs){ bs = sc; best = sl; }
        }
        if (best >= 0){
          const j = best === 0 ? i + 45 : best === 1 ? i + 15 : best === 2 ? i + 5 : i + 1;
          nx[j] += v * q; fit += v * q;
        } else nx[i] += v * q;      // мест нет — сидит на скамейке
      }
      num[pi] += w * fit;
      den[pi] += w * q;
      const t = st; st = nx; nx = t;
    }
  }
  const out = new Map();
  for (let i = 0; i < n; i++) out.set(sk[i], den[i] > 0 ? num[i] / den[i] : 0);
  // вратари живут отдельно: позиция одна, формула для неё точна
  const gs = roster.filter(q => q.isG)
                   .sort((a,b)=>(a.rank_pre??9999)-(b.rank_pre??9999));
  gs.forEach((g, i) => out.set(g, playShare(SLOT_COUNT.G, i, pDay(g))));
  return out;
}

function weightOf(p, roster){
  // Состав приходит одним и тем же для всех двенадцати категорий подряд,
  // поэтому держу разбор последнего.
  let hit = wCache && wCacheKey && wCacheKey.length === roster.length;
  if (hit) for (let i = 0; i < roster.length; i++)
    if (wCacheKey[i] !== roster[i]){ hit = false; break; }
  if (!hit){ wCacheKey = roster.slice(); wCache = rosterWeights(roster); }
  return wCache.get(p) ?? 0;
}

// Сумма категории по составу с честными весами.
function catSum(roster, c, isG){
  if (c.k === RATIO)
    return ratioOf(roster.filter(q => q.isG).map(q => [q, weightOf(q, roster)]));
  let v = 0;
  for (const q of roster){
    if (!!q.isG !== isG) continue;
    v += weightOf(q, roster) * q.z[c.k];
  }
  return v;
}
// Процент отражённых — не сумма, а отношение. Складывать z двух вратарей
// нельзя: у пары он равен общим сэйвам на общие броски, и добавить вратаря
// хуже текущей пары значит ОПУСТИТЬ команду, хотя сумма z при этом растёт.
// Категория решается за матчап, а не за сезон. Восемьдесят четыре игры при
// трёх в неделю — это двадцать восемь матчапов; считаю в настоящих голах и
// хитах за один такой отрезок, а не в отвлечённых долях сигмы.
const MATCHUPS = 28;
// Шум внутри матчапа: пуассоновский счёт плюс разброс числа игр (2-4 за
// неделю). Сверено с замерами по боксскорам: хиты 10.2, блоки 8.0,
// броски 18 — формула даёт 10.2, 8.1, 18.5.
const CV_SK = 0.20, CV_G = 0.40;
const PM_SD = 7.8;        // плюс-минус по Пуассону не считается — только замер
let SHOTS = 110;          // броски по команде за матчап, для процента отражённых
const noise = (mu, isG) => Math.max(mu, 0) + Math.pow((isG ? CV_G : CV_SK) * mu, 2);

const RATIO = 'svpct';
const ratioOf = gs => {
  let sv = 0, sa = 0;
  for (const [g, w] of gs){ sv += w * (g.sv || 0); sa += w * (g.sa || 0); }
  return sa ? sv / sa : 0;
};             // за каждую позицию сверх первой
// Сколько игроков каждой позиции реально нужно лиге: слотов × 12 команд.
// Отсюда берётся уровень «кто займёт этот слот, если я его не усилю».
const SLOT_COUNT = {C:2, LW:2, RW:2, D:4, G:2};
// Скамейка: 4 места. Без этого предела модель набирала по семь защитников —
// лишние просто садились на лавку, которая считалась бездонной.
const BENCH = 4;
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

// Никакой нормировки: доли сигмы прятали масштаб, а решает именно он.
function buildZ(list, cats){
  for (const p of list){
    p.z = {};
    for (const c of cats) p.z[c.k] = (+p[c.k] || 0) / MATCHUPS;
    if (p.isG) p.z[RATIO] = +p.svpct || 0;
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

// Свой генератор вместо Math.random: на нём лига пересчитывается восемьдесят
// раз, и с настоящей случайностью цена игрока прыгала при каждой перезагрузке
// страницы. Одинаковый сид — одинаковый ответ на один и тот же расклад.
let seed = 1;
const reseed = () => { seed = 20260922; };
// Math.imul, а не обычное умножение: seed * 1103515245 доходит до 2.4e18, это
// выше предела точности числа, младшие биты терялись ещё до маскирования и
// период падал до десяти тысяч вместо двух миллиардов.
const rnd = () => { seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff; return seed / 0x7fffffff; };

function simulate(all, jitter){
  const key = p => (p.rank_pre ?? 9999) +
    (jitter ? (rnd()+rnd()+rnd()-1.5) * jitter : 0);
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
        if (sl === 'BN' || !sl) continue;
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
      if (key === 'sk') for (const q of t.at.BN) v += 0.35 * q.z[c.k];
      if (c.k === RATIO) return ratioOf(t.at.G.map(q => [q, 1]));
      return v;
    });
    out[c.k] = {m: mean(sums), sd: std(sums), sorted:[...sums].sort((a,b)=>b-a)};
  }
  return out;
}

// Свести много раздач в одно распределение: среднее по всем, разброс — тоже
// по всем сразу, так что в него входит и случайность самого драфта.
// Команды лиги считаю ровно тем же весом, что и свою, иначе сравнивать нечего.
function pool(runs, cats, key){
  const isG = key === 'gk';
  const rosters = [];
  for (const teams of runs) for (const t of teams)
    rosters.push(['C','LW','RW','D','G','BN'].flatMap(sl => t.at[sl] || []));
  const out = {};
  for (const c of cats){
    const sums = rosters.map(r => catSum(r, c, isG));
    out[c.k] = {m: mean(sums), sd: std(sums), sorted:[...sums].sort((a,b)=>b-a)};
  }
  // Тем же минимумом меряю и соперников: у них те же два слота и то же правило.
  if (isG) out.minOK = mean(rosters.map(r => gMinOK(r)));
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
  const bn = () => (used.BN || 0) < BENCH ? 'BN' : null;   // null = места нет вовсе
  if (p.isG) return used.G < SLOT_COUNT.G ? 'G' : bn();
  for (const pos of p.pos) if ((used[pos]||0) < (SLOT_COUNT[pos]||0)) return pos;
  return bn();
}

function prepare(d){
  d.skaters.forEach(p => { p.isG = false; });
  d.goalies.forEach(p => { p.isG = true; if (!p.pos || !p.pos.length) p.pos = ['G']; });
  buildZ(d.skaters, SK_CATS);
  buildZ(d.goalies, G_CATS);
  const top = [...d.goalies].sort((a,b)=>(a.rank_pre??9999)-(b.rank_pre??9999)).slice(0, 24);
  SHOTS = top.length ? 2 * mean(top.map(g => (+g.sa || 0) / MATCHUPS)) : 110;
  const all = [...d.skaters, ...d.goalies];
  // Одна раздача строго по рангу — это одна точка, а не разброс. Живой драфт
  // тасует порядок: соперники тянутся, ошибаются, добирают по нужде. Поэтому
  // гоняю раздачу много раз с шумом и усредняю — иначе узкие категории
  // (PPP, голевые передачи) выглядят решаемыми, а они шумные.
  reseed();
  const runs = [];
  for (let i = 0; i < 80; i++) runs.push(simulate(all, i ? 25 : 0));
  LG   = {sk: pool(runs, SK_CATS, 'sk'), gk: pool(runs, G_CATS, 'gk')};
  BASE = slotBase(runs[0]);
  return [...d.skaters, ...d.goalies];
}

// Вероятность выиграть категорию по итогам сезона, если моя финальная сумма
// по ней будет v. Сравнение всегда между готовыми составами: незаполненные
// слоты заранее добиты средним уровнем этого слота (см. profile).
// Сравниваю не с разбросом по лиге за сезон, а со случайностью одной недели:
// сильнейший по категории всё равно проигрывает её примерно в трети случаев.
function pWin(cat, v, isG){
  const L = (isG ? LG.gk : LG.sk)[cat.k];
  let sd;
  if (cat.k === RATIO){
    const q = (v + L.m) / 2;
    sd = Math.sqrt(2 * q * (1 - q) / Math.max(SHOTS, 1));
  } else if (cat.k === 'pm'){
    sd = PM_SD * Math.SQRT2;
  } else {
    sd = Math.sqrt(noise(v, isG) + noise(L.m, isG));
  }
  return sd > 0 ? Phi((v - L.m) / sd) : 0.5;
}

// Разложить моих игроков по слотам Yahoo. Негибких ставим первыми — иначе
// мультипозиционный займёт слот, который больше некому закрыть.
// Раскладка состава по слотам. Жадность здесь врала: Зибанейд (C/RW) садился
// на C просто потому, что C идёт первым в его списке, и второй слот центра
// оказывался занят. После этого Кросби показывался скамейкой — хотя в Yahoo
// я бы просто сдвинул Зибанейда на RW и поставил обоих. Теперь ищу
// аугментирующий путь: новый игрок вытесняет соседа, если тому есть куда уйти.
const SEATS = ['C','LW','RW','D','G'];
function seatIn(p, at, taken, seen){
  for (const sl of (p.isG ? ['G'] : p.pos)){
    if ((taken[sl] || 0) < (SLOT_COUNT[sl] || 0)){ taken[sl]++; at.set(p, sl); return true; }
  }
  for (const sl of (p.isG ? ['G'] : p.pos)){
    if (seen.has(sl)) continue;
    seen.add(sl);
    for (const [q, qs] of [...at]){   // копия: at.set ниже дописывает в конец
      if (qs !== sl || q === p) continue;
      at.delete(q);
      if (seatIn(q, at, taken, seen)){ at.set(p, sl); return true; }
      at.set(q, sl);
    }
  }
  return false;
}

// Кого сажаю первым: сперва негибких, потом сильных. Порядок на размер
// раскладки не влияет — аугментирующий путь всё равно найдёт максимум.
function seatAll(mine){
  const at = new Map(), taken = {C:0, LW:0, RW:0, D:0, G:0};
  const order = [...mine].sort((a,b)=>
    (a.pos.length - b.pos.length) || ((a.rank_pre??9999)-(b.rank_pre??9999)));
  const out = [];
  for (const p of order) if (!seatIn(p, at, taken, new Set())) out.push(p);
  return {at, taken, out};
}

function assign(mine){
  const {at: seat, taken, out} = seatAll(mine);
  const used = {C:taken.C, LW:taken.LW, RW:taken.RW, D:taken.D, G:taken.G, BN:0};
  const at = new Map();
  for (const [p, sl] of seat) at.set(p.name, sl);
  for (const p of out){
    if (used.BN < BENCH){ used.BN++; at.set(p.name, 'BN'); }
    else at.set(p.name, 'OUT');
  }
  return {used, at};
}

// Скамейка: 4 места. Третий вратарь садится сюда же, поэтому за него
// платишь одним полевым — это учитывается само собой.
function benchFree(used){ return Math.max(0, BENCH - used.BN); }

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
    const sl = slotFor(q, u); if (sl) u[sl]++;
  });
  if (!ORDER.length) for (const nm of Object.keys(taken)){      // порядка нет — всё моё
    const q = by.get(nm); if (!q) continue;
    const u = st[MY_SLOT - 1]; const sl = slotFor(q, u); if (sl) u[sl]++;
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
      if (sl === 'BN' || !sl) continue;
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
  const fill = futureFill(pool, taken, used);
  // считаю по итоговому составу: и уже взятые, и те, кем добью пустые слоты
  const roster = [...mine, ...fill.list.map(f => f.p)];
  const z = {};
  for (const c of SK_CATS) z[c.k] = catSum(roster, c, false);
  for (const c of G_CATS)  z[c.k] = catSum(roster, c, true);
  const free = {};
  for (const [pos, n] of Object.entries(SLOT_COUNT))
    free[pos] = Math.max(0, n - used[pos]);
  free.BN = benchFree(used);
  const gs = roster.filter(q => q.isG).map(q => [q, weightOf(q, roster)]);
  const p = {};
  let exp = 0;
  for (const c of SK_CATS){ p[c.k] = pWin(c, z[c.k], false); exp += p[c.k]; }
  // Вратарские категории идут через минимум выходов: провалил — отдал их все,
  // сколько бы сэйвов ни набрал. Соперник рискует тем же, и когда провалит он,
  // категория моя без борьбы.
  const a = gMinOK(roster), b = LG.gk && LG.gk.minOK != null ? LG.gk.minOK : 1;
  for (const c of G_CATS) { p[c.k] = a * (1 - b) + a * b * pWin(c, z[c.k], true); exp += p[c.k]; }
  const nG = mine.filter(x=>x.isG).length;
  // Главное число — не сумма категорий, а шанс взять большинство. Неделя
  // выигрывается по счёту 7:5, и команда с ровными 6.2 в сумме может брать
  // семёрку реже, чем команда с тем же средним, но без провалов.
  const p7 = pAtLeast(SK_CATS.concat(G_CATS).map(c => p[c.k]), NEED);
  return {z, p, pFull: p, expected: exp, p7, used, at, free, fill, gs, roster,
          nSk: mine.length - nG, nG};
}

// Прирост вероятностей по категориям, если игрок встанет на свой слот вместо
// среднего игрока, который занял бы это место. Защитник сравнивается с
// защитником: слот D форвардом не закрыть, его всё равно кто-то займёт.
// Что даёт игрок: ставлю его на место того, кем этот слот закрылся бы без
// него, и пересчитываю состав целиком. Веса при этом меняются у всех, кого
// он теснит — иначе четвёртый центр выглядел бы бесплатным.
// Куда ставить игрока с двумя-тремя позициями. Раньше брался первый слот из
// p.pos, а там первым идёт C — самая забитая группа: добор и так закроет её
// кем-то сильным, поэтому C/LW/RW выглядел пустышкой. Гаутье на C давал −7.5,
// он же на LW даёт +20.3. Считаю по тому слоту, где выгода больше: в Yahoo
// состав выставляю я, и поставлю туда же.
function bestSlot(p, pr){
  if (p.isG) return slotFor(p, pr.used);
  let free = p.pos.filter(sl => (pr.used[sl] || 0) < (SLOT_COUNT[sl] || 0));
  // Прямо свободного слота нет — но сосед с двумя позициями может подвинуться.
  // Кросби (чистый C) при занятых центрах садился на скамейку, хотя Зибанейд
  // уходит на RW и освобождает ему место.
  if (!free.length){
    const mine = [...pr.at.keys()];
    const now = pr.roster.filter(q => mine.includes(q.name));
    const s2 = seatAll(now.concat(p));
    const got = [...s2.at].find(([q]) => q === p);
    if (!got) return slotFor(p, pr.used);
    free = [got[1]];
  }
  if (free.length === 1) return free[0];
  let best = free[0], bv = -Infinity;
  for (const sl of free){
    const alt  = pr.fill.byPos[sl] || null;
    const next = pr.roster.filter(q => q !== alt && q !== p).concat(p);
    let v = 0;
    for (const c of SK_CATS) v += c.rel * pWin(c, catSum(next, c, false), false);
    if (v > bv){ bv = v; best = sl; }
  }
  return best;
}

function catDelta(p, pr){
  const slot = bestSlot(p, pr);
  // Кого он собой заменяет. Если слот уже полон своими, добор туда никого не
  // ставит — и раньше игрок вписывался СВЕРХ состава, семнадцатым. Центры от
  // этого раздувались: место занято, а цена считалась так, будто он пришёл
  // бесплатно. Состав всегда 16, поэтому кто-то обязан уйти: слабейший из
  // тех, кем я собирался добить остаток.
  let alt = pr.fill.byPos[slot] || null;
  if (!alt){
    // Вытесняю со СКАМЕЙКИ, а не с чужого слота: если убрать запланированного
    // защитника, слот D останется пустым и старт развалится. Новичок входит в
    // старт, кто-то сдвигается, и по цепочке с лавки выпадает слабейший.
    let worst = null;
    for (const f of pr.fill.list){
      if (f.pos !== 'BN' || f.p === p) continue;
      if (!worst || (f.p.rank_pre ?? 9999) > (worst.rank_pre ?? 9999)) worst = f.p;
    }
    alt = worst;
  }
  // Убираю и того, кем слот закрылся бы, и самого p: он может уже стоять в
  // прогнозе добора, и тогда concat вписывал его в состав ВТОРЫМ экземпляром —
  // одним объектом, который в weightOf считался за двух конкурентов и душил
  // веса остальных.
  const next = pr.roster.filter(q => q !== alt && q !== p).concat(p);
  const out = [];
  for (const c of SK_CATS)
    out.push({n:c.n, k:c.k, rel:c.rel, d: pWin(c, catSum(next,c,false), false) - pr.p[c.k]});
  const a = gMinOK(next), b = LG.gk && LG.gk.minOK != null ? LG.gk.minOK : 1;
  for (const c of G_CATS)
    out.push({n:c.n, k:c.k, rel:c.rel,
              d: a * (1 - b) + a * b * pWin(c, catSum(next,c,true), true) - pr.p[c.k]});
  return out;
}

// Неделя выигрывается по большинству: нужно взять 7 категорий из 12, а не
// набрать побольше в сумме. Разница не теоретическая: категория на 68% уже
// почти моя, и лить в неё ещё — трата пика, тогда как четыре вратарские
// висят на 46-48% и берутся все разом. Сумма этого не видит, а свёртка видит.
const NEED = 7;
function pAtLeast(ps, need){
  let v = [1];
  for (const q of ps){
    const n = new Array(v.length + 1).fill(0);
    for (let i = 0; i < v.length; i++){ n[i] += v[i] * (1 - q); n[i+1] += v[i] * q; }
    v = n;
  }
  let s = 0;
  for (let k = need; k < v.length; k++) s += v[k];
  return s;
}
const ALL_CATS = () => SK_CATS.concat(G_CATS);

function scoreAll(pool, taken){
  const pr = profile(pool, taken);
  const cats = ALL_CATS();
  const base = pAtLeast(cats.map(c => pr.p[c.k]), NEED);
  for (const p of pool){
    p.slot = bestSlot(p, pr);
    const d = catDelta(p, pr);
    const ps = cats.map(c => {
      const x = d.find(y => y.k === c.k);
      return Math.max(0, Math.min(1, pr.p[c.k] + (x ? x.d : 0)));
    });
    const s = pAtLeast(ps, NEED) - base;
    // ×100 — чтобы читалось как «сотые доли категории»
    // бонус за гибкость всегда в плюс: умножение делало слабого игрока с двумя
    // позициями ещё хуже слабого с одной, а нужно ровно наоборот
    p.score = 100 * s;
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
  // Считаю ВСЕ чужие пики до моего следующего хода, а не только те, что между
  // моими двумя. Раньше пики от текущего момента до моего хода выпадали, и
  // сразу после своего пика доска обещала, что до меня доживёт игрок, которого
  // разберут за двадцать ходов до того.
  const gap  = (cur && next) ? (next - done - 1) - 1 : 0;

  // кого соперники, вероятно, заберут за это время (берут по рангу Yahoo)
  const byRank = [...free].sort((a,b)=>(a.rank_pre??9999)-(b.rank_pre??9999));
  const gone = new Set(byRank.slice(0, Math.max(0, gap)).map(p=>p.name));

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
  const r = Math.floor((n - 1) / TEAMS) + 1, s = (n - 1) % TEAMS;
  return reversed(r) ? TEAMS - s : s + 1;
}

// Что у команд НАБРАНО НА ДАННЫЙ МОМЕНТ: сумма сезонных проекций Yahoo по
// реально взятым игрокам. Без добора и без весов состава — эти числа можно
// пересчитать руками по карточкам игроков, и они обязаны сойтись.
//
// Здесь был прогноз на конец драфта: каждая команда достраивалась планом по
// рангу Yahoo. Он выдавал Tomashek 2545 вбрасываний при одном центре в
// составе. Команды пикают не по списку, и такая достройка в таблице
// статистики читается как факт, не будучи им. Прогноз убран.
function standings(pool, taken){
  const by = new Map(pool.map(q => [q.name, q]));
  const done = Object.keys(taken).length;
  const teams = Array.from({length: TEAMS}, (_, i) => ({
    slot: i+1, mine: i+1 === MY_SLOT, name: TEAM_NAMES[i] || ('K'+(i+1)),
    have: [], picks: 0, used: {C:0,LW:0,RW:0,D:0,G:0,BN:0}
  }));
  ORDER.slice(0, done).forEach((nm, i) => {
    const t = teams[teamOf(i+1) - 1];
    t.picks++;
    const q = by.get(nm); if (!q) return;
    const sl = slotFor(q, t.used); if (sl) t.used[sl]++;
    t.have.push(q);
  });
  const cats = [...SK_CATS, ...G_CATS];
  for (const t of teams){
    t.need = {};
    for (const [pos, n] of Object.entries(SLOT_COUNT)) t.need[pos] = Math.max(0, n - t.used[pos]);
    const gs = t.have.filter(q => q.isG), sk = t.have.filter(q => !q.isG);
    t.nG = gs.length; t.nSk = sk.length;
    t.sum = {}; t.rank = {};
    for (const c of SK_CATS) t.sum[c.k] = sk.length ? sk.reduce((v,q) => v + (q[c.k]||0), 0) : null;
    const sv = gs.reduce((v,q)=>v+(q.sv||0),0), sa = gs.reduce((v,q)=>v+(q.sa||0),0);
    for (const c of G_CATS) t.sum[c.k] = !gs.length ? null
      : c.k === RATIO ? (sa ? sv/sa : null) : gs.reduce((v,q) => v + (q[c.k]||0), 0);
    t.multi = t.have.filter(q => !q.isG && q.pos.length > 1).length;
  }
  // Место — только среди тех, у кого игроки этого типа вообще есть: иначе
  // двенадцать нулей выстраиваются в фальшивый рейтинг 1…12.
  for (const t of teams) t.inHalf = {};
  for (const c of cats){
    const live = teams.filter(t => t.sum[c.k] != null).sort((a,b) => b.sum[c.k] - a.sum[c.k]);
    live.forEach((t,i) => { t.rank[c.k] = i+1; });
    for (const t of teams) if (t.sum[c.k] == null) t.rank[c.k] = null;
    // Верхняя половина считается от числа команд, у которых категория вообще
    // есть: вратарей взяли не все, и «топ-6 из 12» там было бы неправдой.
    const half = Math.ceil(live.length / 2);
    for (const t of teams) t.inHalf[c.k] = t.rank[c.k] != null && t.rank[c.k] <= half;
  }
  for (const t of teams) t.takes = cats.filter(c => t.inHalf[c.k]).length;
  return teams;
}

// Кого возьмут ближайшие k пиков, если лига пойдёт по рангу Yahoo и будет
// закрывать пустые слоты. Модель грубая — средняя ошибка 8.8 пика, — но она
// отвечает на единственный нужный вопрос: доживёт ли игрок до моего хода.
function nextPicks(pool, taken, k){
  const by = new Map(pool.map(q => [q.name, q]));
  const done = Object.keys(taken).length;
  const byRank = pool.filter(q => !taken[q.name])
                     .sort((a,b)=>(a.rank_pre??9999)-(b.rank_pre??9999));
  const st = Array.from({length: TEAMS}, () => ({C:0,LW:0,RW:0,D:0,G:0,BN:0}));
  ORDER.slice(0, done).forEach((nm, i) => {
    const q = by.get(nm); if (!q) return;
    const u = st[teamOf(i+1) - 1];
    const sl = slotFor(q, u); if (sl) u[sl]++;
  });
  const gone = new Set(), out = [];
  const last = Math.min(TEAMS * ROUNDS, done + (k || 12));
  for (let n = done + 1; n <= last; n++){
    const u = st[teamOf(n) - 1];
    const bench = (u.C+u.LW+u.RW+u.D+u.G) >= STARTERS;
    let pick = null, slot = 'BN';
    for (const q of byRank){
      if (gone.has(q.name)) continue;
      if (bench){ if (q.isG) continue; pick = q; break; }
      const sl = slotFor(q, u);
      if (sl === 'BN' || !sl) continue;
      pick = q; slot = sl; break;
    }
    if (!pick) continue;
    gone.add(pick.name); u[slot]++;
    out.push({n, team: teamOf(n), name: TEAM_NAMES[teamOf(n)-1], mine: teamOf(n) === MY_SLOT,
              p: pick, slot,
              need: Object.fromEntries(Object.entries(SLOT_COUNT)
                      .map(([pos,c]) => [pos, Math.max(0, c - u[pos])]))});
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

const API = {pAtLeast, NEED,TEAMS, MY_SLOT, ROUNDS, MY_PICKS, TEAM_NAMES, SLOTS, SK_CATS, G_CATS, weightOf, catSum, playShare, pDay, gMinOK,
             prepare, setOrder, scoreAll, profile, standings, nextPicks, pWin, catDelta, simulate, assign, teamOf, runs, SLOT_COUNT, fillRoster, withScarcity, groupOf,
             get LG(){return LG;}};
if (typeof module !== 'undefined' && module.exports) module.exports = API;
root.NHL = API;
})(typeof globalThis !== 'undefined' ? globalThis : this);
