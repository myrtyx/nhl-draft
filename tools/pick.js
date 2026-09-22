// Инструмент решения «кого на этот пик»: три замера, которые доска не даёт.
//
//   node tools/pick.js               — всё сразу
//   node tools/pick.js live          — только дожитие кандидатов
//   node tools/pick.js solo Имя ...  — только чистый вклад игроков
//   node tools/pick.js pair 'А+Б' ... — пара на два ближайших пика
//   node tools/pick.js order G C [W] — в каком порядке закрывать 2-3 позиции
//   node tools/pick.js depth     — как пустеет рынок по позициям к моим ходам
//   node tools/pick.js queue 'А;Б;В' 'Б;А;В' — сравнить очереди из Fantrax
//   node tools/pick.js cats Имя ... — прибавка по каждой категории
//   node tools/pick.js off pm Имя ... — решает ли эта категория выбор
//   node tools/pick.js g3            — третий вратарь: кого, когда и сколько даёт
//
// SKIP='Имя;Имя' — вычеркнуть игроков, которых проекции Yahoo ещё считают
// живыми: травма, отстранение, холдаут. Движок такого знать не может, а
// чужие команды уже знают — Хеллебак висел свободным 13 пиков сверх ранга.
// Вычеркнутый выпадает и из кандидатов, и из плана добора, но НЕ считается
// пикнутым: номера ходов не сдвигаются.
//
// Зачем. Колонка ЦЕНА считает кандидата против плана добора, а план строится
// по рангу Yahoo. Настоящий крайний вытесняет из плана такого же крайнего и
// получает ноль — Кемпе 273-е место при ранге Yahoo 47. Здесь три замера,
// которые от этого плана не зависят.
const C = require('../core.js');
const fs = require('fs');
const H = __dirname + '/..';
const SEED = require('./order.js').order;   // сайт (hockey.json на lynx), запас — SEED index.html
const SKIP = (process.env.SKIP || '').split(';').map(x => x.trim()).filter(Boolean);
const POOL0 = C.prepare(JSON.parse(fs.readFileSync(H+'/data/yahoo_proj.json','utf8')));
const POOL = C.dropOut(POOL0, SKIP);
{
  const miss = SKIP.filter(n => !POOL0.some(p => p.name === n));
  if (miss.length) console.log('ВЫЧЕРКНУТЬ НЕ УДАЛОСЬ (нет в данных): ' + miss.join(', '));
  const out = [...C.OUT.map(x => x[0] + ' (' + x[1] + ')'),
               ...SKIP.filter(n => !miss.includes(n))];
  if (out.length) console.log('вычеркнуты: ' + out.join(', '));
}
const by = new Map(POOL.map(p => [p.name, p]));
const TAKEN = {}; SEED.forEach((n,i) => { TAKEN[n] = C.teamOf(i+1) === C.MY_SLOT ? 'ME' : 'X'; });
C.setOrder(SEED);
const gauss = () => { let u=0,v=0; while(!u)u=Math.random(); while(!v)v=Math.random();
  return Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*v); };

// --- 1. чистый вклад: состав заморожен, меняется ровно один игрок -----------
// Доска сравнивает кандидата с филлером по рангу; тут сравнение честное —
// та же команда, та же дырка, разные игроки в ней.
function solo(namesToTest){
  const {mine, fill, pr} = BASE();
  console.log('\nЧИСТЫЙ ВКЛАД (15 человек те же, меняется 16-й)   план сейчас: p7 ' +
    (100*pr.p7).toFixed(1) + '%\n');
  for (const n of namesToTest){
    const q = by.get(n); if (!q){ console.log(n + ' — нет в данных'); continue; }
    const o = fit(mine, fill, [q]);
    const ok = C.gMinOK(o.r), p = VEC(o.r);
    const was = o.out[0] === q ? 'уже в плане' : 'вместо ' + o.out[0].name.split(' ').slice(-1)[0];
    console.log(n.padEnd(22) + 'p7 ' + (100*o.v).toFixed(1) + '%   ' + was.padEnd(20) +
      'минимум вратарских выходов ' + (100*ok).toFixed(0) + '%   | W ' + (100*p.w).toFixed(0) +
      ' SV ' + (100*p.sv).toFixed(0) + ' SV% ' + (100*p.svpct).toFixed(0) + ' SHO ' + (100*p.sho).toFixed(0));
  }
}

