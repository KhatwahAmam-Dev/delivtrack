import { WA } from './config.js';
import { fill, normalizePhone, safeName, fmtDistance } from './util.js';
import { gmapsLink, gmapsDirections } from './geo.js';

/* ---------------- Tautan dasar ---------------- */

export function waLink(phone, text = '') {
  const p = normalizePhone(phone);
  const base = p ? `https://wa.me/${p}` : 'https://wa.me/';
  return text ? `${base}?text=${encodeURIComponent(text)}` : base;
}

/**
 * Buka tautan di tab baru. Tidak pernah menavigasi tab aplikasi.
 * Catatan: `noopener` pada argumen ketiga membuat `window.open` SELALU
 * mengembalikan null, sehingga keberhasilan buka tab tak bisa dideteksi.
 * Karena itu pemutusan `opener` dilakukan manual setelah tab terbuka.
 */
export function waOpen(url) {
  try {
    const w = window.open(url, '_blank');
    if (!w) return false;
    try {
      w.opener = null;
    } catch { /* tab lintas asal — biarkan, tautan tetap aman */ }
    return true;
  } catch {
    return false;
  }
}

export function waSend(phone, text) {
  const url = waLink(phone, text);
  return { url, opened: waOpen(url) };
}

export function telLink(phone) {
  return `tel:${normalizePhone(phone) || phone}`;
}

