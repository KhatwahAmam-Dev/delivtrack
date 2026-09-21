// Layar 1 — Data diri deliman, data pelanggan, dan nomor kantor.
// Semua wajib diisi sebelum aplikasi membuka halaman informasi pengantaran.

import { icon } from '../icons.js';
import { $, esc, isValidPhone, prettyPhone } from '../util.js';
import { kv } from '../db.js';
import { toast, withBusy, markInvalid } from '../ui.js';
import { scanCode, scannerSupported } from '../scanner.js';
import * as trip from '../trip.js';

export default {
  title: 'Mulai Pengantaran',
  sub: 'Data deliman & pelanggan',
  brand: true,
  tab: true,

  async mount(root, ctx) {
    const settings = (await kv.get('settings', {})) || {};
    const draft = trip.getTrip() || {};
    const crew = draft.crew || {};
    const customer = draft.customer || {};
    const kantor = draft.kantor || {};

    root.innerHTML = `
      <section class="hero">
        <div class="hero__label">Pengantaran Baru</div>
        <div class="hero__value">Data Pengantaran</div>
        <div class="hero__meta">
          <span class="hero__pill">${icon('shield')} Tersimpan di HP Anda</span>
          <span class="hero__pill">${icon('clock')} Otomatis saat internet kembali</span>
        </div>
      </section>

      <section class="section">
        <div class="section__head">
          <div class="section__title">Data Deliman</div>
          <div class="section__line"></div>
        </div>
        <div class="card card__pad">
          <div class="field">
            <label class="field__label" for="f-crew-nama">${icon('user')} Nama Lengkap <span class="field__req">*</span></label>
            <input class="input" id="f-crew-nama" name="crewNama" autocomplete="name" placeholder="Contoh: Budi Santoso"
              value="${esc(crew.nama || settings.crewNama || '')}" />
          </div>
          <div class="field">
            <label class="field__label" for="f-crew-hp">${icon('phone')} Nomor HP Deliman <span class="field__req">*</span></label>
            <input class="input" id="f-crew-hp" name="crewHp" type="tel" inputmode="numeric" autocomplete="tel"
              placeholder="08xxxxxxxxxx" value="${esc(crew.hp || settings.crewHp || '')}" />
            <div class="field__hint">Dipakai pada laporan yang dikirim ke kantor.</div>
          </div>
        </div>
      </section>

      <section class="section">
        <div class="section__head">
          <div class="section__title">Tujuan Pengantaran</div>
          <div class="section__line"></div>
        </div>
        <div class="card card__pad">
          <div class="field-row">
            <div class="field">
              <label class="field__label" for="f-pel-nama">${icon('store')} Nama Pelanggan <span class="field__req">*</span></label>
              <input class="input" id="f-pel-nama" name="pelangganNama" placeholder="Nama penerima"
                value="${esc(customer.nama || '')}" />
            </div>
            <div class="field">
              <label class="field__label" for="f-pel-hp">${icon('whatsapp')} No. HP Pelanggan <span class="field__req">*</span></label>
              <input class="input" id="f-pel-hp" name="pelangganHp" type="tel" inputmode="numeric"
                placeholder="08xxxxxxxxxx" value="${esc(customer.hp || '')}" />
            </div>
          </div>

          <div class="field" style="margin-bottom:0">
            <label class="field__label" for="f-resi">${icon('receipt')} Nomor Resi Struk Belanja <span class="field__req">*</span></label>
            <div class="inputwrap">
              <input class="input input--with-icon" id="f-resi" name="resi" placeholder="Ketik atau pindai barcode / QR"
                value="${esc(customer.resi || '')}" />
              <button class="btn btn--icon btn--soft" type="button" id="btnScan" aria-label="Pindai barcode atau QR">
                ${icon('qr')}
              </button>
            </div>
            <div class="field__hint" id="scanHint">
              ${scannerSupported()
                ? 'Tekan tombol pindai untuk membaca barcode/QR pada struk belanja.'
                : 'Pemindai tidak tersedia di peramban ini — silakan ketik nomor resi manual.'}
            </div>
          </div>
        </div>
      </section>

      <section class="section">
        <div class="section__head">
          <div class="section__title">Kantor</div>
          <div class="section__line"></div>
        </div>
        <div class="card card__pad">
          <div class="field">
            <label class="field__label" for="f-kantor-nama">${icon('store')} Nama Kantor</label>
            <input class="input" id="f-kantor-nama" name="kantorNama" placeholder="Contoh: Toko Sejahtera Cabang Utama"
              value="${esc(kantor.nama || settings.kantorNama || '')}" />
          </div>
          <div class="field" style="margin-bottom:0">
            <label class="field__label" for="f-kantor-hp">${icon('phone')} Nomor Kantor (tujuan laporan) <span class="field__req">*</span></label>
            <input class="input" id="f-kantor-hp" name="kantorNomor" type="tel" inputmode="numeric"
              placeholder="08xxxxxxxxxx" value="${esc(kantor.nomor || settings.kantorNomor || '')}" />
            <div class="field__hint">Laporan penyelesaian pengantaran akan dikirim ke nomor ini lewat WhatsApp.</div>
          </div>
        </div>
      </section>

      <div class="banner banner--info mt-12">
        ${icon('info')}
        <div>Isi semua kolom bertanda <b>*</b>. Setelah lengkap, aplikasi berpindah ke halaman informasi untuk memfoto produk dan nota belanja.</div>
      </div>

      <div class="mt-16" style="padding-bottom:6px">
        <button class="btn btn--primary btn--lg btn--block" id="btnNext" type="button">
          ${icon('arrowRight')} Lanjut ke Halaman Informasi
        </button>
      </div>
    `;

    const scanBtn = $('#btnScan', root);
    scanBtn.addEventListener('click', async () => {
      try {
        const res = await scanCode({ title: 'Pindai Resi Belanja' });
        if (!res) return;
        if (res.value) {
          $('#f-resi', root).value = res.value;
          toast(`Kode terbaca (${res.format}).`, 'ok');
        } else {
          $('#f-resi', root).focus();
          toast('Ketik nomor resi secara manual.', 'info');
        }
      } catch (e) {
        toast(e.message, 'err');
      }
    });

    $('#btnNext', root).addEventListener('click', () => submit(root, ctx));

    root.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.target.tagName === 'INPUT') submit(root, ctx);
    });

    ['crewHp', 'pelangganHp', 'kantorNomor'].forEach((n) => {
      const f = root.querySelector(`[name="${n}"]`);
      f.addEventListener('blur', () => {
        if (f.value.trim()) f.value = prettyPhone(f.value);
      });
    });
  },

  async onBack() {
    return true;
  },
};

