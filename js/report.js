import { APP, MIME_XLSX } from './config.js';
import { blobToDataURL, download, fmtDate, fmtDateTime, fmtDistance, fmtDuration, fmtTime, fmtCoord, safeName } from './util.js';
import { gmapsLink } from './geo.js';
import { loadVendor } from './vendor.js';

/* ============================ PDF ============================ */

const NAVY = [14, 23, 41];
const GREY = [110, 122, 143];
const BRAND = [79, 70, 229];
const LINE = [223, 228, 240];

async function ensureJsPDF() {
  await loadVendor('jspdf');
  const ctor = window.jspdf?.jsPDF || window.jsPDF;
  if (!ctor) throw new Error('Pustaka PDF belum termuat.');
  return ctor;
}

async function imageInfo(blob) {
  const dataUrl = await blobToDataURL(blob);
  const dim = await new Promise((res) => {
    const i = new Image();
    i.onload = () => res({ w: i.naturalWidth, h: i.naturalHeight });
    i.onerror = () => res({ w: 4, h: 3 });
    i.src = dataUrl;
  });
  return { dataUrl, ...dim, mime: blob.type || 'image/jpeg' };
}

class Doc {
  constructor(doc) {
    this.d = doc;
    this.w = doc.internal.pageSize.getWidth();
    this.h = doc.internal.pageSize.getHeight();
    this.m = 14;
    this.y = this.m;
  }
  get innerW() {
    return this.w - this.m * 2;
  }
  need(space) {
    if (this.y + space > this.h - this.m) {
      this.d.addPage();
      this.y = this.m;
      return true;
    }
    return false;
  }
  text(str, { size = 10, style = 'normal', color = NAVY, x = this.m, align = 'left', lead = 1.35, maxW = null } = {}) {
    this.d.setFont('helvetica', style);
    this.d.setFontSize(size);
    this.d.setTextColor(...color);
    const width = maxW ?? this.innerW;
    const lines = this.d.splitTextToSize(String(str ?? ''), width);
    for (const ln of lines) {
      this.need(size * 0.42);
      this.d.text(ln, x, this.y);
      this.y += size * 0.42 * lead;
    }
    return this;
  }
  gap(v = 4) {
    this.y += v;
    return this;
  }
  rule(color = LINE, thickness = 0.25) {
    this.need(4);
    this.d.setDrawColor(...color);
    this.d.setLineWidth(thickness);
    this.d.line(this.m, this.y, this.w - this.m, this.y);
    this.y += 3.5;
    return this;
  }
  sectionTitle(label) {
    this.gap(3);
    this.need(12);
    this.d.setFillColor(...BRAND);
    this.d.roundedRect(this.m, this.y - 3, 2.4, 6.4, 1.2, 1.2, 'F');
    this.text(label.toUpperCase(), { size: 9.8, style: 'bold', color: NAVY, x: this.m + 6 });
    this.gap(1.5);
  }
}

/**
 * Susun laporan pengantaran lengkap dalam format PDF.
 * @returns {Promise<Blob>}
 */