// --- 2. дожитие: кого разберут раньше, чем дойдёт мой следующий пик ---------
// Считает движок (`C.survive`), а не этот файл: две реализации одного и того
// же шума уже разошлись на 6 п.п. по Кросби. Здесь только печать.
function live(watch, N = 400){
  const marks = C.MY_PICKS.filter(n => n > SEED.length).slice(0, 3);
  const res = C.survive(POOL, TAKEN, marks, N);
  const idx = new Map(res.map(r => [r.p.name, r]));
  console.log('\nДОЖИТИЕ (' + N + ' прогонов, шум ранга σ=' + C.SD_RANK + ')\n');
  console.log('игрок                 ранг' + marks.map(m => ('до #'+m).padStart(8)).join(''));
  watch.map(w => idx.get(w)).filter(Boolean)
    .sort((x,y) => y.s[y.s.length-1] - x.s[x.s.length-1])
    .forEach(r => console.log(r.p.name.padEnd(22) + String(r.p.rank_pre ?? '—').padStart(4) +
      r.s.map(c => ((100*c).toFixed(0)+'%').padStart(8)).join('')));
  console.log('\nПроверено назад по 59 сыгранным пикам: обещано 72% дожития — сбылось 73%,');
  console.log('средняя ошибка обещания 3.7 п.п. Точное имя чужого пика не предсказуемо (17%).');
}

// Состав из 16 под одного-двух кандидатов: под каждого из плана добора уходит
// один филлер. Раньше уходил последний филлер того же типа, и это ломалось
// дважды. Вратарь-кандидат всегда вытеснял запланированного вратаря, так что
// вариант «третий вратарь вместо слабейшего полевого» не считался вовсе, а
// второй вратарь в паре давал состав 17 и выкидывался. А кандидат, который
// уже стоит в плане (Раст, Найт), попадал в состав вторым экземпляром.
// Теперь: кандидат из плана вытесняет сам себя, остальные пробуют каждый
// разумный вариант (последний полевой, любой вратарь плана), и берётся
// лучший по p7 — в Yahoo состав выставляю я, и выставлю лучший.
const BASE = () => { const pr = C.profile(POOL, TAKEN);
  return { mine: pr.roster.filter(q => TAKEN[q.name] === 'ME'),
           fill: pr.roster.filter(q => TAKEN[q.name] !== 'ME'), pr }; };
const P7 = r => C.pAtLeast(C.SK_CATS.concat(C.G_CATS).map(c => VEC(r)[c.k]), C.NEED);
const VEC = (r, okOver) => { const p = {};
  for (const c of C.SK_CATS) p[c.k] = C.pWin(c, C.catSum(r,c,false), false);
  const ok = okOver ?? C.gMinOK(r), b = C.LG.gk && C.LG.gk.minOK != null ? C.LG.gk.minOK : 1;
  for (const c of C.G_CATS) p[c.k] = ok*(1-b) + ok*b*C.pWin(c, C.catSum(r,c,true), true);
  return p; };
