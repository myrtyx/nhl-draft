// Контроли перед выкатом. Гонять всегда: node tools/check.js
const C = require('../core.js');
const fs = require('fs');
const P0 = () => C.prepare(JSON.parse(fs.readFileSync(__dirname + '/../data/yahoo_proj.json','utf8')));
let fail = 0;
const say = (ok, name, got) => { console.log((ok ? '  ок   ' : '  ПЛОХО') + '  ' + name + ': ' + got); if (!ok) fail++; };

let t = Date.now(); const P = P0(); const tp = Date.now() - t;
say(tp < 1500, 'скорость prepare', tp + ' мс (предел 1500)');

const teams = C.simulate(P, 0);
let bad = 0, st = 0, sum = 0;
for (const tm of teams){
  const u = {}; for (const s of ['C','LW','RW','D','G','BN']) u[s] = (tm.at[s]||[]).length;
  if (u.C>2||u.LW>2||u.RW>2||u.D>4||u.G>2||u.BN>4) bad++;
  st += u.C+u.LW+u.RW+u.D+u.G;
  const r = ['C','LW','RW','D','G','BN'].flatMap(s => tm.at[s]||[]);
  for (const c of C.SK_CATS) sum += C.pWin(c, C.catSum(r,c,false), false);
  for (const c of C.G_CATS)  sum += C.pWin(c, C.catSum(r,c,true), true);
}
say(bad === 0, 'составы легальны', bad ? bad + ' незаконных' : 'все 12');
say(st/teams.length === 12, 'стартеров', (st/teams.length).toFixed(1) + '/12');
const cal = sum/teams.length;
say(Math.abs(cal - 6) < 0.25, 'калибровка', cal.toFixed(3) + ' (эталон 6.000)');

const ps = [0.5,0.5,0.5,0.5,0.5,0.5,0.5,0.5,0.5,0.5,0.5,0.5];
say(Math.abs(C.pAtLeast(ps, 7) - 0.3872) < 0.001, 'свёртка P(7 из 12)',
    C.pAtLeast(ps,7).toFixed(4) + ' при всех 50% (эталон 0.3872)');

process.exit(fail ? 1 : 0);
