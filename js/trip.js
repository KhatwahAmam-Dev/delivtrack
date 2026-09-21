// Mesin status pengantaran (state machine) — draft → siap → perjalanan → tiba → selesai → ditutup.
// Semua perubahan langsung ditulis ke IndexedDB, sehingga aman walau aplikasi
// ditekan tombol Home, ditutup tidak sengaja, atau HP kehabisan baterai.

import { GPS, TRIP_STATE, APP } from './config.js';
import { kv, media, queue, requestPersistence, trips } from './db.js';
import { GeoWatch, ScreenWake, accumulate, geoErrorMessage, haversine } from './geo.js';
import { fmtDistance, fmtDuration, slugName, uid } from './util.js';
import * as sync from './sync.js';

/* ---------------- Jenis berkas ---------------- */

export const KIND = {
  PRODUK: 'produk',
  NOTA: 'nota',
  SERAH_TERIMA: 'serah-terima',
  TTD: 'ttd',
  PDF: 'pdf',
  LAIN: 'lain',
};

export const KIND_LABEL = {
  [KIND.PRODUK]: 'Foto Produk',
  [KIND.NOTA]: 'Foto Nota Belanja',
  [KIND.SERAH_TERIMA]: 'Foto Serah Terima',
  [KIND.TTD]: 'Tanda Tangan',
  [KIND.PDF]: 'Laporan PDF',
  [KIND.LAIN]: 'Dokumentasi Lain',
};

/** Foto yang wajib ada sebelum deliman boleh berangkat. */
export const WAJIB_BERANGKAT = [KIND.PRODUK, KIND.NOTA];
/** Foto yang wajib ada saat serah terima. */
export const WAJIB_TIBA = [KIND.SERAH_TERIMA];

/* ---------------- Event bus ---------------- */

const listeners = new Set();

export const tripEvents = {
  on(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  emit(evt) {
    listeners.forEach((fn) => {
      try {
        fn(evt);
      } catch {
        /* diabaikan */
      }
    });
  },
};

/* ---------------- Status internal ---------------- */

let current = null;
let watch = null;
let wake = null;
let saveTimer = null;
let dirty = false;
let startedWatchAt = 0;
const mediaCache = new Map();

const hasIdb = typeof indexedDB !== 'undefined';

/* ---------------- Utilitas ---------------- */

function blankTrip(input) {
  const now = Date.now();
  const id = makeTripId(now);
  return {
    id,
    version: APP.version,
    state: TRIP_STATE.DRAFT,
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    arrivedAt: null,
    finishedAt: null,
    closedAt: null,
    crew: { nama: '', hp: '', kantor: '' },
    customer: { nama: '', hp: '', resi: '' },
    kantor: { nama: '', nomor: '' },
    produk: { catatan: '', kode: '' },
    startPoint: null,
    endPoint: null,
    trail: [],
    summary: null,
    handover: { signedBy: '', signedAt: null, catatan: '' },
    syncState: 'local',
    driveFolderId: null,
    driveLinks: [],
    driveLinksFlat: [],
    ...input,
  };
}

function makeTripId(ts = Date.now()) {
  const d = new Date(ts);
  const p = (n, l = 2) => String(n).padStart(l, '0');
  return `DT-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(
    d.getMinutes()
  )}${p(d.getSeconds())}-${uid(3)}`;
}

const clone = (o) => (o == null ? o : JSON.parse(JSON.stringify(o)));

/** Simpan segera (dipakai untuk kejadian penting). */
async function persist(reason = 'update') {
  if (!current || !hasIdb) return current;
  clearTimeout(saveTimer);
  saveTimer = null;
  dirty = false;
  const snapshot = clone(current);
  try {
    await trips.save(snapshot);
  } catch (e) {
    console.warn('[trip] gagal menyimpan', reason, e);
  }
  tripEvents.emit({ type: 'saved', reason, trip: getTrip() });
  return snapshot;
}

/** Simpan tertunda — untuk titik GPS yang datang cepat (maks. 1 tulisan / 3 dtk). */
function persistSoon(reason = 'trail') {
  dirty = true;
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    if (dirty) persist(reason);
  }, 3000);
}