const FIT = new Map();
function fit(mine, fill, qs){
  const key = qs.map(q => q.name).join('|');
  if (FIT.has(key)) return FIT.get(key);
  let best = null;
  const rec = (i, f, out) => {
    if (i === qs.length){
      const r = [...mine, ...f, ...qs];
      // четвёртый вратарь — это уже не подстраховка минимума, а ставка на объём
      // W/SV, который соперник закрывает тем же трансфером; не рассматриваем
      if (r.length !== 16 || r.filter(x => x.isG).length > 3) return;
      const v = P7(r);
      if (!best || v > best.v) best = {r, v, out};
      return;
    }
    const q = qs[i];
    if (f.includes(q)) return rec(i + 1, f.filter(x => x !== q), [...out, q]);
    const opts = new Set();
    const lastSk = [...f].reverse().find(x => !x.isG);
    if (lastSk) opts.add(lastSk);
    for (const x of f) if (x.isG) opts.add(x);
    for (const o of opts) rec(i + 1, f.filter(x => x !== o), [...out, o]);
  };
  rec(0, fill, []);
  FIT.set(key, best);
  return best;   // {r: состав 16, v: p7, out: кого вытеснил каждый} или null
}

// --- 3. пара: два ближайших пика вместе ------------------------------------
// «Возьму крайнего сейчас, центра с фейсоффами доберу потом» — довод про ДВА
// пика, и проверять его надо парой. Состав держится на 16: под каждого
// кандидата вырезается филлер своего типа.
function pair(specs){
  const {mine, fill} = BASE();
  console.log('\nПАРА НА ДВА БЛИЖАЙШИХ ПИКА (состав 16)\n');
  for (const spec of specs){
    const names = spec.split('+').map(s => s.trim());
    const qs = names.map(n => by.get(n));
    if (qs.some(q => !q)){ console.log(names.join(' + ') + ' — нет в данных'); continue; }
    const o = fit(mine, fill, qs);
    if (!o) { console.log(names.join(' + ') + ' — состав из 16 не собрать'); continue; }
    console.log(names.join(' + ').padEnd(42) + 'p7 ' + (100*o.v).toFixed(1) + '%   вместо ' +
      o.out.map(x => x.name.split(' ').slice(-1)[0]).join(', '));
  }
  console.log('\nДожитие второго игрока смотри в режиме live — пара без него врёт.');
}

const GFILT = g => g === 'G'  ? (q => !!q.isG)
                : g === 'SK' ? (q => !q.isG)
                : g === 'W'  ? (q => !q.isG && (q.pos.includes('LW') || q.pos.includes('RW')))
                : (q => !q.isG && q.pos.includes(g));

