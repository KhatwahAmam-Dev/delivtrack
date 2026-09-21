import { MEDIA } from './config.js';
import { icon } from './icons.js';
import { el, $ } from './util.js';

const errMsg = (e) => {
  const n = e?.name;
  if (n === 'NotAllowedError') return 'Izin kamera ditolak. Aktifkan izin kamera untuk DelivTrack di pengaturan browser.';
  if (n === 'NotFoundError') return 'Kamera tidak ditemukan pada perangkat ini.';
  if (n === 'NotReadableError') return 'Kamera sedang dipakai aplikasi lain. Tutup aplikasi tersebut lalu coba lagi.';
  if (n === 'OverconstrainedError') return 'Kamera tidak mendukung pengaturan yang diminta.';
  return e?.message || 'Gagal membuka kamera.';
};

/**
 * Mengambil foto dengan UI kamera penuh layar, autofokus kontinu, dan hasil tajam.
 * @returns {Promise<{blob: Blob, dataUrl: string, w: number, h: number}|null>} null bila dibatalkan
 */
export async function capturePhoto({ title = 'Ambil Foto', hint = 'Arahkan kamera, tunggu fokus terkunci lalu tekan tombol.', facing = 'environment', allowGallery = true, maxDim = MEDIA.maxDim, quality = MEDIA.quality, scan = false } = {}) {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('Perangkat/browser ini tidak mendukung akses kamera. Pastikan halaman dibuka lewat HTTPS.');
  }

  return new Promise((resolve) => {
    let stream = null;
    let track = null;
    let torchOn = false;
    let torchSupported = false;
    let closed = false;
    let busy = false;

    const root = el('div', { class: 'cam', role: 'dialog', 'aria-label': title });
    root.innerHTML = `
      <div class="cam__stage">
        <video class="cam__video" autoplay playsinline muted></video>
        ${scan ? `<div class="cam__scan"><div class="cam__scan-box"><i></i><i></i><i></i><i></i><div class="cam__scan-laser"></div></div></div>` : ''}
        <div class="cam__flash"></div>
        <div class="cam__top">
          <button class="cam__round" data-act="close" aria-label="Tutup">${icon('x')}</button>
          <div class="cam__title">${title}</div>
          <button class="cam__round hidden" data-act="torch" aria-label="Senter" aria-pressed="false">${icon('flashlight')}</button>
        </div>
        <div class="cam__hint">${hint}</div>
      </div>
      <div class="cam__bottom">
        <div class="cam__side"></div>
        <button class="cam__shutter" data-act="shot" aria-label="Ambil foto"></button>
        <div class="cam__side">
          <button class="cam__round" data-act="switch" aria-label="Ganti kamera">${icon('switchCam')}</button>
        </div>
      </div>
    `;

    const video = $('.cam__video', root);
    const flash = $('.cam__flash', root);
    const torchBtn = $('[data-act="torch"]', root);

    const cleanup = () => {
      if (closed) return;
      closed = true;
      try {
        stream?.getTracks().forEach((t) => t.stop());
      } catch {
        /* diabaikan */
      }
      root.remove();
      document.body.style.removeProperty('overflow');
    };

    const finish = (result) => {
      cleanup();
      resolve(result);
    };

    async function startStream() {
      if (stream) stream.getTracks().forEach((t) => t.stop());

      const base = {
        audio: false,
        video: {
          facingMode: { ideal: facing },
          width: { ideal: 2560 },
          height: { ideal: 1440 },
          // Kunci agar tidak blur: fokus & eksposur otomatis berkelanjutan.
          focusMode: 'continuous',
          exposureMode: 'continuous',
          whiteBalanceMode: 'continuous',
          // Hindari lag shutter yang membuat foto goyang.
          shutterSpeed: { ideal: 1 / 120 },
        },
      };

      try {
        stream = await navigator.mediaDevices.getUserMedia(base);
      } catch {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: { ideal: facing } },
        });
      }

      track = stream.getVideoTracks()[0];

      // Terapkan mode fokus kontinu secara eksplisit bila didukung.
      try {
        const caps = track.getCapabilities?.() || {};
        if (caps.focusMode?.includes('continuous')) {
          await track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] });
        }
        torchSupported = !!caps.torch;
      } catch {
        torchSupported = false;
      }

      torchBtn.classList.toggle('hidden', !torchSupported);
      video.srcObject = stream;
      await video.play().catch(() => {});
    }

    function rawBlob() {
      // Ukuran sumber mengikuti orientasi video sebenarnya.
      const vw = video.videoWidth;
      const vh = video.videoHeight;
      const stage = $('.cam__stage', root).getBoundingClientRect();
      // Pangkas tengah agar hasil = apa yang dilihat (object-fit: cover).
      const targetAspect = stage.width / stage.height;
      let sw = vw;
      let sh = vh;
      if (vw / vh > targetAspect) sw = Math.round(vh * targetAspect);
      else sh = Math.round(vw / targetAspect);
      const sx = Math.round((vw - sw) / 2);
      const sy = Math.round((vh - sh) / 2);

      const scale = Math.min(1, maxDim / Math.max(sw, sh));
      const ow = Math.max(1, Math.round(sw * scale));
      const oh = Math.max(1, Math.round(sh * scale));

      const cv = document.createElement('canvas');
      cv.width = ow;
      cv.height = oh;
      const ctx = cv.getContext('2d', { alpha: false });
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(video, sx, sy, sw, sh, 0, 0, ow, oh);

      return new Promise((res) =>
        cv.toBlob((b) => res({ blob: b, w: ow, h: oh }), 'image/jpeg', quality)
      );
    }

    async function shoot() {
      if (busy || closed) return;
      busy = true;
      const btn = $('[data-act="shot"]', root);
      btn.disabled = true;

      try {
        flash.classList.add('go');
        setTimeout(() => flash.classList.remove('go'), 400);

        // Beri kesempatan autofokus menstabilkan gambar sebelum ditangkap.
        await new Promise((r) => setTimeout(r, 260));

        const shot = await rawBlob();
        if (!shot.blob) throw new Error('Gagal memproses hasil foto.');

        if (scan) {
          finish({ blob: shot.blob, dataUrl: null, w: shot.w, h: shot.h });
          return;
        }

        cleanup();
        resolve({
          ...shot,
          dataUrl: URL.createObjectURL(shot.blob),
        });
      } catch (e) {
        busy = false;
        btn.disabled = false;
        alert(errMsg(e));
      }
    }

    root.addEventListener('click', async (ev) => {
      const btn = ev.target.closest('[data-act]');
      if (!btn) return;
      const act = btn.dataset.act;

      if (act === 'close') finish(null);

      if (act === 'shot') shoot();

      if (act === 'switch') {
        facing = facing === 'environment' ? 'user' : 'environment';
        try {
          await startStream();
        } catch (e) {
          alert(errMsg(e));
        }
      }

      if (act === 'torch') {
        if (!torchSupported) return;
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

    startStream().catch((e) => {
      cleanup();
      resolve({ error: errMsg(e) });
    });
  });
}

