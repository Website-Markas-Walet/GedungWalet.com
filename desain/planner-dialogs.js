// Dialog Walet Planner: pilihan awal (manual / pengamatan cepat), pengaturan proyek, tanya-jawab pengamatan,
// selesai & kirim WhatsApp, link desain, dan lembar desain untuk admin.
import { TYPES, RULES, SIZE_PRESETS, WA_NUMBER, SURVEY, SURVEY_DEFAULT, SUARA, ROLE_ORDER, TW, LANGIT, SISI, AMPLI, AUDIO_ALAT, AUDIO_DEFAULT, dbTarget, icon } from './planner-data.js';
import { floorSVG } from './planner-draw.js';
import { isFull, derive, inRect, center, floorRect, zonePattern, levels } from './planner-geom.js';
import { luxTxt } from './planner-light.js';
import { channels, cableInfo, KABEL_JENIS } from './planner-cable.js';
import { rabRows } from './planner-rab.js';
import * as SK from './planner-sketch.js';
import * as SND from './planner-suara.js';

let A = null;                       // API dari planner.js
let admin = false;                  // mode tim (/desain/?admin=1)
export function init(app) { A = app; }
export const isAdmin = () => admin;

const $ = s => document.querySelector(s);
const dlg = $('#dlg');
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const fmt = n => (+n).toLocaleString('id-ID');
const uid = () => Math.random().toString(36).slice(2, 9);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const optLabel = (k, v) => (SURVEY[k].opts.find(([x]) => x === v) || [, '-'])[1];

export function openDlg(title, body, foot, size = false) {   // size: false | true ('wide') | 'mid'
  dlg.classList.toggle('wide', size === true || size === 'wide');
  dlg.classList.toggle('mid', size === 'mid');
  dlg.innerHTML = `<div class="dh"><h2>${title}</h2><button type="button" id="dClose" aria-label="Tutup">${icon('x')}</button></div><div class="db">${body}</div><div class="df">${foot}</div>`;
  $('#dClose').onclick = () => dlg.close();
  if (!dlg.open) dlg.showModal();
}

// ---------- pilihan awal ----------
export function dlgStart(first = false) {
  openDlg(first ? 'Selamat datang di Walet Planner' : 'Proyek baru',
    `<p class="lead">Pilih cara memulai desain rumah walet Anda.</p>
     <div class="pl-start">
       <button type="button" id="stManual">${icon('pencil', 22)}<b>Buat desain manual</b><span>Tentukan ukuran gedung, lalu gambar sendiri sekat, void, ruang inap, LAR, dan tweeter.</span></button>
       <button type="button" id="stQuick">${icon('spark', 22)}<b>Desain dari pengamatan cepat</b><span>Jawab beberapa pertanyaan tentang lokasi dan pengamatan burung — denah, sekat, LAR, dan tweeter dibuat otomatis.</span></button>
       <button type="button" id="stSketch">${icon('photo', 22)}<b>Dari gambar tangan</b><span>Unggah foto sketsa denah (beri tulisan LMB, VOID, LAR, INAP…) lalu jiplak di atasnya${admin ? ' — atau ubah otomatis dengan AI' : ', atau kirim ke tim kami untuk dirapikan'}.</span></button>
     </div>
     ${first ? '<p class="tip" style="margin-top:12px">Di belakang dialog ini sudah ada contoh desain 4×12 m, 4 lantai.</p>' : '<p class="tip" style="margin-top:12px">Desain yang sedang terbuka akan diganti — salin link desainnya dulu bila ingin menyimpannya.</p>'}`,
    `<button type="button" class="pl-btn" id="stSkip">${first ? 'Lihat contoh dulu' : 'Batal'}</button>`, 'mid');
  $('#stManual').onclick = () => dlgManual(true);
  $('#stQuick').onclick = () => dlgSurvey({});
  $('#stSketch').onclick = () => dlgSketch();
  $('#stSkip').onclick = () => dlg.close();
}

// ---------- ukuran gedung (dipakai dialog manual & langkah 1 pengamatan) ----------
function sizeFields(m) {
  return `<div class="g2"><div><label for="fName">Nama proyek</label><input id="fName" value="${esc(m.name)}" placeholder="RBW Pak Budi – Kalimantan"></div><div><label for="fCity">Kota / lokasi</label><input id="fCity" value="${esc(m.city)}" placeholder="Samarinda"></div></div>
   <div class="g3"><div><label for="fW">Lebar (m)</label><input id="fW" type="number" min="2" max="40" step="0.5" value="${m.w}"></div><div><label for="fH">Panjang (m)</label><input id="fH" type="number" min="2" max="60" step="0.5" value="${m.h}"></div><div><label for="fFH">Tinggi per lantai (m)</label><input id="fFH" type="number" min="1.8" max="4" step="0.1" value="${m.floorH}"></div></div>
   <label>Ukuran populer</label><div class="presets">${SIZE_PRESETS.map(([a, b]) => `<button type="button" data-w="${a}" data-h="${b}"${a === m.w && b === m.h ? ' class="on"' : ''}>${a}×${b}</button>`).join('')}</div>
   <label for="fN">Jumlah lantai</label><select id="fN">${[1, 2, 3, 4, 5, 6, 7, 8].map(n => `<option value="${n}"${n === m.n ? ' selected' : ''}>${n} lantai${n % 2 ? ' (buku menyarankan genap)' : ''}</option>`).join('')}</select>
   <p class="tip" style="margin:6px 0 0">Standar buku: lebar kelas 4 / 8 / 12 m, panjang maks 30 m, tinggi lantai 2 m, jumlah lantai genap.</p>
   <p class="err" id="fErr" hidden></p>`;
}
function bindSize() {
  dlg.querySelectorAll('.presets button').forEach(b => b.onclick = () => {
    $('#fW').value = b.dataset.w; $('#fH').value = b.dataset.h; $('#fErr').hidden = true;
    dlg.querySelectorAll('.presets button').forEach(x => x.classList.toggle('on', x === b));
  });
  ['fW', 'fH', 'fFH'].forEach(id => $('#' + id).addEventListener('input', () => { $('#fErr').hidden = true; }));
}
function readSize() {
  const w = +$('#fW').value, h = +$('#fH').value, fh = +$('#fFH').value, err = $('#fErr');
  const bad = !(w >= 2 && w <= 40) ? 'Lebar harus 2–40 m.' : !(h >= 2 && h <= 60) ? 'Panjang harus 2–60 m.' : !(fh >= 1.8 && fh <= 4) ? 'Tinggi per lantai harus 1,8–4 m.' : '';
  if (bad) { err.textContent = bad; err.hidden = false; return null; }
  return { name: $('#fName').value.trim(), city: $('#fCity').value.trim(), w, h, floorH: fh, floors: +$('#fN').value };
}

// ---------- desain manual / pengaturan proyek ----------
export function dlgManual(isNew) {
  const m = isNew ? { name: '', city: '', w: 4, h: 12, floorH: RULES.lantaiTinggi, n: 4 } : { ...A.model, n: A.model.floors.length };
  openDlg(isNew ? 'Desain manual' : 'Pengaturan proyek',
    `<p class="lead">${isNew ? 'Tentukan ukuran bangunan. Denah dimulai kosong (hanya dinding luar) — lalu gambar sendiri.' : 'Ubah nama, lokasi, dan ukuran gedung.'}</p>${sizeFields(m)}
     ${isNew ? '<label class="chk"><input type="checkbox" id="fBase"> Mulai dari tata letak dasar (void, jalur, ruang inap, sekat, LAR, tweeter) lalu sesuaikan</label>' : '<p class="tip warnc">Mengubah ukuran akan merapatkan elemen yang melewati batas baru.</p>'}`,
    `<button type="button" class="pl-btn" id="dBack">${isNew ? 'Kembali' : 'Batal'}</button><button type="button" class="pl-btn pl-primary" id="dOk">${isNew ? 'Mulai menggambar' : 'Simpan'}</button>`);
  bindSize();
  $('#dBack').onclick = () => (isNew ? dlgStart(false) : dlg.close());
  $('#dOk').onclick = () => {
    const o = readSize(); if (!o) return;
    if (!isNew) { dlg.close(); A.applyProject(o); return; }
    const base = $('#fBase').checked, { model } = A.newModel({ ...o, auto: base });
    dlg.close(); A.setModel(model);
    A.hint(base ? 'Tata letak dasar siap — sesuaikan sekat, LAR, dan tweeter.' : 'Denah kosong siap — pilih "Sekat walet" di katalog untuk mulai menggambar.');
  };
}