export async function buildTripPdf(trip, { photos = [], signature = null, driveLinks = [] } = {}) {
  const JsPDF = await ensureJsPDF();
  const d = new JsPDF({ unit: 'mm', format: 'a4', compress: true, putOnlyUsedFonts: true });
  d.setProperties({
    title: `Laporan Pengantaran ${trip.id}`,
    subject: `Pengantaran oleh ${trip.crew?.nama || '-'}`,
    author: APP.name,
    creator: APP.name,
  });

  const p = new Doc(d);

  /* --- Kop --- */
  d.setFillColor(79, 70, 229);
  d.roundedRect(p.m, p.y, 11, 11, 2.6, 2.6, 'F');
  d.setTextColor(255, 255, 255);
  d.setFont('helvetica', 'bold');
  d.setFontSize(11);
  d.text('DT', p.m + 2.35, p.y + 7.3);

  d.setFont('helvetica', 'bold');
  d.setFontSize(14);
  d.setTextColor(...NAVY);
  d.text(APP.name, p.m + 15, p.y + 5.1);

  d.setFont('helvetica', 'normal');
  d.setFontSize(8.4);
  d.setTextColor(...GREY);
  d.text(`${APP.tagline}  •  Laporan resmi pengantaran`, p.m + 15, p.y + 9.4);

  d.setFont('helvetica', 'bold');
  d.setFontSize(8.6);
  d.setTextColor(...BRAND);
  d.text(`ID: ${trip.id}`, p.w - p.m, p.y + 5.1, { align: 'right' });
  d.setFont('helvetica', 'normal');
  d.setTextColor(...GREY);
  d.text(fmtDate(trip.startedAt || trip.createdAt), p.w - p.m, p.y + 9.4, { align: 'right' });

  p.y += 15;
  p.rule(BRAND, 0.6);
  p.gap(1);

  /* --- Ringkasan --- */
  p.sectionTitle('Ringkasan Pengantaran');
  const summaryRows = [
    ['Pelanggan', trip.customer?.nama || '-'],
    ['No. HP Pelanggan', trip.customer?.hp || '-'],
    ['No. Resi', trip.customer?.resi || '-'],
    ['Deliman', trip.crew?.nama || '-'],
    ['No. HP Deliman', trip.crew?.hp || '-'],
    ['Kantor Pelapor', trip.kantor?.nama || trip.kantor?.nomor || '-'],
    ['Status', (trip.state || '-').toUpperCase()],
  ];
  for (const [k, v] of summaryRows) {
    p.need(6);
    d.setFont('helvetica', 'normal');
    d.setFontSize(9.6);
    d.setTextColor(...GREY);
    d.text(k, p.m, p.y);
    d.setFont('helvetica', 'bold');
    d.setTextColor(...NAVY);
    d.text(String(v), p.m + 46, p.y, { maxWidth: p.innerW - 46 });
    p.y += 6;
  }
  p.gap(2);

  /* --- Waktu & Jarak --- */
  p.sectionTitle('Waktu, Durasi & Jarak Tempuh');
  const s = trip.summary || {};
  const metrics = [
    ['Berangkat', fmtDateTime(trip.startedAt)],
    ['Tiba di tujuan', fmtDateTime(trip.arrivedAt)],
    ['Selesai', fmtDateTime(trip.finishedAt)],
    ['Durasi total', s.durationText || fmtDuration((trip.finishedAt || 0) - (trip.startedAt || 0))],
    ['Jarak tempuh (rute GPS)', fmtDistance(s.distanceMeters ?? trip.distanceMeters ?? 0)],
    ['Jarak lurus titik awal→akhir', fmtDistance(s.straightMeters ?? 0)],
    ['Kecepatan rata-rata', s.avgSpeedKmh ? `${s.avgSpeedKmh.toFixed(1)} km/jam` : '-'],
    ['Titik terpantau', `${s.pointCount ?? 0} titik`],
  ];
  for (const [k, v] of metrics) {
    p.need(6);
    d.setFont('helvetica', 'normal');
    d.setFontSize(9.6);
    d.setTextColor(...GREY);
    d.text(k, p.m, p.y);
    d.setFont('helvetica', 'bold');
    d.setTextColor(...NAVY);
    d.text(String(v), p.m + 62, p.y);
    p.y += 6;
  }
  p.gap(2);

  /* --- Titik koordinat --- */
  p.sectionTitle('Titik Awal & Titik Akhir');
  const a = trip.startPoint;
  const b = trip.endPoint;
  const coordRows = [
    ['Titik awal (berangkat)', a ? fmtCoord(a.lat, a.lng) : '-', a ? `${Math.round(a.accuracy || 0)} m` : '-', a ? gmapsLink(a) : ''],
    ['Titik akhir (sampai)', b ? fmtCoord(b.lat, b.lng) : '-', b ? `${Math.round(b.accuracy || 0)} m` : '-', b ? gmapsLink(b) : ''],
  ];
  for (const [label, coord, acc, link] of coordRows) {
    p.need(14);
    d.setFont('helvetica', 'bold');
    d.setFontSize(9.6);
    d.setTextColor(...NAVY);
    d.text(label, p.m, p.y);
    p.y += 4.9;
    d.setFont('courier', 'normal');
    d.setFontSize(9.2);
    d.setTextColor(...GREY);
    d.text(`${coord}   (akurasi ±${acc})`, p.m + 3, p.y);
    p.y += 4.6;
    if (link) {
      d.setFont('helvetica', 'normal');
      d.setFontSize(8);
      d.setTextColor(...BRAND);
      const t = d.splitTextToSize(link, p.innerW - 3)[0];
      d.textWithLink(t, p.m + 3, p.y, { url: link });
      p.y += 4.4;
    }
  }
  p.gap(2);

  /* --- Foto --- */
  if (photos.length) {
    d.addPage();
    p.y = p.m;
    p.sectionTitle('Dokumentasi Foto');

    const cols = 2;
    const gap = 4;
    const colW = (p.innerW - gap * (cols - 1)) / cols;
    let col = 0;
    let rowTop = p.y;
    let rowH = 0;

    for (const ph of photos) {
      const info = await imageInfo(ph.blob);
      const ratio = info.h / info.w || 0.75;
      const boxH = Math.min(colW * 1.35, colW * ratio);
      const labelH = 5.5;
      const totalH = boxH + labelH;

      if (p.y + totalH > p.h - p.m) {
        d.addPage();
        p.y = p.m;
        p.sectionTitle('Dokumentasi Foto (lanjutan)');
        col = 0;
        rowTop = p.y;
        rowH = 0;
      }

      const x = p.m + col * (colW + gap);
      const y = p.y;

      try {
        d.addImage(info.dataUrl, 'JPEG', x, y, colW, boxH, undefined, 'FAST');
      } catch {
        d.setFillColor(240, 242, 248);
        d.rect(x, y, colW, boxH, 'F');
      }
      d.setDrawColor(...LINE);
      d.setLineWidth(0.3);
      d.rect(x, y, colW, boxH);

      d.setFont('helvetica', 'bold');
      d.setFontSize(7.6);
      d.setTextColor(...GREY);
      d.text(ph.label || 'Foto', x, y + boxH + 3.6);
      d.setFont('helvetica', 'normal');
      d.setFontSize(6.8);
      d.text(ph.time ? fmtTime(ph.time) : '', x + colW, y + boxH + 3.6, { align: 'right' });

      rowH = Math.max(rowH, totalH);
      col++;
      if (col >= cols) {
        col = 0;
        p.y = rowTop + rowH + gap;
        rowTop = p.y;
        rowH = 0;
      }
    }
    if (col !== 0) p.y = rowTop + rowH + gap;
    p.gap(2);
  }

  /* --- Tanda tangan --- */
  p.need(70);
  p.sectionTitle('Tanda Tangan Penerima');
  if (signature) {
    const info = await imageInfo(signature);
    const wImg = Math.min(p.innerW, 78);
    const hImg = (info.h / info.w) * wImg;
    const capped = Math.min(hImg, 40);

    d.setDrawColor(...LINE);
    d.setFillColor(252, 252, 254);
    d.roundedRect(p.m, p.y, wImg, capped, 2, 2, 'FD');
    try {
      d.addImage(info.dataUrl, 'PNG', p.m + 2, p.y + 1.5, wImg - 4, capped - 3, undefined, 'FAST');
    } catch { /* diabaikan */ }
    p.y += capped + 3;
    d.setFont('helvetica', 'normal');
    d.setFontSize(8.6);
    d.setTextColor(...GREY);
    d.text(
      `Ditandatangani oleh: ${trip.handover?.signedBy || trip.customer?.nama || '-'}  •  ${fmtDateTime(trip.handover?.signedAt || trip.finishedAt)}`,
      p.m,
      p.y
    );
    p.y += 5;
  } else {
    p.text('Tidak tersedia.', { size: 9.6, color: GREY });
  }

  /* --- Catatan --- */
  if (trip.notes?.trim()) {
    p.gap(3);
    p.sectionTitle('Catatan Deliman');
    p.text(trip.notes.trim(), { size: 9.6, color: NAVY, maxW: p.innerW });
  }

  /* --- Berkas cloud --- */
  if (driveLinks.length) {
    p.gap(3);
    p.sectionTitle('Tautan Arsip Cloud');
    for (const l of driveLinks) {
      p.need(6);
      d.setFont('helvetica', 'normal');
      d.setFontSize(7.8);
      d.setTextColor(...BRAND);
      const t = d.splitTextToSize(l, p.innerW)[0];
      d.textWithLink(t, p.m, p.y, { url: l });
      p.y += 4.4;
    }
  }

  /* --- Kaki halaman --- */
  const pages = d.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    d.setPage(i);
    d.setDrawColor(...LINE);
    d.setLineWidth(0.3);
    d.line(p.m, p.h - 12, p.w - p.m, p.h - 12);
    d.setFont('helvetica', 'normal');
    d.setFontSize(7.4);
    d.setTextColor(...GREY);
    d.text(
      `${APP.name} v${APP.version} — dokumen dibuat otomatis pada ${fmtDateTime(Date.now())}`,
      p.m,
      p.h - 8
    );
    d.text(`Halaman ${i} dari ${pages}`, p.w - p.m, p.h - 8, { align: 'right' });
  }

  return d.output('blob');
}