// --- 4. порядок: какую позицию закрывать первой ----------------------------
// «Сейчас центра, потом вратаря» — или наоборот? Ответ зависит не от того, кто
// лучше сегодня, а от того, кто останется к следующему ходу. Каждый прогон
// разыгрывает чужие пики шумом движка, на своём ходу берёт лучшего по чистому
// вкладу из назначенной группы и складывает готовый состав из 16.
function order(groups, RUNS){
  RUNS = RUNS || 400;
  const done = Object.keys(TAKEN).length;
  const marks = C.MY_PICKS.filter(n => n > done).slice(0, groups.length);
  if (marks.length < 2 || groups.length < 2){ console.log('нужны две позиции и два хода'); return; }
  groups = groups.slice(0, marks.length);
  const filt = GFILT;
  const {mine, fill} = BASE();
  const free = POOL.filter(p => !TAKEN[p.name]);
  // кандидаты: 14 лучших по рангу в группе, каждому — чистый вклад (один раз)
  const cand = {};
  for (const g of new Set(groups)){
    // Обрезать кандидатов по предсезонному рангу Yahoo было нельзя: 22.09 Так
    // (ранг 116) оказался лучшим свободным крайним по чистому вкладу — 66.2
    // против 66.1 у Холлоуэя, — но в первые 14 по рангу не входил, и order
    // его не рассматривал вовсе. Ранг решает, КОГДА игрока снимут с доски;
    // кого брать, решает вклад. Считаем вклад всем свободным в группе.
    cand[g] = free.filter(filt(g))
      .map(q => ({q, v: fit(mine, fill, [q]).v}))
      .sort((a,b) => b.v - a.v);
    if (!cand[g].length){ console.log('в группе ' + g + ' никого нет'); return; }
  }
  for (const g of new Set(groups)) console.log('\nчистый вклад, группа ' + g + ':  ' +
    cand[g].slice(0,5).map(x => x.q.name.split(' ').slice(-1)[0] +
      ' ' + (100*x.v).toFixed(1)).join(' · '));
  const perms = a => a.length <= 1 ? [a]
    : a.flatMap((x,i) => perms([...a.slice(0,i), ...a.slice(i+1)]).map(r => [x, ...r]));
  const plans = perms(groups).filter((a, i, all) =>   // W W G D даёт повторы
    all.findIndex(b => b.join('|') === a.join('|')) === i);
  const last = marks.length - 1;
  const acc = plans.map(() => ({sum: 0, n: 0, who: marks.map(() => ({}))}));
  const seen = marks.map(() => null);
  C.survive(POOL, TAKEN, marks, RUNS, (k, gone) => {
    seen[k] = new Set(gone);   // копия: движок мутирует один и тот же набор
    if (k !== last) return;              // считаем, когда известны все отметки
    plans.forEach((pl, i) => {
      const got = [], names = new Set();
      for (let j = 0; j < pl.length; j++){
        const x = cand[pl[j]].find(y => !seen[j].has(y.q.name) && !names.has(y.q.name));
        if (!x) return;
        got.push(x); names.add(x.q.name);
      }
      const f = fit(mine, fill, got.map(x => x.q));
      if (!f) return;
      const o = acc[i]; o.sum += f.v; o.n++;
      got.forEach((x, j) => { o.who[j][x.q.name] = (o.who[j][x.q.name] || 0) + 1; });
    });
  });
  console.log('\nПОРЯДОК БЛИЖАЙШИХ ХОДОВ · ' + marks.map(m => '#'+m).join(', ') +
              ' · ' + RUNS + ' прогонов, σ=' + C.SD_RANK + '\n');
  const top = (o, n) => Object.entries(o).sort((x,y)=>y[1]-x[1]).slice(0,2)
    .map(([nm,c]) => nm.split(' ').slice(-1)[0] + ' ' + Math.round(100*c/n) + '%').join(', ');
  const rows = plans.map((pl, i) => ({pl, o: acc[i], v: 100*acc[i].sum/acc[i].n}))
    .sort((a,b) => b.v - a.v);
  rows.forEach(({pl, o, v}) => {
    console.log(pl.join(' → ').padEnd(16) + 'p7 ' + v.toFixed(1) + '%   ' +
      marks.map((m, j) => '#' + m + ': ' + top(o.who[j], o.n)).join('   '));
  });
  const d = rows[0].v - rows[rows.length-1].v;
  console.log('\nразмах ' + d.toFixed(1) + ' п.п.' +
    (d < 1 ? ' — это шум, порядок не решает; бери лучшего по чистому вкладу' : ''));
}

