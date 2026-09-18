// Walet Planner — editor denah rumah walet (2D + 3D): state, interaksi, panel properti & analisis.
import { CATALOG, TYPES, RULES, TARIK_ROLES, TW, LAR_FUNGSI, ARAH8, LANGIT, SISI, SARANG_JENIS, icon } from './planner-data.js';
import { climate } from './planner-air.js';
import { simulateSound, nilaiDb } from './planner-sound.js';
import { cableInfo, channels, chCover } from './planner-cable.js';
import * as SND from './planner-suara.js';
import { derive, snapToWall, snapHexa, isLar, center, inRect, twinapRekomendasi, zonePattern, siripDetail, siripVolume, pushOffWalls, snap90, dist, distToRect, angDiff, floorRect, floorHt, clampInto, isFull, ovArea, levels } from './planner-geom.js';
import { drawFloor, symbolSVG } from './planner-draw.js';
import { generate } from './planner-auto.js';
import { analyze } from './planner-analysis.js';
import { simulate, heatURL, luxColor, luxTxt, kategori, LUX_STOPS, simOf, arahNama, facadeAz } from './planner-light.js';
import { simulateAir, suhuLuar } from './planner-air.js';
import { comfort, TINGKAT } from './planner-comfort.js';
import * as D from './planner-dialogs.js';
import * as SK from './planner-sketch.js';

const $ = s => document.querySelector(s);
const LS_KEY = 'waletPlanner.v2';
const round = (v, d = 2) => Math.round(v * 10 ** d) / 10 ** d;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const uid = () => Math.random().toString(36).slice(2, 9);
const fmt = n => (+n).toLocaleString('id-ID');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const snap = v => Math.round(v * 20) / 20; // 5 cm
const OPENINGS = new Set(['lar', 'larj', 'lmb', 'pintu', 'vent']);
const DIRS = [[270, 'Depan ↑'], [315, 'Depan-kanan ↗'], [0, 'Kanan →'], [45, 'Belakang-kanan ↘'], [90, 'Belakang ↓'], [135, 'Belakang-kiri ↙'], [180, 'Kiri ←'], [225, 'Depan-kiri ↖']];
const DIRS4 = [[270, 'Depan ↑'], [0, 'Kanan →'], [90, 'Belakang ↓'], [180, 'Kiri ←']];   // tweeter inap: lurus saja
const SIDE_NAME = { top: 'depan', bottom: 'belakang', left: 'kiri', right: 'kanan' };
const dirName = d => DIRS.reduce((a, b) => (angDiff(a[0], d) <= angDiff(b[0], d) ? a : b))[1];
const roleName = r => (TARIK_ROLES.find(([k]) => k === r) || [, 'Tarik'])[1];

// ---------- state ----------
let model = null, cur = 0, tool = 'select', view = '2d', three = null, drag = null, der = null, calib = null, lastA = null;
let sel = new Set();                                   // id objek & sekat terpilih (boleh banyak)
let undoStack = [], redoStack = [];
let spaceDown = false, measures = [], luxOn = false, luxRes = null, airOn = false, dbOn = false, kabelOn = false, mark = null, pendRute = null;
let hidCh = new Set(), kabelSemua = false, lblOn = true;   // sembunyikan jalur per channel · daftar channel semua/lantai ini · keterangan ruang
let catTab = 'katalog', hid = new Set(), focus = null, openT = new Set();   // daftar item: disembunyikan / fokus (tidak ikut desain)
// kartu panel kanan yang dilipat (judul sebelum "—"); tersimpan per perangkat agar panel tidak menumpuk
let closedCards = new Set(['Sketsa tangan', 'Papan sirip', 'Ukuran gedung', 'Penggaris', 'Ruang dari sekat', 'Lokasi (satelit)']);
try { const c = JSON.parse(localStorage.getItem('waletPlanner.cards')); if (Array.isArray(c)) closedCards = new Set(c); } catch {}
const saveCards = () => { try { localStorage.setItem('waletPlanner.cards', JSON.stringify([...closedCards])); } catch {} };
// grup katalog kiri yang dilipat (dropdown)
let catClosed = new Set();
try { const c = JSON.parse(localStorage.getItem('waletPlanner.catg')); if (Array.isArray(c)) catClosed = new Set(c); } catch {}
let sig = [];                                          // isi tiap lantai saat terakhir diendapkan (tweeter inap otomatis)
const vp = { s: 60, ox: 0, oy: 0 };

// ---------- model ----------
function normalize(m) {
  m.kolom = m.kolom || RULES.kolom;
  if (m.showStruktur === undefined) m.showStruktur = true;
  m.siripTebal = m.siripTebal || RULES.siripTebalCm; m.siripLebar = m.siripLebar || RULES.siripLebarCm;
  m.floors.forEach((f, i) => { f.name = `Lantai ${i + 1}`; f.items = f.items || []; f.walls = f.walls || []; delete f.menara; });
  liftMenara(m);
  if (m.menara) {
    const t = m.menara; Object.assign(t, { name: 'Menara', menara: true, items: t.items || [], walls: t.walls || [] });
    if (t.ht == null) t.ht = 2.5;
    if (t.fw == null) Object.assign(t, menaraRect(m));
  }
  levels(m).forEach(f => f.items.forEach(t => {   // simbol tweeter lama (25 cm) → corong kecil, titik tengah tetap
    if ((t.t === 'twinap' || t.t === 'twtarik') && Math.abs(t.w - TW) > 1e-6) { const c = center(t); Object.assign(t, { w: TW, h: TW, x: round(c.x - TW / 2, 3), y: round(c.y - TW / 2, 3) }); }
  }));
  return m;
}
// Tapak menara baru: tepat di atas void lantai teratas (min 2×2 m), rata dinding luar bila hampir menempel.
function menaraRect(m) {
  const top = m.floors[m.floors.length - 1], T = floorRect(m, top), v = top.items.find(it => it.t === 'void');
  const w = round(Math.min(T.w, Math.max(2, v ? v.w : 2))), h = round(Math.min(T.h, Math.max(2, v ? v.h : 2)));
  let x = clamp((v ? v.x + v.w / 2 : T.x + T.w / 2) - w / 2, T.x, T.x + T.w - w), y = clamp((v ? v.y + v.h / 2 : T.y + T.h / 2) - h / 2, T.y, T.y + T.h - h);
  if (x - T.x < 0.3) x = T.x; else if (T.x + T.w - x - w < 0.3) x = T.x + T.w - w;
  if (y - T.y < 0.3) y = T.y; else if (T.y + T.h - y - h < 0.3) y = T.y + T.h - h;
  return { fx: round(x), fy: round(y), fw: w, fh: h };
}
// Desain lama: menara = kotak di lantai teratas → jadi lantai "Menara" sendiri; LMB & tarik LMB di sisinya ikut pindah.
function liftMenara(m) {
  m.floors.forEach((fl, i) => {
    const mns = fl.items.filter(it => it.t === 'menara'); if (!mns.length) return;
    fl.items = fl.items.filter(it => it.t !== 'menara');
    if (m.menara || i !== m.floors.length - 1) return;
    const mn = mns[0], F = floorRect(m, fl);
    let x = mn.x, y = mn.y;   // menara yang hampir menempel dinding luar → rata dinding (LMB di fasad jadi dinding menara)
    if (x - F.x < 0.3) x = F.x; else if (F.x + F.w - x - mn.w < 0.3) x = F.x + F.w - mn.w;
    if (y - F.y < 0.3) y = F.y; else if (F.y + F.h - y - mn.h < 0.3) y = F.y + F.h - mn.h;
    const lv = m.menara = { name: 'Menara', menara: true, fx: round(x), fy: round(y), fw: round(mn.w), fh: round(mn.h), ht: mn.mt || 2.5, items: [], walls: [] };
    const lmbs = fl.items.filter(it => it.t === 'lmb' && distToRect(center(it), { x, y, w: mn.w, h: mn.h }) <= 0.6);
    const tws = fl.items.filter(it => it.t === 'twtarik' && (it.role === 'lmb' || !it.role) && lmbs.some(l => dist(center(l), center(it)) <= 1.2));
    const moved = new Set([...lmbs, ...tws].map(it => it.id)), R = floorRect(m, lv);
    fl.items = fl.items.filter(it => !moved.has(it.id));
    lmbs.forEach(l => { clampInto(l, R); snapToWall(l, m, lv); lv.items.push(l); });
    tws.forEach(t => { clampInto(t, R); lv.items.push(t); });
  });
}
function newModel(o) {
  const m = {
    id: uid(), name: o.name || 'Rumah Walet', owner: '', city: o.city || '', w: +o.w, h: +o.h, floorH: +o.floorH || RULES.lantaiTinggi,
    kolom: RULES.kolom, showStruktur: true, created: Date.now(), siripTebal: RULES.siripTebalCm, siripLebar: RULES.siripLebarCm,
    floors: Array.from({ length: +o.floors }, (_, i) => ({ name: `Lantai ${i + 1}`, items: [], walls: [] })),
  };
  if (o.survey) m.survey = { ...o.survey };
  if (o.topSmall && m.floors.length > 1) Object.assign(m.floors[m.floors.length - 1], topSmallRect(m));
  const res = o.auto ? generate(m, o.survey) : null;
  return { model: m, notes: res ? res.notes : [] };
}
// Lantai teratas lebih kecil di tengah (menara besar) — proporsi DED 20×25 → 10×15 m.
function topSmallRect(m) {
  const fw = clamp(Math.round(m.w) / 2, Math.min(m.w, 4), m.w), fh = clamp(Math.round(m.h * 1.2) / 2, Math.min(m.h, 6), m.h);
  return { fw, fh, fx: round((m.w - fw) / 2), fy: round((m.h - fh) / 2) };
}
const floor = () => levels(model)[cur];
const isMn = () => !!floor()?.menara;   // lantai aktif = lantai menara
// ruang audio boleh DI LUAR gedung → batas geser/letaknya diperluas ±6 m dari batas lantai
const AUD_EXT = 6;
const boundsOf = it => { const F = FR(); return it?.t === 'audio' ? { x: F.x - AUD_EXT, y: F.y - AUD_EXT, w: F.w + 2 * AUD_EXT, h: F.h + 2 * AUD_EXT } : F; };
const clampItem = it => clampInto(it, boundsOf(it));
const FR = () => floorRect(model, floor());
function clipWall(s, F) {
  const c = (v, a, b) => round(clamp(v, a, b));
  const o = { ...s, x1: c(s.x1, F.x, F.x + F.w), x2: c(s.x2, F.x, F.x + F.w), y1: c(s.y1, F.y, F.y + F.h), y2: c(s.y2, F.y, F.y + F.h) };
  return Math.hypot(o.x2 - o.x1, o.y2 - o.y1) >= 0.3 ? o : null;
}
const findItem = id => floor().items.find(i => i.id === id);
const findWall = id => floor().walls.find(i => i.id === id);
const selItems = () => floor().items.filter(i => sel.has(i.id));
const selWalls = () => floor().walls.filter(w => sel.has(w.id));
function single() {
  if (sel.size !== 1) return null;
  const id = sel.values().next().value, it = findItem(id);
  if (it) return { kind: 'item', el: it };
  const w = findWall(id); return w ? { kind: 'wall', el: w } : null;
}
function pruneSel() { [...sel].forEach(id => { if (!findItem(id) && !findWall(id)) sel.delete(id); }); }
const snapshot = () => JSON.stringify(model);
function commit() { undoStack.push(snapshot()); if (undoStack.length > 60) undoStack.shift(); redoStack = []; save(); }
function restore(json) { model = normalize(JSON.parse(json)); cur = Math.min(cur, levels(model).length - 1); sel.clear(); resetSig(); save(); renderAll(); }
function undo() { if (!undoStack.length) return; redoStack.push(snapshot()); restore(undoStack.pop()); }
function redo() { if (!redoStack.length) return; undoStack.push(snapshot()); restore(redoStack.pop()); }
function save() { try { localStorage.setItem(LS_KEY, JSON.stringify({ model, cur })); } catch {} }
function load() {
  try { const d = JSON.parse(localStorage.getItem(LS_KEY)); if (d?.model?.floors?.length) { model = normalize(d.model); cur = Math.min(d.cur || 0, levels(model).length - 1); return true; } } catch {}
  return false;
}

// ---------- tweeter inap otomatis ----------
// Tweeter inap yang masih persis pola standar ikut menyesuaikan saat ruang berubah (sekat baru membelah zona, LAR dipindah,
// zona digeser/diperbesar, arah sirip diganti). Tweeter yang sudah diatur manual dibiarkan, tapi tidak boleh tertimpa sekat.
function resetSig() { sig = model ? levels(model).map(f => JSON.stringify(f)) : []; }
function settle() {
  if (!model) return;
  const fl = floor(), prev = sig[cur];
  if (prev && prev !== JSON.stringify(fl)) { try { reflow(JSON.parse(prev), fl); } catch (e) { console.warn('reflow', e); } }
  sig[cur] = JSON.stringify(fl);
  save();   // commit() menyimpan keadaan SEBELUM perubahan — simpan juga hasilnya
}
function reflow(prev, fl) {
  const d0 = derive(model, prev), d1 = derive(model, fl);
  const near = (t, pts) => pts.some(p => Math.abs(p.x - center(t).x) < 0.02 && Math.abs(p.y - center(t).y) < 0.02);
  const same = (a, b) => a.length === b.length && a.every(p => b.some(q => Math.abs(p.x - q.x) < 0.02 && Math.abs(p.y - q.y) < 0.02));
  d1.zones.forEach(z => {
    const z0 = d0.zones.find(q => q.id === z.id); if (!z0) return;
    const p0 = zonePattern(d0, z.id), p1 = zonePattern(d1, z.id); if (same(p0, p1)) return;
    const tw0 = prev.items.filter(t => t.t === 'twinap' && inRect(center(t), z0));
    if (!p0.length || tw0.length !== p0.length || !tw0.every(t => !Number.isFinite(t.dir) && !t.locked && near(t, p0))) return;
    const ids = new Set(tw0.map(t => t.id));
    fl.items = fl.items.filter(t => !ids.has(t.id));
    p1.forEach(p => fl.items.push({ id: uid(), t: 'twinap', x: round(p.x - TW / 2, 3), y: round(p.y - TW / 2, 3), w: TW, h: TW }));
  });
  const d2 = derive(model, fl), F = floorRect(model, fl);
  fl.items.forEach(t => { if ((t.t === 'twinap' || t.t === 'twtarik') && !t.locked) pushOffWalls(t, d2.segs, F); });
}

// ---------- API untuk modul dialog ----------
const app = {
  get model() { return model; }, get cur() { return cur; }, get view() { return view; },
  newModel, commit, save, fit, hint, renderAll, setView, applyProject,
  analyze: () => analyze(model), generate, topSmallRect,
  setModel(m) { SND.stopAll(); model = normalize(m); cur = model.floors.length - 1; sel.clear(); hid.clear(); focus = null; openT.clear(); tool = 'select'; calib = null; measures = []; undoStack = []; redoStack = []; SK.prune(model); resetSig(); save(); fit(); renderAll(); if (view === '3d') setView('3d'); },
  setCur(i) { cur = clamp(i, 0, levels(model).length - 1); sel.clear(); save(); renderAll(); },
  replaceFloor(i, items, walls) { commit(); Object.assign(model.floors[i], { items, walls }); liftMenara(model); normalize(model); cur = i; sel.clear(); resetSig(); save(); renderAll(); },
  refresh() { renderTools(); renderPlan(); renderSide(); },
  regenerate(survey) { commit(); model.survey = { ...survey }; const r = generate(model, survey); sel.clear(); resetSig(); save(); fit(); renderAll(); if (view === '3d') setView('3d'); return r.notes; },
  applyTopSmall(on) {
    const t = model.floors[model.floors.length - 1]; if (model.floors.length < 2) return;
    if (on && isFull(model, t)) Object.assign(t, topSmallRect(model));
    if (!on && !isFull(model, t)) { delete t.fx; delete t.fy; delete t.fw; delete t.fh; }
  },
  async load3D() { if (!three) { three = await import('./planner-3d.js'); three.mount($('#view3d')); } return three; },
};
D.init(app);

