// Tab Riwayat — arsip semua transaksi pengantaran.
// Deliman dapat menyaring per periode, mengekspor ke Excel sebagai acuan
// klaim bahan bakar, membuka ulang laporan PDF, atau mengirim ulang ke kantor.

import { icon } from '../icons.js';
import { $, esc, fmtDate, fmtDateLong, fmtDateTime, fmtDistance, fmtDurationShort, fmtTime, download } from '../util.js';
import { actionSheet, modal, sheet, toast, withBusy } from '../ui.js';
import { exportExcel, pdfFileName } from '../report.js';
import { notifyOffice } from '../messaging.js';
import { media, trips } from '../db.js';
import * as trip from '../trip.js';

const RANGES = [
  { key: 'today', label: 'Hari ini' },
  { key: 'week', label: '7 hari' },
  { key: 'month', label: 'Bulan ini' },
  { key: 'all', label: 'Semua' },
];

const SYNC_TAG = {
  synced: { cls: 'badge--ok', icon: 'cloud', label: 'Drive' },
  pending: { cls: 'badge--warn', icon: 'clock', label: 'Antre' },
  uploading: { cls: 'badge--info', icon: 'upload', label: 'Proses' },
  error: { cls: 'badge--danger', icon: 'alert', label: 'Gagal' },
};

let viewItems = [];
let viewRange = 'all';

export default {
  title: 'Riwayat Pengantaran',
  sub: 'Arsip & klaim bahan bakar',
  brand: false,
  tab: true,
  actions: [{ label: 'Ekspor Excel', icon: 'sheet', onClick: () => ekspor(viewItems) }],

  async mount(root, ctx) {
    root.innerHTML = `
      <section class="section" id="totals"></section>

      <section class="section">
        <div class="section__head">
          <div class="section__title">Ekspor Klaim Bahan Bakar</div>
          <div class="section__line"></div>
        </div>
        <div class="card card__pad">
          <div class="chips" id="chips"></div>
          <button class="btn btn--primary btn--block mt-12" id="btnExcel" type="button">
            ${icon('sheet')} Unduh Rekap Excel
          </button>
          <p class="field__hint" style="margin-bottom:0">
            Berisi runutan transaksi sesuai pilihan periode: tanggal, jam berangkat &amp; sampai, durasi,
            jarak tempuh (meter &amp; km), titik awal–akhir, jumlah foto, dan status tanda tangan.
            Sudah termasuk lembar rekap harian.
          </p>
        </div>
      </section>

      <section class="section">
        <div class="section__head">
          <div class="section__title">Daftar Transaksi</div>
          <div class="section__line"></div>
        </div>
        <div id="list"></div>
      </section>

      <div style="height:12px"></div>
    `;

    $('#chips', root).addEventListener('click', (e) => {
      const btn = e.target.closest('[data-range]');
      if (!btn) return;
      viewRange = btn.dataset.range;
      paintChips(root);
      render(root, ctx);
    });

    $('#btnExcel', root).addEventListener('click', () => ekspor(viewItems));

    paintChips(root);
    await render(root, ctx);
  },

  async onBack() {
    return true;
  },
};

/* ---------------- Data & penyaringan ---------------- */

async function semua() {
  const rows = await trips.list({ limit: 1000 });
  return rows.filter((t) => t.state === 'selesai' || t.state === 'ditutup');
}

function batas(range) {
  const d = new Date();
  if (range === 'today') {
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }
  if (range === 'week') {
    d.setDate(d.getDate() - 6);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }
  if (range === 'month') {
    d.setDate(1);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }
  return 0;
}

/* ---------------- Render ---------------- */

function paintChips(root) {
  const box = $('#chips', root);
  if (!box) return;
  box.innerHTML = RANGES.map(
    (r) =>
      `<button class="chip" data-range="${r.key}" type="button" aria-pressed="${viewRange === r.key}">${r.label}</button>`
  ).join('');
}

