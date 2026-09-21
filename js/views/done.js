// Layar 5 — Pengantaran selesai.
// Menampilkan ringkasan lengkap, mengirim laporan ke kantor lewat WhatsApp,
// menyimpan/mengunggah berkas, lalu menutup sesi agar siap pengantaran berikutnya.

import { icon } from '../icons.js';
import { $, download, esc, fmtDateLong, fmtDistance, fmtDuration, fmtTime } from '../util.js';
import { gmapsLink } from '../geo.js';
import { modal, toast, withBusy } from '../ui.js';
import { pdfFileName } from '../report.js';
import { notifyOffice } from '../messaging.js';
import * as trip from '../trip.js';
import * as sync from '../sync.js';

const SYNC_BADGE = {
  pending: { cls: 'badge--warn', label: 'Menunggu diunggah', icon: 'clock' },
  uploading: { cls: 'badge--info', label: 'Sedang diunggah', icon: 'upload' },
  synced: { cls: 'badge--ok', label: 'Tersimpan di Google Drive', icon: 'cloud' },
  error: { cls: 'badge--danger', label: 'Unggahan gagal — akan dicoba lagi', icon: 'alert' },
};

export default {
  title: 'Pengantaran Selesai',
  sub: 'Laporan & arsip',
  brand: true,
  tab: false,

  async mount(root, ctx) {
    const t = trip.getTrip();
    if (!t || t.state !== 'selesai') {
      root.innerHTML = `
        <div class="empty">
          <div class="empty__ico">${icon('info')}</div>
          <h3>Belum ada pengantaran yang selesai</h3>
          <p>Selesaikan serah terima terlebih dahulu, atau buka tab Riwayat untuk melihat arsip sebelumnya.</p>
        </div>`;
      return;
    }

    const sum = t.summary || {};

    root.innerHTML = `
      <section class="hero">
        <div class="hero__label">Pengantaran Selesai</div>
        <div class="hero__value">${esc(t.customer?.nama || 'Pelanggan')}</div>
        <div class="hero__meta">
          <span class="hero__pill">${icon('route')} ${esc(sum.distanceText || '0 m')}</span>
          <span class="hero__pill">${icon('clock')} ${esc(sum.durationText || '—')}</span>
          <span class="hero__pill">${icon('checkCircle')} ${esc(fmtTime(t.finishedAt))}</span>
        </div>
      </section>

      <div id="syncCard"></div>

      <section class="section">
        <div class="section__head">
          <div class="section__title">Ringkasan</div>
          <div class="section__line"></div>
        </div>
        <div class="card card__pad">
          <div class="kv">
            <div class="kv__k">ID transaksi</div><div class="kv__v mono">${esc(t.id)}</div>
            <div class="kv__k">Tanggal</div><div class="kv__v">${esc(fmtDateLong(t.startedAt || t.createdAt))}</div>
            <div class="kv__k">Deliman</div><div class="kv__v">${esc(t.crew?.nama || '-')}</div>
            <div class="kv__k">No. HP deliman</div><div class="kv__v tnum">${esc(t.crew?.hp || '-')}</div>
            <div class="kv__k">Pelanggan</div><div class="kv__v">${esc(t.customer?.nama || '-')}</div>
            <div class="kv__k">No. HP pelanggan</div><div class="kv__v tnum">${esc(t.customer?.hp || '-')}</div>
            <div class="kv__k">No. resi</div><div class="kv__v tnum">${esc(t.customer?.resi || '-')}</div>
            <div class="kv__k">Kantor</div><div class="kv__v">${esc(t.kantor?.nama || t.kantor?.nomor || '-')}</div>
          </div>
        </div>
      </section>

      <section class="section">
        <div class="section__head">
          <div class="section__title">Waktu & Jarak Tempuh</div>
          <div class="section__line"></div>
        </div>
        <div class="card card__pad">
          <div class="kv">
            <div class="kv__k">Berangkat</div><div class="kv__v tnum">${esc(fmtTime(t.startedAt))}</div>
            <div class="kv__k">Tiba di tujuan</div><div class="kv__v tnum">${esc(fmtTime(t.arrivedAt))}</div>
            <div class="kv__k">Selesai (ditandatangani)</div><div class="kv__v tnum">${esc(fmtTime(t.finishedAt))}</div>
            <div class="kv__k">Rentang waktu</div><div class="kv__v">${esc(sum.durationText || fmtDuration((t.finishedAt || 0) - (t.startedAt || 0)))}</div>
            <div class="kv__k">Jarak tempuh (GPS)</div><div class="kv__v"><b>${esc(sum.distanceText || fmtDistance(t.distanceMeters || 0))}</b></div>
            <div class="kv__k">Jarak lurus</div><div class="kv__v">${esc(sum.straightText || fmtDistance(sum.straightMeters || 0))}</div>
            <div class="kv__k">Rata-rata</div><div class="kv__v">${sum.avgSpeedKmh ? `${esc(sum.avgSpeedKmh.toFixed(1))} km/jam` : '—'}</div>
            <div class="kv__k">Titik terpantau</div><div class="kv__v">${esc(String(sum.pointCount ?? 0))} titik</div>
          </div>
        </div>
      </section>

      <section class="section">
        <div class="section__head">
          <div class="section__title">Titik Awal & Akhir</div>
          <div class="section__line"></div>
        </div>
        <div class="card card__pad">
          ${pointBlock('Titik awal (berangkat)', t.startPoint)}
          <div style="height:10px"></div>
          ${pointBlock('Titik akhir (sampai)', t.endPoint)}
        </div>
      </section>

      <section class="section">
        <div class="section__head">
          <div class="section__title">Serah Terima</div>
          <div class="section__line"></div>
        </div>
        <div class="card card__pad">
          <div class="kv">
            <div class="kv__k">Diterima oleh</div><div class="kv__v">${esc(t.handover?.signedBy || '-')}</div>
            <div class="kv__k">Ditandatangani</div><div class="kv__v tnum">${esc(t.handover?.signedAt ? fmtTime(t.handover.signedAt) : '—')}</div>
            <div class="kv__k">Jumlah dokumentasi</div><div class="kv__v">${esc(String(t.photoCount ?? 0))} berkas</div>
            ${t.notes ? `<div class="kv__k">Catatan</div><div class="kv__v">${esc(t.notes)}</div>` : ''}
          </div>
        </div>
      </section>

      <section class="section">
        <div class="section__head">
          <div class="section__title">Kirim & Arsipkan</div>
          <div class="section__line"></div>
        </div>
        <div class="card card__pad">
          <button class="btn btn--primary btn--block btn--lg" id="btnWa" type="button">
            ${icon('whatsapp')} Kirim Laporan ke Kantor
          </button>
          <div class="btnrow mt-8">
            <button class="btn btn--soft" id="btnPdf" type="button">${icon('file')} Simpan PDF</button>
            <button class="btn btn--soft" id="btnSharePdf" type="button">${icon('share')} Bagikan PDF</button>
          </div>
          <div class="btnrow mt-8">
            <button class="btn btn--ghost" id="btnDrive" type="button">${icon('drive')} Unggah ke Drive</button>
            <button class="btn btn--ghost" id="btnCopy" type="button">${icon('copy')} Salin teks laporan</button>
          </div>
          <p class="field__hint" style="margin-bottom:0">
            Laporan WhatsApp berisi ringkasan lengkap: nama deliman, nama pelanggan, nomor HP, jarak tempuh, serta titik awal dan titik akhir.
          </p>
        </div>
      </section>

      <div class="actionbar">
        <button class="btn btn--accent btn--lg" id="btnClose" type="button">
          ${icon('power')} Tutup Sesi & Siap Berikutnya
        </button>
      </div>
      <div style="height:78px"></div>
    `;

    const paintSync = () => paintSyncCard($('#syncCard', root), trip.getTrip(), ctx);
    await paintSync();

    const off = sync.syncEvents.on((evt) => {
      if (['start', 'end', 'job-done', 'job-error', 'trip-synced', 'queued'].includes(evt.type)) {
        paintSync().catch(() => {});
      }
    });
    this._off = off;

    $('#btnWa', root).addEventListener('click', () => kirimKantor(root, ctx));
    $('#btnPdf', root).addEventListener('click', () => simpanPdf(false));
    $('#btnSharePdf', root).addEventListener('click', () => simpanPdf(true));
    $('#btnDrive', root).addEventListener('click', () => unggahSekarang());
    $('#btnCopy', root).addEventListener('click', () => salinTeks());
    $('#btnClose', root).addEventListener('click', () => tutupSesi(root, ctx));
  },

  unmount() {
    this._off?.();
    this._off = null;
  },

  async onBack() {
    return true;
  },
};

