// Layar 2 — Halaman Informasi.
// Deliman wajib memfoto produk yang dibeli dan nota belanja. Setelah keduanya
// lengkap, menekan tombol berangkat akan merekam titik awal (Google Maps) dan
// mengirim informasi keberangkatan + foto ke WhatsApp pelanggan.

import { icon } from '../icons.js';
import { $, esc, fmtCoord } from '../util.js';
import { modal, toast, withBusy } from '../ui.js';
import { scannerSupported, scanCode } from '../scanner.js';
import { gmapsLink, parseLatLng } from '../geo.js';
import { notifyCustomerDeparture } from '../messaging.js';
import { photoCard } from '../photobox.js';
import * as trip from '../trip.js';

const STEPS = ['Data', 'Berkas', 'Perjalanan', 'Serah terima'];

export default {
  title: 'Halaman Informasi',
  sub: 'Foto produk & nota belanja',
  brand: true,
  tab: true,

  async mount(root, ctx) {
    const t = trip.getTrip();
    if (!t) {
      root.innerHTML = emptyState('Sesi pengantaran belum dimulai.', 'Mulai dari halaman awal.');
      return;
    }

    root.innerHTML = `
      <section class="hero">
        <div class="hero__label">Tujuan Pengantaran</div>
        <div class="hero__value">${esc(t.customer?.nama || 'Pelanggan')}</div>
        <div class="hero__meta">
          <span class="hero__pill">${icon('receipt')} ${esc(t.customer?.resi || '—')}</span>
          <span class="hero__pill">${icon('whatsapp')} ${esc(t.customer?.hp || '—')}</span>
        </div>
      </section>

      <div class="stepper mt-16">
        ${STEPS.map((s, i) => {
          const state = i === 0 ? 'is-done' : i === 1 ? 'is-active' : '';
          return `<div class="stepper__item ${state}">
            <div class="stepper__dot">${i === 0 ? icon('check') : i + 1}</div>
            ${i < STEPS.length - 1 ? '<div class="stepper__bar"></div>' : ''}
          </div>`;
        }).join('')}
      </div>

      <section class="section" style="margin-top:6px">
        <div class="section__head">
          <div class="section__title">Kelengkapan Berkas</div>
          <div class="section__line"></div>
        </div>
        <div id="photoSlots" class="cardlist"></div>
      </section>

      <section class="section">
        <div class="section__head">
          <div class="section__title">Titik Tujuan (Google Maps)</div>
          <div class="section__line"></div>
        </div>
        <div class="card card__pad">
          <div class="field" style="margin-bottom:0">
            <label class="field__label" for="f-tujuan">${icon('pin')} Tempel tautan / koordinat lokasi</label>
            <div class="inputwrap">
              <input class="input input--with-icon" id="f-tujuan" placeholder="https://maps.google.com/... atau -6.2000, 106.8166"
                value="${esc(t.produk?.tujuan?.label || '')}" />
              <button class="btn btn--icon btn--soft" type="button" id="btnTujuan" aria-label="Simpan lokasi tujuan">
                ${icon('check')}
              </button>
            </div>
            <div class="field__hint" id="tujuanHint">
              Opsional. Bila diisi, tombol navigasi akan mengarah langsung ke alamat tujuan.
            </div>
          </div>
          <div id="tujuanCard" class="mt-12"></div>
        </div>
      </section>

      <div class="banner banner--brand mt-16">
        ${icon('whatsapp')}
        <div>Setelah foto <b>produk</b> dan <b>nota belanja</b> lengkap, tekan tombol berangkat. Aplikasi merekam titik awal dan mengirim informasi keberangkatan beserta fotonya ke WhatsApp pelanggan.</div>
      </div>

      <div class="actionbar" id="bar">
        <button class="btn btn--primary btn--lg" id="btnGo" type="button" disabled>
          ${icon('play')} Mulai Berangkat &amp; Kirim Info
        </button>
      </div>
      <div style="height:78px"></div>
    `;

    const slots = $('#photoSlots', root);

    const produkCard = photoCard({
      kind: trip.KIND.PRODUK,
      title: 'Foto Produk',
      hint: 'Foto seluruh barang belanjaan yang akan diantarkan',
      iconName: 'package',
      onChange: syncGate,
    });

    const notaCard = photoCard({
      kind: trip.KIND.NOTA,
      title: 'Foto Nota Belanja',
      hint: 'Pastikan angka & nomor resi pada struk terbaca jelas',
      iconName: 'receipt',
      scanLabel: scannerSupported() ? 'Pindai' : '',
      onScan: () => rescan(),
      onChange: syncGate,
    });

    slots.append(produkCard.el, notaCard.el);
    await Promise.all([produkCard.refresh(), notaCard.refresh()]);

    renderTujuan(t.produk?.tujuan || null);

    $('#btnTujuan', root).addEventListener('click', saveTujuan);
    $('#f-tujuan', root).addEventListener('keydown', (e) => {
      if (e.key === 'Enter') saveTujuan();
    });
    $('#btnGo', root).addEventListener('click', () => mulai(root, ctx));

    function syncGate() {
      const kurang = trip.missingPhotos('berangkat', [...produkCard.rows, ...notaCard.rows]);
      const btn = $('#btnGo', root);
      btn.disabled = kurang.length > 0;
      btn.innerHTML = kurang.length
        ? `${icon('clock')} Lengkapi ${kurang.map((k) => trip.KIND_LABEL[k]).join(' & ')}`
        : `${icon('play')} Mulai Berangkat &amp; Kirim Info`;
    }

    async function rescan() {
      try {
        const res = await scanCode({ title: 'Pindai Resi Belanja' });
        if (!res) return;
        if (res.value) {
          await trip.setCustomer({ ...trip.getTrip().customer, resi: res.value });
          toast(`Resi diperbarui: ${res.value}`, 'ok');
        } else {
          toast('Ketik nomor resi manual di halaman awal.', 'info');
        }
      } catch (e) {
        toast(e.message, 'err');
      }
    }

    function renderTujuan(pt) {
      const box = $('#tujuanCard', root);
      if (!pt) {
        box.innerHTML = '';
        return;
      }
      box.innerHTML = `
        <div class="sticky-note">
          <div class="bold">${esc(pt.label || 'Titik tujuan')}</div>
          <div class="small muted mono mt-8">${fmtCoord(pt.lat, pt.lng)}</div>
          <div class="linkrow" style="padding-left:0;padding-right:0">
            ${icon('pin')}<a href="${gmapsLink(pt)}" target="_blank" rel="noopener">Lihat di Google Maps</a>
          </div>
        </div>`;
    }

    async function saveTujuan() {
      const input = $('#f-tujuan', root);
      const raw = input.value.trim();
      if (!raw) {
        await trip.setProduk({ tujuan: null });
        renderTujuan(null);
        toast('Titik tujuan dikosongkan.', 'info');
        return;
      }
      const pt = parseLatLng(raw);
      if (!pt) {
        toast('Tautan/koordinat tidak dikenali. Contoh: -6.2000, 106.8166', 'warn', 5200);
        input.focus();
        return;
      }
      const tujuan = { ...pt, label: pt.label || 'Titik tujuan' };
      await trip.setProduk({ tujuan });
      input.value = tujuan.label;
      renderTujuan(tujuan);
      toast('Titik tujuan disimpan.', 'ok');
    }

    syncGate();
  },
};