export function pdfFileName(trip) {
  return `${safeName(trip.id)}_${safeName(trip.customer?.nama || 'pelanggan')}.pdf`;
}

/* ============================ Excel ============================ */

const EXCEL_COLUMNS = [
  ['no', 'No', 5],
  ['id', 'ID Transaksi', 20],
  ['tanggal', 'Tanggal', 12],
  ['jamBerangkat', 'Jam Berangkat', 14],
  ['jamSampai', 'Jam Sampai', 13],
  ['jamSelesai', 'Jam Selesai', 13],
  ['durasiText', 'Durasi', 12],
  ['crew', 'Nama Deliman', 22],
  ['crewHp', 'No. HP Deliman', 16],
  ['pelanggan', 'Nama Pelanggan', 22],
  ['pelangganHp', 'No. HP Pelanggan', 17],
  ['resi', 'No. Resi', 18],
  ['kantor', 'Kantor', 16],
  ['titikAwal', 'Titik Awal (lat,lng)', 24],
  ['titikAkhir', 'Titik Akhir (lat,lng)', 24],
  ['jarakM', 'Jarak Tempuh (m)', 17],
  ['jarakKm', 'Jarak Tempuh (km)', 17],
  ['jarakLurusM', 'Jarak Lurus (m)', 15],
  ['durasiMenit', 'Durasi (menit)', 14],
  ['rataKmh', 'Rata-rata (km/jam)', 16],
  ['jumlahFoto', 'Jumlah Foto', 12],
  ['ttd', 'Ditandatangani', 14],
  ['status', 'Status', 14],
  ['drive', 'Tautan Cloud', 34],
  ['catatan', 'Catatan', 30],
];

