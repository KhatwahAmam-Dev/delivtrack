// Layar 3 — Perjalanan.
// Menampilkan waktu berjalan, jarak tempuh GPS, peta jejak, dan tombol bantuan
// navigasi. Perekaman tetap berjalan walau deliman membuka Google Maps/WhatsApp.

import { TRIP_STATE } from '../config.js';
import { icon } from '../icons.js';
import { $, esc, fmtCoord, fmtDistance, fmtDuration, fmtTime, prettyPhone } from '../util.js';
import { confirmDialog, toast, withBusy } from '../ui.js';
import { gmapsDirections, gmapsLink } from '../geo.js';
import { MiniMap } from '../map.js';
import { notifyCustomerArrival, telLink, waLink } from '../messaging.js';
import * as trip from '../trip.js';

export default {
  title: 'Dalam Perjalanan',
  sub: 'Perekaman aktif',
  brand: false,
  tab: true,
  actions: [
    {
      label: 'Kontak cepat',
      icon: 'phone',
      onClick: (ctx) => quickContacts(ctx),
    },
  ],

  async mount(root, ctx) {
    const t = trip.getTrip();
    if (!t) {
      root.innerHTML = empty('Sesi pengantaran tidak ditemukan.', 'Mulai pengantaran baru dari halaman awal.');
      return;
    }
    if (t.state === TRIP_STATE.READY) {
      root.innerHTML = empty('Perjalanan belum dimulai.', 'Lengkapi berkas lalu tekan "Mulai Berangkat".');
      return;
    }

    const tujuan = t.produk?.tujuan || null;

    root.innerHTML = `
      <section class="hero">
        <div class="hero__label">Waktu Berjalan</div>
        <div class="hero__value tnum" id="clock">00m 00d</div>
        <div class="hero__meta">
          <span class="hero__pill">${icon('route')} <b class="tnum" id="dist">—</b></span>
          <span class="hero__pill">${icon('flag')} <span id="statePill">Dalam perjalanan</span></span>
        </div>
      </section>

      <div id="gpsWarn" class="mt-12"></div>

      <div class="statgrid mt-16">
        <div class="stat">
          <div class="stat__k">${icon('gauge')} Kecepatan</div>
          <div class="stat__v tnum" id="speed">0 km/j</div>
        </div>
        <div class="stat">
          <div class="stat__k">${icon('target')} Akurasi GPS</div>
          <div class="stat__v tnum" id="acc">—</div>
        </div>
        <div class="stat">
          <div class="stat__k">${icon('pin')} Titik Tercatat</div>
          <div class="stat__v tnum" id="pts">0</div>
        </div>
        <div class="stat">
          <div class="stat__k">${icon('nav')} Jarak Lurus</div>
          <div class="stat__v tnum" id="straight">—</div>
        </div>
      </div>

      <section class="section">
        <div class="section__head">
          <div class="section__title">Jejak Perjalanan</div>
          <div class="section__line"></div>
        </div>
        <div class="map map--tall" id="map"></div>
        <div class="small muted mt-8" id="coord">Menunggu titik GPS pertama…</div>
      </section>

      <section class="section">
        <div class="section__head">
          <div class="section__title">Bantuan Cepat</div>
          <div class="section__line"></div>
        </div>
        <div class="card">
          <button class="row row--tap" type="button" id="btnNav">
            <div class="row__ico row__ico--ok">${icon('nav')}</div>
            <div class="row__body">
              <div class="row__title">Buka Rute di Google Maps</div>
              <div class="row__sub">${tujuan ? 'Menuju titik tujuan yang disimpan' : 'Dari titik awal keberangkatan'}</div>
            </div>
            <div class="row__end">${icon('chevronRight')}</div>
          </button>
          <button class="row row--tap" type="button" id="btnTel">
            <div class="row__ico">${icon('phone')}</div>
            <div class="row__body">
              <div class="row__title">Telepon Pelanggan</div>
              <div class="row__sub">${esc(prettyPhone(t.customer?.hp))}</div>
            </div>
            <div class="row__end">${icon('chevronRight')}</div>
          </button>
          <button class="row row--tap" type="button" id="btnWa">
            <div class="row__ico row__ico--ok">${icon('whatsapp')}</div>
            <div class="row__body">
              <div class="row__title">Chat WhatsApp Pelanggan</div>
              <div class="row__sub">Beri tahu bila sudah dekat</div>
            </div>
            <div class="row__end">${icon('chevronRight')}</div>
          </button>
          <button class="row row--tap" type="button" id="btnKantor">
            <div class="row__ico">${icon('store')}</div>
            <div class="row__body">
              <div class="row__title">Telepon Kantor</div>
              <div class="row__sub">${esc(prettyPhone(t.kantor?.nomor))}</div>
            </div>
            <div class="row__end">${icon('chevronRight')}</div>
          </button>
        </div>
      </section>

      <div class="banner banner--ok mt-12">
        ${icon('shield')}
        <div><b>Perekaman aman.</b> Anda boleh menekan tombol Home, membuka Google Maps, atau menelepon pelanggan — waktu dan titik lokasi tetap tersimpan otomatis di HP, lalu diunggah ke Google Drive saat internet tersambung.</div>
      </div>

      <div class="actionbar">
        <button class="btn btn--primary btn--lg" id="btnArrive" type="button">
          ${icon('flag')} Saya Tiba di Lokasi
        </button>
      </div>
      <div style="height:78px"></div>
    `;

    const map = new MiniMap($('#map', root), { interactive: true });

    let lastPoint = t.trail?.slice(-1)[0] || t.startPoint || null;
    if (t.startPoint) map.setStart(t.startPoint);
    if (lastPoint) {
      map.setMe(lastPoint);
      map.setView(lastPoint.lat, lastPoint.lng, 16);
      paintCoord(lastPoint);
    }
    if (t.trail?.length > 1) map.setTrail(t.trail);

    paintStats(trip.liveSummary(), lastPoint);

    const tick = setInterval(() => {
      const s = trip.liveSummary();
      paintStats(s, lastPoint, { clockOnly: false });
    }, 1000);

    const off = trip.tripEvents.on((evt) => {
      if (evt.type === 'point') {
        lastPoint = evt.point;
        map.setMe(evt.point);
        const trail = evt.trip?.trail || [];
        if (trail.length > 1) {
          map.setTrail(trail);
          if (trail.length === 2) map.fit(trail);
        }
        paintCoord(evt.point);
        paintStats(evt.summary, evt.point);
      }
      if (evt.type === 'gps-error') {
        $('#gpsWarn', root).innerHTML = `
          <div class="banner banner--warn">${icon('wifiOff')}<div><b>GPS bermasalah.</b> ${esc(evt.message)}</div></div>`;
      }
      if (evt.type === 'gps-fallback') {
        toast(`Lokasi memakai titik terakhir: ${evt.message}`, 'warn', 5200);
      }
    });

    $('#btnNav', root).addEventListener('click', () => {
      const from = trip.getTrip()?.startPoint;
      const url = tujuan && from ? gmapsDirections(from, tujuan) : from ? gmapsLink(from) : gmapsLink(lastPoint || { lat: 0, lng: 0 });
      window.open(url, '_blank', 'noopener');
    });
    $('#btnTel', root).addEventListener('click', () => {
      window.location.href = telLink(t.customer?.hp || '');
    });
    $('#btnWa', root).addEventListener('click', () => {
      const txt = `Halo ${t.customer?.nama || 'Bapak/Ibu'}, saya ${t.crew?.nama || 'deliman'} sedang menuju lokasi Anda. Mohon bersiap menerima paket. Terima kasih 🙏`;
      window.open(waLink(t.customer?.hp, txt), '_blank', 'noopener');
    });
    $('#btnKantor', root).addEventListener('click', () => {
      window.location.href = telLink(t.kantor?.nomor || '');
    });

    $('#btnArrive', root).addEventListener('click', () => arrive(root, ctx));

    function paintCoord(p) {
      $('#coord', root).textContent = p
        ? `Posisi terakhir: ${fmtCoord(p.lat, p.lng)}${p.accuracy ? ` · akurasi ±${Math.round(p.accuracy)} m` : ''}`
        : 'Menunggu titik GPS pertama…';
    }

    function paintStats(s, p, { clockOnly = true } = {}) {
      const elapsed = (trip.getTrip()?.startedAt || Date.now());
      $('#clock', root).textContent = fmtDuration(Date.now() - elapsed);
      if (clockOnly) {
        const speed = p?.speedKmh;
        $('#speed', root).textContent = `${Number.isFinite(speed) ? Math.round(speed) : 0} km/j`;
        $('#acc', root).textContent = p?.accuracy ? `±${Math.round(p.accuracy)} m` : '—';
        $('#pts', root).textContent = String(s?.points ?? 0);
      }
      $('#dist', root).textContent = s?.distanceText || '0 m';
      $('#straight', root).textContent = s?.straightText || '—';
    }

    this._cleanup = () => {
      clearInterval(tick);
      off();
      map.destroy();
    };
    this._map = map;
    this._invalidate = () => map.invalidate();
    setTimeout(() => map.invalidate(), 260);
  },

  unmount() {
    this._cleanup?.();
    this._cleanup = null;
  },

  async onBack() {
    const stay = await confirmDialog(
      'Kembali ke halaman informasi?',
      'Perjalanan tetap berjalan dan terus merekam. Anda dapat kembali ke layar ini dari Beranda.',
      { okLabel: 'Ya, kembali', cancelLabel: 'Tetap di sini', okTone: 'primary' }
    );
    return stay;
  },
};

