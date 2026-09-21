// Antrian unggah tahan offline. Job disimpan di IndexedDB sehingga tetap ada
// walaupun aplikasi ditutup, lalu diproses otomatis saat internet kembali.

import { SYNC } from './config.js';
import { db, kv, media, queue, STORE, trips } from './db.js';
import * as drive from './drive.js';
import { toast } from './ui.js';

const listeners = new Set();
let running = false;
let timer = null;

export const syncEvents = {
  on(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  emit(payload) {
    listeners.forEach((fn) => {
      try {
        fn(payload);
      } catch { /* diabaikan */ }
    });
  },
};

function backoff(attempts) {
  const arr = SYNC.backoffMs;
  return arr[Math.min(attempts, arr.length - 1)];
}

/* ---------------- Penjadwalan job ---------------- */

export async function enqueueTripUpload(tripId, { reason = 'selesai' } = {}) {
  const job = {
    id: `job_${tripId}`,
    tripId,
    type: 'trip-bundle',
    reason,
    createdAt: Date.now(),
    attempts: 0,
    nextAt: 0,
  };
  await queue.add(job);
  await registerBackgroundSync();
  syncEvents.emit({ type: 'queued', tripId });
  return job;
}

export async function registerBackgroundSync() {
  try {
    const reg = await navigator.serviceWorker?.ready;
    if (reg?.sync) await reg.sync.register('delivtrack-upload');
  } catch { /* tidak didukung — pakai timer internal */ }
}

/* ---------------- Pemroses ---------------- */

export async function pendingCount() {
  return (await queue.all()).length;
}

export async function flushQueue({ manual = false } = {}) {
  if (running) return { skipped: true };
  if (!navigator.onLine) {
    if (manual) toast('Tidak ada internet. Data tetap aman di HP dan akan terunggah otomatis nanti.', 'warn');
    return { skipped: true, offline: true };
  }

  const configured = await drive.isConfigured();
  if (!configured) {
    if (manual) toast('Client ID Google Drive belum diatur. Buka Setelan → Google Drive.', 'warn');
    return { skipped: true, notConfigured: true };
  }

  const due = await queue.due();
  if (!due.length) return { skipped: true, empty: true };

  if (!(await drive.isConnected())) {
    try {
      await drive.ensureToken({ interactive: false });
    } catch (e) {
      if (manual) toast(e.message, 'warn');
      syncEvents.emit({ type: 'need-auth', error: e.message });
      return { skipped: true, needAuth: true };
    }
  }

  running = true;
  syncEvents.emit({ type: 'start', total: due.length });
  let done = 0;
  let failed = 0;

  try {
    for (const job of due) {
      try {
        syncEvents.emit({ type: 'progress', job, done, total: due.length });
        await processJob(job);
        await queue.del(job.id);
        done++;
        syncEvents.emit({ type: 'job-done', job, done, total: due.length });
      } catch (e) {
        failed++;
        const attempts = (job.attempts || 0) + 1;
        const giveUp = attempts >= SYNC.maxAttempts;
        await queue.add({
          ...job,
          attempts,
          nextAt: Date.now() + backoff(attempts),
          lastError: e?.message || String(e),
        });
        await trips.save({
          ...(await trips.get(job.tripId)),
          syncState: giveUp ? 'error' : 'pending',
          syncError: e?.message || String(e),
        }).catch(() => {});
        syncEvents.emit({ type: 'job-error', job, error: e });
        if (/Sesi Google Drive|Client ID/i.test(e?.message || '')) break;
      }
    }
  } finally {
    running = false;
    syncEvents.emit({ type: 'end', done, failed });
  }

  if (manual) {
    if (done && !failed) toast(`${done} transaksi berhasil diunggah ke Google Drive.`, 'ok');
    else if (done && failed) toast(`${done} berhasil, ${failed} gagal diunggah.`, 'warn');
    else if (failed) toast('Unggahan gagal. Akan dicoba lagi otomatis.', 'err');
    else toast('Tidak ada antrian yang perlu diunggah.', 'info');
  }

  return { done, failed };
}

async function processJob(job) {
  const trip = await trips.get(job.tripId);
  if (!trip) throw new Error('Data transaksi tidak ditemukan.');

  await trips.save({ ...trip, syncState: 'uploading' });

  const settings = await kv.get('settings', {});
  const rootName = settings.driveFolderName || 'DelivTrack';
  const makePublic = settings.drivePublicLinks !== false;

  syncEvents.emit({ type: 'stage', tripId: trip.id, stage: 'folder' });
  const folderId = await drive.tripFolder(trip, rootName);

  const rows = await media.byTrip(trip.id);
  const links = [];
  const uploaded = {};

  // Laporan sempat gagal disusun (mis. sesi terputus). Bangun ulang di sini
  // agar arsip di cloud selalu memuat PDF, bukan hanya foto mentahnya.
  if (!rows.some((r) => r.kind === 'pdf')) {
    try {
      const { buildTripPdf } = await import('./report.js');
      const blob = await buildTripPdf(trip, {
        photos: rows.filter((r) => r.kind !== 'pdf' && r.kind !== 'ttd'),
        signature: rows.find((r) => r.kind === 'ttd')?.blob || null,
        driveLinks: trip.driveLinks || [],
      });
      rows.push(await media.putBlob({ tripId: trip.id, kind: 'pdf', blob, meta: { name: `${trip.id}.pdf` } }));
    } catch (e) {
      syncEvents.emit({ type: 'stage', tripId: trip.id, stage: 'laporan-gagal' });
    }
  }

  const order = ['pdf', 'produk', 'nota', 'serah-terima', 'lain', 'ttd'];
  rows.sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind) || (a.at || 0) - (b.at || 0));

  for (const row of rows) {
    const label = `${trip.id}_${row.kind}_${new Date(row.at || Date.now()).toISOString().slice(11, 19).replace(/:/g, '')}`;
    const ext = row.mime === 'application/pdf' ? 'pdf' : row.mime === 'image/png' ? 'png' : 'jpg';
    const name = `${label}.${ext}`;

    syncEvents.emit({ type: 'stage', tripId: trip.id, stage: name });
    const file = await drive.uploadFile(row.blob, name, { folderId, makePublic });
    uploaded[row.id] = file;
    if (file.webViewLink) links.push({ kind: row.kind, name: file.name, url: file.webViewLink });
  }

  const fresh = await trips.get(trip.id);
  await trips.save({
    ...fresh,
    syncState: 'synced',
    syncedAt: Date.now(),
    syncError: null,
    driveFolderId: folderId,
    driveLinks: links,
    driveLinksFlat: links.map((l) => l.url),
  });

  syncEvents.emit({ type: 'trip-synced', tripId: trip.id, links });
  return links;
}

