import { icon } from './icons.js';
import { el, $ } from './util.js';

const NATIVE_FORMATS = [
  'qr_code', 'aztec', 'data_matrix', 'pdf417',
  'code_128', 'code_39', 'code_93', 'codabar', 'itf',
  'ean_13', 'ean_8', 'upc_a', 'upc_e',
];

export function scannerSupported() {
  return !!(('BarcodeDetector' in window) || window.ZXing) && !!navigator.mediaDevices?.getUserMedia;
}

/**
 * Membuka pemindai barcode/QR penuh layar.
 * Memakai BarcodeDetector bawaan browser bila ada, jika tidak memakai pustaka ZXing.
 * @returns {Promise<{value: string, format: string, engine: string}|null>}
 */
export async function scanCode({ title = 'Pindai Barcode / QR Struk' } = {}) {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('Perangkat ini tidak mendukung akses kamera.');
  }

  return new Promise((resolve) => {
    let stream = null;
    let closed = false;
    let raf = 0;
    let timer = 0;
    let detecting = false;
    let detector = null;
    let zxing = null;

    const root = el('div', { class: 'cam', role: 'dialog', 'aria-label': title });
    root.innerHTML = `
      <div class="cam__stage">
        <video class="cam__video" autoplay playsinline muted></video>
        <div class="cam__scan">
          <div class="cam__scan-box"><i></i><i></i><i></i><i></i><div class="cam__scan-laser"></div></div>
        </div>
        <div class="cam__top">
          <button class="cam__round" data-act="close" aria-label="Tutup">${icon('x')}</button>
          <div class="cam__title">${title}</div>
          <button class="cam__round hidden" data-act="torch" aria-label="Senter" aria-pressed="false">${icon('flashlight')}</button>
        </div>
        <div class="cam__hint" data-role="hint">Posisikan barcode/QR di dalam kotak</div>
      </div>
      <div class="cam__bottom" style="justify-content:center">
        <button class="btn btn--ghost" data-act="manual" style="color:#fff;border-color:rgba(255,255,255,.25);flex:0 0 auto">
          ${icon('edit')} Ketik manual
        </button>
      </div>
    `;

    const video = $('.cam__video', root);
    const hint = $('[data-role="hint"]', root);
    const torchBtn = $('[data-act="torch"]', root);
    let track = null;
    let torchOn = false;

    const cleanup = () => {
      if (closed) return;
      closed = true;
      cancelAnimationFrame(raf);
      clearTimeout(timer);
      try {
        zxing?.reset?.();
      } catch { /* diabaikan */ }
      try {
        stream?.getTracks().forEach((t) => t.stop());
      } catch { /* diabaikan */ }
      root.remove();
      document.body.style.removeProperty('overflow');
    };

    const finish = (result) => {
      cleanup();
      resolve(result);
    };

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    async function initDetector() {
      if ('BarcodeDetector' in window) {
        try {
          const supported = await window.BarcodeDetector.getSupportedFormats();
          const formats = NATIVE_FORMATS.filter((f) => supported.includes(f));
          if (formats.length) {
            detector = new window.BarcodeDetector({ formats });
            return 'native';
          }
        } catch { /* lanjut ke fallback */ }
      }
      if (window.ZXing?.BrowserMultiFormatReader) {
        const hints = new Map();
        hints.set(window.ZXing.DecodeHintType.POSSIBLE_FORMATS, [
          window.ZXing.BarcodeFormat.QR_CODE,
          window.ZXing.BarcodeFormat.CODE_128,
          window.ZXing.BarcodeFormat.CODE_39,
          window.ZXing.BarcodeFormat.CODE_93,
          window.ZXing.BarcodeFormat.EAN_13,
          window.ZXing.BarcodeFormat.EAN_8,
          window.ZXing.BarcodeFormat.UPC_A,
          window.ZXing.BarcodeFormat.ITF,
          window.ZXing.BarcodeFormat.CODABAR,
          window.ZXing.BarcodeFormat.DATA_MATRIX,
          window.ZXing.BarcodeFormat.PDF_417,
          window.ZXing.BarcodeFormat.AZTEC,
        ]);
        hints.set(window.ZXing.DecodeHintType.TRY_HARDER, true);
        zxing = new window.ZXing.BrowserMultiFormatReader(hints, { delayBetweenScanAttempts: 180 });
        return 'zxing';
      }
      return null;
    }

    function frameToCanvas() {
      const vw = video.videoWidth;
      const vh = video.videoHeight;
      if (!vw || !vh) return null;
      const scale = Math.min(1, 1000 / Math.max(vw, vh));
      canvas.width = Math.round(vw * scale);
      canvas.height = Math.round(vh * scale);
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      return canvas;
    }

    async function tick() {
      if (closed) return;
      if (detecting || video.readyState < 2) {
        timer = setTimeout(tick, 160);
        return;
      }
      detecting = true;
      try {
        const cv = frameToCanvas();
        if (!cv) throw new Error('frame');

        let hit = null;
        if (detector) {
          const codes = await detector.detect(cv);
          if (codes?.length) {
            const c = codes[0];
            hit = { value: c.rawValue, format: c.format };
          }
        } else if (zxing) {
          try {
            const r = zxing.decodeFromCanvas(cv);
            if (r) {
              hit = {
                value: r.getText(),
                format: String(r.getBarcodeFormat?.() ?? 'unknown').toLowerCase(),
              };
            }
          } catch {
            /* NotFoundException tiap frame — normal */
          }
        }

        if (hit?.value) {
          if (navigator.vibrate) navigator.vibrate(60);
          finish({ ...hit, engine: detector ? 'barcode-detector' : 'zxing' });
          return;
        }
      } catch {
        /* frame belum siap, coba lagi */
      } finally {
        detecting = false;
      }
      timer = setTimeout(tick, detector ? 220 : 200);
    }

    root.addEventListener('click', async (ev) => {
      const btn = ev.target.closest('[data-act]');
      if (!btn) return;
      const act = btn.dataset.act;

      if (act === 'close') finish(null);

      if (act === 'manual') {
        hint.textContent = 'Masukkan kode secara manual…';
        finish({ value: null, format: 'manual', engine: 'manual' });
      }

      if (act === 'torch' && track) {
        torchOn = !torchOn;
        try {
          await track.applyConstraints({ advanced: [{ torch: torchOn }] });
          torchBtn.setAttribute('aria-pressed', String(torchOn));
        } catch {
          torchOn = false;
        }
      }
    });

    document.body.appendChild(root);
    document.body.style.overflow = 'hidden';

    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1920 },
            height: { ideal: 1080 },
            focusMode: 'continuous',
          },
        });
      } catch {
        stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: true });
      }

      track = stream.getVideoTracks()[0];
      try {
        const caps = track.getCapabilities?.() || {};
        if (caps.focusMode?.includes('continuous')) {
          await track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] });
        }
        torchBtn.classList.toggle('hidden', !caps.torch);
      } catch { /* diabaikan */ }

      video.srcObject = stream;
      try {
        await video.play();
      } catch { /* diabaikan */ }

      const engine = await initDetector();
      if (!engine) {
        finish({ error: 'Pemindai barcode tidak tersedia di browser ini.' });
        return;
      }
      hint.textContent =
        engine === 'native'
          ? 'Posisikan barcode/QR di dalam kotak'
          : 'Posisikan barcode/QR di dalam kotak (mode kompatibilitas)';
      tick();
    })().catch((e) => {
      finish({ error: e?.message || 'Gagal mengaktifkan kamera.' });
    });
  });
}