async function submit(root, ctx) {
  const form = {
    crewNama: root.querySelector('[name="crewNama"]').value.trim(),
    crewHp: root.querySelector('[name="crewHp"]').value.trim(),
    pelangganNama: root.querySelector('[name="pelangganNama"]').value.trim(),
    pelangganHp: root.querySelector('[name="pelangganHp"]').value.trim(),
    resi: root.querySelector('[name="resi"]').value.trim(),
    kantorNama: root.querySelector('[name="kantorNama"]').value.trim(),
    kantorNomor: root.querySelector('[name="kantorNomor"]').value.trim(),
  };

  const errors = {};
  if (form.crewNama.length < 3) errors.crewNama = 'Nama lengkap minimal 3 huruf.';
  if (!isValidPhone(form.crewHp)) errors.crewHp = 'Nomor HP deliman tidak valid (contoh: 08123456789).';
  if (form.pelangganNama.length < 2) errors.pelangganNama = 'Nama pelanggan wajib diisi.';
  if (!isValidPhone(form.pelangganHp)) errors.pelangganHp = 'Nomor HP pelanggan tidak valid.';
  if (form.resi.length < 3) errors.resi = 'Nomor resi minimal 3 karakter.';
  if (!isValidPhone(form.kantorNomor)) errors.kantorNomor = 'Nomor kantor tidak valid.';

  if (!markInvalid(root, errors)) {
    toast('Periksa kembali data yang belum benar.', 'warn');
    return;
  }

  await withBusy('Menyiapkan sesi…', async () => {
    await trip.beginSession(form);
    // Naikkan ke status "siap" agar sesi otomatis dilanjutkan bila aplikasi tertutup.
    await trip.armTrip();
    const settings = (await kv.get('settings', {})) || {};
    await kv.set('settings', {
      ...settings,
      crewNama: form.crewNama,
      crewHp: form.crewHp,
      kantorNama: form.kantorNama,
      kantorNomor: form.kantorNomor,
    });
  });

  toast('Data tersimpan. Lanjut memfoto produk & nota belanja.', 'ok');
  ctx.go('prepare');
}
