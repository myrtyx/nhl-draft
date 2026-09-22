// Повторяет сайт один в один: SEED читается из index.html, метки ME/X
// ставит teamOf — ровно как derive() в браузере. Любой мой прогон должен
// идти через этот файл, иначе счёт пойдёт от пустого состава.
const C = require('/Users/martins/Desktop/dev/nhl-draft/core.js');
const fs = require('fs');
const html = fs.readFileSync('/Users/martins/Desktop/dev/nhl-draft/index.html','utf8');
const block = html.slice(html.indexOf('const SEED = ['), html.indexOf('];', html.indexOf('const SEED = [')));
const ORDER = [...block.matchAll(/\['([^']+)'/g)].map(m => m[1]);
const P = C.prepare(JSON.parse(fs.readFileSync('/Users/martins/Desktop/dev/nhl-draft/data/yahoo_proj.json','utf8')));
C.setOrder(ORDER);
const taken = {};
ORDER.forEach((n,i) => { taken[n] = C.teamOf(i+1) === 2 ? 'ME' : 'X'; });
const pr = C.scoreAll(P, taken);
C.withScarcity(P, taken);
const why = p => C.catDelta(p, pr).filter(x=>x.rel>=1).sort((a,b)=>b.d-a.d).slice(0,3)
  .filter(x=>x.d>0.01).map(x=>x.k+' +'+(x.d*100).toFixed(0)).join(' ') || 'добор глубины';
const row = p => '   ' + (p.name+'                     ').slice(0,22) + p.pos.join('/').padEnd(10)
  + String(p.slot).padEnd(5) + p.vorp.toFixed(2).padStart(6) + '   '
  + String(p.rank_pre).padStart(4) + '  ' + String(p.gp).padStart(3) + '   ' + why(p);
module.exports = {C, P, ORDER, taken, pr, why, row,
  free: () => P.filter(p => !taken[p.name]).sort((a,b)=>b.vorp-a.vorp),
  HEAD: '   игрок                 поз       слот  ЦЕНА   Yahoo  GP   что даёт'};