async function render(root, ctx) {
  const all = await semua();
  const from = batas(viewRange);
  const rows = all.filter((t) => (t.startedAt || t.createdAt || 0) >= from);
  viewItems = rows;

  paintTotals($('#totals', root), rows);

  const list = $('#list', root);
  if (!rows.length) {
    list.innerHTML = `
      <div class="empty">
        <div class="empty__ico">${icon('inbox')}</div>
        <h3>Belum ada transaksi</h3>
        <p>Pengantaran yang sudah selesai dan ditandatangani akan muncul di sini.</p>
      </div>`;
    return;
  }

  const byDay = new Map();
  rows.forEach((t) => {
    const key = fmtDate(t.startedAt || t.createdAt);
    if (!byDay.has(key)) byDay.set(key, []);
    byDay.get(key).push(t);
  });

  list.innerHTML = '';
  for (const [day, items] of byDay) {
    const meter = items.reduce((a, t) => a + (t.summary?.distanceMeters ?? t.distanceMeters ?? 0), 0);
    const group = document.createElement('div');
    group.className = 'daygroup';
    group.innerHTML = `
      <div class="daygroup__t">
        ${icon('calendar')} ${esc(day)} <i></i> ${items.length} pengantaran · ${esc(fmtDistance(meter))}
      </div>
      <div class="cardlist" style="margin-top:0"></div>`;
    const holder = group.querySelector('.cardlist');
    items.forEach((t) => holder.appendChild(card(t, ctx)));
    list.appendChild(group);
  }
}

function paintTotals(box, rows) {
  if (!box) return;
  const meter = rows.reduce((a, t) => a + (t.summary?.distanceMeters ?? t.distanceMeters ?? 0), 0);
  const ms = rows.reduce((a, t) => a + ((t.finishedAt || 0) - (t.startedAt || 0)), 0);
  const hari = new Set(rows.map((t) => fmtDate(t.startedAt || t.createdAt))).size;
  const synced = rows.filter((t) => t.syncState === 'synced').length;

  box.innerHTML = `
    <div class="card card__pad">
      <div class="statgrid">
        <div class="stat">
          <div class="stat__k">${icon('package')} Pengantaran</div>
          <div class="stat__v">${rows.length}</div>
          <div class="stat__h">${hari} hari aktif</div>
        </div>
        <div class="stat">
          <div class="stat__k">${icon('route')} Jarak tempuh</div>
          <div class="stat__v">${esc(fmtDistance(meter))}</div>
          <div class="stat__h">akumulasi rute GPS</div>
        </div>
        <div class="stat">
          <div class="stat__k">${icon('clock')} Total durasi</div>
          <div class="stat__v">${esc(fmtDurationShort(ms))}</div>
          <div class="stat__h">berangkat → selesai</div>
        </div>
        <div class="stat">
          <div class="stat__k">${icon('cloud')} Terarsip</div>
          <div class="stat__v">${synced}/${rows.length}</div>
          <div class="stat__h">tersimpan di Google Drive</div>
        </div>
      </div>
    </div>`;
}

function card(t, ctx) {
  const sum = t.summary || {};
  const tag = SYNC_TAG[t.syncState] || SYNC_TAG.pending;
  const el = document.createElement('div');
  el.className = 'card';
  el.innerHTML = `
    <div class="histcard__top">
      <div class="stack" style="gap:2px;min-width:0">
        <span class="histcard__id">${esc(t.id)}</span>
        <span class="small bold" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
          ${esc(t.customer?.nama || 'Pelanggan')} · ${esc(t.customer?.resi || 'tanpa resi')}
        </span>
      </div>
      <div class="grow"></div>
      <span class="badge ${tag.cls}">${icon(tag.icon)} ${tag.label}</span>
    </div>
    <div class="histcard__meta">
      <span>${icon('clock')} ${esc(fmtTime(t.startedAt))}–${esc(fmtTime(t.finishedAt))}</span>
      <span>${icon('route')} ${esc(sum.distanceText || fmtDistance(t.distanceMeters || 0))}</span>
      <span>${icon('gauge')} ${esc(sum.durationText || '—')}</span>
      <span>${icon('camera')} ${esc(String(t.photoCount ?? 0))} foto</span>
      <span>${icon('pen')} ${esc(t.handover?.signedBy || '—')}</span>
    </div>
    <div class="histcard__foot">
      <button class="btn btn--sm btn--soft" data-act="detail" type="button">${icon('eye')} Rincian</button>
      <button class="btn btn--sm btn--ghost" data-act="pdf" type="button">${icon('file')} PDF</button>
      <button class="btn btn--sm btn--ghost" data-act="more" type="button">${icon('layers')} Lainnya</button>
    </div>`;

  el.addEventListener('click', (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (!act) return;
    if (act === 'detail') detail(t);
    else if (act === 'pdf') bukaPdf(t);
    else if (act === 'more') lainnya(t, ctx);
  });
  return el;
}

