// Pemuatan pustaka pihak ketiga secara malas (lazy).
// Pustaka disimpan lokal di folder vendor/ dan sudah di-cache Service Worker,
// jadi tetap bisa dimuat walau perangkat sedang offline.

const LIBS = {
  leaflet: { src: './vendor/leaflet.js', global: 'L', css: './vendor/leaflet.css' },
  zxing: { src: './vendor/zxing.min.js', global: 'ZXing' },
  jspdf: { src: './vendor/jspdf.umd.min.js', global: 'jspdf' },
  xlsx: { src: './vendor/xlsx.full.min.js', global: 'XLSX' },
};

const pending = new Map();

function injectCss(href) {
  if (document.querySelector(`link[href="${href}"]`)) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = href;
  document.head.appendChild(link);
}

function injectScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`Gagal memuat ${src}. Periksa folder vendor/.`));
    document.head.appendChild(s);
  });
}

/** Muat pustaka bila belum ada. Aman dipanggil berkali-kali. */
export function loadVendor(name) {
  const lib = LIBS[name];
  if (!lib) return Promise.reject(new Error(`Pustaka "${name}" tidak dikenal.`));
  if (window[lib.global]) return Promise.resolve(window[lib.global]);
  if (pending.has(name)) return pending.get(name);

  const task = (async () => {
    if (lib.css) injectCss(lib.css);
    await injectScript(lib.src);
    if (!window[lib.global]) throw new Error(`Pustaka ${name} termuat tetapi tidak terdaftar.`);
    return window[lib.global];
  })().catch((e) => {
    pending.delete(name);
    throw e;
  });

  pending.set(name, task);
  return task;
}

export const vendorReady = {
  get leaflet() {
    return !!window.L;
  },
  get zxing() {
    return !!window.ZXing;
  },
  get jspdf() {
    return !!(window.jspdf || window.jsPDF);
  },
  get xlsx() {
    return !!window.XLSX;
  },
};

/** Muat pustaka yang berat di latar belakang setelah aplikasi siap. */
export function warmVendor(names = ['leaflet', 'zxing']) {
  const run = () => names.forEach((n) => loadVendor(n).catch(() => {}));
  if ('requestIdleCallback' in window) window.requestIdleCallback(run, { timeout: 4000 });
  else setTimeout(run, 2500);
}
