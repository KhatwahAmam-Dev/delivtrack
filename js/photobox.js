// Komponen kartu foto yang dipakai layar "Halaman Informasi" (produk & nota)
// dan layar serah terima. Menangani kamera, galeri, thumbnail, dan hapus.

import { MEDIA } from './config.js';
import { icon } from './icons.js';
import { capturePhoto, compressImageFile, pickFromGallery } from './camera.js';
import { $, el } from './util.js';
import { confirmDialog, imageViewer, toast, withBusy } from './ui.js';
import * as trip from './trip.js';

/**
 * @param {object} opts
 * @param {string} opts.kind      KIND.* — jenis berkas yang disimpan
 * @param {string} opts.title     Judul kartu
 * @param {string} opts.hint      Keterangan kecil di dalam tombol kamera
 * @param {string} [opts.iconName]
 * @param {boolean} [opts.required] Tampilkan lencana "Wajib"
 * @param {number} [opts.max]
 * @param {string} [opts.note]    Banner bantuan (opsional)
 * @param {string} [opts.scanLabel] Bila diisi, tampilkan tombol pindai tambahan
 * @param {Function} [opts.onScan]
 * @param {Function} [opts.onChange]  Dipanggil setiap daftar foto berubah
 */
export function photoCard({
  kind,
  title,
  hint = 'Ketuk untuk membuka kamera',
  iconName = 'camera',
  required = true,
  max = MEDIA.maxPerSlot,
  note = '',
  scanLabel = '',
  onScan = null,
  onChange = null,
} = {}) {
  const card = el('div', { class: 'card' });
  card.innerHTML = `
    <div class="card__head">
      <h3>${title}</h3>
      <div class="grow"></div>
      <span class="badge badge--warn" data-role="badge">${required ? 'Wajib' : 'Opsional'}</span>
    </div>
    <div class="card__pad">
      ${note ? `<div class="banner banner--info" style="margin-bottom:12px">${icon('info')}<div>${note}</div></div>` : ''}
      <button class="dropzone" type="button" data-role="add">
        <div class="dropzone__ico">${icon(iconName)}</div>
        <div class="dropzone__t">Buka Kamera</div>
        <div class="dropzone__s">${hint}</div>
      </button>
      <div class="btnrow mt-8">
        <button class="btn btn--ghost btn--sm" type="button" data-role="gallery">
          ${icon('image')} Dari galeri
        </button>
        ${scanLabel ? `<button class="btn btn--soft btn--sm" type="button" data-role="scan">${icon('qr')} ${scanLabel}</button>` : ''}
      </div>
      <div class="thumbs mt-12" data-role="thumbs"></div>
    </div>
  `;

  const thumbs = $('[data-role="thumbs"]', card);
  const badge = $('[data-role="badge"]', card);
  const addBtn = $('[data-role="add"]', card);
  const galleryBtn = $('[data-role="gallery"]', card);
  const scanBtn = $('[data-role="scan"]', card);

  let rows = [];
  const urls = new Map();

  const blobUrl = (row) => {
    if (!urls.has(row.id)) urls.set(row.id, URL.createObjectURL(row.blob));
    return urls.get(row.id);
  };

  function render() {
    thumbs.innerHTML = '';
    rows.forEach((row) => {
      const t = el('div', { class: 'thumb' });
      t.innerHTML = `<img alt="" src="${blobUrl(row)}" /><button class="thumb__x" type="button" aria-label="Hapus foto">${icon('x')}</button>`;
      t.querySelector('img').addEventListener('click', () =>
        imageViewer(blobUrl(row), `${title} · ${rows.indexOf(row) + 1}`)
      );
      t.querySelector('.thumb__x').addEventListener('click', async () => {
        const ok = await confirmDialog('Hapus foto ini?', 'Foto yang dihapus tidak dapat dikembalikan.', {
          okLabel: 'Hapus',
          okTone: 'danger',
        });
        if (!ok) return;
        await trip.removeMedia(row.id);
        await refresh();
      });
      thumbs.appendChild(t);
    });

    if (rows.length < max) {
      const add = el('button', { class: 'thumb thumb--add', type: 'button', 'aria-label': 'Tambah foto' },
        `${icon('plus')}<span>Tambah</span>`);
      add.addEventListener('click', shoot);
      thumbs.appendChild(add);
    }

    const full = rows.length >= max;
    addBtn.disabled = full;
    galleryBtn.disabled = full;

    if (required) {
      const ok = rows.length > 0;
      badge.className = `badge badge--${ok ? 'ok' : 'warn'}`;
      badge.textContent = ok ? `Lengkap · ${rows.length}` : 'Wajib';
    } else {
      badge.className = `badge badge--${rows.length ? 'ok' : 'info'}`;
      badge.textContent = rows.length ? `${rows.length} foto` : 'Opsional';
    }

    onChange?.(rows);
  }

  async function refresh() {
    rows = await trip.mediaRows(kind);
    render();
    return rows;
  }

  async function save(shots) {
    for (const shot of shots) {
      await trip.addPhoto(kind, shot.blob, { w: shot.w, h: shot.h });
    }
    if (navigator.vibrate) navigator.vibrate(30);
    await refresh();
    toast(`${shots.length} foto ${title.toLowerCase()} tersimpan.`, 'ok');
  }

  async function shoot() {
    if (rows.length >= max) {
      toast(`Maksimal ${max} foto untuk ${title.toLowerCase()}.`, 'warn');
      return;
    }
    try {
      const shot = await capturePhoto({
        title,
        hint: 'Dekatkan kamera, tunggu fokus terkunci, lalu tekan tombol.',
      });
      if (!shot) return;
      if (shot.error) {
        toast(shot.error, 'err', 5200);
        return;
      }
      await withBusy('Menyimpan foto…', () => save([shot]));
    } catch (e) {
      toast(e.message || 'Gagal membuka kamera.', 'err', 5200);
    }
  }

  async function fromGallery() {
    const sisa = max - rows.length;
    if (sisa <= 0) return;
    const files = await pickFromGallery({ multiple: true });
    if (!files.length) return;
    await withBusy('Mengolah foto…', async () => {
      const shots = [];
      for (const file of files.slice(0, sisa)) {
        try {
          shots.push(await compressImageFile(file));
        } catch {
          /* berkas tidak terbaca — lewati */
        }
      }
      if (shots.length) await save(shots);
      else toast('Berkas gambar tidak dapat dibaca.', 'warn');
    });
  }

  addBtn.addEventListener('click', shoot);
  galleryBtn.addEventListener('click', fromGallery);
  scanBtn?.addEventListener('click', () => onScan?.());

  return {
    el: card,
    refresh,
    get rows() {
      return rows;
    },
    destroy() {
      urls.forEach((u) => URL.revokeObjectURL(u));
      urls.clear();
    },
  };
}

/** Baris centang kelengkapan berkas wajib — dipakai di layar serah terima. */
export function checklist(items = []) {
  const box = el('div', { class: 'checklist' });
  items.forEach((it) => {
    const node = el('div', { class: `check ${it.ok ? 'is-ok' : ''}` }, `
      <div class="check__tick">${icon(it.ok ? 'check' : 'clock')}</div>
      <div class="grow">${it.label}</div>
      <div class="check__end">${it.ok ? 'Siap' : 'Belum'}</div>
    `);
    box.appendChild(node);
  });
  return box;
}