// --- 5. глубина: что рынок предложит на каждом моём ходу -------------------
// Довод «возьму центра — потом хороших крайних не останется» проверяется не
// списком имён, а кривой: сколько стоит ЛУЧШИЙ СВОБОДНЫЙ в каждой группе на
// каждом моём ходу. Позиция дефицитна, если кривая обрывается; если она
// пологая — ждать не страшно, кто-то того же уровня будет.
function depth(RUNS){
  RUNS = RUNS || 400;
  const done = Object.keys(TAKEN).length;
  const marks = C.MY_PICKS.filter(n => n > done).slice(0, 5);
  const groups = ['C', 'LW', 'RW', 'D', 'G'];
  const {mine, fill} = BASE();
  const free = POOL.filter(p => !TAKEN[p.name]);
  const cand = {}, acc = {};
  for (const g of groups){
    cand[g] = free.filter(GFILT(g))   // без обрезки по рангу — см. order()
      .map(q => ({q, v: fit(mine, fill, [q]).v}))
      .sort((a,b) => b.v - a.v);
    acc[g] = marks.map(() => ({sum: 0, n: 0, who: {}}));
  }
  C.survive(POOL, TAKEN, marks, RUNS, (k, gone) => {
    for (const g of groups){
      const b = cand[g].find(x => !gone.has(x.q.name));
      if (!b) continue;
      const o = acc[g][k]; o.sum += b.v; o.n++;
      o.who[b.q.name] = (o.who[b.q.name] || 0) + 1;
    }
  });
  console.log('\nЛУЧШИЙ СВОБОДНЫЙ НА МОЁМ ХОДУ · ' + RUNS + ' прогонов, σ=' + C.SD_RANK);
  console.log('(чистый вклад в p7; чужие пики разыграны шумом, свои не вычтены)\n');
  console.log('поз ' + marks.map(m => ('#'+m).padStart(8)).join('') + '   обрыв');
  for (const g of groups){
    const v = acc[g].map(o => o.n ? 100*o.sum/o.n : null);
    console.log(g.padEnd(4) + v.map(x => (x==null?'—':x.toFixed(1)).padStart(8)).join('') +
      '   ' + (v[0]!=null && v[v.length-1]!=null ? '-'+(v[0]-v[v.length-1]).toFixed(1)+' п.п.' : '—'));
  }
  console.log('');
  for (const g of groups){
    const top = k => Object.entries(acc[g][k].who).sort((a,b)=>b[1]-a[1]).slice(0,2)
      .map(([nm,c]) => nm.split(' ').slice(-1)[0]+' '+Math.round(100*c/acc[g][k].n)+'%').join(', ');
    console.log(g.padEnd(4) + '#' + marks[0] + ': ' + top(0) + '   →   #' +
      marks[marks.length-1] + ': ' + top(marks.length-1));
  }
}

// --- 6. очередь: список имён по приоритету, как в Fantrax -------------------
// `order` сравнивает позиции, а очередь — конкретные имена. Разница важна:
// проигрыш решает не тот, кого берёшь, а тот, кто остаётся запасным вариантом,
// когда первый номер уже разобран.
function queue(specs, RUNS){
  RUNS = RUNS || 1200;
  const done = Object.keys(TAKEN).length;
  const qs = specs.map(t => t.split(';').map(x => x.trim()).filter(Boolean));
  const depthN = Math.max(...qs.map(q => q.length));
  const marks = C.MY_PICKS.filter(n => n > done).slice(0, Math.min(depthN, 3));
  const bad = [...new Set(qs.flat())].filter(n => !by.has(n));
  if (bad.length){ console.log('нет в данных: ' + bad.join(', ')); return; }
  const {mine, fill} = BASE();
  const acc = qs.map(() => ({sum: 0, n: 0, who: marks.map(() => ({})), miss: 0}));
  const last = marks.length - 1, seen = marks.map(() => null);
  C.survive(POOL, TAKEN, marks, RUNS, (k, gone) => {
    seen[k] = new Set(gone);
    if (k !== last) return;
    qs.forEach((q, i) => {
      const got = [], used = new Set();
      for (let j = 0; j < marks.length; j++){
        const nm = q.find(x => !seen[j].has(x) && !used.has(x));
        if (!nm){ acc[i].miss++; return; }
        got.push(by.get(nm)); used.add(nm);
      }
      const f = fit(mine, fill, got);
      if (!f) return;
      const o = acc[i]; o.sum += f.v; o.n++;
      got.forEach((x, j) => { o.who[j][x.name] = (o.who[j][x.name] || 0) + 1; });
    });
  });
  console.log('\nОЧЕРЕДЬ НА ' + marks.map(m => '#'+m).join(', ') +
              ' · ' + RUNS + ' прогонов, σ=' + C.SD_RANK + '\n');
  const top = (o, n) => Object.entries(o).sort((a,b)=>b[1]-a[1]).slice(0,3)
    .map(([nm,c]) => nm.split(' ').slice(-1)[0] + ' ' + Math.round(100*c/n) + '%').join(', ');
  qs.map((q, i) => ({q, o: acc[i], v: acc[i].n ? 100*acc[i].sum/acc[i].n : 0}))
    .sort((a,b) => b.v - a.v)
    .forEach(({q, o, v}) => {
      console.log(q.map(n => n.split(' ').slice(-1)[0]).join(' → ') + '   p7 ' + v.toFixed(1) + '%' +
        (o.miss ? '   очередь кончалась в ' + Math.round(100*o.miss/RUNS) + '% прогонов' : ''));
      marks.forEach((m, j) => console.log('   #' + m + ': ' + top(o.who[j], o.n)));
    });
}

