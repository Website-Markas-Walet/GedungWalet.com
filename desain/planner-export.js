// Lembar desain (PNG) yang dikirim tim GedungWalet ke WhatsApp pelanggan. Hanya dipakai dalam mode admin.
import { TYPES, RULES } from './planner-data.js';
import { floorSVG, symbolSVG } from './planner-draw.js';
import { levels } from './planner-geom.js';
import { luxTxt } from './planner-light.js';

const FONT = 'Roboto, Arial, sans-serif';
const HEAD = 'Raleway, Roboto, Arial, sans-serif';
const LOGO = '/wp-content/uploads/2021/07/Custom-dimensions-800x200-px-1.png';
const PAD = 44;   // ruang untuk garis ukuran di sekeliling denah
const fmt = n => (+n).toLocaleString('id-ID');
const loadImg = src => new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = src; });
const svgUrl = svg => 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg.includes('xmlns=') ? svg : svg.replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" '));

function wrap(ctx, text, maxW) {
  const lines = []; let line = '';
  for (const word of text.split(' ')) {
    const t = line ? `${line} ${word}` : word;
    if (ctx.measureText(t).width > maxW && line) { lines.push(line); line = word; } else line = t;
  }
  if (line) lines.push(line);
  return lines;
}

export async function makeSheet(m, a, img3d) {
  const cv = await makeSheetCanvas(m, a, img3d);
  return new Promise((res, rej) => cv.toBlob(b => (b ? res(b) : rej(new Error('toBlob gagal'))), 'image/png'));
}
export async function makeSheetCanvas(m, a, img3d) {
  try { await document.fonts?.ready; } catch {}
  const LV = levels(m), n = LV.length, CW = 2000, M = 56, RIGHT = 640, GAP = 36;
  const leftW = CW - 2 * M - RIGHT - GAP;
  const cols = Math.min(n, 4), rows = Math.ceil(n / cols);
  const cellW = (leftW - (cols - 1) * 20) / cols, maxCellH = rows === 1 ? 900 : 640, LBL = 104;   // margin label ruang di kiri denah
  const s = Math.min((cellW - 2 * PAD - LBL) / m.w, (maxCellH - 2 * PAD - 34) / m.h);
  const cellH = m.h * s + 2 * PAD + 34;
  const plans = await Promise.all(LV.map((_, i) => loadImg(svgUrl(floorSVG(m, i, s, { pad: PAD, chain: false, pfx: 'ex' + i })))));

  const probe = document.createElement('canvas').getContext('2d');
  probe.font = `17px ${FONT}`;
  const noteLines = a.notes.slice(0, 10).flatMap(nt => wrap(probe, `• ${nt.txt}`, RIGHT - 10));
  const rekLines = (a.rekom || []).slice(0, 6).flatMap(t => wrap(probe, `• ${t}`, RIGHT - 10));
  const stats = [
    ['Luas bangunan', `${fmt(Math.round(a.luasTotal * 10) / 10)} m²`],
    ['Sirip efektif (ruang inap)', `${fmt(a.siripM)} m`],
    ['Papan sirip', `${fmt(a.siripM3)} m³ · ${m.siripTebal || RULES.siripTebalCm}×${m.siripLebar || RULES.siripLebarCm} cm · ±${fmt(a.siripBatang)} batang`],
    ['Sarang efektif*', `± ${fmt(a.sarang)} sarang`],
    ...(a.lux ? [['Cahaya ruang inap (simulasi)', `maks ${luxTxt(a.lux.maxInap)}`]] : []),
    ['Referensi produksi**', `${fmt(a.kgRef[0])}–${fmt(a.kgRef[1])} kg/tahun`],
    ['Tweeter inap / tarik', `${a.twinapN} / ${a.twtarikN}`],
    ['Channel ampli', `${a.channels}`],
    ...(a.kabelM ? [['Kabel tweeter / klem', `${fmt(a.kabelM)} m / ${fmt(a.klemN)}`]] : []),
    ['LMB / ventilasi / kolam', `${a.lmbN} / ${a.ventN} / ${a.kolamN}`],
    ['Menara / tweeter hexagonal', `${a.menaraN ? 'ada' : 'tidak ada'} / ${a.hexaN}`],
  ];
  const rightH = 480 + 44 + stats.length * 36 + 50 + noteLines.length * 25 + (rekLines.length ? 50 + rekLines.length * 25 : 0);
  const used = [...new Set(LV.flatMap(f => f.items.map(it => it.t)))].filter(t => TYPES[t]);
  if (m.floors.some(f => f.walls.length)) used.unshift('sekat');
  const legend = await Promise.all(used.map(t => loadImg(svgUrl(symbolSVG(t, 34))).then(im => [t, im]).catch(() => [t, null])));
  const TOP = 180, FOOT = 86, legRows = Math.ceil(used.length / 5), LEG = 40 + legRows * 44;
  const bodyH = Math.max(rows * cellH + (rows - 1) * 20, rightH);
  const CH = TOP + bodyH + LEG + FOOT;

  const cv = document.createElement('canvas'); cv.width = CW; cv.height = CH;
  const c = cv.getContext('2d');
  c.fillStyle = '#fff'; c.fillRect(0, 0, CW, CH);
  c.fillStyle = '#1565C0'; c.fillRect(0, 0, CW, 10);

  // kepala
  try { const logo = await loadImg(LOGO); c.drawImage(logo, M, 44, 224, 56); } catch {}
  c.fillStyle = '#1a1a1a'; c.font = `800 36px ${HEAD}`; c.fillText('Lembar Desain Rumah Walet', M + 256, 74);
  c.font = `500 20px ${FONT}`; c.fillStyle = '#3a4452';
  c.fillText([m.name || 'Rumah Walet', m.city, m.owner && `Pemilik: ${m.owner}`].filter(Boolean).join('  ·  '), M + 256, 110);
  c.font = `18px ${FONT}`; c.fillStyle = '#5a6472';
  const tgl = new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
  c.fillText(`Ukuran ${fmt(m.w)} × ${fmt(m.h)} m  ·  ${m.floors.length} lantai${m.menara ? ' + menara' : ''}  ·  tinggi lantai ${fmt(m.floorH)} m  ·  tinggi gedung ${fmt(a.tinggi)} m  ·  ${tgl}`, M + 256, 142);
  const sc = a.score >= 80 ? '#1D9E75' : a.score >= 55 ? '#BA7517' : '#D85A30';
  c.fillStyle = sc; c.beginPath(); c.roundRect(CW - M - 230, 40, 230, 104, 12); c.fill();
  c.fillStyle = '#fff'; c.font = `500 17px ${FONT}`; c.fillText('Skor kelayakan', CW - M - 208, 72);
  c.font = `800 48px ${HEAD}`; c.fillText(`${a.score}`, CW - M - 208, 126);
  const scoreW = c.measureText(`${a.score}`).width;
  c.font = `500 20px ${FONT}`; c.fillText('/ 100', CW - M - 208 + scoreW + 8, 126);
  c.strokeStyle = '#e6eaf0'; c.lineWidth = 2; c.beginPath(); c.moveTo(M, TOP - 16); c.lineTo(CW - M, TOP - 16); c.stroke();

  // denah per lantai
  plans.forEach((im, i) => {
    const col = i % cols, row = Math.floor(i / cols), x = M + col * (cellW + 20), y = TOP + row * (cellH + 20);
    c.fillStyle = '#1a1a1a'; c.font = `700 20px ${HEAD}`;
    c.fillText(`${LV[i].name}${i === m.floors.length - 1 ? ' · atas' : ''}`, x + (cellW - im.width) / 2 + PAD, y + 22);
    c.drawImage(im, x + (cellW - im.width) / 2, y + 34);
  });

  // kolom kanan: 3D, ringkasan, catatan, rekomendasi
  const rx = CW - M - RIGHT; let ry = TOP;
  if (img3d) {
    try { const im = await loadImg(img3d); c.drawImage(im, rx, ry, RIGHT, 480); } catch {}
    c.strokeStyle = '#e6eaf0'; c.strokeRect(rx, ry, RIGHT, 480);
  }
  ry += 480 + 44;
  c.fillStyle = '#1a1a1a'; c.font = `700 22px ${HEAD}`; c.fillText('Ringkasan', rx, ry - 10);
  stats.forEach(([k, v], j) => {
    const y = ry + 22 + j * 36;
    c.font = `18px ${FONT}`; c.fillStyle = '#5a6472'; c.fillText(k, rx, y);
    c.fillStyle = '#1a1a1a'; c.font = `500 18px ${FONT}`; c.textAlign = 'right'; c.fillText(v, rx + RIGHT, y); c.textAlign = 'left';
    c.strokeStyle = '#f0f2f5'; c.beginPath(); c.moveTo(rx, y + 12); c.lineTo(rx + RIGHT, y + 12); c.stroke();
  });
  ry += 22 + stats.length * 36 + 28;
  c.fillStyle = '#1a1a1a'; c.font = `700 22px ${HEAD}`; c.fillText('Catatan analisis', rx, ry);
  c.font = `17px ${FONT}`; c.fillStyle = '#3a4452';
  noteLines.forEach((ln, j) => c.fillText(ln, rx, ry + 30 + j * 25));
  if (rekLines.length) {
    ry += 30 + noteLines.length * 25 + 26;
    c.fillStyle = '#1a1a1a'; c.font = `700 22px ${HEAD}`; c.fillText('Rekomendasi lokasi', rx, ry);
    c.font = `17px ${FONT}`; c.fillStyle = '#3a4452';
    rekLines.forEach((ln, j) => c.fillText(ln, rx, ry + 30 + j * 25));
  }

  // legenda dengan simbol yang sama seperti di denah
  let lx = M, ly = TOP + bodyH + 30;
  c.font = `16px ${FONT}`;
  legend.forEach(([t, im]) => {
    const T = TYPES[t], wText = c.measureText(T.name).width + 52;
    if (lx + wText > CW - M) { lx = M; ly += 44; }
    if (im) c.drawImage(im, lx, ly - 4, 34, 34);
    c.fillStyle = '#3a4452'; c.fillText(T.name, lx + 42, ly + 18);
    lx += wText + 22;
  });

  // kaki
  const fy = CH - FOOT + 30;
  c.strokeStyle = '#e6eaf0'; c.lineWidth = 2; c.beginPath(); c.moveTo(M, fy - 26); c.lineTo(CW - M, fy - 26); c.stroke();
  c.fillStyle = '#1565C0'; c.font = `500 18px ${FONT}`; c.fillText('GedungWalet.com  ·  WhatsApp 0852 3535 0662  ·  Mulyosari Tengah No. 97 F, Surabaya', M, fy);
  c.fillStyle = '#5a6472'; c.font = `15px ${FONT}`;
  c.fillText(`Denah konsep (indikatif), bukan gambar kerja. Sarang efektif hanya dari papan sirip di ruang inap. *Asumsi ${RULES.sarangPerMeterSirip} sarang per meter sirip. **Skala dari RBW 6×12 m 2 lantai = ${RULES.produksi6x12KgTahun[0]}–${RULES.produksi6x12KgTahun[1]} kg/tahun.`, M, fy + 28);

  return cv;
}