export function tripToRow(trip, index) {
  const s = trip.summary || {};
  const dur = (trip.finishedAt || 0) - (trip.startedAt || 0);
  return {
    no: index + 1,
    id: trip.id,
    tanggal: fmtDate(trip.startedAt || trip.createdAt),
    jamBerangkat: fmtTime(trip.startedAt),
    jamSampai: fmtTime(trip.arrivedAt),
    jamSelesai: fmtTime(trip.finishedAt),
    durasiText: s.durationText || fmtDuration(dur),
    crew: trip.crew?.nama || '-',
    crewHp: trip.crew?.hp || '-',
    pelanggan: trip.customer?.nama || '-',
    pelangganHp: trip.customer?.hp || '-',
    resi: trip.customer?.resi || '-',
    kantor: trip.kantor?.nama || trip.kantor?.nomor || '-',
    titikAwal: trip.startPoint ? `${trip.startPoint.lat.toFixed(6)}, ${trip.startPoint.lng.toFixed(6)}` : '-',
    titikAkhir: trip.endPoint ? `${trip.endPoint.lat.toFixed(6)}, ${trip.endPoint.lng.toFixed(6)}` : '-',
    jarakM: Math.round(s.distanceMeters ?? trip.distanceMeters ?? 0),
    jarakKm: Number(((s.distanceMeters ?? trip.distanceMeters ?? 0) / 1000).toFixed(3)),
    jarakLurusM: Math.round(s.straightMeters ?? 0),
    durasiMenit: Math.round(dur / 60000),
    rataKmh: Number((s.avgSpeedKmh ?? 0).toFixed(2)),
    jumlahFoto: trip.photoCount ?? 0,
    ttd: trip.handover?.signedBy || '-',
    status: trip.state || '-',
    drive: (trip.driveLinks || []).join(' | '),
    catatan: trip.notes || '',
  };
}