/* ---------------- Siklus hidup trip ---------------- */

export function getTrip() {
  return current ? clone(current) : null;
}

export function tripId() {
  return current?.id || null;
}

export function isRunning() {
  return current?.state === TRIP_STATE.EN_ROUTE;
}

export async function setCrew(crew = {}) {
  if (!current) current = blankTrip();
  current.crew = { ...current.crew, ...crew };
  current.state = TRIP_STATE.DRAFT;
  return persist('crew');
}

export async function setKantor(kantor = {}) {
  if (!current) current = blankTrip();
  current.kantor = { ...current.kantor, ...kantor };
  return persist('kantor');
}

export async function setCustomer(customer = {}) {
  if (!current) current = blankTrip();
  current.customer = { ...current.customer, ...customer };
  return persist('customer');
}

/** Dipakai layar "Siapkan berkas" (foto produk & nota + kode resi). */
export async function setProduk(patch = {}) {
  if (!current) return null;
  current.produk = { ...current.produk, ...patch };
  return persist('produk');
}

/** Selesaikan layar persiapan: promo draft menjadi sesi siap berangkat. */
export async function armTrip() {
  if (!current) throw new Error('Belum ada data pengantaran.');
  current.state = TRIP_STATE.READY;
  await persist('arm');
  await requestPersistence();
  return getTrip();
}

/* ---------------- Media ---------------- */

export function cachedMedia(tripIdKey = null) {
  const key = tripIdKey || current?.id;
  return key ? mediaCache.get(key) || [] : [];
}

export function mediaGroups(rows = cachedMedia()) {
  const grouped = {};
  rows.forEach((r) => {
    (grouped[r.kind] ||= []).push(r);
  });
  return grouped;
}

export async function refreshMedia() {
  if (!current) return [];
  const rows = await media.byTrip(current.id);
  rows.sort((a, b) => (a.at || 0) - (b.at || 0));
  mediaCache.set(current.id, rows);
  tripEvents.emit({ type: 'media', rows, groups: mediaGroups(rows) });
  return rows;
}

export async function addPhoto(kind, blob, meta = {}) {
  if (!current) throw new Error('Belum ada sesi pengantaran.');
  const row = await media.putBlob({
    tripId: current.id,
    kind,
    blob,
    meta: { ...meta, tripState: current.state },
  });
  await refreshMedia();
  tripEvents.emit({ type: 'media-added', kind, row });
  await persist('media-add');
  return row;
}

export async function removeMedia(id) {
  await media.del(id);
  await refreshMedia();
  await persist('media-del');
}

export async function mediaRows(kind) {
  const rows = await media.byTripKind(current.id, kind);
  rows.sort((a, b) => (a.at || 0) - (b.at || 0));
  return rows;
}

/** Cek kelengkapan berkas wajib pada tahap tertentu. */
export function missingPhotos(stage = 'berangkat', rows = cachedMedia()) {
  const need = stage === 'tiba' ? WAJIB_TIBA : WAJIB_BERANGKAT;
  const have = new Set(rows.map((r) => r.kind));
  return need.filter((k) => !have.has(k));
}

/* ---------------- Perjalanan ---------------- */

export async function startTrip() {
  if (!current) throw new Error('Belum ada sesi pengantaran.');
  if (current.state === TRIP_STATE.EN_ROUTE) return getTrip();

  const rows = await media.byTrip(current.id);
  const kurang = missingPhotos('berangkat', rows);
  if (kurang.length) {
    throw new Error(`Foto ${kurang.map((k) => KIND_LABEL[k]).join(' & ')} belum lengkap.`);
  }

  const point = await resolvePoint();
  current.startPoint = point;
  current.startedAt = Date.now();
  current.state = TRIP_STATE.EN_ROUTE;
  current.trail = [{ ...point, at: current.startedAt }];
  current.summary = null;
  await persist('start');

  startTracking();
  await sync.registerBackgroundSync();

  tripEvents.emit({ type: 'started', trip: getTrip() });
  return getTrip();
}