/* ---------------- Aksi per transaksi ---------------- */

async function detail(t) {
  const sum = t.summary || {};
  const rows = await media.byTrip(t.id);
  const berkas = rows.filter((r) => r.kind !== 'pdf' && r.kind !== 'ttd').length;
  const links = t.driveLinksFlat || [];

  const handle = sheet({
    title: t.customer?.nama || 'Pelanggan',
    subtitle: `${t.id} · ${fmtDateLong(t.startedAt || t.createdAt)}`,
    body: `
      <div class="chips">
        ${links.length
          ? links.slice(0, 6).map((u, i) => `<a class="chip" href="${esc(u)}" target="_blank" rel="noopener">${icon('cloud')} Berkas ${i + 1}</a>`).join('')
          : `<span class="chip">${icon('cloudOff')} Belum terarsip ke Drive</span>`}
      </div>
      <div class="kv mt-12">
        <div class="kv__k">Deliman</div><div class="kv__v">${esc(t.crew?.nama || '-')}</div>
        <div class="kv__k">No. HP pelanggan</div><div class="kv__v tnum">${esc(t.customer?.hp || '-')}</div>
        <div class="kv__k">No. resi</div><div class="kv__v tnum">${esc(t.customer?.resi || '-')}</div>
        <div class="kv__k">Kantor</div><div class="kv__v">${esc(t.kantor?.nama || t.kantor?.nomor || '-')}</div>
        <div class="kv__k">Berangkat</div><div class="kv__v tnum">${esc(fmtDateTime(t.startedAt))}</div>
        <div class="kv__k">Tiba</div><div class="kv__v tnum">${esc(fmtDateTime(t.arrivedAt))}</div>
        <div class="kv__k">Selesai</div><div class="kv__v tnum">${esc(fmtDateTime(t.finishedAt))}</div>
        <div class="kv__k">Rentang waktu</div><div class="kv__v">${esc(sum.durationText || '-')}</div>
        <div class="kv__k">Jarak tempuh</div><div class="kv__v"><b>${esc(sum.distanceText || fmtDistance(t.distanceMeters || 0))}</b></div>
        <div class="kv__k">Jarak lurus</div><div class="kv__v">${esc(sum.straightText || '-')}</div>
        <div class="kv__k">Rata-rata</div><div class="kv__v">${sum.avgSpeedKmh ? `${esc(sum.avgSpeedKmh.toFixed(1))} km/jam` : '-'}</div>
        <div class="kv__k">Titik awal</div><div class="kv__v mono tiny">${esc(t.startPoint ? `${t.startPoint.lat.toFixed(6)}, ${t.startPoint.lng.toFixed(6)}` : '-')}</div>
        <div class="kv__k">Titik akhir</div><div class="kv__v mono tiny">${esc(t.endPoint ? `${t.endPoint.lat.toFixed(6)}, ${t.endPoint.lng.toFixed(6)}` : '-')}</div>
        <div class="kv__k">Dokumentasi</div><div class="kv__v">${berkas} berkas</div>
        <div class="kv__k">Ditandatangani</div><div class="kv__v">${esc(t.handover?.signedBy || '-')} · ${esc(fmtTime(t.handover?.signedAt))}</div>
        ${t.notes ? `<div class="kv__k">Catatan</div><div class="kv__v">${esc(t.notes)}</div>` : ''}
      </div>`,
    footer: `<button class="btn btn--primary btn--block" data-role="pdf" type="button">${icon('file')} Buka Laporan PDF</button>`,
  });

  $('[data-role="pdf"]', handle.root)?.addEventListener('click', () => {
    handle.close(null);
    bukaPdf(t);
  });
}