/** Kompres ulang gambar yang dipilih dari galeri agar hemat penyimpanan. */
export async function compressImageFile(file, maxDim = MEDIA.maxDim, quality = MEDIA.quality) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = () => rej(new Error('Gambar tidak dapat dibaca.'));
      i.src = url;
    });
    const scale = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.round(img.naturalWidth * scale);
    const h = Math.round(img.naturalHeight * scale);
    const cv = document.createElement('canvas');
    cv.width = w;
    cv.height = h;
    const ctx = cv.getContext('2d', { alpha: false });
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, w, h);
    const blob = await new Promise((res) => cv.toBlob(res, 'image/jpeg', quality));
    return { blob, w, h, dataUrl: URL.createObjectURL(blob) };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Buat thumbnail kecil untuk tampilan daftar. */
export async function makeThumb(blob, dim = MEDIA.thumbDim, quality = MEDIA.thumbQuality) {
  const url = URL.createObjectURL(blob);
  try {
    const img = await new Promise((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = rej;
      i.src = url;
    });
    const scale = Math.min(1, dim / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));
    const cv = document.createElement('canvas');
    cv.width = w;
    cv.height = h;
    cv.getContext('2d').drawImage(img, 0, 0, w, h);
    return await new Promise((res) => cv.toBlob(res, 'image/jpeg', quality));
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Pilih gambar dari galeri (fallback bila kamera tidak mau dipakai). */
export function pickFromGallery({ multiple = false, accept = 'image/*' } = {}) {
  return new Promise((resolve) => {
    const input = el('input', { type: 'file', accept, multiple, capture: false });
    input.style.display = 'none';
    document.body.appendChild(input);
    input.addEventListener('change', () => {
      const files = Array.from(input.files || []);
      input.remove();
      resolve(files);
    });
    input.click();
  });
}