/* ---------------- Kartu status unggah ---------------- */

async function paintSyncCard(box, t, ctx) {
  if (!box || !t) return;
  const cfg = SYNC_BADGE[t.syncState] || SYNC_BADGE.pending;
  const links = t.driveLinksFlat || [];
  const pend = await sync.pendingCount();

  box.innerHTML = `
    <section class="section">
      <div class="card card__pad">
        <div style="display:flex;align-items:center;gap:10px">
          <div class="stack" style="gap:6px;min-width:0">
            <span class="badge ${cfg.cls}">${icon(cfg.icon)} ${cfg.label}</span>
            <span class="tiny muted">
              ${t.syncedAt
                ? `Terakhir diunggah ${esc(new Date(t.syncedAt).toLocaleString('id-ID'))}`
                : `Laporan PDF & foto disimpan di HP${pend ? ` · ${pend} transaksi dalam antrean` : ''}`}
            </span>
          </div>
          <div class="grow"></div>
          <button class="btn btn--sm btn--soft" id="btnRetry" type="button">${icon('refresh')} Coba lagi</button>
        </div>
        ${t.syncError ? `<div class="field__err" style="margin-top:8px">${icon('alert')} ${esc(t.syncError)}</div>` : ''}
        ${links.length
          ? `<div class="mt-12" style="display:flex;flex-wrap:wrap;gap:6px">
              ${links.slice(0, 4).map((u, i) => `<a class="chip" href="${esc(u)}" target="_blank" rel="noopener">${icon('cloud')} Berkas ${i + 1}</a>`).join('')}
              ${links.length > 4 ? `<span class="chip">+${links.length - 4} lagi</span>` : ''}
            </div>`
          : ''}
      </div>
    </section>`;

  $('#btnRetry', box)?.addEventListener('click', async () => {
    const res = await withBusy('Mengunggah ke Google Drive…', () => sync.retryAllNow()).catch((e) => {
      toast(e.message, 'err', 5000);
      return null;
    });
    if (res && !res.skipped) await paintSyncCard(box, trip.getTrip(), ctx);
  });
}