// ---------- pengamatan cepat (4 langkah) ----------
export function dlgSurvey(opts = {}) {
  const m = A.model, regen = !!opts.regenerate;
  const draft = regen
    ? { name: m.name, city: m.city, w: m.w, h: m.h, floorH: m.floorH, n: m.floors.length, topSmall: m.floors.length > 1 && !isFull(m, m.floors[m.floors.length - 1]), survey: { ...SURVEY_DEFAULT, ...(m.survey || {}) } }
    : { name: '', city: '', w: 4, h: 12, floorH: RULES.lantaiTinggi, n: 4, topSmall: false, survey: { ...SURVEY_DEFAULT } };
  const topChoice = () => `<div class="q">Lantai teratas</div><div class="chips" data-k="topSmall">${[['sama', 'Sama dengan lantai di bawahnya'], ['kecil', 'Lebih kecil di tengah (menara besar, seperti DED 20×25)']]
    .map(([v, t]) => `<button type="button" class="chip${(draft.topSmall ? 'kecil' : 'sama') === v ? ' on' : ''}" data-v="${v}">${t}</button>`).join('')}</div>
    <p class="tip">Ukuran, posisi, dan tinggi tiap lantai tetap bisa diubah satu per satu di panel kanan.</p>`;
  const STEPS = ['Ukuran & lantai', 'Lingkungan lokasi', 'Pengamatan burung', 'Ringkasan'];
  let step = 0;
  const chips = k => `<div class="q">${SURVEY[k].q}</div><div class="chips" data-k="${k}">${SURVEY[k].opts.map(([v, t]) => `<button type="button" class="chip${draft.survey[k] === v ? ' on' : ''}" data-v="${v}">${t}</button>`).join('')}</div>`;
  const sides = k => {
    const b = (v, cls) => `<button type="button" class="chip ${cls}${draft.survey[k] === v ? ' on' : ''}" data-v="${v}">${optLabel(k, v)}</button>`;
    return `<div class="q">${SURVEY[k].q}</div><div class="sides" data-k="${k}">${b('depan', 'sd-t')}${b('kiri', 'sd-l')}<div class="bld">Gedung<small>${fmt(draft.w)} × ${fmt(draft.h)} m</small></div>${b('kanan', 'sd-r')}${b('belakang', 'sd-b')}${b('?', 'sd-u')}</div>`;
  };
  const summary = () => {
    const tmp0 = regen ? { ...JSON.parse(JSON.stringify(m)), w: draft.w, h: draft.h, floorH: draft.floorH } : null;
    const { model: tmp, notes } = A.newModel({ ...draft, floors: draft.n, auto: !regen, survey: draft.survey });
    if (regen) {   // pratinjau memakai ukuran tiap lantai yang sudah diatur pada desain ini
      tmp.floors.forEach((f, i) => { const src = tmp0.floors[i]; if (src) ['fx', 'fy', 'fw', 'fh', 'ht'].forEach(k => { if (src[k] != null) f[k] = src[k]; }); });
      const t = tmp.floors[tmp.floors.length - 1];
      if (draft.topSmall && tmp.floors.length > 1 && t.fw == null) Object.assign(t, A.topSmallRect(tmp));
      if (!draft.topSmall) ['fx', 'fy', 'fw', 'fh'].forEach(k => delete t[k]);
      notes.push(...A.generate(tmp, draft.survey).notes);
    }
    const s = 120 / Math.max(tmp.w, tmp.h);
    return `<div class="sum">${Object.keys(SURVEY).map(k => `<div><span>${SURVEY[k].q}</span><b>${optLabel(k, draft.survey[k])}</b></div>`).join('')}</div>
      <div class="q">Denah yang akan dibuat</div><ul class="tips">${notes.map(t => `<li>${t}</li>`).join('')}</ul>
      <div class="thumbs">${levels(tmp).map((f, i) => `<figure>${floorSVG(tmp, i, s, { pad: 4, dims: false, labels: false, chain: false, struktur: false, pfx: 'sv' + i })}<figcaption>${f.name}</figcaption></figure>`).join('')}</div>
      ${regen ? '<p class="tip warnc">Isi semua lantai akan diganti dengan denah otomatis ini (bisa dibatalkan dengan Undo).</p>' : ''}`;
  };
  const finish = () => {
    if (regen) {
      const changed = draft.w !== m.w || draft.h !== m.h || draft.floorH !== m.floorH || draft.n !== m.floors.length || draft.name !== m.name || draft.city !== m.city;
      if (changed) A.applyProject({ w: draft.w, h: draft.h, floorH: draft.floorH, floors: draft.n, name: draft.name, city: draft.city });
      A.applyTopSmall(draft.topSmall);
      A.regenerate(draft.survey); dlg.close(); A.hint('Denah dibuat ulang dari jawaban pengamatan — Undo untuk membatalkan.');
      return;
    }
    const { model } = A.newModel({ ...draft, floors: draft.n, auto: true, survey: draft.survey, topSmall: draft.topSmall });
    dlg.close(); A.setModel(model); A.hint('Desain otomatis siap — sesuaikan sekat, LAR, dan tweeter bila perlu.');
  };
  const render = () => {
    const head = `<div class="steps">${STEPS.map((t, i) => `<span class="${i <= step ? 'on' : ''}" title="${t}"></span>`).join('')}</div><p class="lead"><b>Langkah ${step + 1} dari ${STEPS.length}:</b> ${STEPS[step]}</p>`;
    const body = step === 0 ? sizeFields(draft) + topChoice()
      : step === 1 ? chips('env') + chips('rh') + chips('suhu') + chips('tinggi')
      : step === 2 ? sides('burung') + chips('populasi') + sides('angin')
      : summary();
    const back = step ? 'Sebelumnya' : regen ? 'Batal' : 'Kembali', next = step < 3 ? 'Lanjut' : regen ? 'Terapkan ke desain' : 'Buat desain otomatis';
    openDlg(regen ? 'Pengamatan cepat' : 'Desain dari pengamatan cepat', head + body, `<button type="button" class="pl-btn" id="wBack">${back}</button><button type="button" class="pl-btn pl-primary" id="wNext">${next}</button>`);
    if (step === 0) bindSize();
    dlg.querySelectorAll('.chips, .sides').forEach(g => g.querySelectorAll('[data-v]').forEach(b => b.onclick = () => {
      if (g.dataset.k === 'topSmall') draft.topSmall = b.dataset.v === 'kecil'; else draft.survey[g.dataset.k] = b.dataset.v;
      g.querySelectorAll('[data-v]').forEach(x => x.classList.toggle('on', x === b));
    }));
    $('#wBack').onclick = () => { if (step) { step--; render(); } else if (regen) dlg.close(); else dlgStart(false); };
    $('#wNext').onclick = () => {
      if (step === 0) { const o = readSize(); if (!o) return; Object.assign(draft, o, { n: o.floors }); }
      if (step < 3) { step++; render(); } else finish();
    };
  };
  render();
}

// ---------- selesai → WhatsApp ----------
function surveyText(sv) {
  const pop = { ramai: 'ramai', sedang: 'sedang', sepi: 'sedikit' }[sv.populasi], rh = { lembab: 'lembab', normal: 'normal', kering: 'kering' }[sv.rh];
  return `${SUARA[sv.env]?.label || '-'}; ${sv.burung === '?' ? 'arah burung belum diamati' : `burung datang dari ${sv.burung}`}; populasi ${pop}; udara ${rh}`;
}
export function dlgFinish() {
  const m = A.model, a = A.analyze(), link = buildShareLink(m), s = 100 / Math.max(m.w, m.h);
  openDlg('Selesai & konsultasi',
    `<p class="lead">Desain Anda akan dikirim ke tim arsitek GedungWalet.com lewat WhatsApp untuk konsultasi lebih dalam. Setelah konsultasi, file desain lengkap (denah, 3D, rekomendasi) kami kirimkan ke WhatsApp Anda.</p>
     <div class="g2"><div><label for="fOwner">Nama Anda</label><input id="fOwner" value="${esc(m.owner)}" placeholder="Nama lengkap" autocomplete="name"></div><div><label for="fCity2">Kota lokasi rumah walet</label><input id="fCity2" value="${esc(m.city)}" placeholder="Samarinda"></div></div>
     <label for="fNote">Catatan untuk arsitek (opsional)</label><textarea id="fNote" rows="2" placeholder="Misal: lahan di pinggir sawah, sudah ada gedung tetangga…"></textarea>
     <div class="sum1"><b>Ringkasan:</b> ${fmt(m.w)} × ${fmt(m.h)} m, ${m.floors.length} lantai, tinggi ${fmt(m.floorH)} m · sirip efektif ${fmt(a.siripM)} m (±${fmt(a.siripM3)} m³ papan) · ±${fmt(a.sarang)} sarang${a.lux ? ` · ruang inap maks ${luxTxt(a.lux.maxInap)}` : ''} · skor ${a.score}/100</div>
     <div class="thumbs">${levels(m).map((f, i) => `<figure>${floorSVG(m, i, s, { pad: 4, dims: false, labels: false, chain: false, struktur: false, pfx: 'th' + i })}<figcaption>${f.name}</figcaption></figure>`).join('')}</div>`,
    `<button type="button" class="pl-btn" id="dPDF">Unduh PDF</button><button type="button" class="pl-btn" id="dCopy">Salin link desain</button><button type="button" class="pl-btn pl-primary" id="dWA">${icon('wa', 16)} Kirim ke WhatsApp</button>`);
  $('#dCopy').onclick = async () => { try { await navigator.clipboard.writeText(link); $('#dCopy').textContent = 'Tersalin ✓'; } catch { prompt('Salin link ini:', link); } };
  $('#dPDF').onclick = () => dlgPDF();
  $('#dWA').onclick = () => {
    m.owner = $('#fOwner').value.trim(); m.city = $('#fCity2').value.trim(); A.save();
    const note = $('#fNote').value.trim();
    const lines = [
      'Halo GedungWalet.com, saya sudah menyelesaikan desain rumah walet di Walet Planner dan ingin konsultasi lebih dalam.', '',
      `👤 Nama: ${m.owner || '-'}`, `📍 Lokasi: ${m.city || '-'}`, `🏠 Proyek: ${m.name || 'Rumah Walet'}`,
      `📐 Ukuran: ${fmt(m.w)} × ${fmt(m.h)} m, ${m.floors.length} lantai, tinggi ${fmt(m.floorH)} m`,
      `🪵 Sirip efektif (ruang inap): ±${fmt(a.siripM)} m (est. ±${fmt(a.sarang)} sarang)`,
      `🪚 Papan sirip ${m.siripTebal || RULES.siripTebalCm}×${m.siripLebar || RULES.siripLebarCm} cm: ±${fmt(a.siripM3)} m³ (±${fmt(a.siripBatang)} batang @${RULES.papanPanjang} m)`,
      ...(a.lux ? [`💡 Cahaya ruang inap (simulasi): maks ${luxTxt(a.lux.maxInap)}`] : []),
      `🔊 Tweeter inap ${a.twinapN} · tarik ${a.twtarikN} · channel ampli ${a.channels}`,
      ...(a.kabelM ? [`🔌 Kabel tweeter ±${fmt(a.kabelM)} m · klem kabel ±${fmt(a.klemN)} (tiap 10 cm)`] : []),
      ...((() => { try { const r = rabRows(A.model, a, cableInfo(A.model)); return r.total ? [`💰 RAB perlengkapan ±Rp ${fmt(r.total)} (perkiraan)`] : []; } catch { return []; } })()),
      `🌬️ LMB ${a.lmbN} · Menara ${a.menaraN ? 'ada' : 'tidak'} · Hexagonal ${a.hexaN} · Ventilasi ${a.ventN} · Kolam ${a.kolamN}`,
      ...(m.survey ? [`🔎 Pengamatan: ${surveyText(m.survey)}`] : []),
      `⭐ Skor kelayakan: ${a.score}/100`,
      ...a.notes.filter(n => n.lvl !== 'ok').slice(0, 3).map(n => `• ${n.txt}`),
      ...(note ? [`📝 Catatan: ${note}`] : []),
      '', `🔗 Link desain: ${buildShareLink(m)}`, '', 'Mohon dikirimkan hasil desain lengkapnya ke WhatsApp saya. Terima kasih.',
    ];
    window.open(`https://api.whatsapp.com/send?phone=${WA_NUMBER}&text=${encodeURIComponent(lines.join('\n'))}`, '_blank', 'noopener');
    try { window.dataLayer?.push({ event: 'planner_finish', size: `${m.w}x${m.h}`, floors: m.floors.length, score: a.score, mode: m.survey ? 'pengamatan' : 'manual' }); } catch {}
  };
}

