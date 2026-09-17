// Simulasi siklus udara — jaringan aliran multizona, metode yang sama dengan perangkat terbuka CONTAM (NIST, domain
// publik) dan EnergyPlus AirflowNetwork: tiap ruang (dari sekat) = satu zona bertekanan, tiap bukaan = elemen orifis
//   ṁ = Cd · A · √(2 ρ |ΔP|)   (arah mengikuti tanda ΔP)
// Penggerak: efek cerobong — beda kerapatan udara dalam (hangat & lembap, lebih ringan) dan luar menurut jam — serta
// tekanan angin Cp·½ρv² di tiap sisi gedung. Tekanan zona dicari dengan Newton-Raphson sampai massa udara tiap zona
// seimbang. Hasil: debit tiap bukaan (masuk / keluar), pertukaran udara (ACH) tiap ruang.
import { SIM_DEFAULT, RULES } from './planner-data.js';
import { levels, spaces, floorHt, floorRect } from './planner-geom.js';
import { sunPos, skyLux, facadeAz, arahNama } from './planner-light.js';

const G = 9.81;
const CP = [[0, 0.6], [45, 0.3], [90, -0.5], [135, -0.4], [180, -0.3]];   // koefisien tekanan angin dinding gedung rendah
const cpAt = th => {
  const a = Math.abs(((((th + 180) % 360) + 360) % 360) - 180);
  for (let i = 1; i < CP.length; i++) if (a <= CP[i][0]) { const [x0, c0] = CP[i - 1], [x1, c1] = CP[i]; return c0 + ((c1 - c0) * (a - x0)) / (x1 - x0); }
  return -0.3;
};
const SIDE_ANG = { depan: 0, kanan: 90, belakang: 180, kiri: 270 };
export const suhuLuar = jam => 29 + 4 * Math.sin((2 * Math.PI * (jam - 9)) / 24);   // perkiraan harian: ±25 °C (03.00) – ±33 °C (15.00)
const esat = T => 610.94 * Math.exp((17.625 * T) / (T + 243.04));                  // tekanan uap jenuh (Pa)
const rhoAir = (T, rh) => (101325 - 0.378 * (rh / 100) * esat(T)) / (287.05 * (T + 273.15));   // udara lembap lebih ringan
const RH_LUAR = 75, CD = 0.6, VENT_A = Math.PI * 0.0508 ** 2, VENT_CD = 0.45, BOCOR = 2e-4;
// Ventilasi: paralon 4" menembus dinding ±82 cm di bawah plafon (60 cm di bawah sirip), elbow, lalu pipa turun 1 m —
// ujung dalamnya 1 m lebih rendah; kolom udara di pipa tegak ikut dihitung dengan memakai ketinggian ujung dalam.
const VENT_Z = 0.82, PIPA_TURUN = 1;

// Gauss dengan pivot (n kecil: jumlah ruang seluruh gedung)
function solve(A, b) {
  const n = b.length;
  for (let c = 0; c < n; c++) {
    let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    if (Math.abs(A[p][c]) < 1e-14) continue;
    [A[c], A[p]] = [A[p], A[c]]; [b[c], b[p]] = [b[p], b[c]];
    for (let r = c + 1; r < n; r++) { const f = A[r][c] / A[c][c]; if (!f) continue; for (let k = c; k < n; k++) A[r][k] -= f * A[c][k]; b[r] -= f * b[c]; }
  }
  const x = new Array(n).fill(0);
  for (let r = n - 1; r >= 0; r--) { let s = b[r]; for (let k = r + 1; k < n; k++) s -= A[r][k] * x[k]; x[r] = Math.abs(A[r][r]) > 1e-14 ? s / A[r][r] : 0; }
  return x;
}