export function mailLink(to, subject, body) {
  return `mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

/* ---------------- Berbagi berkas (foto/PDF) ke WhatsApp ---------------- */

export function canShareFiles(files = []) {
  return !!(navigator.canShare && navigator.share) && navigator.canShare({ files });
}

/**
 * Kirim teks + foto/PDF lewat lembar berbagi bawaan HP, sehingga bisa langsung
 * dipilih WhatsApp dan dikirim sebagai lampiran asli (bukan sekadar tautan).
 */
export async function shareFiles({ text = '', files = [], title = 'DelivTrack', phone = '' } = {}) {
  const list = files.filter(Boolean);

  if (list.length && canShareFiles(list)) {
    try {
      await navigator.share({ title, text, files: list });
      return { via: 'share-files' };
    } catch (e) {
      if (e?.name === 'AbortError') return { via: 'cancelled' };
      // jatuh ke cara berikutnya
    }
  }

  if (list.length === 1 && !text) {
    try {
      await navigator.share({ title, files: list });
      return { via: 'share-files' };
    } catch (e) {
      if (e?.name === 'AbortError') return { via: 'cancelled' };
    }
  }

  // Fallback teks: beri tahu pengguna bahwa lampiran perlu dikirim manual.
  const fallbackText =
    list.length && text
      ? `${text}\n\n_(Lampiran ${list.length} berkas terpisah — pilih berkas dari tombol Unduh.)_`
      : text;

  const { url, opened } = waSend(phone, fallbackText || '');

  // Popup diblokir: gestur pengguna sudah habis oleh proses GPS/unggah yang panjang.
  // Tawarkan buka sekali-tap, jangan pernah menyerobot layar aplikasi.
  if (!opened) {
    const sudahDibuka = await tawarkanWhatsApp(url);
    if (!sudahDibuka) return { via: 'wa-prompt', count: list.length, url };
  }

  return { via: 'wa-text', count: list.length, url };
}

/** Lembar pilihan untuk membuka WhatsApp dengan gestur pengguna yang segar. */
async function tawarkanWhatsApp(url) {
  const { actionSheet } = await import('./ui.js');
  const pick = await actionSheet({
    title: 'Kirim lewat WhatsApp',
    subtitle: 'Pesan sudah siap. Aplikasi tetap berjalan di layar ini.',
    actions: [
      { label: 'Buka WhatsApp sekarang', hint: 'Terbuka di tab baru', icon: 'whatsapp', tone: 'ok', value: url },
      { label: 'Nanti saja', hint: 'Bisa dikirim ulang dari Riwayat', icon: 'x', value: '' },
    ],
  });
  return !!pick && waOpen(pick);
}

/** Ubah daftar Blob menjadi File agar bisa dibagikan lewat Web Share API. */
export function toFiles(blobs = [], namer = (b, i) => `berkas-${i + 1}.jpg`) {
  return blobs
    .filter(Boolean)
    .map((b, i) => {
      if (b instanceof File) return b;
      const name = namer(b, i);
      try {
        return new File([b.blob || b], name, { type: (b.blob || b).type || 'image/jpeg' });
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

/* ---------------- Template pesan ---------------- */

export function varsFor(trip, extra = {}) {
  const awal = trip.startPoint;
  const akhir = trip.endPoint;
  return {
    crew: trip.crew?.nama || '-',
    hpCrew: trip.crew?.hp || '-',
    pelanggan: trip.customer?.nama || '-',
    hpPelanggan: trip.customer?.hp || '-',
    resi: trip.customer?.resi || '-',
    kantor: trip.kantor?.nama || trip.kantor?.nomor || '-',
    linkAwal: awal ? gmapsLink(awal) : '-',
    linkAkhir: akhir ? gmapsLink(akhir) : '-',
    titikAwal: awal ? `${awal.lat.toFixed(5)}, ${awal.lng.toFixed(5)}` : '-',
    titikAkhir: akhir ? `${akhir.lat.toFixed(5)}, ${akhir.lng.toFixed(5)}` : '-',
    linkRute: awal && akhir ? gmapsDirections(awal, akhir) : '-',
    waktu: fmtWaktu(extra.at || Date.now()),
    berangkat: fmtWaktu(trip.startedAt),
    tiba: fmtWaktu(trip.arrivedAt),
    selesai: fmtWaktu(trip.finishedAt),
    jarak: fmtDistance(trip.summary?.distanceMeters ?? trip.distanceMeters ?? 0),
    jarakLurus: fmtDistance(trip.summary?.straightMeters ?? 0),
    durasi: trip.summary?.durationText || '-',
    penandatangan: trip.handover?.signedBy || trip.customer?.nama || '-',
    berkas: extra.berkas || '-',
    tanggal: new Date(trip.startedAt || Date.now()).toLocaleDateString('id-ID', {
      day: '2-digit', month: 'long', year: 'numeric',
    }),
    ...extra,
  };
}

function fmtWaktu(ts) {
  if (!ts) return '-';
  return new Date(ts).toLocaleString('id-ID', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

export function buildMessage(kind, trip, extra = {}) {
  return fill(WA[kind] || '', varsFor(trip, extra));
}

/* ---------------- Pengiriman ke pihak terkait ---------------- */

export async function notifyCustomerDeparture(trip, photoBlobs = []) {
  const text = buildMessage('keberangkatan', trip);
  const files = photoBlobs.filter(Boolean);
  return shareFiles({
    title: `Keberangkatan — ${trip.customer?.nama || 'Pelanggan'}`,
    text,
    files,
    phone: trip.customer?.hp || '',
  });
}

export async function notifyCustomerArrival(trip, photoBlobs = []) {
  const text = buildMessage('sampai', trip);
  const files = photoBlobs.filter(Boolean);
  return shareFiles({
    title: `Tiba di lokasi — ${trip.customer?.nama || 'Pelanggan'}`,
    text,
    files,
    phone: trip.customer?.hp || '',
  });
}

export async function notifyOffice(trip, { pdfBlob = null, photoBlobs = [], driveLinks = [] } = {}) {
  const berkas = driveLinks.length
    ? driveLinks.join('\n')
    : pdfBlob
      ? `Laporan PDF ${safeName(trip.id)}.pdf dilampirkan`
      : '-';

  const text = buildMessage('kantor', trip, { berkas });
  const files = [pdfBlob, ...photoBlobs].filter(Boolean);

  return shareFiles({
    title: `Laporan pengantaran ${trip.id}`,
    text,
    files,
    phone: trip.kantor?.nomor || '',
  });
}

/** Ringkasan teks laporan kantor (dipakai untuk pratinjau & fallback salin). */
export function officeReportText(trip, opts = {}) {
  return buildMessage('kantor', trip, opts);
}