/* ---------------- Aksi berkas ---------------- */

async function simpanPdf(bagikan) {
  const t = trip.getTrip();
  if (!t) return;
  try {
    const blob = await withBusy('Menyiapkan PDF…', () => trip.getPdf(t));
    if (!blob) throw new Error('Berkas PDF tidak tersedia.');
    const name = pdfFileName(t);

    if (bagikan && navigator.canShare && navigator.share) {
      const file = new File([blob], name, { type: 'application/pdf' });
      if (navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({ title: `Laporan ${t.id}`, files: [file] });
          return;
        } catch (e) {
          if (e?.name === 'AbortError') return;
        }
      }
    }

    download(blob, name);
    toast('Laporan PDF disimpan ke folder unduhan.', 'ok');
  } catch (e) {
    toast(e.message, 'err', 5000);
  }
}

async function unggahSekarang() {
  const res = await withBusy('Mengunggah ke Google Drive…', () => sync.retryAllNow()).catch((e) => {
    toast(e.message, 'err', 5000);
    return null;
  });
  if (res) await paintSyncCard($('#syncCard'), trip.getTrip(), null);
}

async function salinTeks() {
  const t = trip.getTrip();
  if (!t) return;
  const berkas = (t.driveLinksFlat || []).length
    ? t.driveLinksFlat.join('\n')
    : 'Laporan PDF & foto tersimpan di HP deliman';

  const { officeReportText } = await import('../messaging.js');
  const { copyText } = await import('../util.js');
  const text = officeReportText(t, { berkas });
  const ok = await copyText(text);
  toast(ok ? 'Teks laporan disalin. Tempel di WhatsApp kantor.' : 'Tidak bisa menyalin otomatis.', ok ? 'ok' : 'warn');
}

