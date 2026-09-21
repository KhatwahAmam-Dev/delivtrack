import { GPS } from './config.js';

const R = 6371008.8; // radius bumi (meter)

const toRad = (d) => (d * Math.PI) / 180;

/** Jarak lingkaran besar antara 2 koordinat (meter). */
export function haversine(a, b) {
  if (!a || !b) return 0;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const la1 = toRad(a.lat);
  const la2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Bearing awal a->b dalam derajat (0-360). */
export function bearing(a, b) {
  const la1 = toRad(a.lat);
  const la2 = toRad(b.lat);
  const dLng = toRad(b.lng - a.lng);
  const y = Math.sin(dLng) * Math.cos(la2);
  const x = Math.cos(la1) * Math.sin(la2) - Math.sin(la1) * Math.cos(la2) * Math.cos(dLng);
  return (Math.atan2(y, x) * 180) / Math.PI + 360;
}

export function formatBearing(deg) {
  const dirs = ['Utara', 'Timur Laut', 'Timur', 'Tenggara', 'Selatan', 'Barat Daya', 'Barat', 'Barat Laut'];
  return dirs[Math.round(((deg % 360) + 360) % 360 / 45) % 8];
}

/* ---------------- Tautan peta ---------------- */

export function gmapsLink(pt) {
  if (!pt) return '';
  return `https://www.google.com/maps/search/?api=1&query=${pt.lat},${pt.lng}`;
}

export function gmapsDirections(from, to) {
  if (!from || !to) return gmapsLink(to || from);
  return (
    'https://www.google.com/maps/dir/?api=1' +
    `&origin=${from.lat},${from.lng}` +
    `&destination=${to.lat},${to.lng}` +
    '&travelmode=driving'
  );
}

export function geoUri(pt, label = 'Lokasi') {
  return `geo:${pt.lat},${pt.lng}?q=${pt.lat},${pt.lng}(${encodeURIComponent(label)})`;
}

/**
 * Baca koordinat dari teks apa pun: "lat, lng", tautan Google Maps
 * (…/@-6.2,106.8,17z, …?q=-6.2,106.8, …!3d-6.2!4d106.8), atau geo: URI.
 */
export function parseLatLng(text) {
  if (!text) return null;
  const s = String(text).trim();
  const num = '(-?\\d{1,3}(?:\\.\\d+)?)';
  const patterns = [
    new RegExp(`!3d${num}!4d${num}`),
    new RegExp(`@${num},${num}`),
    new RegExp(`[?&](?:q|query|ll|destination|center|daddr)=${num},${num}`),
    new RegExp(`^geo:${num},${num}`),
    new RegExp(`^${num}\\s*,\\s*${num}$`),
  ];
  for (const re of patterns) {
    const m = s.match(re);
    if (!m) continue;
    const lat = Number(m[1]);
    const lng = Number(m[2]);
    if (Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
      return { lat, lng };
    }
  }
  return null;
}

/* ---------------- Watch posisi ---------------- */

export class GeoWatch {
  constructor({ onPoint, onError, onStatus } = {}) {
    this.onPoint = onPoint || (() => {});
    this.onError = onError || (() => {});
    this.onStatus = onStatus || (() => {});
    this.watchId = null;
    this.last = null;
    this.running = false;
    this._lastEmit = 0;
  }

  get supported() {
    return 'geolocation' in navigator;
  }

  start() {
    if (!this.supported) {
      this.onError({ code: -1, message: 'Perangkat ini tidak mendukung GPS browser.' });
      return false;
    }
    if (this.running) return true;

    this.watchId = navigator.geolocation.watchPosition(
      (pos) => this._handle(pos),
      (err) => this.onError(err),
      {
        enableHighAccuracy: GPS.enableHighAccuracy,
        timeout: GPS.timeout,
        maximumAge: GPS.maximumAge,
      }
    );
    this.running = true;
    this.onStatus('watching');
    return true;
  }

  stop() {
    if (this.watchId !== null) {
      navigator.geolocation.clearWatch(this.watchId);
      this.watchId = null;
    }
    this.running = false;
    this.onStatus('stopped');
  }

  async once(timeout = 15000) {
    if (!this.supported) throw new Error('GPS tidak tersedia');
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Waktu permintaan GPS habis')), timeout);
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          clearTimeout(timer);
          resolve(pointFrom(pos));
        },
        (err) => {
          clearTimeout(timer);
          reject(new Error(geoErrorMessage(err)));
        },
        { enableHighAccuracy: true, timeout, maximumAge: 0 }
      );
    });
  }

  _handle(pos) {
    const p = pointFrom(pos);
    const prev = this.last;

    if (prev) {
      const d = haversine(prev, p);
      const dt = Math.max(1, (p.at - prev.at) / 1000);
      const kmh = (d / dt) * 3.6;
      p.speedKmh = Math.round(kmh * 10) / 10;
      p.moved = d;
      p.jump = d > GPS.minMoveM && kmh > GPS.maxSpeedKmh;
      p.elapsed = p.at - prev.at;
    } else {
      p.speedKmh = 0;
      p.moved = 0;
      p.jump = false;
      p.elapsed = 0;
    }

    // Titik pertama selalu diterima; berikutnya disaring agar akumulasi jarak tidak kacau.
    const accept =
      !prev ||
      ((p.accuracy == null || p.accuracy <= GPS.maxAccuracyM) && !p.jump);

    if (accept) this.last = p;

    const now = Date.now();
    const shouldEmit = accept && (now - this._lastEmit >= GPS.minIntervalMs || !prev);
    if (shouldEmit) this._lastEmit = now;

    this.onPoint(p, { accept, shouldEmit });
  }
}

