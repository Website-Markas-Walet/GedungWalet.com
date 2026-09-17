// Kenyamanan ruang bagi walet — dipakai simulasi burung 3D dan panel "Simulasi burung". Tiap ruang (dari sekat) dinilai:
// cahaya (ruang inap harus gelap < 1 lux), akses dari LMB (jumlah pintu/lubang yang dilewati), suara (tweeter tarik /
// inap di ruang itu — walet mengejar suara tarik lebih dulu), jalan keluar anakan ke arah terang, dan pertukaran udara.
// Hasil per ruang: skor 0–100, tingkat nyaman / kurang / tidak nyaman, dan alasannya.
import { RULES } from './planner-data.js';
import { levels, center } from './planner-geom.js';
import { simulate } from './planner-light.js';
import { simulateAir } from './planner-air.js';

export const TINGKAT = { nyaman: '#2E7D32', kurang: '#F9A825', tidak: '#C62828', jalan: '#78909C' };

export function comfort(m) {
  const L = simulate(m), A = simulateAir(m), LV = levels(m), R = L.regions, HP = L.hp;
  // graf ruang: jumlah pintu (LAR / celah sekat gantung) dari ruang ber-LMB tempat walet masuk; terjun / naik lewat
  // lubang void tidak dihitung (void = "lift" walet)
  const adj = R.map(() => []);
  HP.forEach((h, k) => adj[h.from].push({ to: h.to, k }));
  const hop = R.map(() => Infinity), dq = [];
  R.forEach((r, i) => { if (r.fixed.length) { hop[i] = 0; dq.push(i); } });
  while (dq.length) {
    const i = dq.shift();
    adj[i].forEach(e => { const w = HP[e.k].rect ? 0 : 1; if (hop[i] + w < hop[e.to]) { hop[e.to] = hop[i] + w; if (w) dq.push(e.to); else dq.unshift(e.to); } });
  }
  // suara di tiap ruang: tweeter tarik (dikejar lebih dulu), tweeter inap, hexagonal
  const snd = R.map(() => ({ tarik: [], inap: 0 }));
  LV.forEach((fl, fi) => fl.items.forEach(it => {
    if (it.t !== 'twtarik' && it.t !== 'twinap') return;
    const c = center(it), a = L.at(fi, c.x, c.y); if (!a) return;
    const g = a.region.gid; if (it.t === 'twtarik') snd[g].tarik.push({ x: c.x, y: c.y, id: it.id }); else snd[g].inap++;
  }));
  const ach = new Map(A.zones.map(z => [`${z.li}:${z.rid}`, z.ach]));
  const rooms = R.map((r, i) => {
    const out = { gid: i, fi: r.fi, id: r.id, name: r.name, type: r.type, lux: r.lux, hop: hop[i], tarik: snd[i].tarik, inap: snd[i].inap, ach: ach.get(`${r.fi}:${r.id}`) ?? 0, alasan: [] };
    if (r.type === 'void' || r.type === 'audio' || r.fixed.length) return { ...out, score: 100, level: 'jalan' };   // jalan terbang / ruang alat
    let s = 100; const why = t => out.alasan.push(t), inap = r.type === 'inap';
    if (!Number.isFinite(hop[i])) { s -= 100; why('tidak bisa dijangkau dari LMB'); }
    else if (hop[i] > 3) { s -= Math.min(45, (hop[i] - 3) * 12); why(`sulit dijangkau (${hop[i]} pintu dari LMB)`); }
    if (inap && r.lux > RULES.luxInap) { s -= r.lux > 5 ? 75 : 55; why(`terlalu terang (±${r.lux < 10 ? r.lux.toFixed(1).replace('.', ',') : Math.round(r.lux)} lux)`); }
    if (!inap && r.lux > 50) { s -= 25; why('silau untuk ruang transit'); }
    if (inap && !snd[i].tarik.length && !snd[i].inap) { s -= 30; why('sepi — tanpa suara tarik/inap'); }
    else if (inap && !snd[i].tarik.length) { s -= 10; why('tanpa tweeter tarik'); }
    if (inap && !r.reach) { s -= 15; why('anakan sulit menemukan jalan keluar'); }
    if (out.ach < 0.3 && r.area >= 1) { s -= 15; why('udara pengap'); }
    s = Math.max(0, Math.min(100, s));
    return { ...out, score: s, level: s >= 70 ? 'nyaman' : s >= 40 ? 'kurang' : 'tidak' };
  });
  return { rooms, adj, hop, L, A };
}