/** Kegiatan tiba di lokasi: rekam titik akhir lalu kirim info ke pelanggan. */
async function arrive(root, ctx) {
  const t = trip.getTrip();
  if (!t) return;

  const ok = await confirmDialog(
    'Sudah tiba di lokasi pelanggan?',
    'Titik akhir perjalanan akan direkam dan info kedatangan dikirim ke WhatsApp pelanggan.',
    { okLabel: 'Ya, Saya Tiba', okTone: 'success' }
  );
  if (!ok) return;

  let done = null;
  await withBusy('Merekam titik akhir…', async () => {
    done = await trip.arrive();
  }).catch((e) => toast(e.message || 'Gagal merekam titik akhir.', 'err', 5600));

  if (!done) return;

  try {
    await notifyCustomerArrival(done, []);
  } catch (e) {
    toast(`Info kedatangan gagal dikirim: ${e.message}`, 'warn', 5600);
  }

  toast(`Tiba pukul ${fmtTime(done.arrivedAt)} · jarak ${fmtDistance(done.summary?.distanceMeters || 0)}.`, 'ok', 4600);
  ctx.go('handover');
}

async function quickContacts(ctx) {
  const t = trip.getTrip();
  if (!t) return;
  const { actionSheet } = await import('../ui.js');
  const pick = await actionSheet({
    title: 'Kontak cepat',
    subtitle: 'Telepon atau kirim pesan',
    actions: [
      { label: 'Telepon pelanggan', hint: prettyPhone(t.customer?.hp), icon: 'phone', value: telLink(t.customer?.hp) },
      { label: 'WhatsApp pelanggan', hint: prettyPhone(t.customer?.hp), icon: 'whatsapp', value: waLink(t.customer?.hp, ''), tone: 'ok' },
      { label: 'Telepon kantor', hint: prettyPhone(t.kantor?.nomor), icon: 'store', value: telLink(t.kantor?.nomor) },
    ],
  });
  if (!pick) return;
  if (pick.startsWith('http')) window.open(pick, '_blank', 'noopener');
  else window.location.href = pick;
}

function empty(title, sub) {
  return `
    <div class="empty">
      <div class="empty__ico">${icon('alert')}</div>
      <h3>${title}</h3>
      <p>${sub}</p>
    </div>`;
}