// ---------- katalog, lantai, alat ----------
function renderCatalog() {
  const tabs = `<div class="cattabs" role="tablist"><button type="button" data-tab="katalog" class="${catTab === 'katalog' ? 'on' : ''}">Katalog</button><button type="button" data-tab="daftar" class="${catTab === 'daftar' ? 'on' : ''}">${icon('list', 14)} Daftar${hid.size || focus ? ' •' : ''}</button></div>`;
  $('#catalog').innerHTML = tabs + (catTab === 'daftar' ? listHTML() : CATALOG.map(g => {
    const cl = catClosed.has(g.group);
    return `<div class="cgrp${cl ? ' cl' : ''}"><h4 class="cgh" data-cg="${esc(g.group)}">${g.group}<i>${g.items.length}</i></h4><div class="cgi">` + g.items.map(it => {
      const t = it.kind === 'wall' ? 'sekat' : 'place:' + it.t;
      return `<button type="button" class="it${tool === t ? ' on' : ''}" data-t="${it.t}" title="${esc(it.tip)}">${symbolSVG(it.t)}<span>${it.t === 'menara' && model?.menara ? 'Buka lantai menara' : it.name}</span></button>`;
    }).join('') + '</div></div>';
  }).join(''));
  $('#catalog').querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { catTab = b.dataset.tab; renderCatalog(); });
  $('#catalog').querySelectorAll('.cgh').forEach(h => h.onclick = () => {   // grup katalog bisa dilipat (dropdown)
    const k = h.dataset.cg;
    if (catClosed.has(k)) catClosed.delete(k); else catClosed.add(k);
    try { localStorage.setItem('waletPlanner.catg', JSON.stringify([...catClosed])); } catch {}
    renderCatalog();
  });
  if (catTab === 'daftar') return bindList();
  $('#catalog').querySelectorAll('.it').forEach(b => b.onclick = () => {
    const it = TYPES[b.dataset.t], t = it.kind === 'wall' ? 'sekat' : 'place:' + it.t;
    if (it.t === 'menara') return openMenara();
    setTool(tool === t ? 'select' : t);
    if (tool === 'select') return;
    hint(it.kind === 'wall' ? 'Klik-seret untuk menggambar sekat — panjang tampil langsung; tahan Shift untuk sudut bebas'
      : it.t === 'lmb' && model.menara && !isMn() ? 'Klik dekat dinding — atau klik di tapak menara: LMB otomatis dipasang di lantai Menara'
      : OPENINGS.has(it.t) ? `Klik dekat ${isLar(it.t) ? 'garis sekat' : 'dinding'} — ${it.name} menempel dan memotongnya otomatis`
      : it.t === 'hexa' ? 'Klik dekat LMB — tweeter hexagonal menempel di atas LMB (di menara atau lantai ber-LMB)'
      : `Klik di denah untuk meletakkan ${it.name}`);
  });
}
// Daftar item lantai aktif: sembunyikan / tampilkan per jenis atau per item — berlaku SEMUA LANTAI ('T:t') atau hanya
// lantai tertentu ('T:t#f'), plus fokus pada satu jenis / item. Hanya tampilan: tidak mengubah desain dan tidak ikut link.
const LIST_ORDER = CATALOG.flatMap(g => g.items.map(it => it.t));
let hidScope = 'semua';   // cakupan tombol mata pada grup: 'semua' lantai atau 'lantai' aktif saja
const tHid = t => hid.has('T:' + t) || hid.has(`T:${t}#${cur}`);
function showOf(o) {
  if (hid.has(o.id) || tHid(o.t)) return 0;
  return !focus || focus === o.id || focus === 'T:' + o.t ? 1 : 0.14;
}
const objOf = id => { const it = findItem(id); if (it) return it; return findWall(id) ? { t: 'sekat', id } : { t: '', id }; };
function itemLabel(it, k) {
  const nm = TYPES[it.t].name.split(' (')[0].split(' –')[0];
  if (it.t === 'twtarik') return `${roleName(der?.roles.get(it.id))}${der?.blocked.has(it.id) ? ' ✕' : ''}`;
  if (isLar(it.t)) return `${it.t === 'larj' ? 'LAR jendela' : 'LAR pintu'} · ${((LAR_FUNGSI.find(([q]) => q === der?.larType.get(it.id)) || [, ''])[1]).replace('LAR ', 'fungsi ')}`;
  if (it.t === 'lmb') return `LMB ${Math.round(Math.max(it.w, it.h) * 100)}×${it.tcm || 50} cm`;
  if (['inap', 'void', 'jalur', 'audio', 'kolam', 'tangga'].includes(it.t)) return `${nm} ${fmt(round(it.w))}×${fmt(round(it.h))} m`;
  return `${nm} ${k + 1}`;
}
function listHTML() {
  if (!model) return '';
  const fl = floor(), groups = [];
  LIST_ORDER.forEach(t => {
    if (t === 'sekat') { if (fl.walls.length) groups.push({ t, name: 'Sekat walet', els: fl.walls.map((w, k) => ({ id: w.id, label: `Sekat ${k + 1} · ${fmt(round(Math.hypot(w.x2 - w.x1, w.y2 - w.y1)))} m${w.jenis === 'gantung' ? ' gantung' : ''}`, locked: w.locked })) }); return; }
    const its = fl.items.filter(it => it.t === t); if (!its.length) return;
    groups.push({ t, name: TYPES[t].name, els: its.map((it, k) => ({ id: it.id, label: itemLabel(it, k), locked: it.locked })) });
  });
  if (model.menara && cur === model.floors.length - 1) groups.push({ t: 'menara', name: 'Tapak menara', els: [] });
  const eye = (key, off) => `<button type="button" class="eye${off ? ' off' : ''}" data-hide="${key}" title="${off ? 'Tampilkan' : 'Sembunyikan'}">${icon(off ? 'eyeoff' : 'eye', 15)}</button>`;
  const eyeT = (t, off) => `<button type="button" class="eye${off ? ' off' : ''}" data-hidet="${t}" title="${off ? 'Tampilkan' : hidScope === 'lantai' ? 'Sembunyikan di lantai ini' : 'Sembunyikan di semua lantai'}">${icon(off ? 'eyeoff' : 'eye', 15)}</button>`;
  const fc = key => `<button type="button" class="fc${focus === key ? ' on' : ''}" data-focus="${key}" title="${focus === key ? 'Keluar dari fokus' : 'Fokus — redupkan yang lain'}">${icon('focus', 15)}</button>`;
  const fname = !focus ? '' : focus.startsWith('T:') ? (groups.find(g => 'T:' + g.t === focus)?.name || 'jenis ini') : (groups.flatMap(g => g.els).find(e => e.id === focus)?.label || 'item');
  return `<div class="lst">
    <div class="scoperow">Mata berlaku untuk <select id="lsScope"><option value="semua"${hidScope === 'semua' ? ' selected' : ''}>semua lantai</option><option value="lantai"${hidScope === 'lantai' ? ' selected' : ''}>lantai ini saja</option></select></div>
    <div class="lg${lblOn ? '' : ' off'}"><button type="button" class="eye${lblOn ? '' : ' off'}" data-lbl title="${lblOn ? 'Sembunyikan keterangan nama ruang' : 'Tampilkan keterangan nama ruang'}">${icon(lblOn ? 'eye' : 'eyeoff', 15)}</button><span class="lgn" style="cursor:default">Keterangan nama ruang</span></div>
    ${kabelOn ? `<div class="lg"><span style="width:26px"></span><span class="lgn" style="cursor:default">Jalur kabel: mata per channel ada di panel kanan</span></div>` : ''}
    ${focus || hid.size ? `<div class="fbar"><span>${focus ? `Fokus: <b>${esc(fname)}</b>` : `${hid.size} disembunyikan`}</span><button type="button" id="lsAll">Tampilkan semua</button></div>` : ''}
    ${groups.length ? groups.map(g => {
      const off = tHid(g.t), open = openT.has(g.t) && g.els.length;
      return `<div class="lg${off ? ' off' : ''}">${eyeT(g.t, off)}<button type="button" class="lgn" data-open="${g.t}">${symbolSVG(g.t, 22)}<span>${g.name}</span><small>${g.els.length || ''}</small>${g.els.length ? `<i>${open ? '▾' : '▸'}</i>` : ''}</button>${fc('T:' + g.t)}</div>`
        + (open ? g.els.map(e => `<div class="li${sel.has(e.id) ? ' on' : ''}${hid.has(e.id) || off ? ' off' : ''}">${eye(e.id, hid.has(e.id))}<button type="button" class="lin" data-pick="${e.id}">${esc(e.label)}${e.locked ? ' · terkunci' : ''}</button>${fc(e.id)}</div>`).join('') : '');
    }).join('') : '<p class="tip">Belum ada elemen di lantai ini.</p>'}
    <p class="tip">Ikon mata = sembunyikan / tampilkan (pilih cakupannya di atas: semua lantai / lantai ini). Ikon fokus = hanya jenis atau item itu yang jelas, lainnya diredupkan — cocok saat menjelaskan desain. Hanya tampilan, desain tidak berubah.</p></div>`;
}
function bindList() {
  const C = $('#catalog');
  const sc = C.querySelector('#lsScope'); if (sc) sc.onchange = () => { hidScope = sc.value; renderCatalog(); };
  const lb = C.querySelector('[data-lbl]'); if (lb) lb.onclick = () => { lblOn = !lblOn; refreshView(); };
  C.querySelectorAll('[data-hidet]').forEach(b => b.onclick = () => {   // mata per JENIS: cakupan semua lantai / lantai ini
    const t = b.dataset.hidet, g = 'T:' + t, f = `T:${t}#${cur}`;
    if (tHid(t)) { hid.delete(g); [...hid].forEach(k => { if (k.startsWith('T:' + t + '#')) hid.delete(k); }); }
    else { hid.add(hidScope === 'lantai' ? f : g); if (focus === g) focus = null; }
    [...sel].forEach(id => { if (!showOf(objOf(id))) sel.delete(id); }); refreshView();
  });
  C.querySelectorAll('[data-hide]').forEach(b => b.onclick = () => {
    const k = b.dataset.hide; if (hid.has(k)) hid.delete(k); else { hid.add(k); if (focus === k) focus = null; }
    [...sel].forEach(id => { if (!showOf(objOf(id))) sel.delete(id); }); refreshView();
  });
  C.querySelectorAll('[data-focus]').forEach(b => b.onclick = () => { const k = b.dataset.focus; focus = focus === k ? null : k; hid.delete(k); refreshView(); });
  C.querySelectorAll('[data-open]').forEach(b => b.onclick = () => { const t = b.dataset.open; if (openT.has(t)) openT.delete(t); else openT.add(t); renderCatalog(); });
  C.querySelectorAll('[data-pick]').forEach(b => b.onclick = () => {
    const id = b.dataset.pick, o = objOf(id); hid.delete(id); hid.delete('T:' + o.t); hid.delete(`T:${o.t}#${cur}`);
    if (focus && showOf(o) < 1) focus = null;
    sel = new Set([id]); refreshView();
  });
  const a = $('#lsAll'); if (a) a.onclick = () => { hid.clear(); focus = null; refreshView(); };
}
// Perubahan tampilan saja (sembunyi / fokus): tanpa commit, 3D ikut diperbarui.
function refreshView() { renderCatalog(); renderPlan(); renderSide(false); if (view === '3d' && three) three.build(model, cur, opts3d()); }
function renderFloors() {
  const el = $('#floorBar'), LV = levels(model), nF = model.floors.length;
  const size = f => { if (!f.menara && isFull(model, f)) return ''; const F = floorRect(model, f); return ` · ${fmt(F.w)}×${fmt(F.h)}`; };
  el.innerHTML = `<span class="lbl">Lantai</span>` + LV.map((f, i) => `<button type="button" role="tab" data-i="${i}" class="${i === cur ? 'on' : ''}${f.menara ? ' mn' : ''}" aria-selected="${i === cur}">${f.menara ? `${icon('tower', 13)} ` : ''}${f.name}${size(f)}${i === nF - 1 ? ' · atas' : ''}</button>`).join('')
    + `<button type="button" class="add" id="addFloor" title="Tambah lantai">${icon('plus', 14)} Tambah</button>`
    + (model.menara ? '' : `<button type="button" class="add" id="addMenara" title="Menara (rumah monyet) di atas void — lantai sendiri untuk LMB & tweeter hexagonal">${icon('tower', 14)} Menara</button>`)
    + (cur > 0 && !isMn() ? `<button type="button" class="add" id="copyFloor" title="Salin sekat, ruang, dan tweeter dari lantai di bawahnya">${icon('copy', 14)} Salin dari bawah</button>` : '')
    + (isMn() || nF > 1 ? `<button type="button" class="add" id="delFloor" title="${isMn() ? 'Hapus menara' : 'Hapus lantai aktif'}">${icon('trash', 14)}</button>` : '');
  el.querySelectorAll('[data-i]').forEach(b => b.onclick = () => goLevel(+b.dataset.i));
  $('#addFloor').onclick = () => { commit(); model.floors.push({ name: `Lantai ${nF + 1}`, items: [], walls: [] }); cur = model.floors.length - 1; sel.clear(); resetSig(); renderAll(); };
  const am = $('#addMenara'); if (am) am.onclick = openMenara;
  const c = $('#copyFloor');
  if (c) c.onclick = () => {
    if (floor().items.length && !confirm(`Ganti isi ${floor().name} dengan salinan ${model.floors[cur - 1].name}?`)) return;
    commit(); const src = model.floors[cur - 1];
    const F = FR();   // lantai ini bisa lebih kecil → hanya salin yang berada di dalam batasnya
    floor().items = src.items.filter(it => !['kolam', 'audio', 'pintu', 'lmb', 'menara'].includes(it.t) && ovArea(it, F) > 0.5 * it.w * it.h).map(it => clampInto({ ...it, id: uid() }, F));
    floor().walls = src.walls.map(s => clipWall({ ...s, id: uid() }, F)).filter(Boolean); sel.clear(); resetSig(); renderAll();
  };
  const d = $('#delFloor');
  if (d) d.onclick = () => {
    if (isMn()) { if (!confirm('Hapus menara beserta LMB & tweeter di dalamnya?')) return; commit(); delete model.menara; cur = model.floors.length - 1; sel.clear(); resetSig(); renderAll(); return; }
    if (!confirm(`Hapus ${floor().name} beserta isinya?`)) return; commit(); SK.shiftSketches(model, cur, model.floors.length); model.floors.splice(cur, 1); normalize(model); cur = Math.min(cur, model.floors.length - 1); sel.clear(); resetSig(); renderAll();
  };
}
function goLevel(i) { cur = clamp(i, 0, levels(model).length - 1); sel.clear(); save(); renderAll(); }
// Lantai menara: dibuat tepat di atas void lantai teratas; LMB & tweeter hexagonal dipasang di sini.
function openMenara() {
  if (!model.menara) {
    commit(); model.menara = { name: 'Menara', menara: true, ...menaraRect(model), ht: 2.5, items: [], walls: [] }; resetSig();
    hint('Menara dibuat tepat di atas void — pasang LMB di dindingnya (klik dekat dinding) dan tweeter hexagonal di atas LMB.', 8000);
  } else hint('Lantai menara: LMB menempel ke dinding menara, tweeter hexagonal menempel di atas LMB.');
  cur = model.floors.length; sel.clear(); tool = 'select'; calib = null; save(); renderAll();
}
function renderTools() {
  const sk = SK.getSketch(model, cur), b = (t, ic, title) => `<button type="button" data-tool="${t}" class="${tool === t ? 'on' : ''}" title="${title}">${icon(ic)}</button>`;
  $('#tools').innerHTML = `${b('select', 'select', 'Pilih / geser objek (V) — seret area kosong untuk memilih banyak')}${b('geser', 'hand', 'Geser tampilan (H) — atau tahan Spasi / seret tombol tengah mouse')}${b('sekat', 'wall', 'Gambar sekat walet (W)')}${b('ukur', 'ruler', 'Penggaris (M)')}
   <span class="sep"></span>
   <button type="button" id="tUndo" title="Undo (Ctrl+Z)" ${undoStack.length ? '' : 'disabled'}>${icon('undo')}</button>
   <button type="button" id="tRedo" title="Redo (Ctrl+Y)" ${redoStack.length ? '' : 'disabled'}>${icon('redo')}</button>
   <span class="sep"></span>
   <button type="button" id="tFit" title="Pas ke layar">${icon('fit')}</button>
   <button type="button" id="tStruk" class="${model.showStruktur !== false ? 'on' : ''}" title="Tampilkan kolom & balok">${icon('kolom')}</button>
   <button type="button" id="tAuto" title="Isi otomatis lantai ini (dari jawaban pengamatan)">${icon('spark')}</button>
   <button type="button" id="tLux" class="lux${luxOn ? ' on' : ''}" title="Cek lux — simulasi cahaya dari LMB ke seluruh ruang">${icon('sun')}</button>
   <button type="button" id="tAir" class="air${airOn ? ' on' : ''}" title="Cek udara — siklus udara + suhu & kelembapan per lantai">${icon('wind')}</button>
   <button type="button" id="tDb" class="db${dbOn ? ' on' : ''}" title="Cek dB — sebaran suara tarik & inap per ruang">${icon('db')}</button>
   <button type="button" id="tKabel" class="kbl${kabelOn ? ' on' : ''}" title="Kabel — jalur kabel tweeter ke ruang audio + klem">${icon('cable')}</button>${sk ? `
   <button type="button" id="tSketch" class="${sk.show !== false ? 'on' : ''}" title="Tampilkan / sembunyikan foto sketsa">${icon('photo')}</button>` : ''}`;
  $('#tools').querySelectorAll('[data-tool]').forEach(x => x.onclick = () => setTool(x.dataset.tool));
  $('#tUndo').onclick = undo; $('#tRedo').onclick = redo; $('#tFit').onclick = () => { fit(); renderPlan(); };
  $('#tStruk').onclick = () => { model.showStruktur = model.showStruktur === false; save(); renderAll(); };
  $('#tAuto').onclick = () => {
    if (floor().items.length && !confirm(`Ganti isi ${floor().name} dengan tata letak otomatis?`)) return;
    commit(); generate(model, model.survey, cur); sel.clear(); resetSig(); renderAll();
  };
  $('#tLux').onclick = () => {
    luxOn = !luxOn; if (!luxOn) hideTip(); renderAll();
    if (luxOn) hint('Cek lux: arahkan kursor ke denah untuk membaca lux di titik itu — atur arah hadap, jam & langit di panel kanan.', 7000);
  };
  $('#tAir').onclick = () => {
    airOn = !airOn; renderAll();
    if (airOn) hint('Cek udara: panah biru = udara masuk, merah = keluar (m³/jam) + suhu & kelembapan tiap lantai di panel kanan.', 8000);
  };
  $('#tDb').onclick = () => {
    dbOn = !dbOn; renderAll();
    if (dbOn) hint('Cek dB: angka T = suara tarik, I = suara inap per ruang — atur volume channel lewat tombol "Ruang audio" di atas.', 8000);
  };
  $('#tKabel').onclick = () => {
    kabelOn = !kabelOn; renderAll();
    if (kabelOn) hint('Kabel: jalur tiap channel ke ruang audio (R) — siku mengikuti sirip/dinding, menembus terpal, tidak menembus bata.', 8000);
  };
  const ts = $('#tSketch');
  if (ts) ts.onclick = () => { SK.setSketch(model, cur, { ...sk, show: sk.show === false }); renderTools(); renderPlan(); renderSide(); };
}
function setTool(t) {
  tool = t; if (t !== 'calib') calib = null;
  if (t === 'sekat' || t === 'calib' || t.startsWith('place:')) sel.clear();
  renderCatalog(); renderTools(); renderPlan(); renderSide();
  if (t === 'ukur') hint('Penggaris: seret dari titik ke titik — menempel ke ujung sekat, sudut, dan tepi objek. Shift = lurus. Esc = hapus ukuran.', 7000);
  if (t === 'geser') hint('Geser tampilan: seret denah. Tekan H atau V untuk kembali memilih objek.');
}
let hintT;
function hint(msg, ms = 4000) { const h = $('#hint'); clearTimeout(hintT); if (!msg) { h.classList.remove('show'); return; } h.textContent = msg; h.classList.add('show'); hintT = setTimeout(() => h.classList.remove('show'), ms); }