let cache = { sig: '', res: null };
export function simulateAir(m) {
  const sim = { ...SIM_DEFAULT, ...(m.sim || {}) }, LV = levels(m);
  const sig = JSON.stringify([m.w, m.h, m.floorH, sim, m.floors, m.menara || null]);
  if (cache.sig === sig) return cache.res;
  const Tin = +sim.suhu, Tout = suhuLuar(+sim.jam), rhoIn = rhoAir(Tin, +sim.rh), rhoOut = rhoAir(Tout, RH_LUAR);
  const v = Math.max(0, +sim.anginKec || 0), windAng = SIDE_ANG[sim.anginDari] ?? 0, pw = 0.5 * rhoOut * v * v;
  // zona = ruang tiap lantai; ketinggian alas lantai bertumpuk
  const zones = [], y0 = [], sps = [];
  let acc = 0;
  LV.forEach((fl, li) => {
    const H = floorHt(m, fl), sp = spaces(m, fl); y0.push(acc); sps.push({ sp, H });
    sp.regions.forEach(r => zones.push({ li, rid: r.id, name: fl.menara ? 'Menara' : sp.name[r.id], type: fl.menara || sp.isVoid[r.id] ? 'void' : sp.type[r.id], vol: r.area * H, cx: r.cx, cy: r.cy, zc: acc + H / 2 }));
    acc += H;
  });
  const zid = (li, rid) => zones.findIndex(z => z.li === li && z.rid === rid);
  const links = [];   // { a, b (-1 = luar), z, A, cd, cp?, kind, li, x, y, ... }
  const side = (F, x, y) => { const e = [[y - F.y, 'depan', 0, 1], [F.y + F.h - y, 'belakang', 0, -1], [x - F.x, 'kiri', 1, 0], [F.x + F.w - x, 'kanan', -1, 0]].reduce((p, q) => (q[0] < p[0] ? q : p)); return e; };
  LV.forEach((fl, li) => {
    const { sp, H } = sps[li], F = sp.F, base = y0[li];
    sp.ports.forEach(p => {   // LAR / celah sekat gantung antar ruang di lantai yang sama
      const h = p.kind === 'larj' ? Math.min(1, H - 0.2) : p.kind === 'lar' ? Math.min(2, H) : H - 0.7; if (h < 0.2) return;
      const zc = p.kind === 'larj' ? H - 0.2 - h / 2 : h / 2;
      links.push({ a: zid(li, p.a), b: zid(li, p.b), z: base + zc, A: p.len * h, cd: CD, kind: p.kind === 'gantung' ? 'gantung' : 'lar', li, x: p.x, y: p.y, nx: p.nx, ny: p.ny });
    });
    fl.items.forEach(it => {   // ventilasi, LMB, pintu (bocor) ke udara luar
      if (it.t !== 'vent' && it.t !== 'lmb' && it.t !== 'pintu') return;
      const x = it.x + it.w / 2, y = it.y + it.h / 2, e = side(F, x, y); if (e[0] > 0.5) return;
      const r = sp.regNear(x + e[2] * 0.35, y + e[3] * 0.35); if (r < 0) return;
      const cp = cpAt(SIDE_ANG[e[1]] - windAng), tt = (it.tcm || 50) / 100;
      const L = it.t === 'lmb' ? { A: Math.max(it.w, it.h) * tt, cd: CD, zc: H - 0.25 - tt / 2 } : it.t === 'vent' ? { A: VENT_A, cd: VENT_CD, zc: Math.max(0.3, H - VENT_Z - PIPA_TURUN) } : { A: 0.01, cd: CD, zc: 1 };
      links.push({ a: zid(li, r), b: -1, z: base + L.zc, A: L.A, cd: L.cd, cp, kind: it.t, li, x, y, nx: e[2], ny: e[3], sisi: e[1], id: it.id });
    });
    if (li === 0) return;
    const lo = sps[li - 1].sp;   // lubang void ke lantai di bawahnya (lantai menara terbuka seluruhnya ke void)
    (fl.menara ? [floorRect(m, fl)] : fl.items.filter(it => it.t === 'void')).forEach(vz => {
      const x0 = Math.max(vz.x, F.x, lo.F.x), y0v = Math.max(vz.y, F.y, lo.F.y), x1 = Math.min(vz.x + vz.w, F.x + F.w, lo.F.x + lo.F.w), y1 = Math.min(vz.y + vz.h, F.y + F.h, lo.F.y + lo.F.h);
      if (x1 - x0 < 0.3 || y1 - y0v < 0.3) return;
      const cx = (x0 + x1) / 2, cy = (y0v + y1) / 2, ru = sp.regAt(cx, cy) >= 0 ? sp.regAt(cx, cy) : sp.regNear(cx, cy), rl = lo.regAt(cx, cy) >= 0 ? lo.regAt(cx, cy) : lo.regNear(cx, cy);
      if (ru >= 0 && rl >= 0) links.push({ a: zid(li, ru), b: zid(li - 1, rl), z: base, A: (x1 - x0) * (y1 - y0v), cd: CD, kind: 'void', li, x: cx, y: cy });
    });
  });
  zones.forEach((z, i) => links.push({ a: i, b: -1, z: z.zc, A: BOCOR, cd: CD, cp: 0, kind: 'bocor', li: z.li }));   // celah kecil agar tiap zona tersambung
  // tekanan zona pada ketinggian 0: P_i(z) = P_i − ρ_in g z ; luar: P_o(z) = −ρ_out g z + Cp·½ρv²
  const n = zones.length, P = new Array(n).fill(0);
  const dPof = (L, P) => { const pa = P[L.a] - rhoIn * G * L.z, pb = L.b >= 0 ? P[L.b] - rhoIn * G * L.z : -rhoOut * G * L.z + (L.cp || 0) * pw; return pa - pb; };
  const flowOf = (L, dP) => {   // ṁ (kg/s) dari a ke b dan turunannya terhadap ΔP
    const rho = dP >= 0 ? rhoIn : L.b >= 0 ? rhoIn : rhoOut, k = L.cd * L.A * Math.sqrt(2 * rho), ad = Math.abs(dP), lim = 1e-4;
    if (ad < lim) { const s = k / Math.sqrt(lim); return [s * dP, s]; }
    return [Math.sign(dP) * k * Math.sqrt(ad), k / (2 * Math.sqrt(ad))];
  };
  for (let it = 0; it < 150; it++) {
    const Fv = new Array(n).fill(0), J = Array.from({ length: n }, () => new Array(n).fill(0));
    links.forEach(L => {
      if (L.a < 0) return;
      const [mf, d] = flowOf(L, dPof(L, P));
      Fv[L.a] += mf; J[L.a][L.a] += d;
      if (L.b >= 0) { Fv[L.b] -= mf; J[L.b][L.b] += d; J[L.a][L.b] -= d; J[L.b][L.a] -= d; }
    });
    const err = Math.max(...Fv.map(Math.abs));
    if (err < 1e-7) break;
    const dx = solve(J, Fv.map(f => -f));
    for (let i = 0; i < n; i++) P[i] += 0.75 * dx[i];
  }
  // hasil: debit tiap bukaan (m³/jam, + = dari zona a ke b / ke luar) dan pertukaran udara per ruang
  const inflow = new Array(n).fill(0), outs = [];
  links.forEach(L => {
    if (L.a < 0) return;
    const dP = dPof(L, P), [mf] = flowOf(L, dP), rho = dP >= 0 ? rhoIn : L.b >= 0 ? rhoIn : rhoOut, q = (mf / rho) * 3600;
    L.q = q; L.dP = dP;
    if (q >= 0) { if (L.b >= 0) inflow[L.b] += q; } else inflow[L.a] += -q;
    if (L.kind !== 'bocor') outs.push(L);
  });
  zones.forEach((z, i) => { z.ach = z.vol > 0 ? inflow[i] / z.vol : 0; z.P = P[i]; });
  const luar = outs.filter(L => L.b < 0), masuk = luar.filter(L => L.q < 0), keluar = luar.filter(L => L.q > 0);
  const res = {
    sim, Tin, Tout, rhoIn, rhoOut, v, zones, links: outs,
    intake: masuk.reduce((s, L) => s - L.q, 0), outtake: keluar.reduce((s, L) => s + L.q, 0),
    masuk: { vent: masuk.filter(L => L.kind === 'vent').length, lmb: masuk.filter(L => L.kind === 'lmb').length },
    keluar: { vent: keluar.filter(L => L.kind === 'vent').length, lmb: keluar.filter(L => L.kind === 'lmb').length },
    cerobong: Tin > Tout ? 'naik' : 'turun',   // udara dalam lebih hangat → naik dan keluar lewat bukaan tinggi
  };
  cache = { sig, res };
  return res;
}

