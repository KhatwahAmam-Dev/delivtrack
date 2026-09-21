// Layar 4 — Serah terima.
// Deliman memfoto produk bersama konsumen, lalu konsumen membubuhkan tanda
// tangan digital. Setelah itu sesi diselesaikan dan laporan PDF dibuat.

import { icon } from '../icons.js';
import { $, esc, fmtTime } from '../util.js';
import { SignaturePad } from '../signature.js';
import { checklist, photoCard } from '../photobox.js';
import { busyText, modal, toast, withBusy } from '../ui.js';
import * as trip from '../trip.js';

export default {
  title: 'Serah Terima',
  sub: 'Foto bersama & tanda tangan',
  brand: false,
  tab: true,

  async mount(root, ctx) {
    const t = trip.getTrip();
    if (!t) {
      root.innerHTML = empty('Sesi pengantaran tidak ditemukan.', 'Mulai pengantaran baru dari halaman awal.');
      return;
    }
    if (t.state === 'siap' || t.state === 'perjalanan') {
      root.innerHTML = empty('Belum tiba di lokasi.', 'Tekan "Saya Tiba di Lokasi" pada layar perjalanan lebih dulu.');
      return;
    }

    const sum = t.summary || {};

    root.innerHTML = `
      <section class="hero">
        <div class="hero__label">Tiba di Lokasi</div>
        <div class="hero__value tnum">${esc(fmtTime(t.arrivedAt))}</div>
        <div class="hero__meta">
          <span class="hero__pill">${icon('route')} ${esc(sum.distanceText || '0 m')}</span>
          <span class="hero__pill">${icon('clock')} ${esc(sum.durationText || '—')}</span>
          <span class="hero__pill">${icon('store')} ${esc(t.customer?.nama || 'Pelanggan')}</span>
        </div>
      </section>

      <section class="section">
        <div class="section__head">
          <div class="section__title">Kelengkapan Serah Terima</div>
          <div class="section__line"></div>
        </div>
        <div id="checklist"></div>
      </section>

      <section class="section">
        <div class="section__head">
          <div class="section__title">Dokumentasi</div>
          <div class="section__line"></div>
        </div>
        <div id="fotoSlot"></div>
      </section>

      <section class="section">
        <div class="section__head">
          <div class="section__title">Tanda Tangan Konsumen</div>
          <div class="section__line"></div>
        </div>
        <div id="sigSlot"></div>
      </section>

      <section class="section">
        <div class="section__head">
          <div class="section__title">Keterangan</div>
          <div class="section__line"></div>
        </div>
        <div class="card card__pad">
          <div class="field">
            <label class="field__label" for="f-penerima">${icon('user')} Nama Penerima Paket</label>
            <input class="input" id="f-penerima" placeholder="Nama orang yang menerima"
              value="${esc(t.handover?.signedBy || t.customer?.nama || '')}" />
          </div>
          <div class="field" style="margin-bottom:0">
            <label class="field__label" for="f-catatan">${icon('edit')} Catatan (opsional)</label>
            <textarea class="textarea" id="f-catatan" placeholder="Contoh: paket diterima utuh, titip ke satpam.">${esc(t.handover?.catatan || '')}</textarea>
          </div>
        </div>
      </section>

      <div class="banner banner--info mt-12">
        ${icon('info')}
        <div>Pastikan penerima menandatangani <b>langsung di layar HP ini</b>. Bila salah, tekan tombol <b>Hapus</b> pada kartu tanda tangan lalu minta tanda tangan ulang.</div>
      </div>

      <div class="actionbar">
        <button class="btn btn--primary btn--lg" id="btnFinish" type="button" disabled>
          ${icon('checkCircle')} Selesaikan Pengantaran
        </button>
      </div>
      <div style="height:78px"></div>
    `;

    /* ---- Foto serah terima ---- */
    const foto = photoCard({
      kind: trip.KIND.SERAH_TERIMA,
      title: 'Foto Serah Terima',
      hint: 'Foto produk bersama konsumen penerima',
      iconName: 'camera',
      note: 'Arahkan kamera ke arah konsumen sambil memegang paket belanja, lalu ambil gambar.',
      onChange: syncGate,
    });
    $('#fotoSlot', root).appendChild(foto.el);
    await foto.refresh();

    /* ---- Tanda tangan ---- */
    const sigSlot = $('#sigSlot', root);
    const block = document.createElement('div');
    block.innerHTML = `
      <div class="card">
        <div class="card__head">
          <h3>Tanda tangan penerima</h3>
          <div class="grow"></div>
          <button class="btn btn--sm btn--ghost" data-role="clear" type="button">Hapus</button>
        </div>
        <div class="card__pad">
          <div class="sigpad">
            <canvas id="sigCanvas"></canvas>
            <div class="sigpad__ghost" data-role="ghost">Tanda tangan di sini</div>
            <div class="sigpad__hint"></div>
          </div>
          <p class="field__hint">Minta penerima menandatangani langsung di layar HP.</p>
        </div>
      </div>`;
    sigSlot.appendChild(block);

    const canvas = $('#sigCanvas', block);
    const ghost = $('[data-role="ghost"]', block);
    const pad = new SignaturePad(canvas);

    const onInk = () => {
      ghost.classList.toggle('hidden', pad.dirty);
      syncGate();
    };
    canvas.addEventListener('pointerup', onInk);
    canvas.addEventListener('pointermove', onInk);
    canvas.addEventListener('pointerleave', onInk);

    $('[data-role="clear"]', block).addEventListener('click', () => {
      pad.clear();
      ghost.classList.remove('hidden');
      syncGate();
      toast('Tanda tangan dibersihkan.', 'info', 2200);
    });

    setTimeout(() => pad.resize(), 120);

    /* ---- Gerbang kelengkapan ---- */
    async function syncGate() {
      const kurang = trip.missingPhotos('tiba', await trip.mediaRows(trip.KIND.SERAH_TERIMA));
      const signed = pad.dirty;
      const items = [
        { label: 'Foto serah terima', ok: kurang.length === 0 },
        { label: 'Tanda tangan konsumen', ok: signed },
      ];
      const box = $('#checklist', root);
      box.innerHTML = '';
      box.appendChild(checklist(items));

      const btn = $('#btnFinish', root);
      btn.disabled = !(items[0].ok && items[1].ok);
      btn.innerHTML = btn.disabled
        ? `${icon('clock')} ${!items[0].ok ? 'Foto serah terima belum ada' : 'Menunggu tanda tangan'}`
        : `${icon('checkCircle')} Selesaikan Pengantaran`;

    }
    await syncGate();

    $('#btnFinish', root).addEventListener('click', () => selesaikan(root, ctx, pad));

    this._cleanup = () => {
      foto.destroy();
      pad.destroy();
    };
  },

  unmount() {
    this._cleanup?.();
    this._cleanup = null;
  },

  async onBack() {
    return false;
  },
};

