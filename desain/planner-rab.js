// RAB (rencana anggaran biaya) perlengkapan walet: baris otomatis dari desain (papan sirip, sekat terpal/bata, tweeter,
// kabel + klem, ventilasi, perangkat ruang audio, dst) + baris tambahan bebas. Jumlah dihitung dari desain; harga satuan
// bisa diubah dan tersimpan di desain (m.rab.h), keterangan di m.rab.k, baris tambahan di m.rab.x.
// Harga bawaan hanya PERKIRAAN pasar — wajib disesuaikan harga lokal. RAB ini belum termasuk struktur bangunan (RAB sipil).
import { AMPLI, AUDIO_ALAT, SARANG_JENIS } from './planner-data.js';
import { levels, floorHt } from './planner-geom.js';

const NAMA_ALAT = Object.fromEntries(AUDIO_ALAT);
const NAMA_AMPLI = Object.fromEntries(AMPLI.map(([k, n]) => [k, n]));
// [key, nama, satuan, harga perkiraan (Rp), keterangan bawaan]
const DEF = [
  ['papan', 'Papan sirip (meranti)', 'm³', 5000000, 'Termasuk ±10% sisa potong'],
  ['terpal', 'Sekat terpal', 'm²', 15000, 'Terpal + rangka gantung'],
  ['bata', 'Sekat bata / dinding', 'm²', 150000, 'Bata + plester 2 sisi'],
  ['twinap', 'Tweeter inap', 'bh', 35000, ''],
  ['twtarik', 'Tweeter tarik', 'bh', 35000, ''],
  ['hexa', 'Tweeter hexagonal', 'bh', 250000, '6 tweeter panggil'],
  ['kabel', 'Kabel tweeter 2×0,75', 'm', 4000, 'Lihat rincian per channel'],
  ['klem', 'Klem kabel', 'bh', 200, 'Tiap 10 cm'],
  ['vent', 'Ventilasi pipa 4"', 'ttk', 45000, 'Pipa + elbow + pipa 1 m + jaring'],
  ['kolam', 'Kolam air', 'bh', 200000, ''],
  ['pintu', 'Pintu baja kunci ganda', 'bh', 1500000, ''],
  ['polesan', 'Sarang polesan (cetakan)', 'bh', 10000, ''],
];
const ALAT_HARGA = { axm: 2500000, piro88: 1800000, piro89: 2000000, kipas: 100000, timerKitani: 150000, timerAC: 120000, saklar: 30000, stopkontak: 50000, aki: 1200000, flashdisk: 60000, twKontrolT: 35000, twKontrolI: 35000 };

export function rabRows(m, a, cab) {
  const H = { ...(m.rab?.h || {}) }, K = { ...(m.rab?.k || {}) };
  const r1 = v => Math.round(v * 10) / 10;
  let terpal = 0, bata = 0, pintuN = 0;
  levels(m).forEach(fl => {
    const h = floorHt(m, fl);
    fl.walls.forEach(w => {
      const L = Math.hypot(w.x2 - w.x1, w.y2 - w.y1) * (w.jenis === 'gantung' ? Math.max(0.5, h - 0.7) : h);
      if (w.bahan === 'bata') bata += L; else terpal += L;
    });
    pintuN += fl.items.filter(it => it.t === 'pintu').length;
  });
  const qty = {
    papan: r1((a.siripM3 || 0) * 1.1), terpal: Math.round(terpal), bata: Math.round(bata),
    twinap: a.twinapN, twtarik: a.twtarikN, hexa: a.hexaN || 0,
    kabel: Math.round(cab?.total || 0), klem: cab?.klem || 0,
    vent: a.ventN, kolam: a.kolamN, pintu: pintuN, polesan: a.sarangN?.polesan || 0,
  };
  const rows = DEF.filter(([k]) => qty[k] > 0).map(([k, nm, sat, hd, ket]) => {
    const hrg = Number.isFinite(+H[k]) ? +H[k] : hd;
    return { key: k, nm, jml: qty[k], sat, hrg, tot: Math.round(qty[k] * hrg), ket: K[k] ?? ket, auto: true };
  });
  (m.audio?.items || []).forEach(it => {
    if (!it.n) return;
    const k = 'alat:' + it.t, nm = NAMA_AMPLI[it.t] || NAMA_ALAT[it.t] || it.t;
    const hrg = Number.isFinite(+H[k]) ? +H[k] : ALAT_HARGA[it.t] ?? 0;
    rows.push({ key: k, nm, jml: it.n, sat: 'bh', hrg, tot: Math.round(it.n * hrg), ket: K[k] ?? (NAMA_AMPLI[it.t] ? `${it.ch || 4} channel` : ''), auto: true });
  });
  (Array.isArray(m.rab?.x) ? m.rab.x : []).forEach((x, i) => {
    const jml = +x.jml || 0, hrg = +x.hrg || 0;
    rows.push({ key: 'x' + i, nm: String(x.nm || ''), jml, sat: x.sat || 'bh', hrg, tot: Math.round(jml * hrg), ket: String(x.ket || ''), auto: false, xi: i });
  });
  return { rows, total: rows.reduce((s, r) => s + r.tot, 0) };
}
export const SARANG_NAMA = Object.fromEntries(SARANG_JENIS);