// ---------- suhu & kelembapan per lantai + panas permukaan dalam dinding ----------
// Suhu: suhu luar harian diredam massa bangunan (lantai atas lebih mengikuti luar), udara hangat menumpuk ke atas,
// lantai dasar terkopel tanah & didinginkan penguapan kolam, lantai teratas/menara kena panas atap. Kelembapan: lantai
// bawah paling lembap (buku: bawah ±90%, atas ±75%); kolam menambah uap, pertukaran udara (ACH) menariknya ke kondisi
// luar. Panas dinding: sisi yang ditimpa matahari langsung → suhu permukaan DALAM naik (T_si = T_dalam + k·(T_sol-air −
// T_dalam), k ±0,3 bata 15 cm, penyerapan cat gelap α 0,6 — cat putih memangkas setengahnya). Perkiraan orde besaran.
const RAD2 = Math.PI / 180;
let cCache = { sig: '', res: null };
export function climate(m) {
  const sim = { ...SIM_DEFAULT, ...(m.sim || {}) }, LV = levels(m);
  const sig = JSON.stringify([m.w, m.h, m.floorH, sim, m.floors, m.menara || null]);
  if (cCache.sig === sig) return cCache.res;
  const sun = sunPos(sim), sky = skyLux(sim, sun), Tout = suhuLuar(+sim.jam), Tmean = 29, top = m.floors.length - 1;
  let A = null; try { A = simulateAir(m); } catch {}
  const achOf = li => { const zs = A ? A.zones.filter(z => z.li === li && z.vol >= 1) : []; return zs.length ? zs.reduce((s, z) => s + z.ach, 0) / zs.length : 1; };
  const irr = az => { const cosI = Math.cos(sun.el * RAD2) * Math.cos((sun.az - az) * RAD2); return (sky.dn * Math.max(0, cosI) * 0.9 + sky.dh * 0.4) / 110; };   // W/m² ≈ lux/110
  const lv = LV.map((fl, i) => {
    const F = floorRect(m, fl), luas = Math.max(1, F.w * F.h);
    const kolam = fl.items.filter(it => it.t === 'kolam').reduce((s, k) => s + k.w * k.h, 0);
    let T = Tmean + (Tout - Tmean) * (0.22 + 0.05 * Math.min(i, 4)) + 0.18 * i;
    if (i === 0) T -= 0.8;
    if (i >= top) T += sun.el > 0 ? 0.9 * (sky.gh / 48000) : -0.2;
    T -= Math.min(1.2, (kolam / luas) * 10);
    const ach = achOf(i), f = 1 / (1 + ach / 8);
    const RH = Math.max(45, Math.min(97, 75 + (i === 0 ? 15 : Math.max(-4, 10 - 3.5 * i)) * f + Math.min(12, (kolam / luas) * 60)));
    const sides = [['depan', 0, -1], ['kanan', 1, 0], ['belakang', 0, 1], ['kiri', -1, 0]].map(([sisi, nx, ny]) => {
      const az = facadeAz(nx, ny, sim.hadap), I = irr(az);
      const Tsi = Math.round((T + 0.3 * Math.max(0, Tout + (0.6 * I) / 17 - T)) * 10) / 10;
      return { sisi, arah: arahNama(az), I: Math.round(I), Tsi, panas: Tsi >= 33 };
    });
    return { i, name: fl.name, T: Math.round(T * 10) / 10, RH: Math.round(RH), ach: Math.round(ach * 10) / 10, kolam, sides,
      okT: T >= RULES.suhu[0] - 0.5 && T <= RULES.suhu[1] + 0.5, okRH: RH >= RULES.rh[0] - 3 && RH <= RULES.rh[1] + 5 };
  });
  const res = { jam: +sim.jam, Tout: Math.round(Tout * 10) / 10, levels: lv, panas: lv.flatMap(l => l.sides.filter(s => s.panas).map(s => ({ lantai: l.name, ...s }))) };
  cCache = { sig, res };
  return res;
}