async function bukaPdf(t) {
  try {
    const blob = await withBusy('Menyiapkan PDF…', () => trip.getPdf(t));
    if (!blob) throw new Error('Berkas PDF tidak ditemukan.');
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank', 'noopener');
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch (e) {
    toast(e.message, 'err', 5000);
  }
}

async function lainnya(t, ctx) {
  const act = await actionSheet({
    title: t.id,
    subtitle: t.customer?.nama || 'Pelanggan',
    actions: [
      { value: 'simpan', label: 'Simpan PDF ke HP', icon: 'download' },
      { value: 'share', label: 'Bagikan PDF', icon: 'share' },
      { value: 'wa', label: 'Kirim ulang laporan ke kantor', icon: 'whatsapp' },
      { value: 'hapus', label: 'Hapus transaksi ini', icon: 'trash', tone: 'danger' },
    ],
  });
  if (!act) return;

  if (act === 'hapus') {
    const ok = await modal({
      title: 'Hapus transaksi ini?',
      text: `<b>${esc(t.id)}</b> beserta foto dan laporan PDF akan dihapus dari HP. Berkas yang sudah terunggah ke Google Drive tidak terpengaruh.`,
      iconName: 'trash',
      tone: 'danger',
      okLabel: 'Hapus',
      okTone: 'danger',
    });
    if (!ok) return;
    await trip.removeTrip(t.id);
    toast('Transaksi dihapus.', 'ok');
    ctx.reload();
    return;
  }

  let blob = null;
  try {
    blob = await withBusy('Menyiapkan PDF…', () => trip.getPdf(t));
  } catch (e) {
    toast(e.message, 'err', 5000);
    return;
  }
  if (!blob) return toast('Berkas PDF tidak tersedia.', 'warn');

  if (act === 'simpan') {
    download(blob, pdfFileName(t));
    toast('PDF disimpan ke folder unduhan.', 'ok');
    return;
  }

  if (act === 'share') {
    const file = new File([blob], pdfFileName(t), { type: 'application/pdf' });
    if (navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ title: `Laporan ${t.id}`, files: [file] });
      } catch { /* dibatalkan pengguna */ }
    } else {
      download(blob, pdfFileName(t));
      toast('Peramban tidak mendukung berbagi berkas — PDF diunduh.', 'info');
    }
    return;
  }

  if (act === 'wa') {
    const res = await notifyOffice(t, { pdfBlob: blob, driveLinks: t.driveLinksFlat || [] });
    if (res.via === 'share-files') toast('Laporan terkirim ke WhatsApp kantor.', 'ok');
    else if (res.via === 'wa-text') toast('WhatsApp terbuka dengan teks laporan; PDF tersimpan di HP.', 'warn', 5000);
    else if (res.via === 'wa-prompt') toast('Pesan laporan siap dikirim lewat WhatsApp.', 'info', 5000);
  }
}

/* ---------------- Ekspor Excel ---------------- */

async function ekspor(rows) {
  const data = rows?.length ? rows : await semua();
  if (!data.length) {
    toast('Belum ada transaksi untuk diekspor.', 'warn');
    return;
  }
  try {
    await withBusy('Menyusun berkas Excel…', () => exportExcel(data, 'rekap-klaim'));
    toast(`${data.length} transaksi diekspor ke Excel.`, 'ok');
  } catch (e) {
    toast(`Ekspor gagal: ${e.message}`, 'err', 5000);
  }
}