// --- 7. категории: из чего складывается чистый вклад ------------------------
// Показывает, ГДЕ игрок добавляет. Суммы по строке здесь намеренно нет: она
// совпадает с solo p7 по порядку (корреляция 0.9999 на 60 полевых, ни одного
// расхождения больше 0.3 п.п.), то есть не добавляет ничего, а выглядит как
// отдельное доказательство. И она ломается на смеси типов: вратарь двигает
// gMinOK и все четыре вратарские категории разом, поэтому в общем списке с
// полевыми корреляция суммы с p7 уходит в минус (-0.33). Сравнивать вратаря
// с полевым по строкам этой таблицы нельзя — для этого есть solo.
function cats(names){
  const qs = names.map(n => by.get(n)).filter(Boolean);
  const miss = names.filter(n => !by.has(n));
  if (miss.length) console.log('нет в данных: ' + miss.join(', '));
  if (!qs.length) return;
  const mixed = qs.some(q => q.isG) && qs.some(q => !q.isG);
  const {mine, fill} = BASE();
  const ALL = [...C.SK_CATS, ...C.G_CATS];
  const vec = r => VEC(r);
  const anyG = qs.some(q => q.isG);
  const show = anyG ? ALL : C.SK_CATS;
  console.log('\nПРИБАВКА К ВЕРОЯТНОСТИ ВЗЯТЬ КАТЕГОРИЮ, п.п.\n');
  const base0 = vec([...mine, ...fill]);
  console.log('план сейчас       ' + show.map(c =>
    (Math.round(100*base0[c.k])+'%').padStart(7)).join(''));
  for (const q of qs){
    const o = fit(mine, fill, [q]);
    const b = vec(o.r), base = base0;   // против плана как он есть
    console.log(q.name.padEnd(18) + show.map(c =>
      (100*(b[c.k]-base[c.k])).toFixed(1).padStart(7)).join('') +
      '   вместо ' + (o.out[0] === q ? '— (уже в плане)' : o.out[0].name.split(' ').slice(-1)[0]));
  }
  console.log('                  ' + show.map(c => c.k.padStart(7)).join(''));
  if (mixed) console.log('\nВ списке и вратарь, и полевой — строки между ними не сравнимы.');
  console.log('Итог по строке не складывай: для этого есть solo.');
}