async function selesaikan(root, ctx, pad) {
  const t = trip.getTrip();
  if (!t) return;

  const signedBy = $('#f-penerima', root).value.trim();
  const catatan = $('#f-catatan', root).value.trim();

  if (!pad.dirty) {
    toast('Tanda tangan konsumen belum diisi.', 'warn');
    return;
  }
  if (!signedBy) {
    toast('Nama penerima paket wajib diisi.', 'warn');
    $('#f-penerima', root).focus();
    return;
  }

  const ok = await modal({
    title: 'Selesaikan pengantaran ini?',
    text: `Tanda tangan <b>${esc(signedBy)}</b> akan disimpan, laporan PDF dibuat, dan sesi pengantaran ditutup.`,
    iconName: 'checkCircle',
    tone: 'ok',
    okLabel: 'Ya, Selesaikan',
    okTone: 'success',
  });
  if (!ok) return;

  const signatureBlob = await pad.toBlob();

  let result = null;
  await withBusy('Menyusun laporan…', async () => {
    result = await trip.completeTrip({
      signatureBlob,
      signedBy,
      catatan,
      onProgress: (stage) => busyText(stage),
    });
  }).catch((e) => {
    console.error(e);
    toast(`Gagal menyelesaikan: ${e.message}`, 'err', 6000);
  });

  if (!result) return;

  toast('Pengantaran selesai. Laporan PDF tersimpan & masuk antrean unggah.', 'ok', 5200);
  ctx.go('done');
}

function empty(title, sub) {
  return `
    <div class="empty">
      <div class="empty__ico">${icon('alert')}</div>
      <h3>${title}</h3>
      <p>${sub}</p>
    </div>`;
}
