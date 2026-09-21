export const APP = {
  name: 'DelivTrack',
  tagline: 'Pemantauan Pengantaran',
  version: '1.0.4',
  schema: 1,
};

export const KEYS = {
  settings: 'settings',
  draft: 'draft',
  theme: 'theme',
};

export const DEFAULTS = {
  // Data crew & kantor disimpan agar tidak perlu input ulang tiap sesi.
  crewNama: '',
  crewHp: '',
  kantorNomor: '',
  kantorNama: '',
  // Integrasi
  gmapsApiKey: '',
  driveClientId: '',
  driveFolderName: 'DelivTrack',
  autoUpload: true,
  autoWa: true,
  theme: 'auto',
};

export const GPS = {
  // Watch position
  enableHighAccuracy: true,
  timeout: 20000,
  maximumAge: 0,
  // Filter kualitas titik
  maxAccuracyM: 120,      // titik dengan akurasi lebih buruk dari ini diabaikan utk akumulasi jarak
  minMoveM: 6,            // jarak minimum antar titik agar dihitung (anti-jitter saat diam)
  maxSpeedKmh: 160,       // lompatan tidak wajar dibuang
  minIntervalMs: 1500,    // throttle penulisan breadcrumb
  maxPoints: 4000,        // batas titik per trip (proteksi memori)
  idleStopMs: 90_000,     // anggap berhenti bila tidak ada gerakan
};

export const MEDIA = {
  maxDim: 1600,
  quality: 0.82,
  thumbDim: 260,
  thumbQuality: 0.6,
  maxPerSlot: 12,
};

export const TILES = {
  url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
  attribution: '&copy; OpenStreetMap',
  maxZoom: 19,
};

export const WA = {
  // Template pesan. Placeholder: {{...}}
  keberangkatan:
    '🚚 *INFO KEBERANGKATAN*\n\n' +
    'Halo *{{pelanggan}}*,\n' +
    'Pesanan Anda sedang dalam perjalanan menuju lokasi.\n\n' +
    '👤 Deliman: {{crew}}\n' +
    '🧾 No. Resi: {{resi}}\n' +
    '🕒 Berangkat: {{waktu}}\n' +
    '📍 Titik awal: {{linkAwal}}\n' +
    '📏 Estimasi jarak: {{jarakLurus}}\n\n' +
    'Deliman akan menghubungi Anda saat tiba. Terima kasih 🙏',

  sampai:
    '📍 *DELIMAN TIBA DI LOKASI*\n\n' +
    'Halo *{{pelanggan}}*,\n' +
    'Deliman kami sudah tiba di lokasi tujuan.\n\n' +
    '👤 Deliman: {{crew}}\n' +
    '🧾 No. Resi: {{resi}}\n' +
    '🕒 Tiba: {{waktu}}\n' +
    '📍 Titik sampai: {{linkAkhir}}\n\n' +
    'Mohon bersiap menerima paket Anda 🙏',

  kantor:
    '✅ *LAPORAN PENGANTARAN SELESAI*\n\n' +
    'Paket belanjaan yang diantarkan oleh deliman atas nama *{{crew}}* ' +
    'telah sampai di tujuan konsumen bernama *{{pelanggan}}* dengan nomor HP {{hpPelanggan}}, ' +
    'dengan jarak tempuh *{{jarak}}*, dari {{titikAwal}} ke {{titikAkhir}} ' +
    'dan paket belanja telah diterima oleh pelanggan.\n\n' +
    '🧾 No. Resi: {{resi}}\n' +
    '🕒 Berangkat: {{berangkat}}\n' +
    '🏁 Selesai: {{selesai}}\n' +
    '⏱️ Durasi: {{durasi}}\n' +
    '✍️ Ditandatangani oleh: {{penandatangan}}\n' +
    '📄 Berkas: {{berkas}}',
};

export const TRIP_STATE = {
  DRAFT: 'draft',
  READY: 'siap',
  EN_ROUTE: 'perjalanan',
  ARRIVED: 'tiba',
  DONE: 'selesai',
  CLOSED: 'ditutup',
};

export const SYNC = {
  maxAttempts: 8,
  backoffMs: [5_000, 15_000, 45_000, 120_000, 300_000, 900_000, 1_800_000, 3_600_000],
  folderParent: null,
};

export const MIME_PDF = 'application/pdf';
export const MIME_XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