export async function arrive() {
  if (!current) throw new Error('Belum ada sesi pengantaran.');
  const point = await resolvePoint();

  stopTracking();
  current.endPoint = point;
  current.arrivedAt = Date.now();
  current.state = TRIP_STATE.ARRIVED;
  current.trail = [...(current.trail || []), { ...point, at: current.arrivedAt }].slice(-GPS.maxPoints);
  current.summary = computeSummary(current);
  await persist('arrive');

  tripEvents.emit({ type: 'arrived', trip: getTrip() });
  return getTrip();
}

/** Ambil titik GPS sekali, dengan fallback ke titik terakhir yang diketahui. */
async function resolvePoint() {
  try {
    const p = await new GeoWatch().once(GPS.timeout || 20000);
    return p;
  } catch (e) {
    const last = current?.trail?.slice(-1)[0] || watch?.last;
    if (last) {
      tripEvents.emit({ type: 'gps-fallback', message: geoErrorMessage(e) });
      return { ...last, at: Date.now(), approximated: true };
    }
    throw new Error(geoErrorMessage(e));
  }
}

function computeSummary(trip) {
  const trail = trip.trail || [];
  const distance = accumulate(trail);
  const straight = trip.startPoint && trip.endPoint ? haversine(trip.startPoint, trip.endPoint) : 0;
  const durationMs = (trip.arrivedAt || Date.now()) - (trip.startedAt || Date.now());
  const hours = durationMs / 3_600_000;
  return {
    distanceMeters: Math.round(distance),
    straightMeters: Math.round(straight),
    distanceText: fmtDistance(distance),
    straightText: fmtDistance(straight),
    durationMs,
    durationText: fmtDuration(durationMs),
    avgSpeedKmh: hours > 0.001 ? Math.round((distance / 1000 / hours) * 10) / 10 : 0,
    points: trail.length,
    computedAt: Date.now(),
  };
}

/* ---------------- Pelacakan latar ---------------- */

export function startTracking() {
  if (watch) return;
  watch = new GeoWatch({
    onPoint: onTrackPoint,
    onError: (err) => tripEvents.emit({ type: 'gps-error', message: geoErrorMessage(err) }),
    onStatus: (s) => tripEvents.emit({ type: 'gps-status', status: s }),
  });
  watch.start();
  startedWatchAt = Date.now();

  if (!wake) wake = new ScreenWake();
  wake.acquire();

  window.addEventListener('pagehide', flushNow);
  window.addEventListener('beforeunload', flushNow);
  document.addEventListener('visibilitychange', onVisibility);
}

export function stopTracking() {
  watch?.stop();
  watch = null;
  wake?.release();
  window.removeEventListener('pagehide', flushNow);
  window.removeEventListener('beforeunload', flushNow);
  document.removeEventListener('visibilitychange', onVisibility);
  flushNow();
}

/** Simpan paksa sekarang — dipanggil saat aplikasi disembunyikan/ditutup. */
export function flushNow(reason = 'flush') {
  const why = typeof reason === 'string' ? reason : 'flush';
  if (!current) return Promise.resolve(null);
  if (dirty) return persist(why);
  persistSoon(why);
  return Promise.resolve(getTrip());
}

function onVisibility() {
  // Saat deliman membuka Google Maps / WhatsApp, halaman menjadi hidden.
  // Kami simpan dulu, lalu lanjutkan pelacakan begitu kembali terlihat.
  if (document.visibilityState === 'hidden') {
    flushNow();
  } else if (current?.state === TRIP_STATE.EN_ROUTE && watch && !watch.running) {
    watch.start();
    wake?.acquire();
  }
}