// Bungkus canvas menjadi PDF (JPEG DCTDecode, tanpa pustaka luar). Multi-halaman: satu canvas = satu halaman,
// ukuran halaman mengikuti ukuran canvas masing-masing.
export function pagesPDF(cvs, q = 0.9) {
  const enc = s => new TextEncoder().encode(s);
  const parts = []; let off = 0; const offs = [];
  const push = c => { parts.push(c); off += c.length; };
  const obj = (n, body) => { offs[n] = off; push(enc(`${n} 0 obj\n${body}\nendobj\n`)); };
  const N = cvs.length;
  push(enc('%PDF-1.4\n'));
  obj(1, '<</Type/Catalog/Pages 2 0 R>>');
  obj(2, `<</Type/Pages/Kids[${cvs.map((_, i) => `${3 + i * 3} 0 R`).join(' ')}]/Count ${N}>>`);
  cvs.forEach((cv, i) => {
    const P = 3 + i * 3, I = P + 1, C = P + 2, W = cv.width, H = cv.height;
    const bin = atob(cv.toDataURL('image/jpeg', q).split(',')[1]);
    const img = new Uint8Array(bin.length);
    for (let k = 0; k < bin.length; k++) img[k] = bin.charCodeAt(k);
    obj(P, `<</Type/Page/Parent 2 0 R/MediaBox[0 0 ${W} ${H}]/Resources<</XObject<</Im${i} ${I} 0 R>>/ProcSet[/PDF/ImageC]>>/Contents ${C} 0 R>>`);
    offs[I] = off;
    push(enc(`${I} 0 obj\n<</Type/XObject/Subtype/Image/Width ${W}/Height ${H}/ColorSpace/DeviceRGB/BitsPerComponent 8/Filter/DCTDecode/Length ${img.length}>>\nstream\n`));
    push(img); push(enc('\nendstream\nendobj\n'));
    const ct = `q ${W} 0 0 ${H} 0 0 cm /Im${i} Do Q`;
    obj(C, `<</Length ${ct.length}>>\nstream\n${ct}\nendstream`);
  });
  const size = 3 + N * 3, xref = off;
  push(enc(`xref\n0 ${size}\n0000000000 65535 f \n${Array.from({ length: size - 1 }, (_, k) => String(offs[k + 1]).padStart(10, '0') + ' 00000 n \n').join('')}trailer\n<</Size ${size}/Root 1 0 R>>\nstartxref\n${xref}\n%%EOF`));
  return new Blob(parts, { type: 'application/pdf' });
}
export const canvasPDF = (cv, q = 0.92) => pagesPDF([cv], q);
