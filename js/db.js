// Lapisan penyimpanan lokal (IndexedDB) — tahan offline & tahan app ditutup paksa.
// IndexedDB dipakai (bukan localStorage) karena harus menyimpan Blob foto/PDF berukuran besar.

const DB_NAME = 'delivtrack';
const DB_VERSION = 1;

export const STORE = {
  TRIPS: 'trips',
  MEDIA: 'media',
  QUEUE: 'queue',
  KV: 'kv',
};

let _db = null;
let _opening = null;

function open() {
  if (_db) return Promise.resolve(_db);
  if (_opening) return _opening;

  _opening = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = (e) => {
      const db = req.result;
      const from = e.oldVersion;

      if (from < 1) {
        const trips = db.createObjectStore(STORE.TRIPS, { keyPath: 'id' });
        trips.createIndex('startedAt', 'startedAt');
        trips.createIndex('state', 'state');
        trips.createIndex('syncState', 'syncState');

        const media = db.createObjectStore(STORE.MEDIA, { keyPath: 'id' });
        media.createIndex('tripId', 'tripId');
        media.createIndex('kind', 'kind');
        media.createIndex('tripKind', ['tripId', 'kind']);

        const queue = db.createObjectStore(STORE.QUEUE, { keyPath: 'id' });
        queue.createIndex('tripId', 'tripId');
        queue.createIndex('createdAt', 'createdAt');

        db.createObjectStore(STORE.KV, { keyPath: 'k' });
      }
    };

    req.onsuccess = () => {
      _db = req.result;
      _db.onversionchange = () => {
        _db.close();
        _db = null;
      };
      resolve(_db);
    };

    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('Database diblokir tab lain. Tutup tab DelivTrack yang lain.'));
  }).finally(() => {
    _opening = null;
  });

  return _opening;
}

function run(storeName, mode, fn) {
  return open().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, mode);
        const store = tx.objectStore(storeName);
        let out;
        try {
          out = fn(store, tx);
        } catch (err) {
          reject(err);
          return;
        }
        tx.oncomplete = () => resolve(out && out.__req ? out.__req.result : out);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error || new Error('Transaksi dibatalkan'));
      })
  );
}

const wrap = (req) => ({ __req: req });

/* ---------------- API umum ---------------- */

export const db = {
  ready: open,

  put(store, value) {
    return run(store, 'readwrite', (s) => wrap(s.put(value)));
  },

  putMany(store, values) {
    return run(store, 'readwrite', (s) => {
      values.forEach((v) => s.put(v));
    });
  },

  get: (store, key) => run(store, 'readonly', (s) => wrap(s.get(key))),

  del: (store, key) => run(store, 'readwrite', (s) => wrap(s.delete(key))),

  clear: (store) => run(store, 'readwrite', (s) => wrap(s.clear())),

  all: (store) => run(store, 'readonly', (s) => wrap(s.getAll())),

  count: (store) => run(store, 'readonly', (s) => wrap(s.count())),

  byIndex(store, index, query, limit) {
    return run(store, 'readonly', (s) => wrap(s.index(index).getAll(query, limit)));
  },

  byIndexRange(store, index, range, limit) {
    return run(store, 'readonly', (s) => wrap(s.index(index).getAll(range, limit)));
  },

  deleteByIndex(store, index, query) {
    return run(store, 'readwrite', (s) => {
      const idx = s.index(index);
      const req = idx.openCursor(query);
      req.onsuccess = () => {
        const cur = req.result;
        if (cur) {
          cur.delete();
          cur.continue();
        }
      };
    });
  },
};

/* ---------------- KV (pengaturan kecil) ---------------- */

export const kv = {
  async get(key, fallback = undefined) {
    const row = await db.get(STORE.KV, key);
    if (row === undefined || row === null) return fallback;
    return row.v;
  },
  async set(key, value) {
    await db.put(STORE.KV, { k: key, v: value, at: Date.now() });
    return value;
  },
  async del(key) {
    await db.del(STORE.KV, key);
  },
  async all() {
    const rows = await db.all(STORE.KV);
    return Object.fromEntries(rows.map((r) => [r.k, r.v]));
  },
};

/* ---------------- Trips ---------------- */