// --- 8. решает ли категория? ------------------------------------------------
// «Мне не нравится его -22» — законное возражение, но проекция +/- может быть
// шумом. Обнуляю категорию ВСЕМ: тогда она у всех 50/50 и в выборе не
// участвует. Если порядок кандидатов не изменился — категория спор не решает,
// и обсуждать надо не её. Годится для любой: fw, hit, blk, pm.
function contrib(pool, names){
  const taken = {}; SEED.forEach((n,i) => { taken[n] = C.teamOf(i+1) === C.MY_SLOT ? 'ME' : 'X'; });
  C.setOrder(SEED);
  const pr = C.profile(pool, taken);
  const mine = pr.roster.filter(q => taken[q.name] === 'ME');
  const fill = pr.roster.filter(q => taken[q.name] !== 'ME');
  const by2 = new Map(pool.map(q => [q.name, q]));
  const out = new Map();
  FIT.clear();   // лига другая — кэш составов от прошлого расчёта не годится
  for (const n of names){ const q = by2.get(n); if (!q) continue;
    out.set(n, 100*fit(mine, fill, [q]).v); }
  FIT.clear();
  return out;
}
function off(cat, names){
  const keys = [...C.SK_CATS, ...C.G_CATS].map(c => c.k);
  if (!keys.includes(cat)) return console.log('нет категории «' + cat + '»; есть: ' + keys.join(' '));
  const A = contrib(POOL, names);
  const raw = JSON.parse(fs.readFileSync(H+'/data/yahoo_proj.json','utf8'));
  let n = 0;
  for (const grp of Object.values(raw)) if (Array.isArray(grp))
    for (const q of grp) if (q[cat] != null){ q[cat] = 0; n++; }
  const B = contrib(C.dropOut(C.prepare(raw), SKIP), names);
  C.prepare(JSON.parse(fs.readFileSync(H+'/data/yahoo_proj.json','utf8')));  // вернуть лигу как была
  const rank = m => [...m.entries()].sort((x,y) => y[1]-x[1]).map(x => x[0]);
  const rA = rank(A), rB = rank(B);
  console.log('\nЕСЛИ «' + cat + '» ОБНУЛИТЬ ВСЕМ (затронуто ' + n + ' игроков)\n');
  console.log('кандидат'.padEnd(22) + 'как есть'.padStart(9) + ('без ' + cat).padStart(10) + 'место'.padStart(9));
  for (const name of rA)
    console.log(name.padEnd(22) + A.get(name).toFixed(1).padStart(9) + B.get(name).toFixed(1).padStart(10)
      + (rA.indexOf(name) === rB.indexOf(name) ? '—' : (rA.indexOf(name)+1) + '→' + (rB.indexOf(name)+1)).padStart(9));
  // Перестановка двух кандидатов, стоящих на одной десятой, — это не «категория
  // решает», а округление. Считаю решающей только ту, что переставляет пару с
  // заметным зазором: тот же порог 0.3 п.п., что и в проверке суммы.
  let worst = null;
  for (const x of names) for (const y of names){
    if (x === y || !A.has(x) || !A.has(y)) continue;
    if (A.get(x) > A.get(y) && B.get(x) < B.get(y)){
      const gap = A.get(x) - A.get(y);
      if (!worst || gap > worst.gap) worst = {x, y, gap};
    }
  }
  const lead = rA[0] !== rB[0];
  if (lead) console.log('\nПервый меняется: ' + rA[0] + ' → ' + rB[0] + '. «' + cat + '» решает выбор.');
  else if (worst && worst.gap >= 0.3)
    console.log('\nПервый тот же, но «' + cat + '» переставляет ' + worst.x + ' и ' + worst.y +
                ' (зазор ' + worst.gap.toFixed(1) + ' п.п.).');
  else console.log('\nПервый тот же, заметных перестановок нет: «' + cat + '» этот выбор не решает.');
}