function onTrackPoint(p, { accept } = {}) {
  if (!current || current.state !== TRIP_STATE.EN_ROUTE) return;

  if (accept) {
    const trail = current.trail || (current.trail = []);
    trail.push({ lat: p.lat, lng: p.lng, accuracy: p.accuracy, at: p.at, speedKmh: p.speedKmh });
    if (trail.length > GPS.maxPoints) trail.splice(0, trail.length - GPS.maxPoints);
    current.summary = computeSummary({ ...current, arrivedAt: Date.now() });
    persistSoon('trail');
  }

  tripEvents.emit({ type: 'point', point: p, trip: getTrip(), summary: current.summary });
}

/* ---------------- Penutupan ---------------- */

/**
 * Tandai sesi selesai setelah konsumen menandatangani.
 * Fungsi ini tidak membuka apa pun — hanya menyiapkan data, PDF, dan antrian unggah,
 * sehingga aman dipanggil dari dalam alur yang sudah dikonfirmasi deliman.
 */
export async function finishTrip({ signatureBlob = null, signedBy = '', catatan = '' } = {}) {
  const t = await completeTrip({ signatureBlob, signedBy, catatan });
  return t;
}

/**
 * Inti penyelesaian: simpan tanda tangan, buat PDF, masukkan ke antrian unggah.
 * `onProgress(stage)` dipakai layar untuk menampilkan status pembuatan berkas.
 */
export async function completeTrip({
  signatureBlob = null,
  signedBy = '',
  catatan = '',
  onProgress = () => {},
} = {}) {
  if (!current) throw new Error('Belum ada sesi pengantaran.');
  if (!current.endPoint) throw new Error('Titik akhir belum terekam. Tekan "Saya Tiba" lebih dulu.');

  const { buildTripPdf } = await import('./report.js');

  stopTracking();

  if (signatureBlob) {
    onProgress('Menyimpan tanda tangan…');
    await media.putBlob({ tripId: current.id, kind: KIND.TTD, blob: signatureBlob, meta: { signedBy } });
  }

  current.handover = {
    ...current.handover,
    signedBy: signedBy || current.customer?.nama || '',
    signedAt: Date.now(),
    catatan,
  };
  current.notes = catatan;
  current.finishedAt = Date.now();
  current.state = TRIP_STATE.DONE;
  current.summary = computeSummary({ ...current, arrivedAt: current.arrivedAt || Date.now() });
  await persist('finish');

  const rows = await refreshMedia();
  current.photoCount = rows.filter((r) => r.kind !== KIND.PDF).length;
  await persist('photo-count');

  onProgress('Menyusun laporan PDF…');
  const pdfBlob = await buildTripPdf(current, {
    photos: rows.filter((r) => r.kind !== KIND.PDF && r.kind !== KIND.TTD),
    signature: rows.find((r) => r.kind === KIND.TTD)?.blob || null,
    driveLinks: current.driveLinks || [],
  });

  await media.putBlob({
    tripId: current.id,
    kind: KIND.PDF,
    blob: pdfBlob,
    meta: { name: `${slugName(current.id)}.pdf` },
  });
  await refreshMedia();
  await persist('pdf');

  onProgress('Menambahkan ke antrian unggah…');
  current.syncState = 'pending';
  await persist('queued');
  await sync.enqueueTripUpload(current.id, { reason: 'selesai' });

  tripEvents.emit({ type: 'finished', trip: getTrip(), pdfBlob });
  return { trip: getTrip(), pdfBlob };
}

/** Ambil PDF laporan (dari simpanan lokal, atau bangun ulang bila hilang). */
export async function getPdf(trip = null) {
  const id = trip?.id || current?.id;
  if (!id) return null;
  const rows = await media.byTripKind(id, KIND.PDF);
  if (rows.length) return rows[0].blob;

  const { buildTripPdf } = await import('./report.js');
  const full = trip || (await trips.get(id));
  const all = await media.byTrip(id);
  const blob = await buildTripPdf(full, {
    photos: all.filter((r) => r.kind !== KIND.PDF && r.kind !== KIND.TTD),
    signature: all.find((r) => r.kind === KIND.TTD)?.blob || null,
    driveLinks: full.driveLinks || [],
  });
  return blob;
}

