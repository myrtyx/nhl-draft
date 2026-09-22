// Инструмент решения «кого на этот пик»: три замера, которые доска не даёт.
//
//   node tools/pick.js               — всё сразу
//   node tools/pick.js live          — только дожитие кандидатов
//   node tools/pick.js solo Имя ...  — только чистый вклад игроков
//   node tools/pick.js pair 'А+Б' ... — пара на два ближайших пика
//   node tools/pick.js order G C [W] — в каком порядке закрывать 2-3 позиции
//   node tools/pick.js depth     — как пустеет рынок по позициям к моим ходам
//   node tools/pick.js queue 'А;Б;В' 'Б;А;В' — сравнить очереди из Fantrax
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
const SEED = (() => { const m = fs.readFileSync(H+'/index.html','utf8').match(/const SEED\s*=\s*(\[[\s\S]*?\n\];)/);
  return eval(m[1].replace(/;$/,'')).map(x => Array.isArray(x) ? x[0] : x); })();
const SKIP = (process.env.SKIP || '').split(';').map(x => x.trim()).filter(Boolean);
const POOL0 = C.prepare(JSON.parse(fs.readFileSync(H+'/data/yahoo_proj.json','utf8')));
const POOL = POOL0.filter(p => !SKIP.includes(p.name));
if (SKIP.length){
  const miss = SKIP.filter(n => !POOL0.some(p => p.name === n));
  if (miss.length) console.log('ВЫЧЕРКНУТЬ НЕ УДАЛОСЬ (нет в данных): ' + miss.join(', '));
  console.log('вычеркнуты: ' + SKIP.filter(n => !miss.includes(n)).join(', '));
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
  const pr = C.profile(POOL, TAKEN);
  const mine = pr.roster.filter(q => TAKEN[q.name] === 'ME');
  const fill = pr.roster.filter(q => TAKEN[q.name] !== 'ME');
  // Вырезаю филлера того же типа, что кандидат: иначе вратарь встаёт третьим
  // сверх слотов G:2 и минимум выходов улетает вверх на пустом месте.
  const cut = isG => { const i = [...fill].reverse().findIndex(q => !!q.isG === isG);
    return i < 0 ? fill : fill.filter((_,j) => j !== fill.length-1-i); };
  const p7of = r => {
    const p = {};
    for (const c of C.SK_CATS) p[c.k] = C.pWin(c, C.catSum(r,c,false), false);
    const ok = C.gMinOK(r), b = C.LG.gk && C.LG.gk.minOK != null ? C.LG.gk.minOK : 1;
    for (const c of C.G_CATS) p[c.k] = ok*(1-b) + ok*b*C.pWin(c, C.catSum(r,c,true), true);
    return { p7: C.pAtLeast(C.SK_CATS.concat(C.G_CATS).map(c => p[c.k]), C.NEED), ok, p };
  };
  console.log('\nЧИСТЫЙ ВКЛАД (15 человек те же, меняется 16-й)\n');
  for (const n of namesToTest){
    const q = by.get(n); if (!q){ console.log(n + ' — нет в данных'); continue; }
    const o = p7of([...mine, ...cut(!!q.isG), q]);
    console.log(n.padEnd(22) + 'p7 ' + (100*o.p7).toFixed(1) + '%   минимум вратарских выходов ' +
      (100*o.ok).toFixed(0) + '%   | W ' + (100*o.p.w).toFixed(0) + ' SV ' + (100*o.p.sv).toFixed(0) +
      ' SV% ' + (100*o.p.svpct).toFixed(0) + ' SHO ' + (100*o.p.sho).toFixed(0));
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

// Состав из 16 под одного-двух кандидатов: под каждого вырезается филлер
// своего типа, иначе сравниваются разные по размеру команды.
const BASE = () => { const pr = C.profile(POOL, TAKEN);
  return { mine: pr.roster.filter(q => TAKEN[q.name] === 'ME'),
           fill: pr.roster.filter(q => TAKEN[q.name] !== 'ME') }; };
const cutFrom = (fill, isGs) => { let f = [...fill];
  for (const isG of isGs){ const i = [...f].reverse().findIndex(q => !!q.isG === isG);
    if (i >= 0) f = f.filter((_,j) => j !== f.length-1-i); }
  return f; };
const P7 = r => { const p = {};
  for (const c of C.SK_CATS) p[c.k] = C.pWin(c, C.catSum(r,c,false), false);
  const ok = C.gMinOK(r), b = C.LG.gk && C.LG.gk.minOK != null ? C.LG.gk.minOK : 1;
  for (const c of C.G_CATS) p[c.k] = ok*(1-b) + ok*b*C.pWin(c, C.catSum(r,c,true), true);
  return C.pAtLeast(C.SK_CATS.concat(C.G_CATS).map(c => p[c.k]), C.NEED); };

// --- 3. пара: два ближайших пика вместе ------------------------------------
// «Возьму крайнего сейчас, центра с фейсоффами доберу потом» — довод про ДВА
// пика, и проверять его надо парой. Состав держится на 16: под каждого
// кандидата вырезается филлер своего типа.
function pair(specs){
  const {mine, fill} = BASE(), cut = isGs => cutFrom(fill, isGs), p7of = P7;
  console.log('\nПАРА НА ДВА БЛИЖАЙШИХ ПИКА (состав 16)\n');
  for (const spec of specs){
    const names = spec.split('+').map(s => s.trim());
    const qs = names.map(n => by.get(n));
    if (qs.some(q => !q)){ console.log(names.join(' + ') + ' — нет в данных'); continue; }
    const r = [...mine, ...cut(qs.map(q => !!q.isG)), ...qs];
    if (r.length !== 16) { console.log(names.join(' + ') + ' — состав ' + r.length + ', не 16'); continue; }
    console.log(names.join(' + ').padEnd(42) + 'p7 ' + (100*p7of(r)).toFixed(1) + '%');
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
    cand[g] = free.filter(filt(g)).sort((a,b) => (a.rank_pre??9e9)-(b.rank_pre??9e9)).slice(0, 14)
      .map(q => ({q, v: P7([...mine, ...cutFrom(fill, [!!q.isG]), q])}))
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
      const r = [...mine, ...cutFrom(fill, got.map(x => !!x.q.isG)), ...got.map(x => x.q)];
      if (r.length !== 16) return;
      const o = acc[i]; o.sum += P7(r); o.n++;
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
    cand[g] = free.filter(GFILT(g)).sort((a,b) => (a.rank_pre??9e9)-(b.rank_pre??9e9)).slice(0, 24)
      .map(q => ({q, v: P7([...mine, ...cutFrom(fill, [!!q.isG]), q])}))
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
      const r = [...mine, ...cutFrom(fill, got.map(x => !!x.isG)), ...got];
      if (r.length !== 16) return;
      const o = acc[i]; o.sum += P7(r); o.n++;
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

const args = process.argv.slice(2);
const free = POOL.filter(p => !TAKEN[p.name]).sort((a,b) => (a.rank_pre??9e9) - (b.rank_pre??9e9));
if (args[0] === 'pair') pair(args.slice(1));
else if (args[0] === 'order'){ const a = args.slice(1);
  const n = a.length && /^\d+$/.test(a[a.length-1]) ? +a.pop() : 0; order(a, n); }
else if (args[0] === 'depth') depth(+args[1] || 0);
else if (args[0] === 'queue'){ const a = args.slice(1);
  const n = a.length && /^\d+$/.test(a[a.length-1]) ? +a.pop() : 0; queue(a, n); }
else if (args[0] === 'solo') solo(args.slice(1));
else if (args[0] === 'live') live(args.length > 1 ? args.slice(1) : free.slice(0,14).map(p => p.name));
else { solo(free.slice(0,6).map(p => p.name).concat(free.filter(p=>p.isG).slice(0,3).map(p=>p.name)));
       live(free.slice(0,14).map(p => p.name)); }