export const trips = {
  async save(trip) {
    trip.updatedAt = Date.now();
    await db.put(STORE.TRIPS, trip);
    return trip;
  },
  get: (id) => db.get(STORE.TRIPS, id),
  del: (id) => db.del(STORE.TRIPS, id),

  async list({ limit = 500 } = {}) {
    const rows = await db.all(STORE.TRIPS);
    rows.sort((a, b) => (b.startedAt || b.createdAt || 0) - (a.startedAt || a.createdAt || 0));
    return rows.slice(0, limit);
  },

  async active() {
    const rows = await db.all(STORE.TRIPS);
    return (
      rows
        // 'selesai' ikut dipulihkan: sesi belum benar-benar tuntas sebelum
        // laporan terkirim ke kantor dan sesi ditutup.
        .filter((t) => ['siap', 'perjalanan', 'tiba', 'selesai'].includes(t.state))
        .sort((a, b) => (b.startedAt || b.createdAt) - (a.startedAt || a.createdAt))[0] || null
    );
  },

  async pendingSync() {
    const rows = await db.all(STORE.TRIPS);
    return rows.filter((t) => t.syncState && t.syncState !== 'synced' && t.state === 'ditutup');
  },
};

/* ---------------- Media (foto, tanda tangan, PDF) ---------------- */

export const media = {
  async putBlob({ id, tripId, kind, blob, meta = {} }) {
    const row = {
      id: id || `${tripId}_${kind}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      tripId,
      kind,
      blob,
      mime: blob.type || 'application/octet-stream',
      bytes: blob.size || 0,
      at: Date.now(),
      ...meta,
    };
    await db.put(STORE.MEDIA, row);
    return row;
  },
  get: (id) => db.get(STORE.MEDIA, id),
  del: (id) => db.del(STORE.MEDIA, id),
  byTrip: (tripId) => db.byIndex(STORE.MEDIA, 'tripId', tripId),
  byTripKind: (tripId, kind) => db.byIndex(STORE.MEDIA, 'tripKind', [tripId, kind]),

  async deleteTripMedia(tripId) {
    await db.deleteByIndex(STORE.MEDIA, 'tripId', tripId);
  },

  async usage() {
    const rows = await db.all(STORE.MEDIA);
    return {
      count: rows.length,
      bytes: rows.reduce((a, r) => a + (r.bytes || 0), 0),
    };
  },
};

/* ---------------- Antrian unggah ---------------- */

export const queue = {
  add: (job) => db.put(STORE.QUEUE, { attempts: 0, nextAt: 0, ...job }),
  get: (id) => db.get(STORE.QUEUE, id),
  del: (id) => db.del(STORE.QUEUE, id),
  all: () => db.all(STORE.QUEUE),
  byTrip: (tripId) => db.byIndex(STORE.QUEUE, 'tripId', tripId),
  clear: () => db.clear(STORE.QUEUE),

  async due(now = Date.now()) {
    const rows = await db.all(STORE.QUEUE);
    return rows.filter((r) => (r.nextAt || 0) <= now).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  },
};

/* ---------------- Pemeliharaan ---------------- */

export async function storageEstimate() {
  if (!navigator.storage?.estimate) return null;
  try {
    const { usage, quota } = await navigator.storage.estimate();
    return { usage, quota, pct: quota ? usage / quota : 0 };
  } catch {
    return null;
  }
}

export async function requestPersistence() {
  if (!navigator.storage?.persist) return false;
  try {
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

export async function exportAll() {
  const [allTrips, allMedia, allQueue, allKv] = await Promise.all([
    db.all(STORE.TRIPS),
    db.all(STORE.MEDIA),
    db.all(STORE.QUEUE),
    db.all(STORE.KV),
  ]);
  return {
    exportedAt: Date.now(),
    version: DB_VERSION,
    trips: allTrips,
    queue: allQueue,
    kv: allKv,
    media: allMedia.map((m) => ({ ...m, blob: null, __omitted: true })),
  };
}

export async function wipeAll() {
  await Promise.all([
    db.clear(STORE.TRIPS),
    db.clear(STORE.MEDIA),
    db.clear(STORE.QUEUE),
  ]);
}