async function mulai(root, ctx) {
  const t = trip.getTrip();
  if (!t) return;

  const kurang = trip.missingPhotos('berangkat', [
    ...(await trip.mediaRows(trip.KIND.PRODUK)),
    ...(await trip.mediaRows(trip.KIND.NOTA)),
  ]);
  if (kurang.length) {
    toast(`Lengkapi dulu: ${kurang.map((k) => trip.KIND_LABEL[k]).join(' & ')}.`, 'warn');
    return;
  }

  const ok = await modal({
    title: 'Mulai pengantaran sekarang?',
    text: 'Titik awal keberangkatan akan direkam dari GPS dan informasi keberangkatan dikirim ke WhatsApp pelanggan.',
    iconName: 'nav',
    tone: 'brand',
    okLabel: 'Ya, Berangkat',
  });
  if (!ok) return;

  let started = null;
  await withBusy('Merekam titik awal…', async () => {
    started = await trip.startTrip();
  }).catch((e) => {
    toast(e.message || 'Gagal memulai perjalanan.', 'err', 5600);
  });

  if (!started) return;

  await kirimInfoKePelanggan(started, root);
  toast('Perjalanan dimulai. Perekaman GPS aktif.', 'ok', 4200);
  ctx.go('route');
}

/** Kirim info keberangkatan + foto ke WhatsApp pelanggan via lembar berbagi HP. */
async function kirimInfoKePelanggan(t, root) {
  const rows = [...(await trip.mediaRows(trip.KIND.PRODUK)), ...(await trip.mediaRows(trip.KIND.NOTA))];
  const files = rows.map((r, i) => {
    try {
      return new File([r.blob], `${r.kind}-${i + 1}.jpg`, { type: r.blob.type || 'image/jpeg' });
    } catch {
      return null;
    }
  });

  try {
    const res = await notifyCustomerDeparture(t, files);
    if (res.via === 'wa-text') {
      toast('Teks keberangkatan dibuka di WhatsApp. Lampiran foto tersedia di Riwayat bila perlu dikirim ulang.', 'info', 6000);
    } else if (res.via === 'share-files') {
      toast('Informasi & foto keberangkatan terkirim.', 'ok');
    } else if (res.via === 'wa-prompt') {
      toast('Pesan keberangkatan siap. Buka WhatsApp dari tombol Kontak cepat di layar Rute.', 'info', 6500);
    }
  } catch (e) {
    toast(`Gagal membuka WhatsApp: ${e.message}`, 'warn', 5600);
  }
}

function emptyState(title, sub) {
  return `
    <div class="empty">
      <div class="empty__ico">${icon('alert')}</div>
      <h3>${title}</h3>
      <p>${sub}</p>
    </div>`;
}
