import { TILES } from './config.js';
import { icon } from './icons.js';
import { net } from './geo.js';
import { el } from './util.js';

let L = null;

function lib() {
  if (L) return L;
  L = window.L || null;
  return L;
}

export function mapAvailable() {
  return !!lib();
}

function dotIcon(kind) {
  const l = lib();
  return l.divIcon({
    className: '',
    html: `<div class="pin-dot pin-dot--${kind}"></div>`,
    iconSize: [18, 18],
    iconAnchor: [9, 9],
  });
}

/**
 * Peta ringkas dengan jejak perjalanan.
 * Tetap menampilkan koordinat bila tile peta tidak bisa dimuat (mode offline).
 */
export class MiniMap {
  constructor(container, { interactive = true, tone = 'brand' } = {}) {
    this.container = container;
    this.map = null;
    this.layers = { trail: null, start: null, end: null, me: null };
    this.tone = tone;

    if (!mapAvailable()) {
      this._fallback('Peta tidak tersedia');
      return;
    }

    const l = lib();
    container.innerHTML = '';
    this.map = l.map(container, {
      zoomControl: interactive,
      attributionControl: false,
      dragging: interactive,
      scrollWheelZoom: false,
      doubleClickZoom: interactive,
      tap: interactive,
      touchZoom: interactive,
      preferCanvas: true,
    }).setView([-6.2, 106.816666], 13);

    this.tileLayer = l.tileLayer(TILES.url, {
      maxZoom: TILES.maxZoom,
      crossOrigin: true,
      errorTileUrl: 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==',
    });
    this.tileLayer.addTo(this.map);

    // Bila tile gagal total (offline), tampilkan pesan ramah.
    let tileErrors = 0;
    this.tileLayer.on('tileerror', () => {
      tileErrors++;
      if (tileErrors === 4 && !net.online) {
        const note = el('div', {
          class: 'banner banner--warn',
          style: 'position:absolute;left:10px;right:10px;bottom:10px;z-index:500',
        }, `${icon('cloudOff')}<div>Peta butuh internet. Titik koordinat tetap tercatat dan lengkap.</div>`);
        container.style.position = 'relative';
        container.appendChild(note);
        setTimeout(() => note.remove(), 5000);
      }
    });

    setTimeout(() => this.map?.invalidateSize(), 220);
  }

  _fallback(msg) {
    this.container.innerHTML = `<div class="map__fallback">${icon('cloudOff')}<div>${msg}</div></div>`;
  }

  setView(lat, lng, zoom = 16) {
    this.map?.setView([lat, lng], zoom, { animate: false });
  }

  fit(points, { padding = 42, maxZoom = 17 } = {}) {
    if (!this.map) return;
    const pts = points.filter(Boolean).map((p) => [p.lat, p.lng]);
    if (!pts.length) return;
    if (pts.length === 1) {
      this.map.setView(pts[0], 16, { animate: false });
      return;
    }
    // Bila radius sangat kecil, jangan zoom terlalu dekat agar konteks jalan tetap terlihat.
    this.map.fitBounds(pts, { padding: [padding, padding], maxZoom });
  }

  setTrail(points) {
    if (!this.map) return;
    const l = lib();
    const latlngs = points.filter(Boolean).map((p) => [p.lat, p.lng]);
    this.layers.trail?.remove();
    this.layers.trail = null;
    if (latlngs.length > 1) {
      this.layers.trail = l.polyline(latlngs, {
        color: '#4f46e5',
        weight: 5,
        opacity: 0.9,
        lineJoin: 'round',
        lineCap: 'round',
      }).addTo(this.map);
    }
  }

  setStart(pt) {
    if (!this.map || !pt) return;
    const l = lib();
    this.layers.start?.remove();
    this.layers.start = l.marker([pt.lat, pt.lng], { icon: dotIcon('start'), title: 'Titik awal' }).addTo(this.map);
  }

  setEnd(pt) {
    if (!this.map || !pt) return;
    const l = lib();
    this.layers.end?.remove();
    this.layers.end = l.marker([pt.lat, pt.lng], { icon: dotIcon('end'), title: 'Titik sampai' }).addTo(this.map);
  }

  setMe(pt) {
    if (!this.map || !pt) return;
    const l = lib();
    if (this.layers.me) {
      this.layers.me.setLatLng([pt.lat, pt.lng]);
    } else {
      this.layers.me = l.marker([pt.lat, pt.lng], { icon: dotIcon('me'), title: 'Posisi saat ini', zIndexOffset: 999 }).addTo(this.map);
    }
  }

  removeMe() {
    this.layers.me?.remove();
    this.layers.me = null;
  }

  invalidate() {
    this.map?.invalidateSize();
  }

  destroy() {
    try {
      this.map?.remove();
    } catch { /* diabaikan */ }
    this.map = null;
  }
}