/** Bangun berkas Excel rekapitulasi (acuan klaim bahan bakar). */
export function buildExcel(trips, { sheetName = 'Rekap Pengantaran' } = {}) {
  const XLSX = window.XLSX;
  if (!XLSX) throw new Error('Pustaka Excel belum termuat.');

  const rows = trips.map((t, i) => tripToRow(t, i));

  const header = EXCEL_COLUMNS.map(([, label]) => label);
  const body = rows.map((r) => EXCEL_COLUMNS.map(([key]) => r[key]));

  const totalJarak = rows.reduce((a, r) => a + (r.jarakM || 0), 0);
  const totalMenit = rows.reduce((a, r) => a + (r.durasiMenit || 0), 0);
  const totalTrip = rows.length;

  const aoa = [
    [`${APP.name} — Rekapitulasi Pengantaran`],
    [`Diekspor: ${fmtDateTime(Date.now())}`],
    [],
    header,
    ...body,
    [],
    ['TOTAL', '', '', '', '', '', '', `${totalTrip} pengantaran`, '', '', '', '', '', '', '', totalJarak, Number((totalJarak / 1000).toFixed(3)), '', totalMenit, '', '', '', '', ''],
  ];

  const ws = XLSX.utils.aoa_to_sheet(aoa);

  ws['!cols'] = EXCEL_COLUMNS.map(([, , w]) => ({ wch: w }));
  ws['!autofilter'] = {
    ref: XLSX.utils.encode_range({ s: { r: 3, c: 0 }, e: { r: 3 + body.length, c: header.length - 1 } }),
  };
  ws['!freeze'] = { xSplit: 0, ySplit: 4 };

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31));

  // Lembar ringkasan per hari — memudahkan hitung klaim harian.
  const byDay = new Map();
  rows.forEach((r) => {
    const cur = byDay.get(r.tanggal) || { tanggal: r.tanggal, trip: 0, meter: 0, menit: 0 };
    cur.trip += 1;
    cur.meter += r.jarakM || 0;
    cur.menit += r.durasiMenit || 0;
    byDay.set(r.tanggal, cur);
  });
  const dayAoa = [
    ['Rekap Harian'],
    [],
    ['Tanggal', 'Jumlah Pengantaran', 'Total Jarak (km)', 'Total Durasi (menit)'],
    ...[...byDay.values()].map((d) => [d.tanggal, d.trip, Number((d.meter / 1000).toFixed(3)), d.menit]),
  ];
  const ws2 = XLSX.utils.aoa_to_sheet(dayAoa);
  ws2['!cols'] = [{ wch: 14 }, { wch: 20 }, { wch: 18 }, { wch: 20 }];
  XLSX.utils.book_append_sheet(wb, ws2, 'Rekap Harian');

  const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  return new Blob([out], { type: MIME_XLSX });
}

export function excelFileName(label = 'rekap') {
  const now = new Date();
  const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
  return `${APP.name}_${safeName(label)}_${stamp}.xlsx`;
}

export async function exportExcel(trips, label = 'rekap') {
  await loadVendor('xlsx');
  const blob = buildExcel(trips);
  download(blob, excelFileName(label));
  return blob;
}

/** Cadangan sederhana bila pustaka Excel gagal dimuat. */
export function exportCsv(trips, label = 'rekap') {
  const rows = trips.map((t, i) => tripToRow(t, i));
  const header = EXCEL_COLUMNS.map(([, l]) => l);
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv = [
    header.map(esc).join(';'),
    ...rows.map((r) => EXCEL_COLUMNS.map(([k]) => esc(r[k])).join(';')),
  ].join('\r\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
  download(blob, excelFileName(label).replace('.xlsx', '.csv'));
  return blob;
}
