// Инструмент решения «кого на этот пик»: три замера, которые доска не даёт.
//
//   node tools/pick.js               — всё сразу
//   node tools/pick.js live          — только дожитие кандидатов
//   node tools/pick.js solo Имя ...  — только чистый вклад игроков
//   node tools/pick.js pair 'А+Б' ... — пара на два ближайших пика
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
const POOL = C.prepare(JSON.parse(fs.readFileSync(H+'/data/yahoo_proj.json','utf8')));
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
// Шум σ=9 — измеренная ошибка ранга Yahoo против реальных пиков этой лиги.
function live(watch, N = 400, SD = 9){
  const mine = C.MY_PICKS.filter(n => n > SEED.length);
  const marks = mine.slice(0, 3);
  const alive = {}; watch.forEach(w => alive[w] = marks.map(() => 0));
  const last = marks[marks.length-1];
  for (let it = 0; it < N; it++){
    const noise = {}; POOL.forEach(p => noise[p.name] = SD*gauss());
    const t = {...TAKEN}, o = [...SEED];
    for (let n = SEED.length+1; n <= last; n++){
      const own = o.filter((nm,i) => C.teamOf(i+1) === C.teamOf(n)).map(nm => by.get(nm)).filter(Boolean);
      const { used } = C.assign(own);
      const cand = POOL.filter(p => !t[p.name])
        .sort((a,b) => ((a.rank_pre??9e9)+noise[a.name]) - ((b.rank_pre??9e9)+noise[b.name]));
      let pick = cand[0];
      for (const p of cand){
        if (p.isG){ if (used.G < C.SLOT_COUNT.G){ pick = p; break; } continue; }
        if (p.pos.some(x => (used[x]||0) < (C.SLOT_COUNT[x]||0))){ pick = p; break; }
      }
      const k = marks.indexOf(n);
      if (k >= 0) watch.forEach(w => { if (!t[w]) alive[w][k]++; });
      t[pick.name] = C.teamOf(n) === C.MY_SLOT ? 'ME' : 'X'; o.push(pick.name);
    }
  }
  console.log('\nДОЖИТИЕ (' + N + ' прогонов, шум ранга σ=' + SD + ')\n');
  console.log('игрок                 ранг' + marks.map(m => ('до #'+m).padStart(8)).join(''));
  watch.map(w => ({ w, a: alive[w] })).sort((x,y) => y.a[y.a.length-1] - x.a[x.a.length-1])
    .forEach(r => console.log(r.w.padEnd(22) + String(by.get(r.w) ? by.get(r.w).rank_pre : '—').padStart(4) +
      r.a.map(c => ((100*c/N).toFixed(0)+'%').padStart(8)).join('')));
  console.log('\nПравило: среди кандидатов с близким вкладом бери того, кто до следующего пика не доживёт.');
}

// --- 3. пара: два ближайших пика вместе ------------------------------------
// «Возьму крайнего сейчас, центра с фейсоффами доберу потом» — довод про ДВА
// пика, и проверять его надо парой. Состав держится на 16: под каждого
// кандидата вырезается филлер своего типа.
function pair(specs){
  const pr = C.profile(POOL, TAKEN);
  const mine = pr.roster.filter(q => TAKEN[q.name] === 'ME');
  const fill = pr.roster.filter(q => TAKEN[q.name] !== 'ME');
  const cut = isGs => { let f = [...fill];
    for (const isG of isGs){ const i = [...f].reverse().findIndex(q => !!q.isG === isG);
      if (i >= 0) f = f.filter((_,j) => j !== f.length-1-i); }
    return f; };
  const p7of = r => { const p = {};
    for (const c of C.SK_CATS) p[c.k] = C.pWin(c, C.catSum(r,c,false), false);
    const ok = C.gMinOK(r), b = C.LG.gk && C.LG.gk.minOK != null ? C.LG.gk.minOK : 1;
    for (const c of C.G_CATS) p[c.k] = ok*(1-b) + ok*b*C.pWin(c, C.catSum(r,c,true), true);
    return C.pAtLeast(C.SK_CATS.concat(C.G_CATS).map(c => p[c.k]), C.NEED); };
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

const args = process.argv.slice(2);
const free = POOL.filter(p => !TAKEN[p.name]).sort((a,b) => (a.rank_pre??9e9) - (b.rank_pre??9e9));
if (args[0] === 'pair') pair(args.slice(1));
else if (args[0] === 'solo') solo(args.slice(1));
else if (args[0] === 'live') live(args.length > 1 ? args.slice(1) : free.slice(0,14).map(p => p.name));
else { solo(free.slice(0,6).map(p => p.name).concat(free.filter(p=>p.isG).slice(0,3).map(p=>p.name)));
       live(free.slice(0,14).map(p => p.name)); }