// ---------- denah ----------
const svg = $('#plan');
const toM = (px, py) => ({ x: (px - vp.ox) / vp.s, y: (py - vp.oy) / vp.s });
function fit() {
  const r = svg.getBoundingClientRect(); if (!r.width || !model) return;
  vp.s = Math.max(6, Math.min((r.width - 110) / model.w, (r.height - 100) / model.h));
  vp.ox = (r.width - model.w * vp.s) / 2; vp.oy = (r.height - model.h * vp.s) / 2 + 8;
}
function luxEnsure() {
  if (!luxOn || !model) return null;
  let L = null; try { L = simulate(model); } catch (e) { console.error('simulasi cahaya', e); }
  if (luxRes && luxRes !== L) luxRes.heat.forEach(u => u && URL.revokeObjectURL(u));
  return (luxRes = L);
}
function luxLabels(L, lf) {
  // nama ruang ikut ditulis bila ruangnya cukup lebar di layar (ruang sempit: angka lux saja agar tidak bertumpuk)
  const out = lf.regions.filter(r => r.area >= 1).map(r => {
    const t = luxTxt(r.lux), full = `${r.name} ${t}`, fits = (r.box?.w || 0) * vp.s >= full.length * 6.2 + 18;
    return { x: r.cx, y: r.cy, txt: fits ? full : t, bad: r.type === 'inap' && r.lux > RULES.luxInap };
  });
  return out;
}
// label dB per ruang (mode "Cek dB"): T = suara tarik, I = suara inap
function dbLabels() {
  let S; try { S = simulateSound(model); } catch { return null; }
  const f = S.floors[cur]; if (!f) return null;
  return f.regions.filter(r => r.area >= 1).map(r => {
    const bad = nilaiDb(r, S.target).length > 0;
    return { x: r.cx, y: r.cy, txt: r.tarik || r.inap ? `T ${r.tarik || '–'} · I ${r.inap || '–'} dB` : 'senyap', bad };
  });
}
function cableRuns() {
  let cb; try { cb = cableInfo(model); } catch { return null; }
  const tampil = cb.chs.filter(c => !hidCh.has(c.id));
  const runs = tampil.flatMap(c => c.runs.filter(r => r.f === cur).map(r => ({ warna: c.warna, pts: r.pts, on: c.on })));
  // keterangan ujung: tweeter terakhir tiap jalur ditandai "ujung"
  const ends = tampil.flatMap(c => c.runs.filter(r => r.f === cur && !r.drop && r.ujung).map(r => ({ x: r.ujung[0], y: r.ujung[1], warna: c.warna })));
  // sambungan riser → ruang audio (semua kabel dari RBW berujung & tersambung ke ruang audio)
  if (cb.au && cb.au.li === cur) {
    const ac = center(cb.au.it);
    runs.push({ warna: '#455A64', pts: [[cb.riser.x, cb.riser.y], [ac.x, cb.riser.y], [ac.x, ac.y]], on: true });
  }
  const LVn = levels(model);
  const riserTxt = cb.au ? (cb.au.li === cur ? '→ ruang audio' : `↕ ke ${LVn[cb.au.li]?.name || 'Lantai 1'} → ruang audio`) : '↕ turun ke pojok gedung';
  return { runs, ends, riser: cb.riser, riserTxt };
}
function renderPlan() {
  const r = svg.getBoundingClientRect(); if (!r.width || !model) return;
  svg.setAttribute('class', 'pl-plan' + (tool === 'sekat' ? ' t-sekat' : tool.startsWith('place:') || tool === 'calib' ? ' t-place' : tool === 'ukur' ? ' t-ukur' : tool === 'site' ? ' t-site' : '')
    + (tool === 'geser' || spaceDown ? ' t-geser' : '') + (drag?.mode === 'pan' ? ' panning' : ''));
  der = derive(model, floor());
  const sk = SK.getSketch(model, cur), L = luxOn ? (drag ? luxRes : luxEnsure()) : null, lf = L?.floors[cur];
  const site = SK.getSketch(model, 100);
  const ms = measures.filter(q => q.f === cur).concat(drag?.mode === 'ukur' ? [drag] : []);
  let html = drawFloor(model, cur, {
    s: vp.s, ox: vp.ox, oy: vp.oy, pfx: 'pl', interactive: true, sel, grid: 'canvas', vw: r.width, vh: r.height, dims: true, ghost: true, chain: !luxOn, der,
    preview: drag?.mode === 'wall' ? drag : null, sketch: sk && sk.show !== false ? { ...sk, href: SK.sketchHref(sk) } : null,
    heat: lf ? { href: heatURL(L, cur), x: lf.F.x, y: lf.F.y, w: lf.nx * lf.cs, h: lf.ny * lf.cs } : null,
    luxLabels: lf ? luxLabels(L, lf) : dbOn && !drag ? dbLabels() : null, labels: lblOn,
    measures: ms, marquee: drag?.mode === 'marquee' ? drag : null, flow: lf ? L.flow[cur] : null, link: drag?.mode === 'link' ? drag : null,
    show: showOf, air: airOn ? airArrows() : null, cables: kabelOn && !drag ? cableRuns() : null,
    site: site?.src ? siteDraw() : null,
    mark: mark && (mark.f == null || mark.f === cur) ? mark : null,
  });
  // tweeter channel yang sedang berbunyi ditandai lingkaran berdenyut (warna channel-nya)
  if (SND.playing.size) {
    try {
      const rings = channels(model).filter(c2 => SND.isPlaying(c2.id) && chCover(c2, cur)).flatMap(c2 =>
        floor().items.filter(it => it.t === c2.t && showOf(it)).map(it => {
          const p2 = center(it);
          return `<circle cx="${round(vp.ox + p2.x * vp.s, 1)}" cy="${round(vp.oy + p2.y * vp.s, 1)}" r="12" fill="none" stroke="${c2.warna}" stroke-width="2.6"/>`;
        }));
      if (rings.length) html += `<g class="sndm" pointer-events="none">${rings.join('')}</g>`;
    } catch {}
  }
  // pratinjau jalur kabel manual yang sedang digambar
  if (tool === 'rute' && pendRute) {
    const warna = channels(model).find(c2 => c2.id === pendRute.id)?.warna || '#00897B';
    const P2 = pendRute.pts.map(([px2, py2]) => `${round(vp.ox + px2 * vp.s, 1)},${round(vp.oy + py2 * vp.s, 1)}`);
    html += `<g pointer-events="none">${P2.length > 1 ? `<polyline points="${P2.join(' ')}" fill="none" stroke="${warna}" stroke-width="2.6" stroke-dasharray="7 5" stroke-linejoin="round"/>` : ''}${P2.map(pt2 => `<circle cx="${pt2.split(',')[0]}" cy="${pt2.split(',')[1]}" r="4" fill="#fff" stroke="${warna}" stroke-width="2"/>`).join('')}</g>`;
  }
  // alat "Geser / perbesar foto": bingkai + pegangan sudut foto satelit (fotonya yang digeser, bukan gedung)
  if (tool === 'site' && site?.src) {
    const R = siteRect(site), rad = ((site.rot || 0) * Math.PI) / 180, co = Math.cos(rad), si = Math.sin(rad);
    const pts = [[-R.w / 2, -R.h / 2], [R.w / 2, -R.h / 2], [R.w / 2, R.h / 2], [-R.w / 2, R.h / 2]]
      .map(([x, y]) => [vp.ox + (R.cx + x * co - y * si) * vp.s, vp.oy + (R.cy + x * si + y * co) * vp.s]);
    html += `<g class="siteBox"><polygon points="${pts.map(p2 => p2.map(v => round(v, 1)).join(',')).join(' ')}" fill="none" stroke="#1565C0" stroke-width="1.6" stroke-dasharray="8 5"/>`
      + pts.map(([x, y], k) => `<rect class="hs" data-hs="${k}" x="${round(x - 6, 1)}" y="${round(y - 6, 1)}" width="12" height="12" rx="2"/>`).join('') + '</g>';
  }
  const one = single();
  if (one?.kind === 'wall' && !one.el.locked) html += [1, 2].map(k => `<circle class="hdw" data-end="${k}" cx="${round(vp.ox + one.el['x' + k] * vp.s, 1)}" cy="${round(vp.oy + one.el['y' + k] * vp.s, 1)}" r="6"/>`).join('');
  if (tool === 'calib' && calib?.p1) {
    const x = round(vp.ox + calib.p1.x * vp.s, 1), y = round(vp.oy + calib.p1.y * vp.s, 1);
    html += `<g stroke="#C62828" stroke-width="1.6" fill="none" pointer-events="none"><circle cx="${x}" cy="${y}" r="9"/><path d="M${x - 15} ${y}h30M${x} ${y - 15}v30"/></g>`;
  }
  svg.innerHTML = html;
}

// ---------- interaksi pointer ----------
function pt(e) { const r = svg.getBoundingClientRect(); return toM(e.clientX - r.left, e.clientY - r.top); }
// tempel ke ujung sekat / sudut gedung dan ke garis dinding luar; penggaris juga ke sudut & tengah objek
function magnet(p, ukur = false) {
  const F = FR(), x1 = F.x + F.w, y1 = F.y + F.h, tol = clamp((ukur ? 10 : 14) / vp.s, 0.05, 0.4);
  const pts = [[F.x, F.y], [x1, F.y], [F.x, y1], [x1, y1]].concat(floor().walls.flatMap(s => [[s.x1, s.y1], [s.x2, s.y2]]));
  if (ukur) floor().items.forEach(it => pts.push([it.x, it.y], [it.x + it.w, it.y], [it.x, it.y + it.h], [it.x + it.w, it.y + it.h], [it.x + it.w / 2, it.y + it.h / 2]));
  let best = null;
  for (const [x, y] of pts) { const d = Math.hypot(p.x - x, p.y - y); if (d < tol && (!best || d < best.d)) best = { x, y, d }; }
  if (best) return { x: best.x, y: best.y };
  // menempel ke badan sekat terdekat (sambungan T) — sekat yang menempel otomatis tersambung
  let bw = null;
  floor().walls.forEach(s => {
    const dx = s.x2 - s.x1, dy = s.y2 - s.y1, L2 = dx * dx + dy * dy; if (L2 < 0.01) return;
    const t = clamp(((p.x - s.x1) * dx + (p.y - s.y1) * dy) / L2, 0, 1), qx = s.x1 + t * dx, qy = s.y1 + t * dy, d = Math.hypot(p.x - qx, p.y - qy);
    if (d < tol && (!bw || d < bw.d)) bw = { x: qx, y: qy, d, hz: Math.abs(dy) < 0.01, vt: Math.abs(dx) < 0.01 };
  });
  if (bw) return { x: round(bw.vt ? bw.x : snap(bw.x)), y: round(bw.hz ? bw.y : snap(bw.y)) };
  if (ukur) return { x: round(snap(p.x)), y: round(snap(p.y)) };
  const q = { x: clamp(snap(p.x), F.x, x1), y: clamp(snap(p.y), F.y, y1) };
  if (Math.abs(q.x - F.x) < 0.2) q.x = F.x; if (Math.abs(q.x - x1) < 0.2) q.x = x1;
  if (Math.abs(q.y - F.y) < 0.2) q.y = F.y; if (Math.abs(q.y - y1) < 0.2) q.y = y1;
  return q;
}
// setPointerCapture bisa gagal pada pointer tertentu (sentuh / sintetis) — seret tetap berjalan tanpa capture.
function capture(e) { try { svg.setPointerCapture(e.pointerId); } catch {} }
function startPan(e) { hideTip(); drag = { mode: 'pan', sx: e.clientX, sy: e.clientY, ox: vp.ox, oy: vp.oy }; capture(e); renderPlan(); }
function startDrag(e, mode, it) {
  if (!it) return;
  e.preventDefault(); if (!sel.has(it.id)) { sel.clear(); sel.add(it.id); }
  const p = pt(e);
  drag = { mode, id: it.id, sx: p.x, sy: p.y, ox: it.x, oy: it.y, ow: it.w, oh: it.h, moved: false, before: snapshot() };
  capture(e); renderPlan(); renderSide();
}
// Geser objek terpilih: satu objek (LAR menempel ke sekat), satu sekat (LAR ikut), atau banyak objek sekaligus.
function startMove(e, p) {
  e.preventDefault();
  const items = selItems().filter(i => !i.locked), walls = selWalls().filter(w => !w.locked);
  if (items.length + walls.length === 1) {
    if (items.length) return startDrag(e, 'move', items[0]);
    const s = walls[0], ops = (der?.segs.find(sg => sg.id === s.id)?.ops || []).filter(o => !o.it.locked).map(o => ({ id: o.it.id, x: o.it.x, y: o.it.y }));
    drag = { mode: 'wallmove', id: s.id, sx: p.x, sy: p.y, o: { ...s }, ops, before: snapshot(), moved: false };
    capture(e); renderPlan(); renderSide(); return;
  }
  const extra = new Set();   // LAR / pintu di sekat yang ikut dipindah
  walls.forEach(s => (der?.segs.find(sg => sg.id === s.id)?.ops || []).forEach(o => { if (!o.it.locked && !sel.has(o.it.id)) extra.add(o.it.id); }));
  const movI = items.concat(floor().items.filter(i => extra.has(i.id)));
  const xs = movI.flatMap(i => [i.x, i.x + i.w]).concat(walls.flatMap(w => [w.x1, w.x2])), ys = movI.flatMap(i => [i.y, i.y + i.h]).concat(walls.flatMap(w => [w.y1, w.y2]));
  if (!xs.length) return;
  drag = { mode: 'group', sx: p.x, sy: p.y, items: movI.map(i => ({ it: i, x: i.x, y: i.y })), walls: walls.map(w => ({ w, o: { ...w } })),
    bx0: Math.min(...xs), bx1: Math.max(...xs), by0: Math.min(...ys), by1: Math.max(...ys), before: snapshot(), moved: false };
  capture(e);
}
function placeAt(t, p, keep) {
  if (t === 'menara') return openMenara();
  commit();
  // LMB / hexagonal yang diklik di tapak menara → dipasang di lantai menara (bukan di lantai teratas)
  if ((t === 'lmb' || t === 'hexa') && model.menara && cur === model.floors.length - 1 && distToRect(p, floorRect(model, model.menara)) <= 0.8) {
    cur = model.floors.length; sel.clear(); resetSig();
    hint(`${t === 'lmb' ? 'LMB' : 'Tweeter hexagonal'} dipasang di lantai Menara (tapak menara di atas void).`, 6000);
  }
  const T = TYPES[t], F = t === 'audio' ? boundsOf({ t }) : FR();
  if (!inRect(p, F)) hint(`Di luar batas ${floor().name} — elemen diletakkan di tepi lantai.`);
  const it = { id: uid(), t, x: snap(clamp(p.x - T.w / 2, F.x, F.x + F.w - T.w)), y: snap(clamp(p.y - T.h / 2, F.y, F.y + F.h - T.h)), w: T.w, h: T.h };
  if (t === 'inap') it.gap = RULES.siripJarak;
  if (t === 'lmb') { it.tcm = 50; it.lmbTw = { a: 2, s: 4, b: 0 }; }   // DED: 2 tarik bibir atas + 4 inap sisi
  if (t === 'sarang') it.ns = 'jadi';
  if (OPENINGS.has(t) && !snapToWall(it, model, floor()) && isLar(t)) hint('LAR belum menempel di sekat — seret ke garis sekat agar sekat terpotong.');
  if (t === 'hexa' && !snapHexa(it, model, floor())) hint('Belum ada LMB di dekatnya — tweeter hexagonal sebaiknya mepet di atas LMB.', 6000);
  floor().items.push(it); sel = new Set([it.id]);
  if (!keep) tool = 'select';
  settle(); renderCatalog(); renderFloors(); renderTools(); renderPlan(); renderSide();
}
// Kotak pilih: kiri→kanan = objek yang masuk penuh, kanan→kiri = objek yang tersentuh (gaya AutoCAD/SketchUp).
function segHitsRect(a, b, R) {
  if (inRect(a, R) || inRect(b, R)) return true;
  let t0 = 0, t1 = 1; const dx = b.x - a.x, dy = b.y - a.y;
  for (const [p, q] of [[-dx, a.x - R.x], [dx, R.x + R.w - a.x], [-dy, a.y - R.y], [dy, R.y + R.h - a.y]]) {
    if (Math.abs(p) < 1e-9) { if (q < 0) return false; continue; }
    const t = q / p; if (p < 0) t0 = Math.max(t0, t); else t1 = Math.min(t1, t);
    if (t0 > t1) return false;
  }
  return true;
}
function marqueeHits(R, cross) {
  const fl = floor(), inside = r => r.x >= R.x - 1e-6 && r.y >= R.y - 1e-6 && r.x + r.w <= R.x + R.w + 1e-6 && r.y + r.h <= R.y + R.h + 1e-6;
  return fl.items.filter(it => !it.locked && (cross ? ovArea(it, R) > 0 : inside(it))).map(it => it.id)
    .concat(fl.walls.filter(w => !w.locked && (cross ? segHitsRect({ x: w.x1, y: w.y1 }, { x: w.x2, y: w.y2 }, R) : inRect({ x: w.x1, y: w.y1 }, R) && inRect({ x: w.x2, y: w.y2 }, R))).map(w => w.id));
}
// Kalibrasi foto sketsa: klik dua sudut berseberangan garis luar gedung pada foto → foto diregangkan ke batas lantai.
function startCalib() {
  const k = SK.getSketch(model, cur); if (!k) return;
  if (k.show === false) SK.setSketch(model, cur, { ...k, show: true });
  setTool('calib'); calib = { p1: null };
  hint('Kalibrasi: klik salah satu sudut garis luar gedung pada foto sketsa (Esc = batal).', 15000);
}
function calibClick(p) {
  if (!calib?.p1) { calib = { p1: p }; renderPlan(); hint('Sekarang klik sudut yang berseberangan (diagonal) dari sudut pertama.', 15000); return; }
  if (Math.abs(p.x - calib.p1.x) < 0.3 || Math.abs(p.y - calib.p1.y) < 0.3) { hint('Titik terlalu dekat — klik sudut yang berseberangan (diagonal).', 6000); return; }
  SK.setSketch(model, cur, SK.calibrate(SK.getSketch(model, cur), calib.p1, p, FR()));
  setTool('select'); hint('Foto sketsa sudah pas dengan batas lantai — jiplak dengan alat sekat & katalog.', 6000);
}
// Tooltip "cek lux" di bawah kursor (sentuh: ketuk area kosong).
const tip = Object.assign(document.createElement('div'), { className: 'pl-luxtip', hidden: true });
$('#stage').append(tip);
let tipT;
function hideTip() { tip.hidden = true; }
function showTip(e, ms) {
  if (!luxOn || !luxRes || view !== '2d') return hideTip();
  const p = pt(e), q = luxRes.at(cur, p.x, p.y); if (!q) return hideTip();
  const r = $('#stage').getBoundingClientRect();
  tip.innerHTML = `<b>${luxTxt(q.lux)}</b> · ${kategori(q.lux)}<br><small>${esc(q.region.name)} — rata-rata ${luxTxt(q.region.lux)}</small>`;
  tip.style.left = `${Math.max(4, Math.min(r.width - 230, e.clientX - r.left + 14))}px`; tip.style.top = `${Math.max(4, Math.min(r.height - 56, e.clientY - r.top + 14))}px`;
  tip.hidden = false; clearTimeout(tipT); if (ms) tipT = setTimeout(hideTip, ms);
}