export function pointFrom(pos) {
  const c = pos.coords;
  return {
    lat: c.latitude,
    lng: c.longitude,
    accuracy: c.accuracy ?? null,
    altitude: c.altitude ?? null,
    heading: c.heading ?? null,
    speed: c.speed ?? null,
    at: pos.timestamp || Date.now(),
  };
}

export function geoErrorMessage(err) {
  const c = err?.code;
  if (c === 1) return 'Izin lokasi ditolak. Aktifkan izin lokasi untuk DelivTrack di pengaturan browser.';
  if (c === 2) return 'Sinyal GPS tidak tersedia saat ini. Coba pindah ke area terbuka.';
  if (c === 3) return 'Permintaan GPS melebihi batas waktu. Coba lagi.';
  return err?.message || 'Gagal membaca lokasi.';
}

/* ---------------- Wake Lock (layar tidak mati) ---------------- */

export class ScreenWake {
  constructor() {
    this.sentinel = null;
    this.wanted = false;
    this._bound = () => this._reattach();
    document.addEventListener('visibilitychange', this._bound);
  }

  get supported() {
    return 'wakeLock' in navigator;
  }

  async acquire() {
    this.wanted = true;
    if (!this.supported) return false;
    try {
      this.sentinel = await navigator.wakeLock.request('screen');
      this.sentinel.addEventListener('release', () => {
        this.sentinel = null;
      });
      return true;
    } catch {
      return false;
    }
  }

  async release() {
    this.wanted = false;
    try {
      await this.sentinel?.release();
    } catch {
      /* diabaikan */
    }
    this.sentinel = null;
  }

  async _reattach() {
    if (document.visibilityState === 'visible' && this.wanted && !this.sentinel) {
      await this.acquire();
    }
  }
}

/* ---------------- Jaringan ---------------- */

export const net = {
  get online() {
    return navigator.onLine !== false;
  },
  onChange(cb) {
    const on = () => cb(true);
    const off = () => cb(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  },
};

/* ---------------- Akumulasi jarak ---------------- */

/**
 * Menghitung jarak tempuh dari daftar breadcrumb.
 * Titik dengan akurasi buruk atau lompatan tidak wajar tidak dihitung.
 */
export function accumulate(points) {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const d = haversine(a, b);
    const dt = Math.max(1, ((b.at || 0) - (a.at || 0)) / 1000);
    const kmh = (d / dt) * 3.6;
    if ((b.accuracy != null && b.accuracy > GPS.maxAccuracyM) || kmh > GPS.maxSpeedKmh) continue;
    if (d < GPS.minMoveM) continue;
    total += d;
  }
  return total;
}
