// Правильная модель «что будет, если возьму X на #59».
// Пики 44..58 — чужие, заполняю их реальными игроками по рангу (как futureFill
// делает для соперников). Фейковые пустышки так нельзя: они не убирают игроков
// из пула, и филлеры выходят завышенными (база 49.9% вместо 41.2%).
const B = require('./board.js');
const fs = require('fs');
const raw = JSON.parse(fs.readFileSync('/Users/martins/Desktop/dev/nhl-draft/data/yahoo_proj.json','utf8'));

const SLOT_COUNT = {C:2, LW:2, RW:2, D:4, G:2}, STARTERS = 12, TEAMS = 12;
function slotFor(p, u){
  if (p.isG) return u.G < SLOT_COUNT.G ? 'G' : 'BN';
  for (const pos of p.pos) if ((u[pos]||0) < (SLOT_COUNT[pos]||0)) return pos;
  return 'BN';
}
// кто уйдёт на пиках done+1..upto, если все берут по рангу Yahoo
function simulate(upto){
  const by = new Map(B.P.map(q => [q.name, q]));
  const gone = new Set(B.ORDER);
  const byRank = B.P.filter(q => !gone.has(q.name))
                    .sort((a,b)=>(a.rank_pre??9999)-(b.rank_pre??9999));
  const st = Array.from({length:TEAMS}, () => ({C:0,LW:0,RW:0,D:0,G:0,BN:0}));
  B.ORDER.forEach((nm,i)=>{ const q=by.get(nm); if(!q) return;
    const u=st[B.C.teamOf(i+1)-1]; const sl=slotFor(q,u); if(sl) u[sl]++; });
  const out = [];
  for (let n = B.ORDER.length+1; n <= upto; n++){
    const u = st[B.C.teamOf(n)-1];
    const bench = (u.C+u.LW+u.RW+u.D+u.G) >= STARTERS;
    let pick = null, slot = 'BN';
    for (const q of byRank){
      if (gone.has(q.name)) continue;
      if (bench){ if (q.isG) continue; pick = q; break; }
      const sl = slotFor(q, u); if (sl === 'BN') continue;
      pick = q; slot = sl; break;
    }
    if (!pick) break;
    gone.add(pick.name); u[slot]++; out.push(pick.name);
  }
  return out;
}
const MID = simulate(58);           // пики 44..58, все чужие

function run(names){                // names[0] → #59, names[1] → #62
  const ord = B.ORDER.concat(MID);
  ord.push(names[0]);
  if (names[1]){ ord.push(...simulate(61).slice(MID.length)); while(ord.length<61) ord.push(MID[0]); ord.length=61; ord.push(names[1]); }
  const P2 = B.C.prepare(JSON.parse(JSON.stringify(raw)));
  B.C.setOrder(ord);
  const t = {}; ord.forEach((n,i)=>{ t[n] = B.C.teamOf(i+1)===2 ? 'ME' : 'X'; });
  const pr = B.C.profile(P2, t);
  return {p7: pr.p7, n: pr.roster.length, used: pr.used};
}
module.exports = {MID, run, simulate};