/** Tutup sesi: arsipkan lalu bersihkan agar siap pengantaran berikutnya. */
export async function closeTrip({ autoUpload = false } = {}) {
  if (!current) return null;
  const id = current.id;

  if (current.state !== TRIP_STATE.DONE) {
    throw new Error('Sesi belum selesai. Selesaikan dulu pengantaran ini.');
  }

  current.state = TRIP_STATE.CLOSED;
  current.closedAt = Date.now();
  await persist('close');

  const closed = getTrip();

  // Pastikan unggahan tetap tercatat walau sesi sempat terputus sebelum
  // `completeTrip` sempat menambahkan job. `queue.add` bersifat idempoten.
  if (current.syncState !== 'synced') {
    current.syncState = 'pending';
    await persist('queued');
    await sync.enqueueTripUpload(id, { reason: 'ditutup' }).catch(() => {});
  }

  if (autoUpload) sync.flushQueue().catch(() => {});

  releaseSession();
  tripEvents.emit({ type: 'closed', trip: closed });
  return closed;
}

function releaseSession() {
  stopTracking();
  clearTimeout(saveTimer);
  saveTimer = null;
  dirty = false;
  current = null;
  tripEvents.emit({ type: 'reset' });
}

/** Buang draft yang belum berangkat. */
export async function discardDraft() {
  if (!current) return;
  const id = current.id;
  releaseSession();
  await media.deleteTripMedia(id).catch(() => {});
  await trips.del(id).catch(() => {});
}

/** Hapus satu transaksi beserta berkas & antreannya (dipakai dari tab Riwayat). */
export async function removeTrip(id) {
  if (!id) return;
  if (current?.id === id) releaseSession();
  await media.deleteTripMedia(id).catch(() => {});
  await queue.del(`job_${id}`).catch(() => {});
  await trips.del(id).catch(() => {});
}

/* ---------------- Pemulihan otomatis ---------------- */

/** Dipanggil saat aplikasi dibuka: lanjutkan sesi yang belum tuntas. */
export async function resumeActiveTrip() {
  if (!hasIdb) return null;
  const active = await trips.active();
  if (!active) return null;

  current = active;
  await refreshMedia();

  if (active.state === TRIP_STATE.EN_ROUTE) {
    startTracking();
    if (active.summary) tripEvents.emit({ type: 'resumed', trip: getTrip() });
  }
  return getTrip();
}

/** Siapkan sesi baru dari data diri crew (layar pertama). */
export async function beginSession(input = {}) {
  const settings = await kv.get('settings', {});
  const trip = blankTrip({
    crew: {
      nama: input.crewNama ?? settings.crewNama ?? '',
      hp: input.crewHp ?? settings.crewHp ?? '',
      kantor: input.crewKantor ?? '',
    },
    kantor: {
      nama: input.kantorNama ?? settings.kantorNama ?? '',
      nomor: input.kantorNomor ?? settings.kantorNomor ?? '',
    },
    customer: {
      nama: input.pelangganNama ?? '',
      hp: input.pelangganHp ?? '',
      resi: input.resi ?? '',
    },
  });

  current = trip;
  await persist('begin');
  tripEvents.emit({ type: 'begin', trip: getTrip() });
  return getTrip();
}

/* ---------------- Ringkasan untuk UI ---------------- */

export function liveSummary() {
  if (!current) return null;
  if (current.state === TRIP_STATE.EN_ROUTE) return computeSummary({ ...current, arrivedAt: Date.now() });
  return current.summary;
}

export function stateLabel(state) {
  return (
    {
      [TRIP_STATE.DRAFT]: 'Data belum lengkap',
      [TRIP_STATE.READY]: 'Siap berangkat',
      [TRIP_STATE.EN_ROUTE]: 'Dalam perjalanan',
      [TRIP_STATE.ARRIVED]: 'Tiba di lokasi',
      [TRIP_STATE.DONE]: 'Selesai',
      [TRIP_STATE.CLOSED]: 'Ditutup',
    }[state] || state
  );
}

export const helpers = { makeTripId, computeSummary, clone };