// ---------- ekspor PDF multi-lembar (centang lembar yang diikutkan) ----------
export async function dlgPDF() {
  const { LEMBAR } = await import('./planner-pdf.js');
  openDlg('Ekspor PDF — pilih lembar',
    `<p class="lead">Setiap lembar berisi gambaran semua lantai untuk satu tema, lengkap dengan penjelasan & legenda. Centang yang mau diikutkan ke PDF.</p>
     <div class="pdfl">${LEMBAR.map(([k, nm]) => `<label class="chk"><input type="checkbox" data-pk="${k}" checked> ${nm}</label>`).join('')}</div>
     <div class="acts"><button type="button" class="mini" id="pdAll">Centang semua</button><button type="button" class="mini" id="pdNone">Kosongkan</button></div>
     <p class="tip">Lembar pencahayaan, dB, dan kenyamanan memakai pengaturan simulasi saat ini (jam, arah hadap, langit). Foto satelit & sketsa tangan tidak ikut ke PDF.</p>`,
    `<button type="button" class="pl-btn" id="pdBatal">Batal</button><button type="button" class="pl-btn pl-blue" id="pdGo">Buat PDF</button>`, 'mid');
  $('#pdBatal').onclick = () => dlg.close();
  $('#pdAll').onclick = () => dlg.querySelectorAll('[data-pk]').forEach(i => { i.checked = true; });
  $('#pdNone').onclick = () => dlg.querySelectorAll('[data-pk]').forEach(i => { i.checked = false; });
  $('#pdGo').onclick = async () => {
    const keys = [...dlg.querySelectorAll('[data-pk]')].filter(i => i.checked).map(i => i.dataset.pk);
    if (!keys.length) { A.hint('Centang minimal satu lembar.'); return; }
    const btn = $('#pdGo'); btn.disabled = true; $('#pdBatal').disabled = true;
    try {
      const m = A.model;
      const img3d = keys.includes('lengkap') ? (await A.load3D()).snapshotSheet(m, 1280, 960) : null;
      const { buildPDF } = await import('./planner-pdf.js');
      const blob = await buildPDF(m, keys, img3d, t => { btn.textContent = t; });
      const url = URL.createObjectURL(blob), el = document.createElement('a');
      el.href = url; el.download = `Desain-RBW-${(m.name || 'rumah-walet').replace(/[^\w-]+/g, '-')}-${keys.length}lembar.pdf`;
      document.body.append(el); el.click(); el.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      btn.textContent = `PDF ${keys.length} lembar terunduh ✓`;
      setTimeout(() => dlg.close(), 1500);
    } catch (e) { console.error('PDF', e); btn.textContent = 'Gagal — coba lagi'; btn.disabled = false; $('#pdBatal').disabled = false; }
  };
}

// Unduh lembar desain (denah semua lantai + 3D + ringkasan) sebagai PDF satu halaman.
export async function downloadPDF(btn) {
  const t0 = btn?.textContent; if (btn) { btn.disabled = true; btn.textContent = 'Menyiapkan PDF…'; }
  try {
    const m = A.model, three = await A.load3D(), img3d = three.snapshotSheet(m, 1280, 960);
    const { makeSheetCanvas, canvasPDF } = await import('./planner-export.js');
    const cv = await makeSheetCanvas(m, A.analyze(), img3d);
    const url = URL.createObjectURL(canvasPDF(cv));
    const el = document.createElement('a');
    el.href = url; el.download = `Desain-RBW-${(m.name || 'rumah-walet').replace(/[^\w-]+/g, '-')}-${m.w}x${m.h}-${m.floors.length}lt.pdf`;
    document.body.append(el); el.click(); el.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    if (btn) btn.textContent = 'PDF terunduh ✓';
  } catch (e) { console.error('PDF', e); if (btn) btn.textContent = 'Gagal membuat PDF'; }
  finally { if (btn) setTimeout(() => { btn.disabled = false; btn.textContent = t0; }, 2500); }
}

// ---------- login & folder proyek (gerbang sisi-klien: kredensial tetap terlihat di kode — bukan keamanan server,
// hanya membatasi akses kasual sesuai permintaan pemilik; data proyek tersimpan di localStorage perangkat) ----------
const LOGIN = { u: 'admin', p: 'admin123' };
export const isAuthed = () => { try { return localStorage.getItem('waletPlanner.login') === '1'; } catch { return false; } };
export function dlgLogin(onOk) {
  openDlg('Masuk Walet Planner',
    `<p class="lead">Halaman desain ini khusus pengguna terdaftar. Masuk untuk membuka editor dan folder proyek Anda.</p>
     <label for="lgU">Username</label><input id="lgU" autocomplete="username" placeholder="username">
     <label for="lgP">Password</label><input id="lgP" type="password" autocomplete="current-password" placeholder="password">
     <p class="err" id="lgErr" hidden>Username atau password salah.</p>`,
    `<button type="button" class="pl-btn pl-primary" id="lgIn">Masuk</button>`);
  $('#dClose').style.display = 'none';
  dlg.oncancel = e => e.preventDefault();   // Esc tidak menutup sebelum berhasil masuk
  const masuk = () => {
    if ($('#lgU').value.trim() === LOGIN.u && $('#lgP').value === LOGIN.p) {
      try { localStorage.setItem('waletPlanner.login', '1'); } catch {}
      dlg.oncancel = null; dlg.close(); onOk?.();
    } else { $('#lgErr').hidden = false; $('#lgP').value = ''; $('#lgP').focus(); }
  };
  $('#lgIn').onclick = masuk;
  [$('#lgU'), $('#lgP')].forEach(i => i.addEventListener('keydown', e => { if (e.key === 'Enter') masuk(); }));
  $('#lgU').focus();
}
const projList = () => { try { const l = JSON.parse(localStorage.getItem('waletPlanner.projects')); return Array.isArray(l) ? l : []; } catch { return []; } };
const projPut = l => { try { localStorage.setItem('waletPlanner.projects', JSON.stringify(l.slice(0, 30))); return true; } catch { return false; } };
export function dlgProjects() {
  const render = () => {
    const m = A.model, list = projList().sort((a, b) => b.up - a.up);
    openDlg('Folder proyek',
      `<p class="lead">Simpan beberapa desain di perangkat ini, buka kembali, atau hapus. Untuk dibagikan / dibuka di perangkat lain, tetap pakai "Salin link desain".</p>
       <div class="acts"><button type="button" class="pl-btn pl-blue" id="pjSave">${icon('plan', 14)} Simpan proyek aktif</button>
        <button type="button" class="pl-btn" id="pjNew">${icon('plus', 14)} Proyek baru</button>
        <button type="button" class="pl-btn" id="pjOut" style="margin-left:auto" title="Keluar akun — halaman meminta login lagi">Keluar akun</button></div>
       ${list.length ? `<table class="pl-leg pjt">${list.map(p => `<tr><td><b>${esc(p.nm)}</b><br><small>${fmt(p.w)}×${fmt(p.h)} m · ${p.n} lantai${p.id === m.id ? ' · sedang dibuka' : ''} · ${new Date(p.up).toLocaleString('id-ID', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</small></td>
         <td style="white-space:nowrap;text-align:right"><button type="button" class="mini" data-buka="${esc(p.id)}">Buka</button> <button type="button" class="mini" data-hapus="${esc(p.id)}">Hapus</button></td></tr>`).join('')}</table>`
        : '<p class="tip">Folder masih kosong — tekan "Simpan proyek aktif" untuk menyimpan desain yang sedang terbuka.</p>'}`,
      `<button type="button" class="pl-btn pl-primary" id="pjClose">Tutup</button>`, 'mid');
    $('#pjClose').onclick = () => dlg.close();
    $('#pjSave').onclick = () => {
      const nm = prompt('Nama proyek:', m.name || 'Rumah Walet'); if (nm === null) return;
      m.name = nm.trim().slice(0, 80) || m.name; A.save();
      const l = projList().filter(p => p.id !== m.id);
      l.unshift({ id: m.id, nm: m.name || 'Rumah Walet', up: Date.now(), w: m.w, h: m.h, n: m.floors.length, m: JSON.parse(JSON.stringify(m)) });
      if (!projPut(l)) alert('Penyimpanan perangkat penuh — hapus proyek lama dulu.');
      A.renderAll(); render();
    };
    $('#pjNew').onclick = () => dlgStart(false);
    $('#pjOut').onclick = () => { if (!confirm('Keluar akun? Halaman akan meminta login lagi.')) return; try { localStorage.removeItem('waletPlanner.login'); } catch {} location.reload(); };
    dlg.querySelectorAll('[data-buka]').forEach(b => b.onclick = () => {
      const p = projList().find(q => q.id === b.dataset.buka); if (!p) return;
      if (!confirm(`Buka "${p.nm}"? Desain yang sedang terbuka diganti — simpan dulu ke folder bila perlu.`)) return;
      dlg.close(); A.setModel(JSON.parse(JSON.stringify(p.m))); A.hint(`Proyek "${p.nm}" dibuka.`);
    });
    dlg.querySelectorAll('[data-hapus]').forEach(b => b.onclick = () => {
      const p = projList().find(q => q.id === b.dataset.hapus); if (!p) return;
      if (!confirm(`Hapus proyek "${p.nm}" dari perangkat ini?`)) return;
      projPut(projList().filter(q => q.id !== p.id)); render();
    });
  };
  render();
}