svg.addEventListener('contextmenu', e => e.preventDefault());
svg.addEventListener('dblclick', () => { if (tool === 'rute') finishRute(); });
svg.addEventListener('pointerleave', hideTip);
svg.addEventListener('pointerdown', e => {
  if (mark) { mark = null; renderPlan(); }
  if (e.button === 1 || e.button === 2 || tool === 'geser' || spaceDown) return startPan(e);
  const p = pt(e);
  if (tool === 'calib') return calibClick(p);
  if (tool === 'ukur') { const a = magnet(p, true); drag = { mode: 'ukur', x1: a.x, y1: a.y, x2: a.x, y2: a.y }; capture(e); return; }
  if (tool === 'sekat') { const a = magnet(p); drag = { mode: 'wall', x1: a.x, y1: a.y, x2: a.x, y2: a.y }; capture(e); return; }
  if (tool === 'rute') {   // gambar jalur kabel manual: klik titik-titik (otomatis siku), Enter/dobel-klik selesai
    if (!pendRute) { setTool('select'); return; }
    let q = { x: snap(p.x), y: snap(p.y) };
    const last = pendRute.pts[pendRute.pts.length - 1];
    if (last && !e.shiftKey) { if (Math.abs(q.x - last[0]) > Math.abs(q.y - last[1])) q.y = last[1]; else q.x = last[0]; }
    pendRute.pts.push([round(q.x), round(q.y)]);
    renderPlan(); return;
  }
  if (tool === 'site') {   // geser / perbesar foto satelit (bukan gedungnya)
    const sk2 = SK.getSketch(model, 100);
    if (!sk2?.src) { setTool('select'); return; }
    const R = siteRect(sk2), c = { x: R.cx, y: R.cy };
    if (e.target.closest('.hs')) drag = { mode: 'siteScale', sk: sk2, d0: Math.max(0.4, dist(p, c)), w0: R.w };
    else drag = { mode: 'siteMove', sk: sk2, p0: p, cx0: R.cx, cy0: R.cy };
    capture(e); return;
  }
  if (tool.startsWith('place:')) return placeAt(tool.slice(6), p, e.shiftKey);
  if (e.target.closest('.mnlink')) return goLevel(model.floors.length);
  const hc = e.target.closest('.hc'), hcIt = hc && findItem(hc.dataset.id);
  if (hcIt && !hcIt.locked) {
    const c = center(hcIt); drag = { mode: 'link', id: hcIt.id, x1: c.x, y1: c.y, x2: p.x, y2: p.y }; capture(e);
    hint('Lepaskan di atas tweeter tarik yang ada di depannya — rantai sebaiknya lewat LAR, tidak menembus sekat.', 6000); return;
  }
  const hdw = e.target.closest('.hdw'), hd = e.target.closest('.hd'), el = e.target.closest('.el'), wl = e.target.closest('.wall'), one = single();
  if (hdw && one?.kind === 'wall' && !one.el.locked) { drag = { mode: 'wallend', id: one.el.id, end: hdw.dataset.end, before: snapshot(), moved: false }; capture(e); return; }
  if (hd && one?.kind === 'item' && !one.el.locked) return startDrag(e, 'resize', one.el);
  const id = el?.dataset.id || wl?.dataset.wid;
  if (id) {
    if (e.shiftKey || e.ctrlKey || e.metaKey) { if (sel.has(id)) sel.delete(id); else sel.add(id); renderPlan(); renderSide(); return; }
    if (!sel.has(id)) { sel.clear(); sel.add(id); }
    if ((findItem(id) || findWall(id))?.locked) { renderPlan(); renderSide(); hint('Terkunci — buka kuncinya dulu (tombol di panel kanan atau tekan L).'); return; }
    return startMove(e, p);
  }
  if (e.pointerType === 'touch') { if (luxOn) showTip(e, 3000); sel.clear(); startPan(e); renderSide(); return; }
  drag = { mode: 'marquee', x1: p.x, y1: p.y, x2: p.x, y2: p.y, sx: e.clientX, sy: e.clientY, add: e.shiftKey || e.ctrlKey || e.metaKey, base: new Set(sel) };
  capture(e);
});
svg.addEventListener('pointermove', e => {
  if (!drag) { if (luxOn) showTip(e); return; }
  if (drag.mode === 'pan') { vp.ox = drag.ox + e.clientX - drag.sx; vp.oy = drag.oy + e.clientY - drag.sy; renderPlan(); return; }
  const p = pt(e);
  if (drag.mode === 'marquee' || drag.mode === 'link') { drag.x2 = p.x; drag.y2 = p.y; renderPlan(); return; }
  if (drag.mode === 'siteMove') { drag.sk.cx = round(drag.cx0 + p.x - drag.p0.x); drag.sk.cy = round(drag.cy0 + p.y - drag.p0.y); renderPlan(); return; }
  if (drag.mode === 'siteScale') {
    const c = { x: drag.sk.cx ?? model.w / 2, y: drag.sk.cy ?? model.h / 2 };
    drag.sk.wM = round(clamp((drag.w0 * dist(p, c)) / drag.d0, 2, 800));
    renderPlan(); renderSide(false); return;
  }
  if (drag.mode === 'ukur') {
    const b = magnet(p, true); let x2 = b.x, y2 = b.y;
    if (e.shiftKey) { if (Math.abs(x2 - drag.x1) > Math.abs(y2 - drag.y1)) y2 = drag.y1; else x2 = drag.x1; }
    drag.x2 = x2; drag.y2 = y2; renderPlan(); return;
  }
  if (drag.mode === 'wall') {
    const b = magnet(p); let x2 = b.x, y2 = b.y;
    if (!e.shiftKey) { if (Math.abs(x2 - drag.x1) > Math.abs(y2 - drag.y1)) y2 = drag.y1; else x2 = drag.x1; }
    drag.x2 = x2; drag.y2 = y2; renderPlan(); return;
  }
  if (drag.mode === 'group') {
    const F = FR(); let dx = snap(p.x - drag.sx), dy = snap(p.y - drag.sy);
    dx = clamp(dx, F.x - drag.bx0, F.x + F.w - drag.bx1); dy = clamp(dy, F.y - drag.by0, F.y + F.h - drag.by1);
    drag.items.forEach(o => { o.it.x = round(o.x + dx); o.it.y = round(o.y + dy); });
    drag.walls.forEach(o => Object.assign(o.w, { x1: round(o.o.x1 + dx), x2: round(o.o.x2 + dx), y1: round(o.o.y1 + dy), y2: round(o.o.y2 + dy) }));
    drag.moved = drag.moved || dx !== 0 || dy !== 0; renderPlan(); renderSide(false); return;
  }
  if (drag.mode === 'wallend') {
    const s = findWall(drag.id), b = magnet(p), k = drag.end, o = k === '1' ? '2' : '1';
    s['x' + k] = round(b.x); s['y' + k] = round(b.y);
    if (!e.shiftKey) { if (Math.abs(s['x' + k] - s['x' + o]) > Math.abs(s['y' + k] - s['y' + o])) s['y' + k] = s['y' + o]; else s['x' + k] = s['x' + o]; }
    drag.moved = true; renderPlan(); renderSide(false); return;
  }
  if (drag.mode === 'wallmove') {
    const s = findWall(drag.id), dx = snap(p.x - drag.sx), dy = snap(p.y - drag.sy), F = FR();
    Object.assign(s, { x1: round(clamp(drag.o.x1 + dx, F.x, F.x + F.w)), x2: round(clamp(drag.o.x2 + dx, F.x, F.x + F.w)), y1: round(clamp(drag.o.y1 + dy, F.y, F.y + F.h)), y2: round(clamp(drag.o.y2 + dy, F.y, F.y + F.h)) });
    drag.ops.forEach(o => { const it = findItem(o.id); if (it) { it.x = round(o.x + dx); it.y = round(o.y + dy); } });   // LAR ikut pindah bersama sekat
    drag.moved = drag.moved || dx !== 0 || dy !== 0; renderPlan(); renderSide(false); return;
  }
  const it = findItem(drag.id); if (!it) return;
  const dx = p.x - drag.sx, dy = p.y - drag.sy;
  if (Math.hypot(dx, dy) > 0.02) drag.moved = true;
  const F = boundsOf(it);
  if (drag.mode === 'move') {
    it.x = snap(clamp(drag.ox + dx, F.x, F.x + F.w - it.w)); it.y = snap(clamp(drag.oy + dy, F.y, F.y + F.h - it.h));
    if (OPENINGS.has(it.t)) snapToWall(it, model, floor());
  } else { it.w = snap(clamp(drag.ow + dx, 0.1, F.x + F.w - it.x)); it.h = snap(clamp(drag.oh + dy, 0.1, F.y + F.h - it.y)); }
  renderPlan(); renderSide(false);
});
svg.addEventListener('pointerup', e => {
  if (!drag) return;
  const dm = drag.mode;
  if (dm === 'wall') {
    if (Math.hypot(drag.x2 - drag.x1, drag.y2 - drag.y1) >= 0.3) {
      commit();
      const n0 = derive(model, floor()).rooms.length;
      const s = { id: uid(), x1: round(drag.x1), y1: round(drag.y1), x2: round(drag.x2), y2: round(drag.y2), jenis: 'penuh' };
      floor().walls.push(s); joinWall(s); sel = new Set([s.id]); settle();
      const n1 = derive(model, floor()).rooms.length;
      hint(n1 > n0 ? `Sekat membagi ruang inap — sekarang ${n1} ruang; tweeter inap pola standar ikut menyesuaikan.`
        : `Sekat ${fmt(round(Math.hypot(s.x2 - s.x1, s.y2 - s.y1)))} m — ketik angka untuk mengubah panjang, lalu Enter.`, 6000);
    }
  } else if (dm === 'marquee') {
    if (Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < 4) { if (!drag.add) sel.clear(); }
    else {
      const R = { x: Math.min(drag.x1, drag.x2), y: Math.min(drag.y1, drag.y2), w: Math.abs(drag.x2 - drag.x1), h: Math.abs(drag.y2 - drag.y1) };
      const hits = marqueeHits(R, drag.x2 < drag.x1);
      sel = drag.add ? new Set([...drag.base, ...hits]) : new Set(hits);
      if (sel.size > 1) hint(`${sel.size} objek dipilih — seret salah satunya untuk memindah bersama · Ctrl+D duplikat · L kunci · Delete hapus.`, 6000);
    }
  } else if (dm === 'ukur') {
    const len = Math.hypot(drag.x2 - drag.x1, drag.y2 - drag.y1);
    if (len >= 0.05) { measures.push({ f: cur, x1: drag.x1, y1: drag.y1, x2: drag.x2, y2: drag.y2 }); measures = measures.slice(-40); hint(`Jarak ${len.toFixed(2).replace('.', ',')} m`); }
  } else if (dm === 'siteMove' || dm === 'siteScale') SK.setSketch(model, 100, { ...drag.sk });
  else if (dm === 'link') linkDrop(e);
  else if (dm !== 'pan' && drag.moved) {
    if ((dm === 'wallend' || dm === 'wallmove') && findWall(drag.id)) joinWall(findWall(drag.id));
    const hx = dm === 'move' && findItem(drag.id);   // tweeter hexagonal yang dilepas dekat LMB langsung menempel
    if (hx?.t === 'hexa' && floor().items.some(l => l.t === 'lmb' && dist(center(l), center(hx)) <= 1.5)) snapHexa(hx, model, floor());
    undoStack.push(drag.before); if (undoStack.length > 60) undoStack.shift(); redoStack = []; settle(); save();
  }
  drag = null; renderTools(); renderPlan(); renderSide();
});
svg.addEventListener('wheel', e => {
  e.preventDefault(); hideTip();
  const r = svg.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
  const ns = clamp(vp.s * (e.deltaY < 0 ? 1.1 : 1 / 1.1), 6, 400);
  vp.ox = mx - (mx - vp.ox) * (ns / vp.s); vp.oy = my - (my - vp.oy) * (ns / vp.s); vp.s = ns; renderPlan();
}, { passive: false });
document.addEventListener('keydown', e => {
  if (!model || e.target.matches?.('input,textarea,select') || $('#dlg').open) return;
  const k = e.key.toLowerCase(), mod = e.ctrlKey || e.metaKey;
  if (e.key === ' ') { e.preventDefault(); if (!spaceDown) { spaceDown = true; renderPlan(); } return; }
  if (mod && k === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); }
  else if (mod && k === 'y') { e.preventDefault(); redo(); }
  else if (mod && k === 'd') { e.preventDefault(); dupSel(); }
  else if (mod && k === 'a') { e.preventDefault(); selectAll(); }
  else if (e.key === 'Delete' || e.key === 'Backspace') deleteSel();
  else if (e.key === 'Enter' && tool === 'rute') { e.preventDefault(); finishRute(); }
  else if (e.key === 'Escape') {
    if (tool === 'rute' && pendRute) { pendRute = null; setTool('select'); hint('Gambar jalur kabel dibatalkan.'); return; }
    if (tool === 'ukur' && measures.some(q => q.f === cur)) { measures = measures.filter(q => q.f !== cur); renderPlan(); renderSide(); return; }
    drag = null; sel.clear(); setTool('select');
  }
  else if (single()?.kind === 'wall' && !single().el.locked && /^[0-9.,]$/.test(e.key) && $('#wLen')) {   // ketik angka → isi panjang sekat (gaya SketchUp)
    e.preventDefault(); const inp = $('#wLen'); inp.focus(); inp.value = /[.,]/.test(e.key) ? '0.' : e.key;
  }
  else if (k === 'v') setTool('select');
  else if (k === 'w') setTool('sekat');
  else if (k === 'm') setTool(tool === 'ukur' ? 'select' : 'ukur');
  else if (k === 'h') setTool(tool === 'geser' ? 'select' : 'geser');
  else if (k === 'l' && sel.size) toggleLock();
  else if (k === 'r' && single()?.kind === 'item') turnSel();
  else if (sel.size && e.key.startsWith('Arrow')) nudge(e);
});
document.addEventListener('keyup', e => { if (e.key === ' ' && spaceDown) { spaceDown = false; renderPlan(); } });
function nudge(e) {
  e.preventDefault();
  const items = selItems().filter(i => !i.locked), walls = selWalls().filter(w => !w.locked), F = FR(), st = e.shiftKey ? 0.5 : 0.05;
  if (!items.length && !walls.length) { hint('Objek terpilih terkunci.'); return; }
  const xs = items.flatMap(i => [i.x, i.x + i.w]).concat(walls.flatMap(w => [w.x1, w.x2])), ys = items.flatMap(i => [i.y, i.y + i.h]).concat(walls.flatMap(w => [w.y1, w.y2]));
  const dx = clamp(e.key === 'ArrowLeft' ? -st : e.key === 'ArrowRight' ? st : 0, F.x - Math.min(...xs), F.x + F.w - Math.max(...xs));
  const dy = clamp(e.key === 'ArrowUp' ? -st : e.key === 'ArrowDown' ? st : 0, F.y - Math.min(...ys), F.y + F.h - Math.max(...ys));
  if (!dx && !dy) return;
  commit();
  items.forEach(i => { i.x = round(i.x + dx); i.y = round(i.y + dy); });
  walls.forEach(w => Object.assign(w, { x1: round(w.x1 + dx), x2: round(w.x2 + dx), y1: round(w.y1 + dy), y2: round(w.y2 + dy) }));
  settle(); renderPlan(); renderSide();
}
function selectAll() {
  sel = new Set([...floor().items, ...floor().walls].filter(x => !x.locked).map(x => x.id));
  renderPlan(); renderSide(); hint(`${sel.size} objek di ${floor().name} dipilih (yang terkunci tidak ikut).`);
}
function deleteSel() {
  if (!sel.size) return;
  const gone = new Set([...sel].filter(id => { const o = findItem(id) || findWall(id); return o && !o.locked; })), locked = sel.size - gone.size;
  if (!gone.size) { hint('Objek terpilih terkunci — buka kunci dulu untuk menghapus.'); return; }
  commit(); const fl = floor();
  fl.items = fl.items.filter(i => !gone.has(i.id)); fl.walls = fl.walls.filter(w => !gone.has(w.id));
  gone.forEach(id => sel.delete(id)); renderAll();
  if (locked) hint(`${locked} objek terkunci tidak dihapus.`);
}
function dupSel() {
  const items = selItems(), walls = selWalls(); if (!items.length && !walls.length) return;
  const F = FR(), xs = items.flatMap(i => [i.x, i.x + i.w]).concat(walls.flatMap(w => [w.x1, w.x2])), ys = items.flatMap(i => [i.y, i.y + i.h]).concat(walls.flatMap(w => [w.y1, w.y2]));
  const off = (lo, hi, a, b) => (hi + 0.5 <= b ? 0.5 : lo - 0.5 >= a ? -0.5 : 0);   // salinan ±0,5 m, tetap di dalam lantai
  const dx = off(Math.min(...xs), Math.max(...xs), F.x, F.x + F.w), dy = off(Math.min(...ys), Math.max(...ys), F.y, F.y + F.h);
  commit();
  const ni = items.map(i => { const c = clampInto({ ...i, id: uid(), x: i.x + dx, y: i.y + dy }, F); delete c.locked; return c; });
  const nw = walls.map(w => { const c = clipWall({ ...w, id: uid(), x1: w.x1 + dx, x2: w.x2 + dx, y1: w.y1 + dy, y2: w.y2 + dy }, F); if (c) delete c.locked; return c; }).filter(Boolean);
  floor().items.push(...ni); floor().walls.push(...nw);
  sel = new Set([...ni, ...nw].map(x => x.id)); renderAll();
  hint(`${ni.length + nw.length} objek diduplikat — seret untuk memindahkannya.`);
}
function toggleLock() {
  const objs = [...selItems(), ...selWalls()]; if (!objs.length) return;
  const lock = objs.some(o => !o.locked);
  commit(); objs.forEach(o => { if (lock) o.locked = true; else delete o.locked; });
  renderAll(); hint(lock ? `${objs.length} objek dikunci — tidak bisa digeser, diubah, atau dihapus.` : `${objs.length} objek dibuka kuncinya.`);
}
function turnSel() {
  const it = single()?.kind === 'item' ? single().el : null; if (!it || it.t === 'twinap' || it.t === 'twtarik' || it.locked) return;
  commit(); [it.w, it.h] = [it.h, it.w]; clampInto(it, FR());
  if (OPENINGS.has(it.t)) snapToWall(it, model, floor());
  renderAll();
}
// Tweeter inap satu zona: pola standar di tiap ruang hasil pembagian sekat (tweeter terkunci dipertahankan).
function fillTwinap(z) {
  const fl = floor(), pts = zonePattern(derive(model, fl), z.id);
  fl.items = fl.items.filter(t => !(t.t === 'twinap' && !t.locked && inRect(center(t), z)));
  pts.forEach(p => { if (!fl.items.some(t => t.t === 'twinap' && t.locked && Math.hypot(center(t).x - p.x, center(t).y - p.y) < 0.2)) fl.items.push({ id: uid(), t: 'twinap', x: round(p.x - TW / 2, 3), y: round(p.y - TW / 2, 3), w: TW, h: TW }); });
}
// Sekat yang ujungnya hampir menempel (≤ 25 cm) ke dinding luar / sekat lain langsung disambungkan.
function joinWall(s) {
  const F = FR(), hz = Math.abs(s.y2 - s.y1) < 0.01, vt = Math.abs(s.x2 - s.x1) < 0.01; if (!hz && !vt) return;
  [1, 2].forEach(k => {
    const o = k === 1 ? 2 : 1, x = s['x' + k], y = s['y' + k], dx = Math.sign(x - s['x' + o]), dy = Math.sign(y - s['y' + o]);
    let best = null; const take = (gap, v) => { if (gap > 0.005 && gap <= 0.25 && (!best || gap < best.gap)) best = { gap, v }; };
    floor().walls.forEach(l => {
      if (l === s) return;
      const lh = Math.abs(l.y2 - l.y1) < 0.01, lv = Math.abs(l.x2 - l.x1) < 0.01;
      if (hz && lv && y >= Math.min(l.y1, l.y2) - 0.05 && y <= Math.max(l.y1, l.y2) + 0.05) take((l.x1 - x) * dx, l.x1);
      if (vt && lh && x >= Math.min(l.x1, l.x2) - 0.05 && x <= Math.max(l.x1, l.x2) + 0.05) take((l.y1 - y) * dy, l.y1);
    });
    if (hz) [F.x, F.x + F.w].forEach(c => take((c - x) * dx, c)); else [F.y, F.y + F.h].forEach(c => take((c - y) * dy, c));
    if (best) s[(hz ? 'x' : 'y') + k] = round(best.v);
  });
}
// Garis manual tweeter tarik → tweeter tarik di depannya (dilepas di atas tweeter tujuan).
function linkDrop(e) {
  const it = findItem(drag.id), el = document.elementFromPoint(e.clientX, e.clientY)?.closest?.('.el'), tg = el && findItem(el.dataset.id);
  if (!it || !tg || tg.t !== 'twtarik' || tg.id === it.id) { hint('Batal — lepaskan tepat di atas tweeter tarik lain.'); return; }
  commit(); it.to = tg.id; delete it.dir; settle();
  hint(derive(model, floor()).blocked.has(it.id) ? 'Terhubung, tapi garisnya menembus sekat ✕ — geser salah satu tweeter ke kusen LAR.' : 'Tweeter tarik terhubung ke tweeter di depannya.', 6000);
}
// Area tertutup sekat tanpa zona → dijadikan ruang inap (sirip + tweeter pola standar menghadap pintunya).
function makeInap(rid) {
  const r = der?.sp.regions[rid]; if (!r) return;
  commit();
  const z = clampInto({ id: uid(), t: 'inap', x: round(r.box.x + 0.02), y: round(r.box.y + 0.02), w: round(r.box.w - 0.04), h: round(r.box.h - 0.04), gap: RULES.siripJarak }, FR());
  floor().items.push(z); fillTwinap(z); resetSig(); sel = new Set([z.id]); renderAll();
  hint('Ruang dijadikan ruang inap — sirip & tweeter inap mengikuti pintunya ke arah void.', 6000);
}