/* ---------------- Kirim ke kantor ---------------- */

async function kirimKantor(root, ctx) {
  const t = trip.getTrip();
  if (!t) return;

  let pdfBlob = null;
  let photoBlobs = [];
  try {
    await withBusy('Menyiapkan laporan…', async () => {
      pdfBlob = await trip.getPdf(t);
      const rows = await trip.refreshMedia();
      photoBlobs = rows
        .filter((r) => ['produk', 'nota', 'serah-terima'].includes(r.kind))
        .slice(0, 4)
        .map((r) => r.blob);
    });
  } catch (e) {
    toast(`Laporan gagal disiapkan: ${e.message}`, 'err', 5000);
    return;
  }

  const res = await notifyOffice(t, {
    pdfBlob,
    photoBlobs,
    driveLinks: t.driveLinksFlat || [],
  });

  if (res.via === 'cancelled') return;

  if (res.via === 'share-files') {
    toast('Laporan terkirim ke WhatsApp kantor lengkap dengan lampiran.', 'ok', 5000);
  } else if (res.via === 'wa-prompt') {
    toast('Pesan laporan siap. Buka WhatsApp dari tombol Kirim ke Kantor kapan pun.', 'info', 6000);
  } else {
    toast('WhatsApp terbuka dengan teks laporan. Lampiran diunduh manual dari tombol Simpan PDF.', 'warn', 6000);
  }
}

/* ---------------- Tutup sesi ---------------- */

async function tutupSesi(root, ctx) {
  const t = trip.getTrip();
  if (!t) return;

  const belum = t.syncState !== 'synced';
  const ok = await modal({
    title: 'Tutup sesi pengantaran?',
    text: belum
      ? 'Data masih tersimpan di HP dan akan diunggah otomatis saat internet kembali. Setelah ditutup, aplikasi kembali ke halaman awal untuk pengantaran berikutnya.'
      : 'Semua berkas sudah tersimpan di Google Drive. Aplikasi akan kembali ke halaman awal untuk pengantaran berikutnya.',
    iconName: 'checkCircle',
    tone: belum ? 'warn' : 'ok',
    okLabel: 'Ya, Tutup Sesi',
    okTone: belum ? 'primary' : 'success',
  });
  if (!ok) return;

  await withBusy('Menutup sesi…', () => trip.closeTrip({ autoUpload: true }))
    .then(() => {
      toast('Sesi ditutup. Siap untuk pengantaran berikutnya.', 'ok');
      ctx.go('home');
    })
    .catch((e) => toast(e.message, 'err', 5000));
}

/* ---------------- Potongan tampilan ---------------- */

function pointBlock(label, pt) {
  if (!pt) {
    return `<div class="tiny muted">${icon('alert')} ${esc(label)} belum terekam.</div>`;
  }
  return `
    <div style="display:flex;align-items:flex-start;gap:10px">
      <div class="stack" style="gap:2px;min-width:0">
        <span class="tiny muted">${esc(label)}</span>
        <span class="mono small">${esc(`${pt.lat.toFixed(6)}, ${pt.lng.toFixed(6)}`)}</span>
        <span class="tiny muted">akurasi ±${esc(String(Math.round(pt.accuracy || 0)))} m${pt.at ? ` · ${esc(fmtTime(pt.at))}` : ''}</span>
      </div>
      <div class="grow"></div>
      <a class="btn btn--sm btn--soft" href="${esc(gmapsLink(pt))}" target="_blank" rel="noopener">
        ${icon('pin')} Buka
      </a>
    </div>`;
}
