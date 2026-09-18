// Putar suara walet per channel: file audio diunggah di tab "Ruang audio" (disimpan di IndexedDB perangkat, per
// desain + channel — file suara tidak ikut link desain), lalu bisa diputar berulang; volume mengikuti dB channel.
// Saat sebuah channel berbunyi, tweeter-tweeter channel itu ditandai lingkaran berdenyut di denah — jadi jelas
// channel ini tersambung ke tweeter mana saja.
const DBN = 'waletPlannerSuara', STORE = 'suara';
let dbP = null;
function db() {
  if (!dbP) dbP = new Promise((res, rej) => {
    const rq = indexedDB.open(DBN, 1);
    rq.onupgradeneeded = () => rq.result.createObjectStore(STORE);
    rq.onsuccess = () => res(rq.result);
    rq.onerror = () => rej(rq.error);
  });
  return dbP;
}
const tx = (mode, fn) => db().then(d => new Promise((res, rej) => {
  const t = d.transaction(STORE, mode), out = fn(t.objectStore(STORE));
  t.oncomplete = () => res(out?.result ?? true);
  t.onerror = () => rej(t.error);
}));
const key = (m, chId) => `${m.id}:${chId}`;

export const setSuara = (m, chId, file) => tx('readwrite', os => (file ? os.put(file, key(m, chId)) : os.delete(key(m, chId)))).catch(e => console.warn('suara tidak tersimpan', e));
export const getSuara = (m, chId) => tx('readonly', os => os.get(key(m, chId))).then(v => (v instanceof Blob ? v : null)).catch(() => null);
export async function daftarSuara(m, chIds) {
  const out = {};
  await Promise.all(chIds.map(async id => { out[id] = !!(await getSuara(m, id)); }));
  return out;
}

export const playing = new Map();   // chId → { audio, url }
export const isPlaying = chId => playing.has(chId);
export const volDb = v => Math.max(0.05, Math.min(1, ((+v || 70) - 40) / 70));   // 40 dB → pelan, 110 dB → penuh
export function stop(chId) {
  const p = playing.get(chId);
  if (!p) return;
  p.audio.pause(); URL.revokeObjectURL(p.url); playing.delete(chId);
}
export function stopAll() { [...playing.keys()].forEach(stop); }
// Putar / hentikan satu channel; kembalikan 'main' | 'stop' | 'kosong' | 'gagal'.
export async function toggle(m, ch) {
  if (isPlaying(ch.id)) { stop(ch.id); return 'stop'; }
  const blob = await getSuara(m, ch.id);
  if (!blob) return 'kosong';
  const url = URL.createObjectURL(blob), audio = new Audio(url);
  audio.loop = true; audio.volume = volDb(ch.vol);
  try { await audio.play(); } catch (e) { URL.revokeObjectURL(url); console.warn('putar suara', e); return 'gagal'; }
  playing.set(ch.id, { audio, url });
  return 'main';
}
export function setVol(chId, v) { const p = playing.get(chId); if (p) p.audio.volume = volDb(v); }