// --- 9. третий вратарь -------------------------------------------------------
// Вратарь на скамейку вместо четвёртого запасного полевого. Движок сам решает,
// класть ли его в план (profile, по p7), здесь — разбор этого решения: сколько
// даёт каждый доступный вратарь, доживёт ли он до моих поздних ходов и сколько
// от прибавки остаётся, если минимум выходов закрывать трансфером.
function g3(RUNS){
  RUNS = RUNS || 400;
  const {mine, fill, pr} = BASE();
  const inPlan = fill.filter(q => q.isG);
  const benchG = pr.g3 && pr.g3.on ? pr.fill.list.find(f => f.pos === 'BN' && f.p.isG) : null;
  // план без третьего: запланированный запасной вратарь уступает место полевому
  const pr2 = pr.g3 ? pr.g3.without : pr.p7;
  const skFill = fill.filter(q => !q.isG);
  console.log('\nТРЕТИЙ ВРАТАРЬ НА СКАМЕЙКУ ВМЕСТО ЧЕТВЁРТОГО ЗАПАСНОГО ПОЛЕВОГО\n');
  console.log('план с двумя вратарями        p7 ' + (100*pr2).toFixed(1) + '%');
  if (benchG) console.log('план с третьим (' + benchG.p.name + ' последним пиком)  p7 ' +
    (100*pr.p7).toFixed(1) + '%   → движок кладёт третьего в план');
  else console.log('движок третьего в план не кладёт' + (pr.g3 ? ' (с ним p7 ' + (100*pr.g3.p7).toFixed(1) + '%)' : ''));
  // два состава на одного кандидата: с ним третьим и без него (полевой на его месте)
  const two = pr.g3 ? pr.g3.two : mine.concat(fill);
  const done = Object.keys(TAKEN).length;
  const marks = C.MY_PICKS.filter(n => n > done).slice(2);   // поздние ходы — туда и ставим
  const res = marks.length ? C.survive(POOL, TAKEN, marks, RUNS) : [];
  const idx = new Map(res.map(r => [r.p.name, r]));
  const free = POOL.filter(p => !TAKEN[p.name] && p.isG);
  const rows = free.map(q => ({q, o: fit(mine, fill, [q])})).filter(x => x.o)
    .sort((a,b) => b.o.v - a.o.v).slice(0, 10);
  console.log('\nвратарь              GP   p7 с ним   минимум   при стриминге' +
    marks.map(m => ('#'+m).padStart(6)).join('') + '   ← доживёт до хода');
  for (const {q, o} of rows){
    // «при стриминге»: минимум выходов считается выполненным всегда и у меня,
    // и в составе без третьего — остаётся только объём W/SV и SV%
    const base = two;
    if (base.length !== 16 || o.r.length !== 16) throw new Error('состав не 16');
    const s1 = C.pAtLeast(Object.values(VEC(o.r, 1)), C.NEED), s0 = C.pAtLeast(Object.values(VEC(base, 1)), C.NEED);
    const sv = idx.get(q.name);
    console.log((q.name + (inPlan.includes(q) ? ' *' : '')).padEnd(20) + String(q.gp).padStart(4) +
      ((100*o.v).toFixed(1) + '%').padStart(11) + ((100*C.gMinOK(o.r)).toFixed(0) + '%').padStart(10) +
      ((s1 - s0 >= 0 ? '+' : '') + (100*(s1 - s0)).toFixed(1) + ' п.п.').padStart(16) +
      (sv ? sv.s.map(c => ((100*c).toFixed(0)+'%').padStart(6)).join('') : ''));
  }
  console.log('\n* уже в плане добора. «при стриминге» — прибавка к p7 против состава с двумя');
  console.log('вратарями, если минимум в 3 выхода закрывать трансфером каждую неделю: это нижняя');
  console.log('граница пользы. Движок без стриминга даёт верхнюю. Правда между ними.');
}

const args = process.argv.slice(2);
const free = POOL.filter(p => !TAKEN[p.name]).sort((a,b) => (a.rank_pre??9e9) - (b.rank_pre??9e9));
if (args[0] === 'pair') pair(args.slice(1));
else if (args[0] === 'order'){ const a = args.slice(1);
  const n = a.length && /^\d+$/.test(a[a.length-1]) ? +a.pop() : 0; order(a, n); }
else if (args[0] === 'depth') depth(+args[1] || 0);
else if (args[0] === 'cats') cats(args.slice(1));
else if (args[0] === 'off') off(args[1], args.slice(2));
else if (args[0] === 'queue'){ const a = args.slice(1);
  const n = a.length && /^\d+$/.test(a[a.length-1]) ? +a.pop() : 0; queue(a, n); }
else if (args[0] === 'solo') solo(args.slice(1));
else if (args[0] === 'g3') g3(+args[1] || 0);
else if (args[0] === 'live') live(args.length > 1 ? args.slice(1) : free.slice(0,14).map(p => p.name));
else { solo(free.slice(0,6).map(p => p.name).concat(free.filter(p=>p.isG).slice(0,3).map(p=>p.name)));
       live(free.slice(0,14).map(p => p.name)); }