/* ---------------- Pemicu otomatis ---------------- */

export function startSyncWatcher({ intervalMs = 45_000 } = {}) {
  const kick = () => {
    if (navigator.onLine) flushQueue().catch(() => {});
  };

  window.addEventListener('online', () => {
    toast('Internet kembali tersambung. Mengunggah data tertunda…', 'info');
    setTimeout(kick, 1200);
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') setTimeout(kick, 2000);
  });

  navigator.serviceWorker?.addEventListener('message', (e) => {
    if (e.data?.type === 'flush-queue') kick();
  });

  clearInterval(timer);
  timer = setInterval(kick, intervalMs);

  setTimeout(kick, 2500);
  return () => clearInterval(timer);
}

/** Ringkasan antrian untuk ditampilkan di layar Setelan. */
export async function queueSummary() {
  const rows = await queue.all();
  const usage = await media.usage();
  return {
    pending: rows.length,
    lastError: rows.map((r) => r.lastError).filter(Boolean).slice(-1)[0] || null,
    bytes: usage.bytes,
    files: usage.count,
  };
}

export async function retryAllNow() {
  const rows = await queue.all();
  await Promise.all(rows.map((r) => queue.add({ ...r, attempts: 0, nextAt: 0 })));
  return flushQueue({ manual: true });
}

export async function clearQueue() {
  await queue.clear();
  const storage = await db.all(STORE.TRIPS);
  await Promise.all(
    storage
      .filter((t) => t.syncState === 'pending' || t.syncState === 'error')
      .map((t) => trips.save({ ...t, syncState: 'synced', syncError: null, syncSkipped: true }))
  );
}