// ---------- panel kanan ----------
const rowNum = (label, key, val, step = 0.05, min = 0) => `<div class="row"><span class="k">${label}</span><input type="number" step="${step}" min="${min}" data-p="${key}" value="${val}"></div>`;
const rowSel = (label, key, opts, val) => `<div class="row"><span class="k">${label}</span><select data-p="${key}">${opts.map(([v, t]) => `<option value="${v}"${String(v) === String(val) ? ' selected' : ''}>${t}</option>`).join('')}</select></div>`;
const rowInfo = (label, val) => `<div class="row"><span class="k">${label}</span><span>${val}</span></div>`;
const lockBtn = locked => `<button type="button" id="aLock" class="${locked ? 'warnb' : ''}" title="Kunci (L)">${icon(locked ? 'unlock' : 'lock', 14)} ${locked ? 'Buka kunci' : 'Kunci'}</button>`;

function itemPanel(it) {
  const T = TYPES[it.t], rows = [], tw = it.t === 'twinap' || it.t === 'twtarik' || it.t === 'hexa', on = der.onWall.has(it.id);
  if (!tw) rows.push(rowNum('Lebar (m)', 'w', it.w, 0.05, 0.1), rowNum('Panjang (m)', 'h', it.h, 0.05, 0.1));
  rows.push(rowNum('Posisi X (m)', 'x', it.x), rowNum('Posisi Y (m)', 'y', it.y));
  if (it.t === 'inap') {
    const rs = der.zoneRooms.get(it.id) || [], kotak = it.st === 'kotak', g = it.gap || (kotak ? RULES.siripKotak : RULES.siripJarak);
    const det = rs.map(r => siripDetail(r, der.orient.get(r.id), der.segs)), len = det.reduce((s, x) => s + x.total, 0), wallL = det.reduce((s, x) => s + x.wall, 0);
    const n = floor().items.filter(z => z.t === 'twinap' && inRect(center(z), it)).length, rek = rs.reduce((s, r) => s + twinapRekomendasi(r, der.orient.get(r.id)), 0);
    const o0 = rs[0] ? der.orient.get(rs[0].id) : 'x';
    const masuk = rs.map((r, k) => { const e = der.entr.get(r.id)[0]; return `${rs.length > 1 ? `R${k + 1}: ` : ''}${e ? `<span class="ok">${e.kind === 'lar' ? 'LAR' : 'sekat gantung'} ${SIDE_NAME[e.side]}</span>` : '<span class="bad">belum ada</span>'}`; }).join('<br>');
    rows.push(rowSel('Jenis sirip', 'st', [['panjang', 'Sirip panjang'], ['kotak', 'Sirip kotak (persegi)']], kotak ? 'kotak' : 'panjang'),
      rowNum(kotak ? 'Ukuran kotak (cm)' : 'Jarak sirip (cm)', 'gapcm', Math.round(g * 100), 5, 15),
      ...(kotak ? [] : [rowSel('Arah sirip', 'o', [['', `Otomatis (garis ${o0 === 'x' ? '↔' : '↕'}, melintang arah masuk)`], ['x', 'Garis ↔ (sejajar lebar)'], ['y', 'Garis ↕ (sejajar panjang)']], it.o || '')]),
      rowInfo('Ruang', rs.length > 1 ? `${rs.length} ruang (dibagi sekat)` : '1 ruang'),
      rowInfo('Papan sirip', `${fmt(Math.round(len))} m <small>(${fmt(Math.round(wallL))} m menempel dinding)</small>`),
      rowInfo('Volume papan', `${fmt(round(siripVolume(model, len), 3))} m³ <small>(${model.siripTebal}×${model.siripLebar} cm)</small>`),
      rowInfo('Tweeter inap', `${n} / saran ±${rek}`),
      rowInfo('Jalan masuk', masuk));
  }
  if (it.t === 'sarang') rows.push(rowSel('Jenis titik', 'ns', SARANG_JENIS, it.ns || 'jadi'),
    rowInfo('Fungsi', 'Pemantauan isi gedung; walet penghuni (jadi/polesan/baru) langsung masuk di simulasi 3D'));
  if (it.t === 'jalur') {
    const rs = der.zoneRooms.get(it.id) || [], det = rs.map(r => siripDetail(r, der.orient.get(r.id), der.segs)), len = det.reduce((s, x) => s + x.total, 0);
    const kotak = it.st === 'kotak', mode = kotak ? 'kotak' : it.gap ? 'panjang' : '';
    rows.push(rowSel('Sirip di ruang jalur', 'sir', [['', 'Tanpa sirip'], ['panjang', 'Sirip panjang'], ['kotak', 'Sirip kotak']], mode));
    if (mode) rows.push(rowNum(kotak ? 'Ukuran kotak (cm)' : 'Jarak sirip (cm)', 'gapcm', Math.round((it.gap || (kotak ? RULES.siripKotak : RULES.siripJarak)) * 100), 5, 15),
      rowInfo('Papan sirip', `${fmt(Math.round(len))} m <small>(ikut dihitung sarang)</small>`));
  }
  if (it.t === 'audio') {
    const F = FR(), c = center(it), luar = c.x < F.x || c.x > F.x + F.w || c.y < F.y || c.y > F.y + F.h;
    rows.push(rowInfo('Luas', `${fmt(round(it.w * it.h, 1))} m² <small>(pemilik: ±${RULES.audioLuas} m²)</small>`),
      rowInfo('Posisi', luar ? 'Di luar gedung ✓' : 'Di dalam gedung (boleh diseret keluar batas lantai)'));
  }
  if (isLar(it.t)) rows.push(rowSel('Bentuk LAR', 'jenis', [['lar', 'LAR pintu (1 × 2 m)'], ['larj', 'LAR jendela (1 × 1 m)']], it.t),
    rowSel('Fungsi LAR', 'lt', [['', `Otomatis (${(LAR_FUNGSI.find(([k]) => k === der.larAuto.get(it.id)) || [, 'LAR jalur'])[1]})`], ...LAR_FUNGSI], it.lt || ''),
    rowInfo('Status', on ? '<span class="ok">Memotong sekat ✓</span>' : '<span class="bad">Belum menempel di sekat</span>'));
  if (it.t === 'lmb') {
    const F = FR(), c = center(it), e = [[c.y - F.y, 0, -1], [F.y + F.h - c.y, 0, 1], [c.x - F.x, -1, 0], [F.x + F.w - c.x, 1, 0]].reduce((p, q) => (q[0] < p[0] ? q : p));
    const az = e[0] <= 0.4 ? facadeAz(e[1], e[2], simOf(model).hadap) : null;   // (e[1], e[2]) = arah keluar dinding
    const q = it.lmbTw || { a: 2, s: 4, b: 0 };
    rows.push(rowNum('Tinggi LMB (cm)', 'tcm', it.tcm || 50, 5, 20), rowInfo('Status', on ? `<span class="ok">Memotong dinding${isMn() ? ' menara' : ''} ✓</span>` : '<span class="bad">Belum menempel di dinding luar</span>'),
      ...(az != null ? [rowInfo('Menghadap', `${arahNama(az)} (${Math.round(az)}°)`)] : []),
      rowInfo('Tweeter di LMB', `${q.a} tarik atas · ${q.s} inap sisi · ${q.b} bawah`));
  }
  if (it.t === 'hexa') {
    const d0 = Math.min(Infinity, ...floor().items.filter(z => z.t === 'lmb').map(z => dist(center(z), center(it))));
    rows.push(rowInfo('Posisi', d0 <= 1.2 ? '<span class="ok">Mepet LMB ✓ — di atap tepat di atas LMB</span>' : '<span class="bad">Jauh dari LMB — seret ke dekat LMB</span>'), rowInfo('Suara', 'Panggil · 6 tweeter ke 6 arah'));
  }
  if (it.t === 'vent') {
    const F = FR(), ed = Math.min(it.x - F.x, F.x + F.w - it.x - it.w, it.y - F.y, F.y + F.h - it.y - it.h);
    rows.push(rowInfo('Bentuk', 'Paralon 4" bulat → elbow ke bawah → pipa turun 1 m'), rowInfo('Status', ed <= 0.02 ? '<span class="ok">Menembus dinding luar ✓</span>' : '<span class="bad">Belum menempel di dinding luar</span>'));
  }
  if (it.t === 'pintu') rows.push(rowInfo('Status', on ? '<span class="ok">Memotong dinding ✓</span>' : '<span class="bad">Belum menempel di dinding</span>'));
  if (it.t === 'menara') rows.push(rowNum('Tinggi menara (m)', 'mt', it.mt || 2.5, 0.5, 1));
  if (it.t === 'twinap') rows.push(rowSel('Arah hadap', 'dir', [['', `Otomatis — menghadap jalan masuk (${dirName(der.autoDir.get(it.id))})`], ...DIRS4], Number.isFinite(it.dir) ? snap90(it.dir) : ''));
  if (it.t === 'twtarik') {
    const tg = der.targets.get(it.id), dd = tg ? dist(center(it), center(tg)) : null, c0 = center(it);
    const others = floor().items.filter(z => z.t === 'twtarik' && z.id !== it.id).map(z => ({ z, d: dist(c0, center(z)), ok: der.clear(c0, center(z)) })).sort((a, b) => a.d - b.d).slice(0, 30);
    rows.push(rowSel('Posisi rantai', 'role', [['', `Otomatis (${roleName(der.roles.get(it.id))})`], ...TARIK_ROLES], it.role || ''),
      rowSel('Tweeter di depannya', 'to', [['', `Otomatis${!it.to && tg ? ` (${roleName(der.roles.get(tg.id))}, ${fmt(round(dd, 1))} m)` : ''}`],
        ...others.map(o => [o.z.id, `${roleName(der.roles.get(o.z.id))} · ${fmt(round(o.d, 1))} m${o.ok ? '' : ' · menembus sekat'}`])], it.to || ''),
      rowSel('Arah hadap', 'dir', [['', `Otomatis — ke tweeter di depannya (${dirName(der.autoDir.get(it.id))})`], ...DIRS], Number.isFinite(it.dir) ? it.dir : ''),
      rowInfo('Jarak ke tweeter depan', dd == null ? '—' : dd > RULES.tarikMaksJarak ? `<span class="bad">${fmt(round(dd, 1))} m (> 5 m)</span>` : `${fmt(round(dd, 1))} m`),
      ...(der.blocked.has(it.id) ? [rowInfo('Status', '<span class="bad">Menabrak sekat ✕ — tidak bisa lanjut</span>')] : []));
  }
  const extra = it.t === 'audio' ? `<button type="button" id="aAudio">${icon('audio', 14)} Buka Ruang audio</button>`
    : it.t === 'lmb' ? `<button type="button" id="aLmb">${icon('list', 14)} Tweeter LMB (tampak depan)…</button>`
    : it.t === 'inap' ? `<button type="button" id="aFill">${icon('spark', 14)} Isi tweeter sesuai pola</button>`
    : OPENINGS.has(it.t) && !on && it.t !== 'lmb' ? `<button type="button" id="aSnap">Tempel ke ${isLar(it.t) ? 'sekat' : 'dinding'}</button>`
    : it.t === 'hexa' ? '<button type="button" id="aHexa">Tempel ke LMB</button>' : '';
  const acts = it.locked ? lockBtn(true)
    : `${extra}${tw ? '' : `<button type="button" id="aTurn">${icon('turn', 14)} Putar</button>`}<button type="button" id="aDup">${icon('copy', 14)} Duplikat</button>${lockBtn(false)}<button type="button" class="danger" id="aDel">${icon('trash', 14)} Hapus</button>`;
  return `<div class="card${it.locked ? ' lock' : ''}"><h4><span class="dot" style="background:${T.fill || T.color};border:1px solid ${T.color}"></span>${T.name}${it.locked ? ' · terkunci' : ''}</h4>
    <fieldset${it.locked ? ' disabled' : ''}>${rows.join('')}</fieldset><p class="tip">${T.tip}</p><div class="acts">${acts}</div></div>`;
}
function bindItemPanel(it) {
  $('#props').querySelectorAll('[data-p]').forEach(inp => inp.onchange = () => {
    commit(); const p = inp.dataset.p, v = inp.value, n = +v;
    if (p === 'gapcm') it.gap = clamp(n, 15, 80) / 100;
    else if (p === 'ns') it.ns = v;
    else if (p === 'sir') {   // sirip ruang jalur: tanpa / panjang / kotak
      if (!v) { delete it.gap; delete it.st; delete it.o; }
      else if (v === 'kotak') { it.st = 'kotak'; it.gap = RULES.siripKotak; }
      else { delete it.st; it.gap = RULES.siripJarak; }
    }
    else if (p === 'st') {
      if (v === 'kotak') { it.st = 'kotak'; if (!(it.gap > RULES.siripJarakMax)) it.gap = RULES.siripKotak; }
      else { delete it.st; if (it.gap > RULES.siripJarakMax) it.gap = RULES.siripJarak; }
    }
    else if (p === 'tcm') it.tcm = clamp(n, 20, 120);
    else if (p === 'mt') it.mt = clamp(n, 1, 6);
    else if (p === 'o') { if (v) it.o = v; else delete it.o; }
    else if (p === 'dir') { if (v === '') delete it.dir; else it.dir = n; }
    else if (p === 'role') { if (v) it.role = v; else delete it.role; }
    else if (p === 'lt') { if (v) it.lt = v; else delete it.lt; }
    else if (p === 'to') { if (v) { it.to = v; delete it.dir; } else delete it.to; }
    else if (p === 'jenis') it.t = v;
    else if (p === 'w') it.w = Math.max(0.1, n); else if (p === 'h') it.h = Math.max(0.1, n);
    else if (p === 'x') it.x = n; else if (p === 'y') it.y = n;
    if ('xywh'.includes(p)) clampItem(it);
    if (OPENINGS.has(it.t) && 'xywh'.includes(p)) snapToWall(it, model, floor());
    renderAll();
  });
  const on = (id, fn) => { const b = $('#' + id); if (b) b.onclick = fn; };
  on('aTurn', turnSel); on('aDup', dupSel); on('aDel', deleteSel); on('aLock', toggleLock);
  on('aAudio', () => D.dlgAudio());
  on('aLmb', () => D.dlgLMB(it));
  on('aSnap', () => { commit(); if (!snapToWall(it, model, floor())) hint('Tidak ada sekat/dinding dalam jarak 0,6 m — geser lebih dekat.'); renderAll(); });
  on('aFill', () => { commit(); fillTwinap(it); resetSig(); renderAll(); });
  on('aHexa', () => { commit(); if (!snapHexa(it, model, floor())) hint('Tidak ada LMB dalam jarak 3 m di lantai ini.'); renderAll(); });
}
function wallPanel(s) {
  const len = Math.hypot(s.x2 - s.x1, s.y2 - s.y1), ang = (Math.round(Math.atan2(-(s.y2 - s.y1), s.x2 - s.x1) * 1800 / Math.PI) / 10 + 360) % 360;
  const ops = der.segs.find(sg => sg.id === s.id)?.ops || [];
  $('#props').innerHTML = `<div class="card${s.locked ? ' lock' : ''}"><h4>Sekat walet (terpal)${s.locked ? ' · terkunci' : ''}</h4><fieldset${s.locked ? ' disabled' : ''}>
    <div class="row"><span class="k">Panjang (m)</span><input type="number" step="0.05" min="0.1" id="wLen" value="${round(len)}"></div>
    <div class="row"><span class="k">Sudut (°)</span><input type="number" step="1" min="0" max="359.9" id="wAng" value="${ang}"></div>
    <div class="row"><span class="k">Titik awal X, Y (m)</span><span><input type="number" step="0.05" id="wX1" value="${s.x1}" class="sm"> <input type="number" step="0.05" id="wY1" value="${s.y1}" class="sm"></span></div>
    <div class="row"><span class="k">Titik akhir X, Y (m)</span><span><input type="number" step="0.05" id="wX2" value="${s.x2}" class="sm"> <input type="number" step="0.05" id="wY2" value="${s.y2}" class="sm"></span></div>
    <div class="row"><span class="k">Jenis</span><select id="wJenis"><option value="penuh"${s.jenis !== 'gantung' ? ' selected' : ''}>Penuh (lantai–plafon)</option><option value="gantung"${s.jenis === 'gantung' ? ' selected' : ''}>Gantung (50 cm di bawah sirip)</option></select></div>
    <div class="row"><span class="k">Bahan</span><select id="wBahan"><option value="terpal"${s.bahan !== 'bata' ? ' selected' : ''}>Terpal (kabel bisa menembus)</option><option value="bata"${s.bahan === 'bata' ? ' selected' : ''}>Bata / dinding (kabel tidak menembus)</option></select></div>
    ${rowInfo('Bukaan di sekat ini', ops.length ? ops.map(o => (o.kind === 'jendela' ? 'LAR jendela' : o.kind === 'pintu' && o.it.t === 'lar' ? 'LAR pintu' : 'Pintu')).join(', ') : 'belum ada')}</fieldset>
    <p class="tip">Ketik angka lalu Enter untuk mengubah panjang (0° = ke kanan, 90° = ke depan/atas). Seret garis untuk memindah (LAR ikut), seret titik ujung untuk mengubah panjang. Sekat yang memotong zona ruang inap otomatis membaginya menjadi ruang baru; di bawah sekat gantung burung bisa lewat.</p>
    <div class="acts">${s.locked ? lockBtn(true) : `<button type="button" id="wLarP">+ LAR pintu</button><button type="button" id="wLarJ">+ LAR jendela</button><button type="button" id="aDup">${icon('copy', 14)} Duplikat</button>${lockBtn(false)}<button type="button" class="danger" id="aDel">${icon('trash', 14)} Hapus</button>`}</div></div>`;
  $('#aLock').onclick = toggleLock;
  if (s.locked) return;
  const applyLenAng = () => {
    const L = Math.max(0.1, +$('#wLen').value || len), A = ((+$('#wAng').value || 0) * Math.PI) / 180;
    const F = FR(); commit(); s.x2 = round(clamp(s.x1 + L * Math.cos(A), F.x, F.x + F.w)); s.y2 = round(clamp(s.y1 - L * Math.sin(A), F.y, F.y + F.h)); renderAll();
  };
  $('#wLen').onchange = applyLenAng; $('#wAng').onchange = applyLenAng;
  [['wX1', 'x1', 'x'], ['wY1', 'y1', 'y'], ['wX2', 'x2', 'x'], ['wY2', 'y2', 'y']].forEach(([id, k, ax]) => $('#' + id).onchange = e => {
    const F = FR(), v = +e.target.value || 0; commit();
    s[k] = round(ax === 'x' ? clamp(v, F.x, F.x + F.w) : clamp(v, F.y, F.y + F.h)); renderAll();
  });
  $('#wJenis').onchange = e => { commit(); s.jenis = e.target.value; renderAll(); };
  $('#wBahan').onchange = e => { commit(); if (e.target.value === 'bata') s.bahan = 'bata'; else delete s.bahan; renderAll(); };
  const addLar = t => {
    commit(); const hz = Math.abs(s.x2 - s.x1) >= Math.abs(s.y2 - s.y1), mx = (s.x1 + s.x2) / 2, my = (s.y1 + s.y2) / 2;
    const it = { id: uid(), t, x: round(mx - (hz ? 0.5 : 0.075)), y: round(my - (hz ? 0.075 : 0.5)), w: hz ? 1 : 0.15, h: hz ? 0.15 : 1 };
    floor().items.push(it); sel = new Set([it.id]); renderAll();
  };
  $('#wLarP').onclick = () => addLar('lar'); $('#wLarJ').onclick = () => addLar('larj');
  $('#aDup').onclick = dupSel; $('#aDel').onclick = deleteSel;
}
function multiPanel() {
  const items = selItems(), walls = selWalls(), cnt = {}, all = items.length + walls.length;
  items.forEach(i => { cnt[i.t] = (cnt[i.t] || 0) + 1; });
  const lockedN = items.concat(walls).filter(o => o.locked).length, allTw = items.length && !walls.length && items.every(i => i.t === 'twinap');
  const rows = Object.entries(cnt).map(([t, n]) => rowInfo(TYPES[t].name, n)).concat(walls.length ? [rowInfo('Sekat walet', walls.length)] : []);
  return `<div class="card"><h4>${icon('group', 14)} ${all} objek dipilih${lockedN ? ` · ${lockedN} terkunci` : ''}</h4>${rows.join('')}
    ${allTw ? rowSel('Arah hadap semua', 'mdir', [['', 'Otomatis — menghadap jalan masuk'], ...DIRS4, ['x', '(biarkan)']], 'x') : ''}
    <p class="tip">Shift/Ctrl+klik menambah atau mengurangi pilihan. Kotak pilih kiri→kanan = objek yang masuk penuh; kanan→kiri = objek yang tersentuh. Seret salah satu objek untuk memindah semuanya; panah = geser 5 cm (Shift 50 cm).</p>
    <div class="acts"><button type="button" id="mDup">${icon('copy', 14)} Duplikat</button><button type="button" id="mLock" class="${lockedN === all ? 'warnb' : ''}">${icon(lockedN === all ? 'unlock' : 'lock', 14)} ${lockedN === all ? 'Buka kunci' : 'Kunci'}</button><button type="button" class="danger" id="mDel">${icon('trash', 14)} Hapus</button></div></div>`;
}
function bindMultiPanel() {
  $('#mDup').onclick = dupSel; $('#mLock').onclick = toggleLock; $('#mDel').onclick = deleteSel;
  const md = $('[data-p="mdir"]');
  if (md) md.onchange = () => {
    if (md.value === 'x') return;
    commit(); selItems().filter(i => !i.locked).forEach(i => { if (md.value === '') delete i.dir; else i.dir = +md.value; }); renderAll();
  };
}
// Batas lantai aktif: tiap lantai boleh berbeda ukuran, posisi, dan tinggi.
function applyFloorRect(o) {
  const fl = floor(), F0 = FR(), mn = !!fl.menara, lo = mn ? 1 : 2;
  const w = clamp(+o.w || F0.w, lo, model.w), h = clamp(+o.h || F0.h, lo, model.h);
  const x = clamp(o.x ?? F0.x, 0, model.w - w), y = clamp(o.y ?? F0.y, 0, model.h - h);
  commit();
  if (!mn && x === 0 && y === 0 && w === model.w && h === model.h) { delete fl.fx; delete fl.fy; delete fl.fw; delete fl.fh; }
  else Object.assign(fl, { fx: round(x), fy: round(y), fw: round(w), fh: round(h) });
  const F = FR(); let removed = 0;
  if (mn) {   // menara digeser → isinya ikut pindah; LMB tetap di dinding, hexagonal tetap di atas LMB
    const dx = F.x - F0.x, dy = F.y - F0.y;
    fl.items.forEach(it => { it.x = round(it.x + dx); it.y = round(it.y + dy); clampInto(it, F); if (it.t === 'lmb') snapToWall(it, model, fl); });
    fl.items.filter(it => it.t === 'hexa').forEach(it => snapHexa(it, model, fl));
  }
  fl.items = fl.items.filter(it => { const keep = ovArea(it, F) > 0.3 * it.w * it.h; if (!keep) removed++; return keep; }).map(it => clampInto(it, F));
  const nw = fl.walls.length; fl.walls = fl.walls.map(s => clipWall(s, F)).filter(Boolean); removed += nw - fl.walls.length;
  sel.clear(); save(); renderAll();
  if (removed) hint(`${removed} elemen di luar batas ${fl.name} dihapus — Undo untuk membatalkan.`);
}
function floorPanel() {
  const fl = floor(), F = FR(), mn = isMn(), nm = mn ? 'menara' : 'lantai', st = mn ? 0.05 : 0.5, below = cur > 0 && !mn ? floorRect(model, levels(model)[cur - 1]) : null;
  return `<div class="card"><h4>${mn ? `${icon('tower', 14)} Menara` : fl.name}${cur === model.floors.length - 1 ? ' (teratas)' : ''} — ukuran &amp; tinggi</h4>
    <div class="row"><span class="k">Lebar ${nm} (m)</span><input type="number" step="${st}" min="${mn ? 1 : 2}" max="${model.w}" id="lW" value="${F.w}"></div>
    <div class="row"><span class="k">Panjang ${nm} (m)</span><input type="number" step="${st}" min="${mn ? 1 : 2}" max="${model.h}" id="lH" value="${F.h}"></div>
    <div class="row"><span class="k">Jarak dari kiri (m)</span><input type="number" step="${st}" min="0" id="lX" value="${F.x}"></div>
    <div class="row"><span class="k">Jarak dari depan (m)</span><input type="number" step="${st}" min="0" id="lY" value="${F.y}"></div>
    <div class="row"><span class="k">Tinggi ${nm} (m)</span><input type="number" step="0.1" min="1.5" max="6" id="lT" value="${floorHt(model, fl)}"></div>
    <p class="tip">${mn ? 'Menara (rumah monyet) berdiri tepat di atas void lantai teratas; lantainya terbuka ke void. Pasang LMB di dinding menara (menghadap arah datang burung) dan tweeter hexagonal mepet di atas LMB. Tinggi 2–3 m. Menggeser menara ikut memindah isinya.'
      : 'Lantai boleh lebih kecil dari gedung (mis. lantai atas 10×15 m di tengah gedung 20×25 m). Area di luarnya tampil sebagai dak atap lantai bawah.'}</p>
    <div class="acts">${mn ? '<button type="button" id="lVoid">Tepat di atas void</button>' : '<button type="button" id="lFull">Penuh</button>'}<button type="button" id="lMid">Tengahkan</button>${below ? '<button type="button" id="lSame">Samakan lantai bawah</button>' : ''}</div></div>`;
}
function bindFloorPanel() {
  ['lW', 'lH', 'lX', 'lY'].forEach(id => $('#' + id).onchange = () => applyFloorRect({ w: +$('#lW').value, h: +$('#lH').value, x: +$('#lX').value, y: +$('#lY').value }));
  $('#lT').onchange = e => { const v = clamp(+e.target.value || model.floorH, 1.5, 6), fl = floor(); commit(); if (v === model.floorH && !fl.menara) delete fl.ht; else fl.ht = round(v); renderAll(); };
  const on = (id, fn) => { const b = $('#' + id); if (b) b.onclick = fn; };
  on('lFull', () => applyFloorRect({ w: model.w, h: model.h, x: 0, y: 0 }));
  on('lMid', () => { const F = FR(); applyFloorRect({ w: F.w, h: F.h, x: round((model.w - F.w) / 2), y: round((model.h - F.h) / 2) }); });
  on('lVoid', () => { const r = menaraRect(model); applyFloorRect({ w: r.fw, h: r.fh, x: r.fx, y: r.fy }); });
  on('lSame', () => { const B = floorRect(model, levels(model)[cur - 1]); applyFloorRect({ w: B.w, h: B.h, x: B.x, y: B.y }); });
}
// Matahari & waktu: arah hadap gedung (kompas), jam, bulan, dan langit — dipakai simulasi cahaya, udara, dan 3D.
const BULAN = ['Bulan ini', 'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
const jamTxt = j => `${String(Math.floor(j)).padStart(2, '0')}.${j % 1 ? '30' : '00'}`;
function setSim(o) { model.sim = { ...(model.sim || {}), ...o }; save(); renderAll(); }
function simCard() {
  const S = simOf(model); let L = null; try { L = simulate(model); } catch {}
  const sun = L?.sun, lm = (L?.lmbs || []).filter(l => l.az != null).map(l => `${arahNama(l.az)}${l.direct ? ' · <b>☀ sinar langsung</b>' : ''}`);
  return `<div class="card"><h4>${icon('sun', 14)} Matahari &amp; waktu</h4>
    ${rowSel('Depan gedung menghadap', 'smHadap', ARAH8, S.hadap)}
    <div class="row"><span class="k">Jam <b id="smJamT">${jamTxt(+S.jam)}</b></span><input type="range" min="5" max="19" step="0.5" id="smJam" value="${S.jam}"></div>
    ${rowSel('Bulan', 'smBulan', BULAN.map((b, k) => [k, b]), S.bulan)}
    ${rowSel('Langit', 'smLangit', LANGIT, S.langit)}
    <div class="row"><span class="k">Jumlah walet (3D)</span><input type="number" min="3" max="60" step="1" data-p="smWalet" value="${S.walet ?? 20}"></div>
    ${sun ? rowInfo('Matahari', sun.el > 0 ? `${arahNama(sun.az)} · ${Math.round(sun.el)}° di atas cakrawala` : 'di bawah cakrawala') : ''}
    ${L ? rowInfo('Cahaya di luar', sun?.el > 0 ? `±${fmt(Math.round(L.sky.gh / 100) * 100)} lux` : 'gelap') : ''}
    ${lm.length ? rowInfo('LMB menghadap', lm.join('<br>')) : ''}
    <p class="tip">LMB yang menghadap matahari mendapat sinar langsung — mis. LMB menghadap barat paling terang sore hari, menghadap timur pagi hari — sehingga void dan ruang jalur ikut lebih terang. Arah hadap juga dipakai untuk bayangan & matahari di 3D.</p></div>`;
}
function bindSimCard() {
  const p = k => $(`#props [data-p="${k}"]`);
  if (!p('smHadap')) return;
  p('smHadap').onchange = e => setSim({ hadap: +e.target.value });
  p('smBulan').onchange = e => setSim({ bulan: +e.target.value });
  p('smLangit').onchange = e => setSim({ langit: e.target.value });
  const w = p('smWalet'); if (w) w.onchange = e => setSim({ walet: clamp(Math.round(+e.target.value || 20), 3, 60) });
  const j = $('#smJam'); j.oninput = () => { $('#smJamT').textContent = jamTxt(+j.value); }; j.onchange = () => setSim({ jam: +j.value });
}
// Siklus udara (jaringan aliran multizona, lihat planner-air.js): pengaturan iklim, arah aliran, pertukaran udara per ruang.
function airCard() {
  let A = null; try { A = simulateAir(model); } catch (e) { console.error('simulasi udara', e); }
  if (!A) return '';
  const S = simOf(model), LV = levels(model), q = v => fmt(Math.round(v)), benar = A.masuk.vent >= A.keluar.vent && A.keluar.lmb >= A.masuk.lmb;
  const rows = LV.map((f, li) => `<tr class="fl"><td>${f.name}</td><td></td></tr>` + A.zones.filter(z => z.li === li && z.vol >= 1)
    .map(z => `<tr><td>${z.name}</td><td class="${z.ach < 0.5 ? 'bad' : ''}">${z.ach < 0.05 ? '≈ 0' : z.ach.toFixed(z.ach < 10 ? 1 : 0).replace('.', ',')} ×/jam</td></tr>`).join('')).reverse().join('');
  return `<div class="card"><h4>${icon('wind', 14)} Siklus udara</h4>
    <div class="row"><span class="k">Suhu dalam (°C)</span><input type="number" step="0.5" min="20" max="36" data-p="smSuhu" value="${S.suhu}"></div>
    <div class="row"><span class="k">Kelembapan dalam (%)</span><input type="number" step="1" min="50" max="99" data-p="smRh" value="${S.rh}"></div>
    ${rowSel('Angin datang dari', 'smAngin', SISI, S.anginDari)}
    <div class="row"><span class="k">Kecepatan angin (m/s)</span><input type="number" step="0.5" min="0" max="15" data-p="smKec" value="${S.anginKec}"></div>
    ${rowInfo(`Suhu luar pukul ${jamTxt(+S.jam)}`, `±${A.Tout.toFixed(1).replace('.', ',')} °C`)}
    ${rowInfo('Udara masuk / keluar', `${q(A.intake)} / ${q(A.outtake)} m³/jam`)}
    ${rowInfo('Ventilasi', `${A.masuk.vent} masuk · ${A.keluar.vent} keluar`)}
    ${rowInfo('LMB', `${A.masuk.lmb} masuk · ${A.keluar.lmb} keluar`)}
    <p class="tip">${benar ? '<span class="ok">Saat ini: ventilasi = intake, LMB = outtake ✓</span>' : `<span class="warn">Saat ini terbalik: udara masuk lewat LMB, keluar lewat ventilasi</span> — ${A.Tout > A.Tin ? 'udara luar lebih panas dari dalam (siang terik)' : 'LMB ditekan angin'}.`}</p>
    <table class="luxt">${rows}</table>
    <p class="tip">Model jaringan aliran multizona seperti CONTAM (NIST) / EnergyPlus AirflowNetwork: tiap ruang = satu zona, tiap bukaan = orifis Q = Cd·A·√(2ΔP/ρ), digerakkan efek cerobong dan tekanan angin. Udara RBW yang hangat & lembap lebih ringan → naik dan keluar lewat bukaan tinggi (LMB / menara), udara segar masuk lewat ventilasi yang rendah. Jadi ventilasi = intake & LMB = outtake benar saat udara dalam lebih hangat dari luar (sore–malam–pagi); saat siang terik atau LMB dihantam angin arahnya bisa terbalik. Merah = pertukaran udara &lt; 0,5×/jam (pengap). Perkiraan kasar.</p></div>`;
}
function bindAirCard() {
  const p = k => $(`#props [data-p="${k}"]`);
  if (!p('smSuhu')) return;
  p('smSuhu').onchange = e => setSim({ suhu: clamp(+e.target.value || 28, 20, 36) });
  p('smRh').onchange = e => setSim({ rh: clamp(+e.target.value || 85, 50, 99) });
  p('smAngin').onchange = e => setSim({ anginDari: e.target.value });
  p('smKec').onchange = e => setSim({ anginKec: clamp(+e.target.value || 0, 0, 15) });
}
// Suhu & kelembapan per lantai + dinding yang panas kena matahari (mode "Cek udara").
function iklimCard() {
  let C; try { C = climate(model); } catch (e) { console.error('iklim', e); return ''; }
  const rows = C.levels.slice().reverse().map(l =>
    `<tr><td>${l.name}</td><td class="${l.okT ? '' : 'bad'}">${String(l.T).replace('.', ',')} °C</td><td class="${l.okRH ? '' : 'bad'}">${l.RH}%</td><td>${l.sides.filter(s => s.panas).map(s => s.sisi).join(', ') || '—'}</td></tr>`).join('');
  return `<div class="card"><h4>${icon('sun', 14)} Suhu &amp; kelembapan per lantai</h4>
    ${rowInfo(`Suhu luar pukul ${jamTxt(+simOf(model).jam)}`, `±${String(C.Tout).replace('.', ',')} °C`)}
    <table class="luxt t4"><tr class="fl"><td>Lantai</td><td>Suhu</td><td>RH</td><td>Dinding panas</td></tr>${rows}</table>
    ${C.panas.length ? `<p class="tip"><span class="warn">${C.panas.length} sisi dinding kena matahari langsung</span> — permukaan DALAMNYA ikut hangat (${C.panas.slice(0, 3).map(p => `${p.lantai} sisi ${p.sisi} ±${String(p.Tsi).replace('.', ',')} °C`).join(', ')}). Redam: cat luar putih, paranet 2 lapis berjarak 1 m, aluminium foil di bawah atap.</p>` : ''}
    <p class="tip">Target buku: suhu 26–31 °C, kelembapan 75–85%. Panas berasal dari paparan matahari ke dinding & atap — makin ke atas makin hangat; lantai bawah paling lembap (bawah ±90%, atas ±75%); kolam menambah uap air, ventilasi menariknya ke kondisi luar. Perkiraan — cocokkan dengan termo-hygrometer di lokasi.</p></div>`;
}
// dB suara tarik & inap per ruang (mode "Cek dB").
function dbCard() {
  let S; try { S = simulateSound(model); } catch (e) { console.error('dB', e); return ''; }
  const rows = S.floors.slice().reverse().map(f => {
    const rs = f.regions.filter(r => r.area >= 1 && r.type !== 'void');
    return rs.length ? `<tr class="fl" data-f="${f.li}" style="cursor:pointer"><td>${f.name}</td><td></td><td></td></tr>` + rs.map(r => {
      const bad = nilaiDb(r, S.target);
      return `<tr><td>${r.name}${bad.length ? `<br><small class="bad">${bad.map(b => b.txt).join(' · ')}</small>` : ''}</td><td>${r.tarik || '–'}</td><td>${r.inap || '–'}</td></tr>`;
    }).join('') : '';
  }).join('');
  return `<div class="card"><h4>${icon('db', 14)} Cek dB — suara per ruang</h4>
    ${rowInfo('Target buku (hal. 421-425)', `tarik ${S.target.tarik[0]}–${S.target.tarik[1]} · inap ${S.target.inap[0]}–${S.target.inap[1]} dB`)}
    ${S.mati.length ? rowInfo('Mati oleh timer', `<span class="warn">${S.mati.join(', ')} (pukul ${jamTxt(+S.jam)})</span>`) : ''}
    <table class="luxt t3"><tr class="fl"><td>Ruang</td><td>Tarik dB</td><td>Inap dB</td></tr>${rows}</table>
    <div class="acts"><button type="button" id="dbAudio">${icon('audio', 14)} Ruang audio — volume &amp; channel</button></div>
    <p class="tip">dB di tengah ruang = volume channel pada 1 m − pelemahan jarak − penghalang (bata ±22 dB, terpal ±10, sekat gantung ±4; bukaan LAR tidak menghalangi). Suara mengikuti jadwal timer AC. Perkiraan kasar.</p></div>`;
}
// Kabel tiap channel + klem (mode "Kabel").
function kabelCard() {
  let cb; try { cb = cableInfo(model); } catch (e) { console.error('kabel', e); return ''; }
  const daftar = cb.chs.filter(c => kabelSemua || chCover(c, cur) || model.kabel?.rute?.[c.id]?.[cur]);
  const rows = daftar.map(c => {
    const manual = !!model.kabel?.rute?.[c.id]?.[cur], bisa = c.t !== 'hexa' && chCover(c, cur), off = hidCh.has(c.id);
    return `<tr${off ? ' style="opacity:.45"' : ''}><td><button type="button" class="eye2${off ? ' off' : ''}" data-che="${c.id}" title="${off ? 'Tampilkan' : 'Sembunyikan'} jalur channel ini di denah">${icon(off ? 'eyeoff' : 'eye', 13)}</button><span class="lxdot" style="background:${c.warna}"></span>${esc(c.nm)}${c.on === false ? ' <small>(cek: mati)</small>' : ''}${manual ? ' ✏️' : ''}
      ${bisa ? `<button type="button" class="mini icb" data-rt="${c.id}" title="${manual ? 'Gambar ulang' : 'Gambar'} jalur kabel sendiri di lantai ini (klik titik-titik, Enter selesai)">✏️</button>` : ''}${manual ? `<button type="button" class="mini icb" data-rtdel="${c.id}" title="Hapus jalur manual lantai ini — kembali otomatis">🗑</button>` : ''}
      ${c.tembus ? '<br><small class="bad">menembus/terkurung bata!</small>' : ''}</td>
      <td>${c.count}</td><td>${fmt(Math.round(c.len))} m</td><td>${fmt(c.klem)}</td></tr>`;
  }).join('');
  const sisa = cb.chs.length - daftar.length;
  return `<div class="card"><h4>${icon('cable', 14)} Kabel tweeter → ruang audio</h4>
    ${rowInfo('Ruang audio', cb.au ? (cb.luar ? 'di luar gedung ✓' : levels(model)[cb.au.li].name) : '<span class="bad">belum ada</span> — dihitung dari pojok gedung')}
    <label class="chkrow"><input type="checkbox" id="kbAll"${kabelSemua ? ' checked' : ''}> Tampilkan semua channel (bukan hanya ${floor().name})</label>
    <table class="luxt t4"><tr class="fl"><td>Channel</td><td>Tw</td><td>Kabel</td><td>Klem</td></tr>${rows}</table>
    ${sisa > 0 ? `<p class="tip">${sisa} channel lantai lain disembunyikan dari daftar — centang di atas untuk melihat semuanya.</p>` : ''}
    ${rowInfo('Total kabel (semua channel)', `<b>${fmt(Math.round(cb.total))} m</b>`)}${rowInfo('Total klem (tiap 10 cm)', `<b>${fmt(cb.klem)}</b>`)}
    <div class="acts"><button type="button" id="kbAudio">${icon('audio', 14)} Atur channel</button></div>
    <p class="tip">Jalur otomatis kini rapi: lurus sepanjang baris tweeter, belok satu SUDUT siku antar baris (memutar hanya bila terhalang bata); titik berlabel <b>ujung</b> = tweeter terakhir jalur; <b>R</b> = titik naik-turun antar lantai lalu tersambung ke ruang audio (garis abu-abu). Ikon mata = sembunyikan jalur channel itu di denah. ✏️ = gambar jalur sendiri untuk lantai aktif. Kabel hexagonal otomatis naik setinggi gedung + menara. Belum termasuk cadangan ±10%.</p></div>`;
}
// gambar / hapus jalur kabel manual channel untuk lantai aktif
function startRute(id) {
  const c = channels(model).find(x => x.id === id);
  if (!c || !chCover(c, cur)) { hint('Channel ini tidak mencakup lantai aktif.'); return; }
  pendRute = { id, pts: [] };
  setTool('rute');
  hint(`Gambar jalur kabel "${c.nm}" di ${floor().name}: klik titik demi titik (otomatis siku; Shift = bebas) — Enter / klik dobel = selesai · Esc = batal.`, 10000);
}
function finishRute() {
  if (!pendRute) { setTool('select'); return; }
  const { id, pts } = pendRute;
  pendRute = null;
  if (pts.length < 2) { setTool('select'); renderPlan(); hint('Jalur batal — butuh minimal 2 titik.'); return; }
  commit();
  if (!model.kabel?.ch?.length) model.kabel = { ...(model.kabel || {}), ch: channels(model).map(({ warna, ...c }) => ({ ...c })) };   // bekukan id channel
  model.kabel.rute = model.kabel.rute || {};
  (model.kabel.rute[id] = model.kabel.rute[id] || {})[cur] = pts;
  setTool('select'); save(); renderAll();
  hint('Jalur kabel manual tersimpan — panjang & klem dihitung dari jalur ini (ikut link desain).', 7000);
}
function delRute(id) {
  const r = model.kabel?.rute; if (!r?.[id]?.[cur]) return;
  commit();
  delete r[id][cur];
  if (!Object.keys(r[id]).length) delete r[id];
  if (!Object.keys(r).length) delete model.kabel.rute;
  save(); renderAll(); hint('Jalur manual dihapus — kembali ke rute otomatis.');
}
// Foto satelit lokasi (Google Maps) sebagai latar denah.
const stFile = Object.assign(document.createElement('input'), { type: 'file', accept: 'image/*', hidden: true });
document.body.append(stFile);
stFile.onchange = async () => {
  const f = stFile.files[0]; stFile.value = ''; if (!f) return;
  try {
    const p = await SK.loadImageFile(f, 2400);
    SK.setSketch(model, 100, { ...p, site: true, wM: Math.round(model.w * 3), op: 0.7, cx: round(model.w / 2), cy: round(model.h / 2) });
    renderAll(); hint('Foto satelit terpasang — tekan "Geser / perbesar foto" lalu seret fotonya (bukan gedungnya) sampai lahan pas.', 9000);
  } catch (err) { hint(err.message); }
};
// kotak foto satelit dalam meter denah (pusat + ukuran mengikuti rasio foto & rotasi)
function siteRect(sk) {
  const w = sk.wM || model.w * 3, h = w * ((sk.rot || 0) % 180 ? sk.iw / sk.ih : sk.ih / sk.iw);
  return { cx: sk.cx ?? model.w / 2, cy: sk.cy ?? model.h / 2, w, h };
}
function siteDraw() {
  const sk = SK.getSketch(model, 100);
  if (!sk?.src) return null;
  const R = siteRect(sk);
  return { href: SK.sketchHref(sk), cx: R.cx, cy: R.cy, w: R.w, h: R.h, rot: sk.rot || 0, op: sk.op ?? 0.7 };
}
function siteCard() {
  const sk = SK.getSketch(model, 100);
  if (!sk) return `<div class="card"><h4>${icon('map', 14)} Lokasi (satelit)</h4>
    <p class="tip">Buka Google Maps → mode Satelit → screenshot lahan Anda → unggah. Foto menjadi latar semua lantai supaya posisi gedung pas dengan lahan & lingkungan aslinya.</p>
    <div class="acts"><button type="button" id="stUp">${icon('photo', 14)} Unggah foto satelit</button></div></div>`;
  return `<div class="card"><h4>${icon('map', 14)} Lokasi (satelit)</h4>
    <div class="row"><span class="k">Lebar foto di denah (m)</span><input type="number" id="stW" min="${Math.ceil(model.w)}" max="500" step="5" value="${Math.round(sk.wM || model.w * 3)}"></div>
    <div class="row"><span class="k">Kejelasan</span><input type="range" id="stOp" min="10" max="100" step="5" value="${Math.round((sk.op ?? 0.7) * 100)}"></div>
    <div class="acts"><button type="button" id="stMove" class="${tool === 'site' ? 'warnb' : ''}">${icon('hand', 14)} ${tool === 'site' ? 'Selesai menggeser' : 'Geser / perbesar foto'}</button><button type="button" id="stRot">${icon('turn', 14)} Putar 90°</button></div>
    <div class="acts"><button type="button" id="stUp">Ganti foto</button><button type="button" class="danger" id="stDel" title="Hapus foto satelit">${icon('trash', 14)}</button></div>
    <p class="tip">"Geser / perbesar foto": seret FOTONYA agar gedung pas di lahan (gedung tidak ikut bergeser); seret kotak sudut untuk memperbesar/mengecil; Esc selesai. Foto ikut tampil sebagai tanah di 3D. Hanya tersimpan di perangkat ini, tidak ikut link desain.</p></div>`;
}
function bindSiteCard() {
  const on = (id, fn) => { const b = $('#' + id); if (b) b.onclick = fn; };
  on('stUp', () => stFile.click());
  on('stMove', () => {
    setTool(tool === 'site' ? 'select' : 'site');
    if (tool === 'site') hint('Seret foto satelit untuk menggeser (gedung tetap diam); seret kotak sudut untuk memperbesar. Esc selesai.', 9000);
  });
  const sk = SK.getSketch(model, 100); if (!sk) return;
  const upd = o => { SK.setSketch(model, 100, { ...sk, ...o }); renderPlan(); };
  const w = $('#stW'); if (w) w.onchange = e => upd({ wM: clamp(Math.round(+e.target.value || model.w * 3), Math.ceil(model.w), 500) });
  const op = $('#stOp'); if (op) op.oninput = e => upd({ op: +e.target.value / 100 });
  on('stRot', () => upd({ rot: ((sk.rot || 0) + 90) % 360 }));
  on('stDel', () => { if (confirm('Hapus foto satelit?')) { SK.setSketch(model, 100, null); renderAll(); } });
}
// Panah aliran udara lantai aktif untuk denah (m³/jam).
function airArrows() {
  let A; try { A = simulateAir(model); } catch { return null; }
  const out = [];
  A.links.forEach(k => {
    const q = Math.abs(k.q); if (q < 0.5) return;
    if (k.kind === 'void') { if (k.li === cur || k.li - 1 === cur) out.push({ x: k.x, y: k.y, q, v: k.q > 0 ? 'turun' : 'naik', kind: 'dalam' }); return; }
    if (k.li !== cur) return;
    const s = k.b < 0 ? (k.q < 0 ? 1 : -1) : k.q > 0 ? 1 : -1;   // luar: (nx, ny) = arah ke dalam; antar ruang: dari zona a ke b
    out.push({ x: k.x, y: k.y, q, dx: s * k.nx, dy: s * k.ny, kind: k.b < 0 ? (k.q < 0 ? 'masuk' : 'keluar') : 'dalam' });
  });
  return out;
}
// Simulasi burung (3D): kenyamanan tiap ruang bagi walet + alasannya.
function birdCard() {
  let C; try { C = comfort(model); } catch (e) { console.error('kenyamanan', e); return ''; }
  const LV = levels(model), rs = C.rooms.filter(r => r.level !== 'jalan' && r.area !== 0 && (r.type === 'inap' || r.level !== 'nyaman')), bad = rs.filter(r => r.level !== 'nyaman');
  const dot = c => `<span class="lxdot" style="background:${TINGKAT[c]}"></span>`;
  const rows = LV.map((f, fi) => { const my = rs.filter(r => r.fi === fi); return my.length ? `<tr class="fl"><td>${f.name}</td><td></td></tr>` + my.map(r => `<tr><td>${dot(r.level)}${r.name}${r.alasan.length ? `<br><small>${r.alasan.join(' · ')}</small>` : ''}</td><td>${r.score}</td></tr>`).join('') : ''; }).reverse().join('');
  return `<div class="card"><h4>${icon('bird', 14)} Simulasi burung — kenyamanan ruang</h4>
    <p class="tip">±20 walet berputar di luar gedung, terpanggil suara hexagonal, masuk lewat LMB, lalu mengejar suara tweeter tarik (LMB → LAR void → jalur → LAR inap → inap) dan menyebar ke tiap lantai & ruang. Ruang yang tidak nyaman cepat ditinggalkan.</p>
    <p class="tip">${dot('nyaman')}nyaman &nbsp;${dot('kurang')}kurang &nbsp;${dot('tidak')}tidak nyaman — warna lantai di 3D.</p>
    ${bad.length ? `<p class="tip"><span class="bad">${bad.length} ruang kurang / tidak nyaman</span> — lihat alasannya; atur ulang sekat, LAR, dan tweeter.</p>` : '<p class="tip"><span class="ok">✓ Semua ruang inap nyaman bagi walet.</span></p>'}
    <table class="luxt">${rows}</table></div>`;
}
const opts3d = () => ({ show: showOf, site: siteDraw() });
// Simulasi cahaya seluruh gedung: lux rata-rata tiap ruang per lantai + legenda warna.
const LUX_ORDER = { void: 0, jalur: 1, audio: 2, lain: 3, inap: 4 };
function luxCard() {
  const L = luxRes || luxEnsure(); if (!L) return '';
  const grad = `linear-gradient(90deg,${LUX_STOPS.map(([v, c]) => `rgb(${c.join(',')}) ${Math.round(((v + 2) / 5) * 100)}%`).join(',')})`;
  const dot = E => `<span class="lxdot" style="background:rgb(${luxColor(E).join(',')})"></span>`;
  const LV = levels(model), rows = L.floors.map((f, fi) => `<tr class="fl" data-f="${fi}" style="cursor:pointer"><td>${LV[fi].name}${fi === cur ? ' · sedang dilihat' : ''}</td><td></td></tr>`
    + f.regions.filter(r => r.area >= 0.5).sort((a, b) => LUX_ORDER[a.type] - LUX_ORDER[b.type] || a.name.localeCompare(b.name, 'id', { numeric: true }))
      .map(r => `<tr><td>${dot(r.lux)}${r.name}</td><td class="${r.type === 'inap' && r.lux > RULES.luxInap ? 'bad' : ''}">${luxTxt(r.lux)}</td></tr>`).join('')).reverse().join('');
  return `<div class="card"><h4>${icon('sun', 14)} Cek lux — simulasi cahaya</h4>
    <div class="luxbar" style="background:${grad}"></div><div class="luxticks"><span>0,01</span><span>0,1</span><span>1</span><span>10</span><span>100</span><span>1000 lux</span></div>
    <table class="luxt">${rows}</table>
    ${(() => { const b = L.regions.filter(r => r.type === 'inap' && !r.reach); return `<p class="tip">${b.length ? `<span class="bad">${b.length} ruang inap buntu</span> — anakan tidak menemukan arah terang ke LMB (${b.map(r => `${levels(model)[r.fi].name}: ${r.name}`).slice(0, 4).join(', ')}).` : '<span class="ok">✓ Semua ruang inap punya jalur cahaya ke LMB</span> (panah jingga di denah).'}</p>`; })()}
    <p class="tip">RBW tanpa lampu: satu-satunya cahaya adalah matahari yang masuk lewat LMB. Makin ke dalam dan makin ke lantai bawah makin gelap; sekat menghalau cahaya sehingga ruang jalur hanya remang dan ruang inap gelap (&lt; ${RULES.luxInap} lux, buku hal. 337–343). Cahaya remang itu menuntun anakan yang baru belajar terbang dari sarang menuju sumber cahaya lalu keluar lewat LMB — panah jingga menunjukkan arahnya. Arahkan kursor (di HP: ketuk) untuk membaca lux di titik itu. Perkiraan kasar, diukur ±30 cm di bawah plafon; cocokkan dengan lux meter di lokasi.</p></div>`;
}
function bindLuxCard() {
  $('#props').querySelectorAll('tr.fl[data-f]').forEach(tr => tr.onclick = () => goLevel(+tr.dataset.f));
}
function measureCard() {
  const ms = measures.filter(q => q.f === cur); if (!ms.length && tool !== 'ukur') return '';
  return `<div class="card"><h4>${icon('ruler', 14)} Penggaris — ${floor().name}</h4>
    ${ms.map((q, k) => rowInfo(`Ukuran ${k + 1}`, `${Math.hypot(q.x2 - q.x1, q.y2 - q.y1).toFixed(2).replace('.', ',')} m`)).join('') || '<p class="tip">Seret di denah dari titik ke titik untuk mengukur.</p>'}
    <p class="tip">Menempel ke ujung sekat, sudut lantai, dan sudut/tengah objek. Tahan Shift agar lurus mendatar/tegak. Ukuran tidak ikut disimpan di desain.</p>
    ${ms.length ? '<div class="acts"><button type="button" id="uClr">Hapus ukuran</button></div>' : ''}</div>`;
}
function siripCard() {
  const a = lastA;
  return `<div class="card"><h4>Papan sirip</h4>
    <div class="row"><span class="k">Tebal papan (cm)</span><input type="number" step="0.5" min="1" max="10" id="sT" value="${model.siripTebal}"></div>
    <div class="row"><span class="k">Lebar papan (cm)</span><input type="number" step="1" min="5" max="40" id="sL" value="${model.siripLebar}"></div>
    ${a ? rowInfo('Total papan sirip', `${fmt(a.siripM)} m`) + rowInfo('Volume kayu', `<b>${fmt(a.siripM3)} m³</b>`) + rowInfo(`Perkiraan batang @${RULES.papanPanjang} m`, `± ${fmt(a.siripBatang)} batang`) : ''}
    <p class="tip">Seluruh ruang inap di semua lantai, termasuk papan yang menempel di sisi berdinding/bersekat. Belum termasuk sisa potong (tambahkan ±10%). Umumnya papan meranti 2×20 cm.</p></div>`;
}
function projectPanel() {
  $('#props').innerHTML = (view === '3d' ? birdCard() : '') + (luxOn || airOn || dbOn || view === '3d' ? simCard() : '') + (luxOn ? luxCard() : '')
    + (airOn ? airCard() + iklimCard() : '') + (dbOn ? dbCard() : '') + (kabelOn ? kabelCard() : '') + measureCard() + floorPanel() + roomsCard() + sketchCard() + siteCard() + siripCard() + `<div class="card"><h4>Ukuran gedung (lantai dasar)</h4>
    <div class="row"><span class="k">Lebar (m)</span><input type="number" step="0.5" min="2" max="40" id="pW" value="${model.w}"></div>
    <div class="row"><span class="k">Panjang (m)</span><input type="number" step="0.5" min="2" max="60" id="pH" value="${model.h}"></div>
    <div class="row"><span class="k">Tinggi lantai standar (m)</span><input type="number" step="0.1" min="1.8" max="4" id="pFH" value="${model.floorH}"></div>
    <div class="row"><span class="k">Jumlah lantai</span><input type="number" step="1" min="1" max="8" id="pN" value="${model.floors.length}"></div>
    <div class="row"><span class="k">Jarak kolom</span><select id="pK">${[3, 4, 5, 6].map(k => `<option value="${k}"${k === model.kolom ? ' selected' : ''}>${k} m</option>`).join('')}</select></div>
    <label class="chkrow"><input type="checkbox" id="pS"${model.showStruktur !== false ? ' checked' : ''}> Tampilkan kolom &amp; balok</label>
    <p class="tip">Ubah angka lalu Enter — elemen di luar batas baru dirapatkan. Pilih elemen di katalog lalu klik di denah. Seret area kosong = kotak pilih banyak objek; geser tampilan dengan alat Geser (H), Spasi+seret, atau tombol tengah/kanan mouse; scroll untuk zoom.</p>
    <div class="acts"><button type="button" id="pEdit">${icon('plan', 14)} Pengaturan proyek</button><button type="button" id="pSurvey">${icon('spark', 14)} Pengamatan cepat</button></div></div>`;
  ['pW', 'pH', 'pFH', 'pN'].forEach(id => $('#' + id).onchange = () => applyProject({ w: +$('#pW').value, h: +$('#pH').value, floorH: +$('#pFH').value, floors: +$('#pN').value }));
  $('#pK').onchange = e => { commit(); model.kolom = +e.target.value; renderAll(); };
  $('#pS').onchange = e => { model.showStruktur = e.target.checked; save(); renderAll(); };
  $('#pEdit').onclick = () => D.dlgManual(false);
  $('#pSurvey').onclick = () => D.dlgSurvey({ regenerate: true });
  $('#sT').onchange = e => { commit(); model.siripTebal = clamp(+e.target.value || RULES.siripTebalCm, 1, 10); renderAll(); };
  $('#sL').onchange = e => { commit(); model.siripLebar = clamp(+e.target.value || RULES.siripLebarCm, 5, 40); renderAll(); };
  const u = $('#uClr'); if (u) u.onclick = () => { measures = measures.filter(q => q.f !== cur); renderPlan(); renderSide(); };
  bindFloorPanel(); bindSketchCard(); bindLuxCard(); bindSimCard(); bindAirCard(); bindSiteCard();
  ['dbAudio', 'kbAudio'].forEach(id => { const b = $('#' + id); if (b) b.onclick = () => D.dlgAudio(); });
  $('#props').querySelectorAll('[data-rt]').forEach(b => b.onclick = () => startRute(b.dataset.rt));
  $('#props').querySelectorAll('[data-rtdel]').forEach(b => b.onclick = () => delRute(b.dataset.rtdel));
  $('#props').querySelectorAll('[data-che]').forEach(b => b.onclick = () => {   // sembunyikan / tampilkan jalur channel di denah
    const id = b.dataset.che;
    if (hidCh.has(id)) hidCh.delete(id); else hidCh.add(id);
    renderPlan(); renderSide(false);
  });
  const ka = $('#kbAll'); if (ka) ka.onchange = () => { kabelSemua = ka.checked; renderSide(false); };
  $('#props').querySelectorAll('tr.fl[data-f]').forEach(tr => { if (!tr.onclick) tr.onclick = () => goLevel(+tr.dataset.f); });
  $('#props').querySelectorAll('[data-inap]').forEach(b => b.onclick = () => makeInap(+b.dataset.inap));
}
// Ruang yang terbentuk dari sekat (area tertutup sekat = satu ruang; LAR & celah sekat gantung = pintunya).
function roomsCard() {
  const sp = der?.sp; if (!sp || sp.regions.length < 2) return '';
  const rows = sp.regions.filter(r => r.area >= 0.5).sort((a, b) => a.cy - b.cy || a.cx - b.cx).map(r => {
    const hop = sp.hop[r.id], d = sp.deg[r.id], bebas = !sp.isVoid[r.id] && sp.type[r.id] === 'lain' && r.area >= 1;
    return `<div class="row"><span class="k">${sp.name[r.id]} · ${fmt(round(r.area, 1))} m²</span><span>${d ? `${d} pintu` : '<span class="bad">tanpa pintu</span>'}${hop > 0 && Number.isFinite(hop) ? ` · ${hop} langkah ke void` : ''}${bebas ? `<button type="button" class="mini" data-inap="${r.id}">Jadikan inap</button>` : ''}</span></div>`;
  }).join('');
  return `<div class="card"><h4>Ruang dari sekat — ${floor().name}</h4>${rows}<p class="tip">Area yang dikelilingi sekat = satu ruang (sekat yang menempel otomatis tersambung). LAR dan celah di bawah sekat gantung menjadi pintunya; tweeter inap dan rantai tweeter tarik selalu lewat pintu itu menuju void.</p></div>`;
}
// Foto sketsa tangan per lantai: latar transparan untuk dijiplak; tim bisa mengubahnya otomatis dengan AI.
const skFile = Object.assign(document.createElement('input'), { type: 'file', accept: 'image/*', hidden: true });
document.body.append(skFile);
skFile.onchange = async () => {
  const f = skFile.files[0]; skFile.value = ''; if (!f) return;
  try {
    SK.setSketch(model, cur, SK.fitToFloor(await SK.loadImageFile(f), FR())); renderAll();
    hint('Foto sketsa dimuat — klik "Kalibrasi 2 titik" agar garis luar gedung pas dengan batas lantai.', 8000);
  } catch (err) { hint(err.message); }
};
function sketchCard() {
  const k = SK.getSketch(model, cur), admin = D.isAdmin(), title = `<h4>Sketsa tangan — ${floor().name}</h4>`;
  if (!k) return `<div class="card">${title}<p class="tip">Punya denah gambar tangan? Unggah fotonya sebagai latar transparan lalu jiplak di atasnya${admin ? ', atau ubah otomatis dengan AI' : ''}.</p>
    <div class="acts"><button type="button" id="skUp">${icon('photo', 14)} Unggah foto sketsa</button><button type="button" id="skLeg">Keterangan tulisan</button></div></div>`;
  return `<div class="card">${title}
    <label class="chkrow"><input type="checkbox" id="skShow"${k.show !== false ? ' checked' : ''}> Tampilkan foto di bawah denah</label>
    <div class="row"><span class="k">Kejelasan foto</span><input type="range" min="10" max="100" step="5" id="skOp" value="${Math.round((k.op || 0.55) * 100)}"></div>
    <div class="acts"><button type="button" id="skCal">${icon('target', 14)} Kalibrasi 2 titik</button><button type="button" id="skRot">${icon('turn', 14)} Putar 90°</button><button type="button" id="skFit">${icon('fit', 14)} Pas ke lantai</button></div>
    <div class="acts">${admin ? `<button type="button" id="skAI">${icon('spark', 14)} Konversi otomatis (AI)</button><button type="button" id="skKey" title="Kode tim & alamat layanan AI">${icon('key', 14)} Kode tim</button>`
      : `<button type="button" id="skWA">${icon('wa', 14)} Kirim ke tim</button>`}<button type="button" id="skUp">Ganti foto</button><button type="button" id="skLeg">Keterangan</button><button type="button" class="danger" id="skDel" title="Hapus foto sketsa">${icon('trash', 14)}</button></div>
    <p class="tip">Kalibrasi: klik dua sudut berseberangan garis luar gedung pada foto — foto diregangkan tepat ke batas lantai. Foto hanya tersimpan di perangkat ini dan tidak ikut link desain.</p></div>`;
}
function bindSketchCard() {
  const on = (id, fn) => { const b = $('#' + id); if (b) b.onclick = fn; };
  const cur0 = () => SK.getSketch(model, cur), upd = o => { SK.setSketch(model, cur, { ...cur0(), ...o }); renderTools(); renderPlan(); };
  on('skUp', () => skFile.click()); on('skLeg', () => D.dlgLegend());
  if (!cur0()) return;
  $('#skShow').onchange = e => upd({ show: e.target.checked });
  $('#skOp').oninput = e => upd({ op: +e.target.value / 100, show: true });
  on('skCal', startCalib);
  on('skRot', () => upd(SK.rotate90(cur0(), FR())));
  on('skFit', () => upd(SK.fitToFloor(cur0(), FR())));
  on('skAI', () => D.runAI(cur)); on('skKey', () => D.dlgTeam()); on('skWA', () => D.sketchWA(cur));
  on('skDel', () => { if (!confirm(`Hapus foto sketsa dari ${floor().name}?`)) return; SK.setSketch(model, cur, null); renderAll(); });
}
function renderSide(full = true) {
  der = der || derive(model, floor());
  pruneSel();
  if (full || !lastA) lastA = analyze(model);
  const one = single();
  if (sel.size > 1) { $('#props').innerHTML = multiPanel(); bindMultiPanel(); }
  else if (one?.kind === 'item') { $('#props').innerHTML = itemPanel(one.el); bindItemPanel(one.el); }
  else if (one?.kind === 'wall') wallPanel(one.el);
  else projectPanel();
  if (!full) { foldCards($('#props')); return; }
  const a = lastA, cls = a.score >= 80 ? 'g' : a.score >= 55 ? 'y' : 'r';
  $('#analysis').innerHTML = `<div class="card"><h4>Analisis kelayakan</h4>
    <div class="score ${cls}"><b>${a.score}</b><span>/ 100</span></div><div class="bar"><i style="width:${a.score}%"></i></div>
    ${rowInfo('Luas bangunan', `${fmt(round(a.luasTotal, 1))} m²`)}
    ${rowInfo('Tinggi gedung', `${fmt(a.tinggi)} m · ${model.floors.length} lt${model.menara ? ' + menara' : ''}`)}
    ${rowInfo('Ruang inap', `${a.inapN} ruang`)}
    ${rowInfo('Sirip efektif (ruang inap)', `${fmt(a.siripM)} m`)}
    ${rowInfo('Papan sirip', `${fmt(a.siripM3)} m³ · ±${fmt(a.siripBatang)} batang`)}
    ${rowInfo('Sarang efektif*', `± ${fmt(a.sarang)} sarang`)}
    ${rowInfo('Referensi produksi**', `${fmt(a.kgRef[0])}–${fmt(a.kgRef[1])} kg/th`)}
    ${a.lux ? rowInfo('Cahaya ruang inap***', `${a.lux.maxInap > RULES.luxInap ? '<span class="bad">' : ''}maks ${luxTxt(a.lux.maxInap)}${a.lux.maxInap > RULES.luxInap ? '</span>' : ''}`) : ''}
    ${rowInfo('Tweeter inap / tarik', `${a.twinapN} / ${a.twtarikN}`)}
    ${rowInfo('Channel ampli', `${a.channels} <small>(atur di "Ruang audio")</small>`)}
    ${a.kabelM ? rowInfo('Kabel / klem', `${fmt(a.kabelM)} m / ${fmt(a.klemN)}`) : ''}
    ${rowInfo('LMB / ventilasi / kolam', `${a.lmbN} / ${a.ventN} / ${a.kolamN}`)}
    ${a.sarangN && a.sarangN.baru + a.sarangN.lama + a.sarangN.polesan + a.sarangN.jadi > 0 ? rowInfo('Titik sarang', `${a.sarangN.jadi} jadi · ${a.sarangN.polesan} polesan · ${a.sarangN.baru} baru · ${a.sarangN.lama} lama`) : ''}
    <ul class="tips">${a.notes.map((n, k) => `<li class="${n.lvl}${n.at ? ' hasat' : ''}"${n.at ? ` data-note="${k}" title="Klik untuk menandai lokasinya di denah"` : ''}>${n.txt}</li>`).join('')}</ul>
    ${a.rekom.length ? `<h4 class="sub">Rekomendasi lokasi</h4><ul class="tips rekom">${a.rekom.map(t => `<li>${t}</li>`).join('')}</ul>` : ''}
    <p class="tip">Sarang efektif dihitung dari papan sirip di ruang inap + ruang jalur bersirip. *Asumsi ${RULES.sarangPerMeterSirip} sarang per meter sirip. **Skala dari RBW 6×12 m 2 lantai = ${RULES.produksi6x12KgTahun[0]}–${RULES.produksi6x12KgTahun[1]} kg/tahun. ***Simulasi cahaya pukul ${jamTxt(+simOf(model).jam)}, langit ${simOf(model).langit}, depan gedung menghadap ${arahNama(+simOf(model).hadap)} — atur di "Cek lux". Catatan bergaris bawah bisa diklik untuk menandai lokasinya. Aturan: buku Budidaya Walet Markaswalet & DED GedungWalet.</p></div>`;
  $('#analysis').querySelectorAll('[data-note]').forEach(li => li.onclick = () => {
    const n = lastA.notes[+li.dataset.note]; if (!n?.at) return;
    mark = { ...n.at };
    if (Number.isFinite(n.at.f) && n.at.f !== cur) { cur = clamp(n.at.f, 0, levels(model).length - 1); sel.clear(); save(); renderAll(); }
    else renderPlan();
    hint('Lokasi catatan ditandai kotak merah berkedip — klik denah untuk menghapus tanda.', 5000);
  });
  foldCards($('#side'));
}
// Kartu panel kanan bisa dilipat (judul diklik) supaya tidak menumpuk; pilihan tersimpan per perangkat.
function foldCards(root) {
  root.querySelectorAll('.card').forEach(c => {
    const h = c.querySelector('h4'); if (!h || c.dataset.fold) return;
    c.dataset.fold = '1';
    // kunci lipatan tidak terikat nama lantai: "Sketsa tangan — Lantai 4" & "Lantai 4 — ukuran & tinggi" tetap satu kunci
    const parts = h.textContent.split('—').map(x => x.trim());
    const key = (parts.find(x => !/^(Lantai\s*\d+|Menara)/i.test(x)) || parts[0]).split('(')[0].replace(/[·:].*$/, '').trim();
    if (closedCards.has(key)) c.classList.add('cl');
    h.classList.add('fold');
    h.addEventListener('click', e => {
      if (e.target.closest('button, select, input, a')) return;
      c.classList.toggle('cl');
      if (c.classList.contains('cl')) closedCards.add(key); else closedCards.delete(key);
      saveCards();
    });
  });
}

// ---------- ukuran proyek ----------
function applyProject(o) {
  const w = clamp(o.w || model.w, 2, 40), h = clamp(o.h || model.h, 2, 60), floorH = clamp(o.floorH || model.floorH, 1.8, 4), n = clamp(Math.round(o.floors || model.floors.length), 1, 8);
  commit(); Object.assign(model, { w, h, floorH, ...(o.name != null ? { name: o.name, city: o.city } : {}) });
  const wasMn = isMn();
  while (model.floors.length < n) model.floors.push({ name: `Lantai ${model.floors.length + 1}`, items: [], walls: [] });
  model.floors.length = n; cur = wasMn && model.menara ? n : Math.min(cur, n - 1);
  levels(model).forEach(f => {
    if (f.fw != null) { f.fw = Math.min(f.fw, w); f.fh = Math.min(f.fh, h); f.fx = clamp(f.fx, 0, w - f.fw); f.fy = clamp(f.fy, 0, h - f.fh); }
    const F = floorRect(model, f);
    f.items.forEach(it => { if (it.t !== 'audio') clampInto(it, F); });   // ruang audio boleh di luar gedung
    f.walls = f.walls.map(s => clipWall(s, F)).filter(Boolean);
  });
  sel.clear(); resetSig(); save(); fit(); renderAll();
  if (view === '3d') setView('3d');
}

// ---------- 3D ----------
async function setView(v) {
  view = v; $('#planner').dataset.view = v; hideTip();
  document.querySelectorAll('.pl-seg [data-view]').forEach(b => b.classList.toggle('on', b.dataset.view === v));
  if (v === '3d') {
    hint('Memuat tampilan 3D…');
    try { const t = await app.load3D(); t.build(model, cur, opts3d()); t.show(); renderSide(false); hint('Seret = putar, scroll = zoom. Tampilan Atas/Depan/Kiri…, per lantai, burung & udara ada di pojok kiri atas.', 7000); }
    catch (err) { console.error(err); hint('Tampilan 3D tidak dapat dimuat di browser ini.'); setView('2d'); }
  } else { if (three) three.hide(); fit(); renderPlan(); renderSide(false); }
}

// ---------- init ----------
function renderAll() {
  if (!model) return;
  settle();
  der = null; renderCatalog(); renderFloors(); renderTools(); renderPlan(); renderSide();
  $('#btnProject').textContent = `${model.name || 'Rumah Walet'} · ${fmt(model.w)}×${fmt(model.h)} m · ${model.floors.length} lt${model.menara ? ' + menara' : ''}${model.city ? ' · ' + model.city : ''}`;
  if (view === '3d' && three) three.build(model, cur, opts3d());
}
document.querySelectorAll('.pl-seg [data-view]').forEach(b => b.onclick = () => setView(b.dataset.view));
$('#btnProject').onclick = () => D.dlgManual(false);
$('#btnNew').innerHTML = `${icon('plan', 15)} Proyek`; $('#btnNew').onclick = () => D.dlgProjects();
$('#btnFinish').onclick = () => D.dlgFinish();
$('#btnAudio').innerHTML = `${icon('audio', 15)} Ruang audio`; $('#btnAudio').onclick = () => D.dlgAudio();
// rekam layar → simpan .webm di perangkat (3D: langsung dari kanvas; 2D: pilih tab lewat izin browser)
let rec = null;
function recBtn() { const b = $('#btnRec'); b.classList.toggle('rec', !!rec); b.innerHTML = rec ? '⏺ Berhenti & simpan' : '⏺ Rekam'; }
async function toggleRec() {
  if (rec) { rec.stop(); return; }
  let stream;
  try {
    const cv3 = view === '3d' && $('#view3d canvas');
    stream = cv3 ? cv3.captureStream(30) : await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 30 }, audio: false });
  } catch (e) { console.warn('rekam', e); hint('Rekam layar dibatalkan / tidak didukung browser ini.'); return; }
  const mime = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find(t => window.MediaRecorder && MediaRecorder.isTypeSupported(t));
  if (!mime) { stream.getTracks().forEach(t => t.stop()); hint('Browser ini tidak mendukung perekaman video.'); return; }
  const mr = new MediaRecorder(stream, { mimeType: mime }), chunks = [];
  mr.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
  mr.onstop = () => {
    stream.getTracks().forEach(t => t.stop());
    const url = URL.createObjectURL(new Blob(chunks, { type: 'video/webm' })), el = document.createElement('a');
    el.href = url; el.download = `rekaman-walet-${new Date().toISOString().slice(0, 16).replace(/[T:]/g, '-')}.webm`;
    document.body.append(el); el.click(); el.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    rec = null; recBtn(); hint('Rekaman tersimpan (.webm) di folder unduhan.', 6000);
  };
  stream.getVideoTracks()[0].onended = () => { if (rec) rec.stop(); };
  mr.start(250); rec = mr; recBtn();
  hint(view === '3d' ? 'Merekam tampilan 3D… tekan tombol rekam lagi untuk berhenti & menyimpan.' : 'Merekam… tekan tombol rekam lagi untuk berhenti & menyimpan.', 7000);
}
$('#btnRec').onclick = toggleRec; recBtn();
$('#btnRAB').innerHTML = `${icon('table', 15)} RAB`; $('#btnRAB').onclick = () => D.dlgRAB();
$('#btnHelp').innerHTML = icon('help', 16); $('#btnHelp').onclick = () => D.dlgHelp();
D.setupAdmin($('#btnExport'));
// panel kiri & kanan bisa disembunyikan agar denah lapang
{
  const pl = $('#planner');
  ['hidecat', 'hideside'].forEach(k => { try { if (localStorage.getItem('waletPlanner.' + k) === '1') pl.classList.add(k); } catch {} });
  const mk = (cls, side, title) => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = `pl-fold ${side}`; b.title = title; b.innerHTML = icon(side === 'l' ? 'panelL' : 'panelR', 15);
    b.onclick = () => { pl.classList.toggle(cls); try { localStorage.setItem('waletPlanner.' + cls, pl.classList.contains(cls) ? '1' : '0'); } catch {} fit(); renderPlan(); };
    $('#stage').append(b);
  };
  mk('hidecat', 'l', 'Sembunyikan / tampilkan panel katalog (kiri)');
  mk('hideside', 'r', 'Sembunyikan / tampilkan panel properti (kanan)');
}
window.addEventListener('resize', () => { if (model && view === '2d') { fit(); renderPlan(); } });
new ResizeObserver(() => { if (model && view === '2d') { fit(); renderPlan(); } }).observe($('#stage'));
window.addEventListener('hashchange', () => {
  const m = D.parseShare(location.hash); if (!m) return;
  history.replaceState(null, '', location.pathname + location.search); app.setModel(m); hint('Desain dari link dimuat.');
});

const fromLink = D.parseShare(location.hash);
let firstRun = false;
if (fromLink) { history.replaceState(null, '', location.pathname + location.search); app.setModel(fromLink); }
else if (load()) { resetSig(); fit(); renderAll(); }
else { firstRun = true; app.setModel(newModel({ name: 'Rumah Walet', w: 4, h: 12, floors: 4, floorH: RULES.lantaiTinggi, auto: true }).model); }
// gerbang masuk: seluruh editor disembunyikan sampai login (username/password diperiksa di sisi klien)
if (D.isAuthed()) { if (firstRun) D.dlgStart(true); }
else {
  document.body.classList.add('pl-lock');
  D.dlgLogin(() => {
    document.body.classList.remove('pl-lock');
    fit(); renderAll();
    hint('Selamat datang! Folder proyek (simpan / buka / hapus) ada di tombol "Proyek".', 7000);
    if (firstRun) D.dlgStart(true);
  });
}
SK.loadSketches().then(() => { if (!model) return; SK.prune(model); renderTools(); renderPlan(); renderSide(); });