// ---------- link desain (seluruh isi desain di-encode di URL) ----------
// v4: kode tipe 1 huruf, koordinat dalam cm, dan tweeter inap yang persis pola standar cukup ditandai per ruang
// (dibuat ulang saat link dibuka) — link gedung besar jadi jauh lebih pendek untuk WhatsApp.
const CODE = { void: 'V', jalur: 'J', inap: 'I', audio: 'A', lmb: 'L', lar: 'R', larj: 'Q', vent: 'E', twinap: 'T', twtarik: 'K', kolam: 'P', menara: 'M', tangga: 'G', pintu: 'D', hexa: 'X', sarang: 'N' };
const DECODE = Object.fromEntries(Object.entries(CODE).map(([k, v]) => [v, k]));
const FIXED = new Set(['twinap', 'twtarik']);
const cm = v => Math.round(v * 100);
export function buildShareLink(m) {
  const encF = f => {
    const der = derive(m, f), skip = new Set(), auto = new Set();
    der.zones.forEach(z => {   // zona inap yang tweeter-nya persis pola standar (semua ruang hasil pembagian sekat)
      const pts = zonePattern(der, z.id), tws = f.items.filter(t => t.t === 'twinap' && inRect(center(t), z));
      const same = pts.length && tws.length === pts.length && tws.every(t => !Number.isFinite(t.dir) && !t.locked && t.w === t.h && t.w <= 0.3
        && pts.some(p => Math.abs(p.x - center(t).x) < 0.02 && Math.abs(p.y - center(t).y) < 0.02));
      if (same) { auto.add(z.id); tws.forEach(t => skip.add(t.id)); }
    });
    const kept = f.items.filter(it => !skip.has(it.id)), idx = new Map(kept.map((it, i) => [it.id, i]));
    const items = kept.map(it => {
      const T = TYPES[it.t], ex = {};
      if (it.gap != null) ex.g = it.gap; if (it.tcm != null) ex.c = it.tcm; if (Number.isFinite(it.dir)) ex.d = Math.round(it.dir);
      if (it.role) ex.r = it.role; if (it.o) ex.o = it.o; if (it.mt != null) ex.m = it.mt; if (auto.has(it.id)) ex.a = 1;
      if (it.st === 'kotak') ex.s = 'k'; if (it.locked) ex.k = 1;
      if (it.ns) ex.n = it.ns[0];                                                       // jenis titik sarang (b/l/p/j)
      if (it.lt) ex.l = it.lt[0]; if (it.to && idx.has(it.to)) ex.t = idx.get(it.to);   // fungsi LAR; tweeter tarik tujuan manual (indeks)
      const a = [CODE[it.t], cm(it.x), cm(it.y)], hasEx = Object.keys(ex).length > 0;
      if (hasEx || !(FIXED.has(it.t) && it.w === T.w && it.h === T.h)) a.push(cm(it.w), cm(it.h));
      if (hasEx) a.push(ex);
      return a;
    });
    return {
      i: items, w: f.walls.map(s => { const fl = (s.locked ? 1 : 0) | (s.bahan === 'bata' ? 2 : 0); return [cm(s.x1), cm(s.y1), cm(s.x2), cm(s.y2), s.jenis === 'gantung' ? 1 : 0, ...(fl ? [fl] : [])]; }),
      ...(f.fw != null ? { r: [f.fx, f.fy, f.fw, f.fh] } : {}), ...(f.ht != null ? { t: f.ht } : {}),
    };
  }, floors = m.floors.map(encF);
  const tb = m.siripTebal || RULES.siripTebalCm, lb = m.siripLebar || RULES.siripLebarCm;
  const adaRab = m.rab && (Object.keys(m.rab.h || {}).length || Object.keys(m.rab.k || {}).length || (m.rab.x || []).length);
  const slim = { v: 6, n: m.name, o: m.owner, c: m.city, w: m.w, h: m.h, fh: m.floorH, k: m.kolom, st: m.showStruktur === false ? 0 : 1, s: m.survey || null, f: floors,
    ...(m.menara ? { mn: encF(m.menara) } : {}), ...(m.sim && Object.keys(m.sim).length ? { sm: m.sim } : {}),
    ...(m.audio ? { au: m.audio } : {}), ...(m.kabel?.ch?.length ? { kb: { ch: m.kabel.ch } } : {}), ...(adaRab ? { rb: m.rab } : {}),
    ...(tb !== RULES.siripTebalCm || lb !== RULES.siripLebarCm ? { sp: [tb, lb] } : {}) };
  const json = JSON.stringify(slim);
  const enc = window.LZString ? LZString.compressToEncodedURIComponent(json) : encodeURIComponent(btoa(unescape(encodeURIComponent(json))));
  return `${location.origin}/desain/#d=${enc}`;
}
// Link bisa dibuat siapa saja → setiap nilai dipaksa menjadi angka/teks/pilihan yang valid sebelum dipakai.
export function parseShare(hash) {
  const mm = String(hash || '').match(/#d=(.+)/); if (!mm) return null;
  try {
    const raw = window.LZString ? LZString.decompressFromEncodedURIComponent(mm[1]) : decodeURIComponent(escape(atob(decodeURIComponent(mm[1]))));
    const s = JSON.parse(raw);
    if (!s || ![2, 3, 4, 5, 6].includes(s.v)) throw new Error('versi link tidak dikenal');
    const num = (v, lo, hi, dflt = lo) => { const n = +v; return Number.isFinite(n) ? clamp(n, lo, hi) : dflt; };
    const txt = v => String(v ?? '').slice(0, 80);
    const sc = v => (s.v >= 4 ? +v / 100 : +v);   // v4: koordinat dalam cm
    const typeOf = c => (typeof c !== 'string' ? null : s.v >= 4 ? (own(DECODE, c) ? DECODE[c] : null) : own(TYPES, c) ? c : null);
    const W = num(s.w, 2, 40, 4), H = num(s.h, 2, 60, 12);
    const survey = s.s && typeof s.s === 'object'
      ? Object.fromEntries(Object.keys(SURVEY).map(k => [k, SURVEY[k].opts.some(([v]) => v === s.s[k]) ? s.s[k] : SURVEY_DEFAULT[k]])) : null;
    const item = a => {
      const t = typeOf(a[0]), T = TYPES[t], ex = a.slice(3).find(v => v && typeof v === 'object') || {}, hasWH = typeof a[3] === 'number';
      const dw = s.v < 5 && FIXED.has(t) ? 0.25 : T.w, dh = s.v < 5 && FIXED.has(t) ? 0.25 : T.h;   // link lama: tweeter 25 cm
      const it = { id: uid(), t, x: num(sc(a[1]), -8, W + 8), y: num(sc(a[2]), -8, H + 8), w: hasWH ? num(sc(a[3]), 0.05, W) : dw, h: hasWH ? num(sc(a[4]), 0.05, H) : dh };   // ruang audio boleh di luar gedung
      if (t === 'inap' && ex.a) it._auto = 1;
      if (s.v === 2 && typeof a[5] === 'number') { if (t === 'lmb') it.tcm = num(a[5], 10, 200); else it.gap = num(a[5], 0.1, 1); }
      if (ex.g != null) it.gap = num(ex.g, 0.1, 1);
      if (ex.c != null) it.tcm = num(ex.c, 10, 200);
      if (ex.d != null) it.dir = num(ex.d, 0, 360);
      if (typeof ex.r === 'string' && own(ROLE_ORDER, ex.r)) it.role = ex.r;
      if (ex.o === 'x' || ex.o === 'y') it.o = ex.o;
      if (ex.m != null) it.mt = num(ex.m, 1, 6);
      if (ex.s === 'k' && (t === 'inap' || t === 'jalur')) it.st = 'kotak';
      if (ex.k) it.locked = true;
      if (t === 'sarang') { it.ns = { b: 'baru', l: 'lama', p: 'polesan', j: 'jadi' }[ex.n] || 'jadi'; }
      if (typeof ex.l === 'string' && (t === 'lar' || t === 'larj')) { const lt = { i: 'inap', j: 'jalur', v: 'void' }[ex.l]; if (lt) it.lt = lt; }
      if (Number.isInteger(ex.t) && t === 'twtarik') it._to = ex.t;
      return it;
    };
    const buildItems = f => {   // indeks tujuan tweeter tarik mengacu ke urutan di link
      const built = (Array.isArray(f?.i) ? f.i : []).slice(0, 1500).map(a => (Array.isArray(a) && typeOf(a[0]) && TYPES[typeOf(a[0])].kind !== 'wall' ? item(a) : null));
      built.forEach(it => { if (!it) return; if (Number.isInteger(it._to)) { const tg = built[it._to]; if (tg && tg !== it && tg.t === 'twtarik') it.to = tg.id; } delete it._to; });
      return built.filter(Boolean);
    };
    const decF = (f, name) => ({
      name, items: buildItems(f),
      walls: (Array.isArray(f?.w) ? f.w : []).filter(Array.isArray).slice(0, 300)
        .map(a => { const fl = +a[5] || 0; return { id: uid(), x1: num(sc(a[0]), 0, W), y1: num(sc(a[1]), 0, H), x2: num(sc(a[2]), 0, W), y2: num(sc(a[3]), 0, H), jenis: a[4] ? 'gantung' : 'penuh', ...(fl & 1 ? { locked: true } : {}), ...(fl & 2 ? { bahan: 'bata' } : {}) }; }),
      ...(Array.isArray(f?.r) && f.r.length === 4 ? (() => { const fw = num(f.r[2], 1, W, W), fh = num(f.r[3], 1, H, H); return { fw, fh, fx: num(f.r[0], 0, W - fw), fy: num(f.r[1], 0, H - fh) }; })() : {}),
      ...(f?.t != null ? { ht: num(f.t, 1.5, 6, 2) } : {}),
    });
    const model = {
      id: uid(), name: txt(s.n), owner: txt(s.o), city: txt(s.c), w: W, h: H, floorH: num(s.fh, 1.8, 4, 2),
      kolom: [3, 4, 5, 6].includes(+s.k) ? +s.k : RULES.kolom, showStruktur: s.st !== 0, created: Date.now(), ...(survey ? { survey } : {}),
      ...(Array.isArray(s.sp) ? { siripTebal: num(s.sp[0], 1, 10, RULES.siripTebalCm), siripLebar: num(s.sp[1], 5, 40, RULES.siripLebarCm) } : {}),
      ...(s.lx != null ? { luxLuar: num(s.lx, 1000, 120000, RULES.cahayaLuar) } : {}),
      floors: (Array.isArray(s.f) ? s.f : []).slice(0, 8).map((f, i) => decF(f, `Lantai ${i + 1}`)),
    };
    if (!model.floors.length) throw new Error('link tanpa lantai');
    if (s.mn && typeof s.mn === 'object') model.menara = { ...decF(s.mn, 'Menara'), menara: true };
    if (s.sm && typeof s.sm === 'object') {   // pengaturan matahari, waktu & udara
      const o = s.sm, r = {};
      if (o.hadap != null) r.hadap = num(o.hadap, 0, 359, 0);
      if (o.jam != null) r.jam = num(o.jam, 0, 24, 13);
      if (o.bulan != null) r.bulan = Math.round(num(o.bulan, 0, 12, 0));
      if (o.lintang != null) r.lintang = num(o.lintang, -12, 8, -6);
      if (o.suhu != null) r.suhu = num(o.suhu, 15, 40, 28);
      if (o.rh != null) r.rh = num(o.rh, 30, 100, 85);
      if (o.anginKec != null) r.anginKec = num(o.anginKec, 0, 20, 2);
      if (o.walet != null) r.walet = num(o.walet, 3, 60, 20);
      if (LANGIT.some(([k]) => k === o.langit)) r.langit = o.langit;
      if (SISI.some(([k]) => k === o.anginDari)) r.anginDari = o.anginDari;
      if (Object.keys(r).length) model.sim = r;
    }
    // pengaturan ruang audio, channel kabel & RAB (semua nilai dipaksa valid)
    if (s.au && typeof s.au === 'object') {
      const jenisOk = new Set([...AMPLI.map(a => a[0]), ...AUDIO_ALAT.map(a => a[0])]);
      const items = (Array.isArray(s.au.items) ? s.au.items : []).slice(0, 24)
        .map(x => (jenisOk.has(x?.t) ? { t: x.t, n: num(x.n, 0, 20, 1), ...(AMPLI.some(a => a[0] === x.t) ? { ch: num(x.ch, 1, 32, 4) } : {}) } : null)).filter(Boolean);
      const jd = {};
      ['panggil', 'tarik', 'inap'].forEach(k => { const v = s.au.jadwal?.[k]; if (Array.isArray(v)) jd[k] = [num(v[0], 0, 24, 5), num(v[1], 0, 24, 19)]; });
      model.audio = { ...(items.length ? { items } : {}), ...(Object.keys(jd).length ? { jadwal: jd } : {}) };
    }
    if (Array.isArray(s.kb?.ch) && s.kb.ch.length) model.kabel = { ch: s.kb.ch.slice(0, 24).map(c => ({
      t: ['twinap', 'twtarik', 'hexa'].includes(c?.t) ? c.t : 'twinap',
      f: Array.isArray(c?.f) ? [Math.round(num(c.f[0], 0, 9, 0)), Math.round(num(c.f[1], 0, 9, 0))].sort((a, b) => a - b) : Math.round(num(c?.f, -1, 9, -1)),
      n: Math.round(num(c?.n, 1, 6, 1)),
      nm: txt(c?.nm), vol: Math.round(num(c?.vol, 40, 110, 70)), fd: txt(c?.fd), ket: String(c?.ket ?? '').slice(0, 160), ...(c?.on === false ? { on: false } : {}) })) };
    if (s.rb && typeof s.rb === 'object') {
      const h = {}, k = {};
      Object.entries(s.rb.h || {}).slice(0, 60).forEach(([a, b]) => { if (/^[\w:.-]{1,24}$/.test(a) && Number.isFinite(+b)) h[a] = Math.max(0, Math.min(1e9, Math.round(+b))); });
      Object.entries(s.rb.k || {}).slice(0, 60).forEach(([a, b]) => { if (/^[\w:.-]{1,24}$/.test(a)) k[a] = String(b ?? '').slice(0, 120); });
      const x = (Array.isArray(s.rb.x) ? s.rb.x : []).slice(0, 30).map(r => ({ nm: String(r?.nm ?? '').slice(0, 80), jml: num(r?.jml, 0, 1e6, 0), sat: String(r?.sat ?? 'bh').slice(0, 10), hrg: Math.max(0, Math.min(1e9, Math.round(+r?.hrg || 0))), ket: String(r?.ket ?? '').slice(0, 120) }));
      model.rab = { h, k, x };
    }
    model.floors.forEach(f => {   // buat ulang tweeter inap berpola standar untuk zona yang ditandai (semua ruang di dalamnya)
      const flagged = f.items.filter(z => z._auto); if (!flagged.length) return;
      const der = derive(model, f);
      flagged.forEach(z => {
        delete z._auto;
        zonePattern(der, z.id).forEach(p => f.items.push({ id: uid(), t: 'twinap', x: Math.round((p.x - TW / 2) * 1000) / 1000, y: Math.round((p.y - TW / 2) * 1000) / 1000, w: TW, h: TW }));
      });
    });
    return model;
  } catch (e) { console.warn('link desain tidak valid', e); return null; }
}

// ---------- denah dari gambar tangan ----------
// Pengunjung: foto sketsa jadi latar untuk dijiplak, atau dikirim ke tim lewat WhatsApp.
// Tim (mode admin): foto dikonversi otomatis oleh AI (Cloudflare Worker "sketsa-ai"), dicek di pratinjau, lalu diterapkan.
const legendTable = () => `<table class="pl-leg">${SK.LEGENDA.map(([a, b]) => `<tr><td>${a}</td><td>${b}</td></tr>`).join('')}</table>`;
export function dlgLegend() {
  openDlg('Keterangan tulisan pada sketsa',
    `<p class="lead">Tulis keterangan ini di sketsa denah (huruf kapital lebih mudah dibaca), beserta ukuran gedung dan sisi depan.</p>${legendTable()}`,
    `<button type="button" class="pl-btn pl-primary" id="lgOk">Mengerti</button>`);
  $('#lgOk').onclick = () => dlg.close();
}
export function dlgSketch() {
  let pending = null, file = null;
  const floorOpts = n => Array.from({ length: n }, (_, i) => `<option value="${i}">Lantai ${i + 1}${n > 1 && i === n - 1 ? ' (teratas)' : ''}</option>`).join('');
  openDlg('Denah dari gambar tangan',
    `<p class="lead">Foto sketsa denah tampak atas. Beri tulisan keterangan seperti <b>LMB</b>, <b>VOID</b>, <b>LAR</b>, <b>INAP</b>, <b>JALUR</b>, ukuran gedung, dan sisi <b>DEPAN</b>.</p>
     <label class="upl"><input type="file" id="skIn" accept="image/*"><span id="skTxt">${icon('photo', 20)} Pilih atau ambil foto sketsa</span><img id="skPrev" alt="Pratinjau foto sketsa" hidden></label>
     <p class="err" id="skErr" hidden></p>
     ${sizeFields({ name: '', city: '', w: 4, h: 12, floorH: RULES.lantaiTinggi, n: 4 })}
     <label for="fSkF">Sketsa ini untuk</label><select id="fSkF">${floorOpts(4)}</select>
     <details class="leg"><summary>Keterangan tulisan yang dikenali</summary>${legendTable()}</details>
     ${admin ? '' : '<p class="tip">Ingin dirapikan tim GedungWalet.com? Tekan "Kirim ke tim" — sketsa Anda kami ubah menjadi denah lengkap dan hasilnya dikirim lewat WhatsApp.</p>'}`,
    `<button type="button" class="pl-btn" id="dBack">Kembali</button>${admin ? '' : `<button type="button" class="pl-btn" id="skWA">${icon('wa', 16)} Kirim ke tim</button>`}
     <button type="button" class="pl-btn${admin ? '' : ' pl-primary'}" id="skTrace">Jiplak manual</button>${admin ? `<button type="button" class="pl-btn pl-blue" id="skAI">${icon('spark', 16)} Konversi otomatis (AI)</button>` : ''}`, 'mid');
  bindSize();
  const err = t => { $('#skErr').textContent = t; $('#skErr').hidden = !t; };
  $('#fN').addEventListener('change', () => { const n = +$('#fN').value, v = Math.min(+$('#fSkF').value, n - 1); $('#fSkF').innerHTML = floorOpts(n); $('#fSkF').value = String(v); });
  $('#skIn').onchange = async () => {
    const f = $('#skIn').files[0]; if (!f) return;
    err(''); $('#skTxt').textContent = 'Memuat foto…';
    try {
      pending = await SK.loadImageFile(f); file = f;
      $('#skPrev').src = pending.src; $('#skPrev').hidden = false; $('#skTxt').innerHTML = `${icon('photo', 18)} Ganti foto`;
    } catch (e) { err(e.message); $('#skTxt').innerHTML = `${icon('photo', 20)} Pilih atau ambil foto sketsa`; }
  };
  const start = () => {   // proyek baru (denah kosong) + foto sketsa sebagai latar lantai terpilih
    if (!pending) { err('Pilih foto sketsa dulu.'); return null; }
    const o = readSize(); if (!o) return null;
    const i = clamp(+$('#fSkF').value || 0, 0, o.floors - 1), { model } = A.newModel({ ...o, auto: false });
    A.setModel(model);
    SK.setSketch(model, i, SK.fitToFloor(pending, floorRect(model, model.floors[i])));
    A.setCur(i);
    return i;
  };
  $('#dBack').onclick = () => dlgStart(false);
  $('#skTrace').onclick = () => {
    if (start() == null) return;
    dlg.close(); A.hint('Foto sketsa jadi latar — klik "Kalibrasi 2 titik" di panel kanan agar pas, lalu jiplak dengan alat sekat & katalog.', 9000);
  };
  const ai = $('#skAI'); if (ai) ai.onclick = () => { const i = start(); if (i != null) runAI(i); };
  const wa = $('#skWA'); if (wa) wa.onclick = () => { const o = readSize(); if (o) sendSketchWA({ ...o, n: o.floors }, file); };
}
function sendSketchWA(o, file) {
  const lines = [
    'Halo GedungWalet.com, saya ingin dibuatkan denah rumah walet dari sketsa gambar tangan saya.', '',
    `🏠 Proyek: ${o.name || 'Rumah Walet'}`, `📍 Lokasi: ${o.city || '-'}`,
    `📐 Ukuran: ${fmt(o.w)} × ${fmt(o.h)} m, ${o.n} lantai${o.floor ? ` (sketsa ${o.floor})` : ''}`,
    ...(o.link ? ['', `🔗 Jiplakan saya sejauh ini: ${o.link}`] : []),
    '', 'Foto sketsa saya kirim setelah pesan ini. Mohon dibantu dibuatkan denah lengkapnya. Terima kasih.',
  ];
  window.open(`https://api.whatsapp.com/send?phone=${WA_NUMBER}&text=${encodeURIComponent(lines.join('\n'))}`, '_blank', 'noopener');
  try { window.dataLayer?.push({ event: 'planner_sketch_wa', size: `${o.w}x${o.h}`, floors: o.n }); } catch {}
  const share = !!(file && navigator.canShare?.({ files: [file] }));
  openDlg('Kirim sketsa ke tim',
    `<p class="lead">WhatsApp sudah dibuka dengan pesan untuk tim GedungWalet.com. Lampirkan foto sketsa Anda di chat tersebut (ikon 📎 → Galeri atau Dokumen).</p>
     ${share ? '<p class="tip">Di HP, foto sketsa juga bisa langsung dibagikan ke WhatsApp dengan tombol di bawah.</p>' : ''}`,
    `${share ? '<button type="button" class="pl-btn" id="skShare">Bagikan foto sketsa…</button>' : ''}<button type="button" class="pl-btn pl-primary" id="skDone">Selesai</button>`);
  const sh = $('#skShare');
  if (sh) sh.onclick = async () => { try { await navigator.share({ files: [file], title: 'Sketsa denah rumah walet' }); } catch {} };
  $('#skDone').onclick = () => dlg.close();
}
export function sketchWA(i) {
  const m = A.model, sk = SK.getSketch(m, i), drawn = m.floors.some(f => f.items.length || f.walls.length);
  sendSketchWA({ name: m.name, city: m.city, w: m.w, h: m.h, n: m.floors.length, floor: m.floors[i].name, link: drawn ? buildShareLink(m) : '' }, sk ? SK.sketchFile(sk) : null);
}
// Kode tim & alamat Worker disimpan per perangkat (localStorage), tidak pernah di link desain.
export function dlgTeam(next) {
  openDlg('Kode tim — konversi AI',
    `<p class="lead">Khusus tim GedungWalet.com. Kode tim dan alamat layanan hanya disimpan di perangkat ini.</p>
     <label for="tmUrl">Alamat layanan AI (Cloudflare Worker)</label><input id="tmUrl" type="url" placeholder="https://sketsa-ai.nama-akun.workers.dev" value="${esc(SK.aiUrl())}">
     <label for="tmKey">Kode tim</label><input id="tmKey" type="password" autocomplete="off" value="${esc(SK.teamKey())}">
     <p class="tip" id="tmMsg"></p>`,
    `<button type="button" class="pl-btn" id="tmCancel">Batal</button><button type="button" class="pl-btn" id="tmTest">Tes koneksi</button><button type="button" class="pl-btn pl-blue" id="tmSave">Simpan</button>`);
  const msg = (t, ok) => { const e = $('#tmMsg'); e.textContent = t; e.className = ok ? 'tip okc' : 'err'; };
  const url = () => $('#tmUrl').value.trim().replace(/\/+$/, '');
  $('#tmCancel').onclick = () => dlg.close();
  $('#tmTest').onclick = async () => {
    msg('Menghubungi layanan…', true);
    try { await SK.checkTeam(url(), $('#tmKey').value.trim()); msg('Terhubung ✓ — kode tim benar.', true); } catch (e) { msg(e.message, false); }
  };
  $('#tmSave').onclick = () => {
    const u = url(), key = $('#tmKey').value.trim();
    if (u && !/^https?:\/\//i.test(u)) { msg('Alamat harus diawali https://', false); return; }
    SK.setTeam(key, u); A.hint('Kode tim disimpan di perangkat ini.');
    if (next && key && SK.aiUrl()) next(); else dlg.close();
  };
}
let aiCtrl = null;
export async function runAI(i) {
  const m = A.model, fl = m.floors[i], sk = SK.getSketch(m, i);
  if (!sk) { A.hint('Unggah foto sketsa dulu.'); return; }
  if (!SK.teamKey() || !SK.aiUrl()) { dlgTeam(() => runAI(i)); return; }
  const F = floorRect(m, fl), ctrl = new AbortController();
  aiCtrl?.abort(); aiCtrl = ctrl;
  openDlg('Konversi sketsa (AI)',
    `<div class="aiwait"><span class="spin"></span><div><b>AI sedang membaca sketsa ${fl.name}…</b><br><span class="tip">Biasanya 30–90 detik. Jangan tutup halaman ini.</span></div></div>`,
    `<button type="button" class="pl-btn" id="aiStop">Batal</button>`);
  $('#aiStop').onclick = () => dlg.close();
  dlg.addEventListener('close', () => ctrl.abort(), { once: true });
  try {
    const res = await SK.requestAI(sk, { lebar: F.w, panjang: F.h, lantai: i + 1, jumlah_lantai: m.floors.length }, ctrl.signal);
    if (!ctrl.signal.aborted) dlgReview(i, res);
  } catch (e) {
    if (ctrl.signal.aborted) return;
    openDlg('Konversi sketsa gagal', `<p class="err">${esc(e.message)}</p><p class="tip">Periksa kode tim dan alamat layanan, atau jiplak manual dengan foto sebagai latar.</p>`,
      `<button type="button" class="pl-btn" id="aiKey">${icon('key', 14)} Kode tim</button><button type="button" class="pl-btn" id="aiClose">Tutup</button><button type="button" class="pl-btn pl-blue" id="aiRetry">Coba lagi</button>`);
    $('#aiKey').onclick = () => dlgTeam(() => runAI(i)); $('#aiClose').onclick = () => dlg.close(); $('#aiRetry').onclick = () => runAI(i);
  }
}
// Pratinjau hasil AI di atas foto sketsa; sisi depan, ukuran, dan tweeter inap bisa disesuaikan tanpa memanggil AI lagi.
function dlgReview(i, res) {
  const m = A.model, fl = m.floors[i], sk = SK.getSketch(m, i), plan = res.plan || {};
  if (plan.terbaca === false) {
    openDlg('Sketsa belum terbaca', `<p class="lead">AI tidak menemukan denah yang jelas pada foto ini.</p><ul class="tips">${(Array.isArray(plan.catatan) ? plan.catatan : []).slice(0, 8).map(c => `<li>${esc(c)}</li>`).join('')}</ul>
      <p class="tip">Foto ulang tegak lurus dari atas dengan cahaya terang, atau jiplak manual.</p>`,
      `<button type="button" class="pl-btn" id="rvClose">Tutup</button><button type="button" class="pl-btn pl-blue" id="rvRetry">Coba lagi</button>`);
    $('#rvClose').onclick = () => dlg.close(); $('#rvRetry').onclick = () => runAI(i);
    return;
  }
  const full = isFull(m, fl), F0 = floorRect(m, fl);
  const st = { d: SK.DEPAN.some(([v]) => v === plan.depan) ? plan.depan : 'atas', size: false, tw: 'lengkapi', photo: !!sk, place: true };
  const build = () => {   // model sementara — desain belum diubah sampai "Terapkan"
    const tmp = JSON.parse(JSON.stringify(m)), tf = tmp.floors[i], hz = SK.sizeHint(plan, st.d);
    if (st.size && full && hz.w && hz.h) { tmp.w = hz.w; tmp.h = hz.h; }
    const r = SK.aiToFloor(plan, tmp, tf, st.d);
    tf.items = r.items; tf.walls = r.walls;
    if (st.tw !== 'sketsa') SK.lengkapiTwinap(tmp, tf, st.tw === 'semua');
    return { tmp, tf, r, hz };
  };
  const apply = () => {
    const hz = SK.sizeHint(plan, st.d);
    if (st.size && full && hz.w && hz.h) A.applyProject({ w: hz.w, h: hz.h });
    const m2 = A.model, f2 = m2.floors[i], r = SK.aiToFloor(plan, m2, f2, st.d), tf = { ...f2, items: r.items, walls: r.walls };
    if (st.tw !== 'sketsa') SK.lengkapiTwinap(m2, tf, st.tw === 'semua');
    if (sk && st.place) SK.setSketch(m2, i, { ...SK.placeByFrame(sk, plan, floorRect(m2, f2), st.d), show: true });
    dlg.close();
    A.replaceFloor(i, tf.items, tf.walls);
    A.hint('Denah dari sketsa diterapkan — periksa & revisi sekat, LAR, dan tweeter. Undo untuk membatalkan.', 8000);
  };
  const render = () => {
    const { tmp, tf, r, hz } = build(), F = floorRect(tmp, tf), s = Math.max(12, Math.min(560 / tmp.w, 420 / tmp.h));
    const diff = hz.w && hz.h && (Math.abs(hz.w - F0.w) > 0.25 || Math.abs(hz.h - F0.h) > 0.25);
    const photo = st.photo && sk ? { ...SK.placeByFrame(sk, plan, F, st.d), href: SK.sketchHref(sk), op: 0.4 } : null;
    const opt = (id, list, v) => `<select id="${id}">${list.map(([k, t]) => `<option value="${k}"${k === v ? ' selected' : ''}>${t}</option>`).join('')}</select>`;
    openDlg(`Hasil konversi — ${fl.name}`,
      `<p class="lead"><b>Terbaca:</b> ${esc(SK.summarize(tf.items, tf.walls))}.</p>
       <div class="rvopts">
         <label class="chk">Sisi depan pada foto ${opt('rvD', SK.DEPAN, st.d)}</label>
         <label class="chk">Tweeter inap ${opt('rvTw', [['lengkapi', 'Lengkapi ruang tanpa TI'], ['semua', 'Semua pola standar'], ['sketsa', 'Hanya dari sketsa']], st.tw)}</label>
         <label class="chk"><input type="checkbox" id="rvPh"${st.photo ? ' checked' : ''}${sk ? '' : ' disabled'}> Tumpuk dengan foto sketsa</label>
         <label class="chk"><input type="checkbox" id="rvPl"${st.place ? ' checked' : ''}${sk ? '' : ' disabled'}> Pasang foto sebagai latar di editor</label>
         ${diff && full ? `<label class="chk"><input type="checkbox" id="rvSz"${st.size ? ' checked' : ''}> Ubah ukuran gedung menjadi ${fmt(hz.w)} × ${fmt(hz.h)} m (tertulis di sketsa)</label>` : ''}
       </div>
       ${diff && !full ? `<p class="tip warnc">Sketsa menyebut ${fmt(hz.w)} × ${fmt(hz.h)} m, sedangkan ${fl.name} ${fmt(F0.w)} × ${fmt(F0.h)} m — sesuaikan di panel lantai bila perlu.</p>` : ''}
       <div class="rvfig">${floorSVG(tmp, i, s, { pad: 26, chain: true, struktur: false, pfx: 'rv', sketch: photo })}</div>
       ${r.warn.length ? `<ul class="tips">${r.warn.map(t => `<li>${esc(t)}</li>`).join('')}</ul>` : ''}
       <p class="tip">${fl.items.length || fl.walls.length ? `Isi ${fl.name} saat ini akan diganti (bisa dibatalkan dengan Undo). ` : ''}${res.usage ? `Biaya AI ± US$${SK.costUSD(res.usage).toFixed(2).replace('.', ',')} (${fmt(res.usage.input)} token masuk, ${fmt(res.usage.output)} token keluar).` : ''}</p>`,
      `<button type="button" class="pl-btn" id="rvCancel">Batal</button><button type="button" class="pl-btn" id="rvRetry">Baca ulang</button><button type="button" class="pl-btn pl-blue" id="rvOk">Terapkan ke ${fl.name}</button>`, 'mid');
    $('#rvD').onchange = e => { st.d = e.target.value; render(); };
    $('#rvTw').onchange = e => { st.tw = e.target.value; render(); };
    $('#rvPh').onchange = e => { st.photo = e.target.checked; render(); };
    $('#rvPl').onchange = e => { st.place = e.target.checked; };
    const sz = $('#rvSz'); if (sz) sz.onchange = e => { st.size = e.target.checked; render(); };
    $('#rvCancel').onclick = () => dlg.close();
    $('#rvRetry').onclick = () => runAI(i);
    $('#rvOk').onclick = apply;
  };
  render();
}

// ---------- tab "Ruang audio": channel + volume + flashdisk, perangkat (ampli dst), jadwal timer ----------
const AMPLI_KEYS = new Set(AMPLI.map(a => a[0]));
const audioOf = m => ({ items: (m.audio?.items || AUDIO_DEFAULT.items).map(x => ({ ...x })), jadwal: { ...AUDIO_DEFAULT.jadwal, ...(m.audio?.jadwal || {}) } });
export function dlgAudio() {
  const m = A.model, au = audioOf(m);
  // channel bekerja pada salinan; disimpan ke m.kabel.ch saat "Simpan"
  let ch = channels(m).map(c => ({ id: c.id, t: c.t, f: c.f, n: c.n, nm: c.nm, vol: c.vol, fd: c.fd || '', ket: c.ket || '', on: c.on !== false }));
  const su = SUARA[m.survey?.env || 'sawah'], tg = dbTarget(m.survey?.env || 'sawah');
  // pilihan lantai: semua, per lantai, gabungan 2 lantai (gedung kecil: 2 lantai cukup 1 channel), menara
  const fKey = v => (Array.isArray(v) ? v.join(':') : String(v));
  const fOpts = v => [[-1, 'Semua lantai'], ...m.floors.map((f, i) => [i, f.name]),
    ...m.floors.slice(0, -1).map((f, i) => [`${i}:${i + 1}`, `Lantai ${i + 1} + ${i + 2}`]),
    ...(m.menara ? [[m.floors.length, 'Menara']] : [])]
    .map(([k, t]) => `<option value="${k}"${fKey(v) === String(k) ? ' selected' : ''}>${t}</option>`).join('');
  const render = () => {
    let cab = null; try { cab = cableInfo({ ...m, kabel: { ch } }); } catch {}
    const lenOf = c => cab?.chs.find(q => q.nm === c.nm && q.t === c.t && q.f === c.f)?.len;
    const kapasitas = au.items.filter(i => AMPLI_KEYS.has(i.t)).reduce((s, i) => s + (i.n || 0) * (i.ch || 4), 0);
    const terpakai = ch.reduce((s, c) => s + c.n, 0);
    let no = 0;
    const chRows = ch.map((c, k) => {
      const amp = `Ch ${no + 1}${c.n > 1 ? `–${no + c.n}` : ''}`; no += c.n;
      return `<tr data-k="${k}">
        <td><label class="swx" title="Saklar cek tweeter — mati/hidupkan channel"><input type="checkbox" data-c="on"${c.on ? ' checked' : ''}><i></i></label></td>
        <td><input data-c="nm" value="${esc(c.nm)}" style="width:110px"></td>
        <td><select data-c="t">${KABEL_JENIS.map(([v, t]) => `<option value="${v}"${c.t === v ? ' selected' : ''}>${t}</option>`).join('')}</select></td>
        <td><select data-c="f">${fOpts(c.f)}</select></td>
        <td><input data-c="n" type="number" min="1" max="6" value="${c.n}" style="width:52px" title="Dibagi berapa channel ampli (gedung besar: 1 lantai inap bisa 3 channel)"></td>
        <td><input data-c="vol" type="number" min="40" max="110" value="${c.vol}" style="width:62px"> dB</td>
        <td class="mut">${amp}</td>
        <td class="mut">${lenOf(c) != null ? `${fmt(Math.round(lenOf(c)))} m` : '—'}</td>
        <td><input data-c="fd" value="${esc(c.fd)}" placeholder="Flashdisk / file suara" style="width:120px"></td>
        <td><input data-c="ket" value="${esc(c.ket)}" placeholder="mis. ${esc(c.t === 'hexa' ? su.panggil : c.t === 'twtarik' ? su.tarik : su.inap)}" style="width:150px"></td>
        <td class="mut" style="white-space:nowrap"><label class="mini" title="Unggah file suara walet (mp3/wav) — tersimpan di perangkat ini"><input type="file" data-snd="${k}" accept="audio/*" hidden>🎵</label>
          <button type="button" class="mini${SND.isPlaying(c.id) ? ' on2' : ''}" data-play="${k}" title="Putar / hentikan — tweeter channel ini ditandai berdenyut di denah">${SND.isPlaying(c.id) ? '⏹' : '▶'}</button></td>
        <td><button type="button" class="mini" data-del="${k}">✕</button></td></tr>`;
    }).join('');
    const alatRows = au.items.map((it, k) => `<tr data-a="${k}">
      <td><select data-al="t">${[...AMPLI, ...AUDIO_ALAT].map(([v, t]) => `<option value="${v}"${it.t === v ? ' selected' : ''}>${t}</option>`).join('')}</select></td>
      <td><input data-al="n" type="number" min="0" max="20" value="${it.n}" style="width:56px"></td>
      <td>${AMPLI_KEYS.has(it.t) ? `<input data-al="ch" type="number" min="1" max="32" value="${it.ch || 4}" style="width:56px"> ch` : '—'}</td>
      <td><span class="mut">${k > 0 ? `<button type="button" class="mini" data-up="${k}">↑</button>` : ''}${k < au.items.length - 1 ? `<button type="button" class="mini" data-dn="${k}">↓</button>` : ''}</span></td>
      <td><button type="button" class="mini" data-adel="${k}">✕</button></td></tr>`).join('');
    const rak = au.items.filter(i => i.n > 0).map(i => `<span class="rk${AMPLI_KEYS.has(i.t) ? ' amp' : ''}">${(NAMA_ALL[i.t] || i.t)}${i.n > 1 ? ` ×${i.n}` : ''}</span>`).join('');
    openDlg('Ruang audio — channel, ampli & jadwal',
      `<p class="lead">Semua kabel tweeter berujung di ruang audio. Atur channel (bebas: 1 lantai inap = 1 channel, atau dibagi 3 channel untuk gedung besar), volume dB tiap channel, flashdisk & suara Markaswalet yang dipakai, perangkat di rak, dan jadwal timer.</p>
       <div class="aud-scroll"><table class="audt"><tr><th title="Saklar cek tweeter">Cek</th><th>Nama channel</th><th>Jenis tweeter</th><th>Lantai</th><th>Bagi</th><th>Volume</th><th>Ch ampli</th><th>Kabel</th><th>Flashdisk</th><th>Suara (Markaswalet)</th><th>Putar</th><th></th></tr>${chRows}</table></div>
       <div class="acts"><button type="button" class="mini" id="auAdd">+ Tambah channel</button><button type="button" class="mini" id="auAuto">Susun otomatis per lantai</button>
        <span class="tip" style="margin:0 0 0 auto">${terpakai} channel terpakai / kapasitas ampli ${kapasitas}${terpakai > kapasitas ? ' — <b class="bad">kurang ampli!</b>' : ' ✓'}</span></div>
       <p class="tip">Volume channel = keluaran dB tiap tweeter pada 1 m (target buku: panggil ${tg.panggil[0]}–${tg.panggil[1]}, tarik ${tg.tarik[0]}–${tg.tarik[1]}, inap ${tg.inap[0]}–${tg.inap[1]} dB). Hasil sebarannya per ruang dilihat di mode <b>Cek dB</b>. Saklar "Cek" mematikan channel untuk mengecek tweeter mana yang hidup.</p>
       <h3 class="aud-h">Perangkat di ruang audio</h3>
       <table class="audt"><tr><th>Perangkat</th><th>Jumlah</th><th>Channel</th><th>Urutan rak</th><th></th></tr>${alatRows}</table>
       <div class="acts"><button type="button" class="mini" id="alAdd">+ Tambah perangkat</button></div>
       <div class="rak">${rak || '<span class="tip">rak kosong</span>'}</div>
       <h3 class="aud-h">Jadwal timer AC (suara hidup–mati)</h3>
       <div class="jadw">${['panggil', 'tarik', 'inap'].map(k => `<label>${k[0].toUpperCase() + k.slice(1)} <input data-j="${k}0" type="number" min="0" max="24" value="${au.jadwal[k][0]}">–<input data-j="${k}1" type="number" min="0" max="24" value="${au.jadwal[k][1]}"> WIB</label>`).join('')}
        <span class="tip">Panggil hanya 05.00–19.00 (etika lingkungan). 0–24 = 24 jam. Jam simulasi di luar jadwal → kategori itu senyap di "Cek dB". Timer Kitani menjadwalkan kipas pendingin ampli.</span></div>`,
      `<button type="button" class="pl-btn" id="auBatal">Batal</button><button type="button" class="pl-btn pl-blue" id="auOk">Simpan</button>`, true);
    const rd = () => render();
    dlg.querySelectorAll('tr[data-k] [data-c]').forEach(inp => inp.onchange = () => {
      const c = ch[+inp.closest('tr').dataset.k], p = inp.dataset.c;
      if (p === 'on') c.on = inp.checked;
      else if (p === 'nm' || p === 'fd' || p === 'ket') c[p] = inp.value.slice(0, 160);
      else if (p === 't') c.t = inp.value;
      else if (p === 'f') c.f = inp.value.includes(':') ? inp.value.split(':').map(Number) : +inp.value;
      else { c[p] = clamp(Math.round(+inp.value || 0), p === 'n' ? 1 : 40, p === 'n' ? 6 : 110); if (p === 'vol') SND.setVol(c.id, c.vol); }
      rd();
    });
    dlg.querySelectorAll('[data-snd]').forEach(inp => inp.onchange = async () => {
      const c = ch[+inp.dataset.snd], f = inp.files[0]; if (!f) return;
      await SND.setSuara(m, c.id, f);
      c.fd = f.name.slice(0, 60); rd();
      A.hint(`File suara "${f.name}" tersimpan untuk channel ${c.nm} — tekan ▶ untuk memutar.`, 6000);
    });
    dlg.querySelectorAll('[data-play]').forEach(b => b.onclick = async () => {
      const c = ch[+b.dataset.play], r2 = await SND.toggle(m, c);
      if (r2 === 'kosong') A.hint('Belum ada file suara — unggah dulu lewat ikon 🎵 di baris channel ini.', 5000);
      else if (r2 === 'gagal') A.hint('File suara tidak bisa diputar browser ini (coba MP3/WAV).', 5000);
      else if (r2 === 'main') A.hint('Suara diputar berulang — tweeter channel ini ditandai berdenyut di denah 2D. Tekan ⏹ untuk berhenti.', 7000);
      rd(); A.refresh();
    });
    dlg.querySelectorAll('[data-del]').forEach(b => b.onclick = () => { ch.splice(+b.dataset.del, 1); rd(); });
    $('#auAdd').onclick = () => { ch.push({ t: 'twinap', f: -1, n: 1, nm: `Channel ${ch.length + 1}`, vol: 60, fd: '', ket: '', on: true }); rd(); };
    $('#auAuto').onclick = () => { ch = channels({ ...m, kabel: null }).map(c => ({ t: c.t, f: c.f, n: c.n, nm: c.nm, vol: c.vol, fd: '', ket: '', on: true })); rd(); };
    dlg.querySelectorAll('tr[data-a] [data-al]').forEach(inp => inp.onchange = () => {
      const it = au.items[+inp.closest('tr').dataset.a], p = inp.dataset.al;
      if (p === 't') { it.t = inp.value; if (AMPLI_KEYS.has(it.t) && !it.ch) it.ch = AMPLI.find(a => a[0] === it.t)?.[2] || 4; }
      else it[p] = clamp(Math.round(+inp.value || 0), 0, p === 'ch' ? 32 : 20);
      rd();
    });
    dlg.querySelectorAll('[data-adel]').forEach(b => b.onclick = () => { au.items.splice(+b.dataset.adel, 1); rd(); });
    dlg.querySelectorAll('[data-up]').forEach(b => b.onclick = () => { const k = +b.dataset.up; [au.items[k - 1], au.items[k]] = [au.items[k], au.items[k - 1]]; rd(); });
    dlg.querySelectorAll('[data-dn]').forEach(b => b.onclick = () => { const k = +b.dataset.dn; [au.items[k + 1], au.items[k]] = [au.items[k], au.items[k + 1]]; rd(); });
    $('#alAdd').onclick = () => { au.items.push({ t: 'flashdisk', n: 1 }); rd(); };
    dlg.querySelectorAll('[data-j]').forEach(inp => inp.onchange = () => {
      const k = inp.dataset.j, cat = k.slice(0, -1), idx = +k.slice(-1);
      au.jadwal[cat][idx] = clamp(Math.round(+inp.value || 0), 0, 24);
    });
    $('#auBatal').onclick = () => dlg.close();
    $('#auOk').onclick = () => {
      A.commit();
      m.kabel = { ch: ch.map(c => ({ ...c })) };   // id ikut disimpan agar file suara per channel tetap terpaut
      m.audio = { items: au.items.filter(i => i.n > 0), jadwal: au.jadwal };
      dlg.close(); A.save(); A.renderAll(); A.hint('Pengaturan ruang audio & channel disimpan — lihat mode "Kabel" dan "Cek dB".', 6000);
    };
  };
  render();
}
const NAMA_ALL = Object.fromEntries([...AMPLI.map(([k, n]) => [k, n]), ...AUDIO_ALAT]);

// ---------- RAB perlengkapan ----------
export function dlgRAB() {
  const m = A.model;
  m.rab = m.rab && typeof m.rab === 'object' ? m.rab : {};
  m.rab.h = m.rab.h || {}; m.rab.k = m.rab.k || {}; m.rab.x = Array.isArray(m.rab.x) ? m.rab.x : [];
  const render = () => {
    let cab = null; try { cab = cableInfo(m); } catch {}
    const { rows, total } = rabRows(m, A.analyze(), cab);
    const rp = v => 'Rp ' + fmt(v);
    const body = rows.map(r => `<tr data-key="${esc(r.key)}"${r.auto ? '' : ' data-x="1"'}>
      <td>${r.auto ? esc(r.nm) : `<input data-r="nm" value="${esc(r.nm)}" placeholder="Nama item">`}</td>
      <td class="num">${r.auto ? `${fmt(r.jml)} ${r.sat}` : `<input data-r="jml" type="number" min="0" value="${r.jml}" style="width:64px"> <input data-r="sat" value="${esc(r.sat)}" style="width:38px">`}</td>
      <td class="num"><input data-r="hrg" type="number" min="0" step="500" value="${r.hrg}" style="width:96px"></td>
      <td class="num"><b>${rp(r.tot)}</b></td>
      <td><input data-r="ket" value="${esc(r.ket)}" placeholder="Keterangan" style="width:150px"></td>
      <td>${r.auto ? '' : `<button type="button" class="mini" data-rdel="${r.xi}">✕</button>`}</td></tr>`).join('');
    openDlg('RAB perlengkapan walet',
      `<p class="lead">Jumlah dihitung otomatis dari desain (baris abu-abu); harga satuan & keterangan bisa diubah dan ikut tersimpan di link desain. Tambahkan baris bebas untuk item lain.</p>
       <div class="aud-scroll"><table class="audt rabt"><tr><th>Nama item</th><th>Jumlah</th><th>Harga satuan (Rp)</th><th>Harga total</th><th>Keterangan</th><th></th></tr>${body}
       <tr class="tot"><td colspan="3">TOTAL</td><td class="num"><b>${rp(total)}</b></td><td colspan="2"></td></tr></table></div>
       <div class="acts"><button type="button" class="mini" id="rbAdd">+ Tambah baris</button><button type="button" class="mini" id="rbCopy">Salin tabel (untuk Excel/WA)</button><button type="button" class="mini" id="rbReset">Kembalikan harga perkiraan</button></div>
       <p class="tip">Harga bawaan hanya PERKIRAAN — sesuaikan dengan harga di kota Anda. RAB ini khusus perlengkapan walet; struktur bangunan (RAB sipil) dihitung terpisah saat konsultasi.</p>`,
      `<button type="button" class="pl-btn pl-primary" id="rbOk">Selesai</button>`, true);
    dlg.querySelectorAll('tr[data-key] [data-r]').forEach(inp => inp.onchange = () => {
      const tr = inp.closest('tr'), key = tr.dataset.key, p = inp.dataset.r;
      if (tr.dataset.x) {
        const x = m.rab.x[+key.slice(1)];
        if (p === 'nm' || p === 'sat' || p === 'ket') x[p] = inp.value.slice(0, 120); else x[p] = Math.max(0, +inp.value || 0);
      } else if (p === 'hrg') m.rab.h[key] = Math.max(0, Math.round(+inp.value || 0));
      else if (p === 'ket') m.rab.k[key] = inp.value.slice(0, 120);
      A.save(); render();
    });
    dlg.querySelectorAll('[data-rdel]').forEach(b => b.onclick = () => { m.rab.x.splice(+b.dataset.rdel, 1); A.save(); render(); });
    $('#rbAdd').onclick = () => { m.rab.x.push({ nm: '', jml: 1, sat: 'bh', hrg: 0, ket: '' }); A.save(); render(); };
    $('#rbReset').onclick = () => { m.rab.h = {}; A.save(); render(); };
    $('#rbCopy').onclick = async () => {
      const t = [['Nama item', 'Jumlah', 'Satuan', 'Harga satuan', 'Harga total', 'Keterangan'].join('\t'),
        ...rows.map(r => [r.nm, r.jml, r.sat, r.hrg, r.tot, r.ket].join('\t')), ['TOTAL', '', '', '', total, ''].join('\t')].join('\n');
      try { await navigator.clipboard.writeText(t); $('#rbCopy').textContent = 'Tersalin ✓'; } catch { prompt('Salin tabel:', t); }
    };
    $('#rbOk').onclick = () => dlg.close();
  };
  render();
}

// ---------- pahami fitur ----------
export function dlgHelp() {
  const F = [
    ['🏗️ Denah & katalog', 'Klik elemen di panel kiri lalu klik di denah. Seret untuk memindah, seret sudut untuk mengubah ukuran, klik kanan/tengah atau alat Geser (H) untuk menggeser tampilan, scroll untuk zoom.'],
    ['🧱 Sekat terpal / bata', 'Gambar sekat dengan alat Sekat (W). Di panel kanan pilih bahannya: terpal (arsir, kabel bisa menembus) atau bata (abu-abu, kabel tidak bisa menembus). Sekat yang memotong zona inap otomatis membaginya menjadi ruang.'],
    ['🗼 Menara', 'Tab "Menara" = lantai sendiri di atas void. LMB & tweeter hexagonal dipasang di dindingnya.'],
    ['📋 Daftar & fokus', 'Tab "Daftar" di panel kiri: ikon mata menyembunyikan item, ikon fokus meredupkan yang lain — untuk menjelaskan desain.'],
    ['☀️ Cek lux', 'Simulasi cahaya dari LMB: atur arah hadap gedung, jam, bulan & langit. Panah jingga = jalur cahaya anakan menuju LMB.'],
    ['💨 Cek udara', 'Siklus udara (ventilasi = intake, LMB = outtake saat udara dalam lebih hangat) + suhu & kelembapan per lantai + dinding yang panas kena matahari.'],
    ['🔊 Cek dB & Ruang audio', 'Tombol "Ruang audio" di atas: atur channel (bebas per lantai / dibagi beberapa channel), volume dB, flashdisk & suara, perangkat (ampli AXM/Piro, kipas, timer, aki), dan jadwal timer. Mode "Cek dB" menampilkan dB tarik/inap tiap ruang dibanding target buku.'],
    ['🔌 Kabel', 'Mode "Kabel" menggambar jalur kabel tiap channel — selalu siku mengikuti sirip/dinding, menembus terpal tapi tidak bata — plus total meter & jumlah klem (tiap 10 cm). Kabel hexagonal otomatis menghitung tinggi gedung.'],
    ['🐦 Simulasi burung', 'Di 3D: walet berputar di luar, terpanggil hexagonal, masuk LMB (kadang mutar dulu di void), mengejar suara tarik, menyebar ke ruang. Penghuni (punya titik sarang) langsung masuk. Jumlah walet diatur di kartu "Matahari & waktu".'],
    ['🪹 Titik sarang', 'Item "Titik sarang" menandai sarang baru / lama / polesan / jadi di sirip — untuk pemantauan & burung penghuni di simulasi.'],
    ['🚶 Jalan di dalam', 'Di 3D tekan "Jalan di dalam": berjalan dengan WASD/panah, seret untuk menoleh, naiki tangga untuk pindah lantai, T = senter. Gelap-terangnya mengikuti simulasi lux; garis oranye = rantai tweeter tarik.'],
    ['🗺️ Foto satelit', 'Kartu "Lokasi (satelit)" di panel kanan: screenshot Google Maps (mode satelit) lokasi Anda, unggah, atur lebar & putar — gedung terlihat di lahan aslinya.'],
    ['💰 RAB', 'Tombol "RAB": tabel nama item, jumlah (otomatis dari desain), harga satuan (bisa diedit), total, keterangan; bisa tambah baris & salin ke Excel/WA.'],
    ['⭐ Skor & tanda lokasi', 'Klik catatan analisis yang bergaris bawah — lantainya dibuka dan lokasinya ditandai kotak merah berkedip.'],
    ['📤 Selesai & konsultasi', 'Kirim desain + link ke WhatsApp tim GedungWalet.com. Seluruh desain (termasuk channel, RAB, pengaturan simulasi) tersimpan di link.'],
  ];
  openDlg('Pahami fitur Walet Planner',
    `<p class="lead">Ringkasan semua fitur. Klik tiap judul untuk membuka.</p>
     ${F.map(([t, b], i) => `<details class="leg"${i === 0 ? ' open' : ''}><summary>${t}</summary><p class="hlp">${b}</p></details>`).join('')}`,
    `<button type="button" class="pl-btn pl-primary" id="hlOk">Mengerti</button>`, 'mid');
  $('#hlOk').onclick = () => dlg.close();
}

// ---------- mode admin: lembar desain untuk dikirim ke WhatsApp pelanggan ----------
// Buka /desain/?admin=1 sekali per perangkat → tombol "Unduh lembar desain" muncul; /desain/?admin=0 mematikannya.
export function setupAdmin(btn) {
  const qs = new URLSearchParams(location.search);
  try { if (qs.get('admin') === '1') localStorage.setItem('waletPlanner.admin', '1'); if (qs.get('admin') === '0') localStorage.removeItem('waletPlanner.admin'); } catch {}
  admin = qs.get('admin') === '1';
  try { admin = admin || localStorage.getItem('waletPlanner.admin') === '1'; } catch {}
  btn.hidden = !admin;
  btn.onclick = exportSheet;
}
async function exportSheet() {
  const m = A.model; A.hint('Menyiapkan lembar desain…');
  try {
    const three = await A.load3D();
    const img3d = three.snapshotSheet(m, 1280, 960);   // semua lantai, tanpa burung / peta; tampilan 3D pengguna dikembalikan
    const { makeSheetCanvas, canvasPDF } = await import('./planner-export.js');
    const cv = await makeSheetCanvas(m, A.analyze(), img3d);
    const blob = await new Promise((res, rej) => cv.toBlob(b => (b ? res(b) : rej(new Error('toBlob gagal'))), 'image/png'));
    const url = URL.createObjectURL(blob), urlPdf = URL.createObjectURL(canvasPDF(cv));
    const nm0 = `Desain-RBW-${(m.name || 'rumah-walet').replace(/[^\w-]+/g, '-')}-${m.w}x${m.h}-${m.floors.length}lt`;
    openDlg('Lembar desain',
      `<p class="lead">Kirim gambar ini ke WhatsApp pelanggan${m.owner ? ` (${esc(m.owner)})` : ''}. Pilih "Salin gambar" lalu tempel (Ctrl+V) di WhatsApp Web, atau unduh PNG / PDF.</p><img class="sheet" src="${url}" alt="Lembar desain rumah walet">`,
      `<button type="button" class="pl-btn" id="dPdfMulti">PDF multi-lembar…</button><button type="button" class="pl-btn" id="dCopyImg">Salin gambar</button><a class="pl-btn" href="${urlPdf}" download="${esc(nm0)}.pdf">Unduh PDF</a><a class="pl-btn pl-primary" href="${url}" download="${esc(nm0)}.png">Unduh PNG</a>`, true);
    $('#dPdfMulti').onclick = () => dlgPDF();
    $('#dCopyImg').onclick = async () => {
      try { await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]); $('#dCopyImg').textContent = 'Tersalin ✓'; }
      catch { A.hint('Browser tidak mengizinkan salin gambar — gunakan Unduh PNG.'); }
    };
    dlg.addEventListener('close', () => { URL.revokeObjectURL(url); URL.revokeObjectURL(urlPdf); }, { once: true });
    A.hint('');
  } catch (err) { console.error(err); A.hint('Gagal membuat lembar desain.'); }
}
