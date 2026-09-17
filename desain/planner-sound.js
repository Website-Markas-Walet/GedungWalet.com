// Simulasi dB suara ("Cek dB") — target per lingkungan dari buku hal. 421-425 (SUARA): panggil / tarik / inap.
// Tiap tweeter = sumber dengan tingkat dB pada 1 m dari volume channel-nya (tab "Ruang audio"); merambat dengan
// pelemahan jarak 20·log10(d) dan pelemahan penghalang di garis pandang: sekat bata ±22 dB, terpal penuh ±10 dB,
// sekat gantung ±4 dB (bukaan LAR tidak menghalangi). dB dijumlah secara energi per kategori untuk tiap ruang.
// Jadwal timer AC ikut dihitung: kategori yang sedang mati pada jam simulasi tidak bersuara. Perkiraan kasar.
import { SIM_DEFAULT, AUDIO_DEFAULT, dbTarget } from './planner-data.js';
import { levels, floorRect, spaces, wallSegs, openingsOn, solidPieces, center } from './planner-geom.js';
import { channels, chCover } from './planner-cable.js';

const CAT = { twinap: 'inap', twtarik: 'tarik', hexa: 'panggil' };
const ATT = s => (s.bahan === 'bata' || s.ext ? 22 : s.jenis === 'gantung' ? 4 : 10);
function segCross(a, b, c, d) {
  const o = (p, q, r) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x), e = 1e-9;
  const d1 = o(c, d, a), d2 = o(c, d, b), d3 = o(a, b, c), d4 = o(a, b, d);
  return ((d1 > e && d2 < -e) || (d1 < -e && d2 > e)) && ((d3 > e && d4 < -e) || (d3 < -e && d4 > e));
}
export const jadwalOf = m => ({ ...AUDIO_DEFAULT.jadwal, ...(m.audio?.jadwal || {}) });
export const jamAktif = (j, jam) => (j[1] <= j[0] ? true : jam >= j[0] && jam < j[1]);

let cache = { sig: '', res: null };
export function simulateSound(m) {
  const sim = { ...SIM_DEFAULT, ...(m.sim || {}) }, LV = levels(m), jadwal = jadwalOf(m);
  const sig = JSON.stringify([m.w, m.h, m.floors, m.menara || null, m.kabel || null, m.audio || null, m.survey?.env, sim.jam]);
  if (cache.sig === sig) return cache.res;
  const chs = channels(m), target = dbTarget(m.survey?.env || 'sawah');
  const mati = ['panggil', 'tarik', 'inap'].filter(c => !jamAktif(jadwal[c], +sim.jam));
  const volOf = (t, li) => {
    const ch = chs.find(c => c.t === t && chCover(c, li));
    return ch && ch.on !== false ? ch.vol : null;
  };
  const floors = LV.map((fl, li) => {
    const sp = spaces(m, fl), F = floorRect(m, fl);
    // penghalang: potongan pejal dinding & sekat (bukaan sudah terpotong dari pieces)
    const walls = wallSegs(m, fl).map(s => {
      const len = Math.hypot(s.x2 - s.x1, s.y2 - s.y1); if (len < 0.05) return null;
      const ux = (s.x2 - s.x1) / len, uy = (s.y2 - s.y1) / len, ops = openingsOn(s, fl);
      return { att: ATT(s), parts: solidPieces(len, ops).map(([a, b]) => [{ x: s.x1 + ux * a, y: s.y1 + uy * a }, { x: s.x1 + ux * b, y: s.y1 + uy * b }]) };
    }).filter(Boolean);
    const attLine = (a, b) => walls.reduce((s, w) => s + (w.parts.some(([p, q]) => segCross(a, b, p, q)) ? w.att : 0), 0);
    const src = fl.items.filter(it => CAT[it.t]).map(it => {
      const cat = CAT[it.t], L1 = volOf(it.t, li);
      return { c: center(it), cat, L1: L1 == null ? null : L1, off: mati.includes(cat) || L1 == null && !chs.some(c => c.t === it.t) };
    });
    const regions = sp.regions.map(r => {
      const p = { x: r.cx, y: r.cy }, E = { panggil: 0, tarik: 0, inap: 0 };
      src.forEach(s => {
        if (mati.includes(s.cat)) return;
        const L1 = s.L1 ?? 65, d = Math.max(0.6, Math.hypot(p.x - s.c.x, p.y - s.c.y));
        const L = L1 - 20 * Math.log10(d) - attLine(p, s.c);
        if (L > 0) E[s.cat] += 10 ** (L / 10);
      });
      const dB = k => (E[k] > 0 ? Math.round(10 * Math.log10(E[k])) : 0);
      return { id: r.id, name: fl.menara ? 'Menara' : sp.name[r.id], type: fl.menara || sp.isVoid[r.id] ? 'void' : sp.type[r.id], cx: r.cx, cy: r.cy, area: r.area, box: r.box, tarik: dB('tarik'), inap: dB('inap'), panggil: dB('panggil') };
    });
    return { li, name: fl.name, regions };
  });
  const res = { jam: +sim.jam, target, mati, jadwal, floors };
  cache = { sig, res };
  return res;
}
// Penilaian ruang inap/jalur: suara tarik & inap sebaiknya di sekitar target buku (terlalu lemah tidak menarik,
// terlalu keras membuat walet tidak nyaman).
export function nilaiDb(r, target) {
  const out = [];
  if (r.type !== 'inap' && r.type !== 'jalur') return out;
  if (r.tarik <= 0) out.push({ k: 'tarik0', txt: 'tanpa suara tarik' });
  else if (r.tarik < target.tarik[0] - 8) out.push({ k: 'tarikLemah', txt: `suara tarik lemah (${r.tarik} dB)` });
  else if (r.tarik > target.tarik[1] + 8) out.push({ k: 'tarikKeras', txt: `suara tarik terlalu keras (${r.tarik} dB)` });
  if (r.type === 'inap' && r.inap > 0 && r.inap > target.inap[1] + 8) out.push({ k: 'inapKeras', txt: `suara inap terlalu keras (${r.inap} dB)` });
  return out;
}
