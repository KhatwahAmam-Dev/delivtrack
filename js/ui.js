import { icon } from './icons.js';
import { el, $ } from './util.js';

/* ---------------- Toast ---------------- */

function toastHost() {
  let host = $('#toast-host');
  if (!host) {
    host = el('div', { id: 'toast-host', class: 'toast-host', role: 'status', 'aria-live': 'polite' });
    document.body.appendChild(host);
  }
  return host;
}

const TOAST_ICON = {
  ok: 'checkCircle',
  err: 'alert',
  warn: 'alert',
  info: 'info',
};

export function toast(message, type = 'info', ms = 3200) {
  const host = toastHost();
  const node = el(
    'div',
    { class: `toast toast--${type}` },
    `${icon(TOAST_ICON[type] || 'info')}<div>${message}</div>`
  );
  host.appendChild(node);
  setTimeout(() => {
    node.classList.add('out');
    setTimeout(() => node.remove(), 240);
  }, ms);
  return node;
}

/* ---------------- Busy overlay ---------------- */

let busyCount = 0;
let busyNode = null;

export function busy(text = 'Memproses…') {
  busyCount++;
  if (busyNode) {
    $('.busy__label', busyNode).textContent = text;
    return;
  }
  busyNode = el(
    'div',
    { class: 'busy', role: 'alertdialog', 'aria-busy': 'true' },
    `<div class="busy__box"><div class="spinner"></div><div class="busy__label">${text}</div></div>`
  );
  document.body.appendChild(busyNode);
}

export function unbusy() {
  busyCount = Math.max(0, busyCount - 1);
  if (busyCount === 0 && busyNode) {
    busyNode.remove();
    busyNode = null;
  }
}

/**
 * Perbarui teks overlay tanpa mengubah hitungan. Dipakai untuk laporan progres
 * dari proses panjang — memanggil `busy()` berulang akan mengunci overlay
 * karena `unbusy()` pemanggilnya hanya berjalan sekali.
 */
export function busyText(text) {
  if (busyNode) $('.busy__label', busyNode).textContent = text;
}

export async function withBusy(text, fn) {
  busy(text);
  try {
    return await fn();
  } finally {
    unbusy();
  }
}

/* ---------------- Overlay dasar ---------------- */

function mountOverlay(inner, { onClose, dismissible = true } = {}) {
  const scrim = el('div', { class: 'scrim' });
  const host = el('div', { id: 'overlay-host' });
  host.appendChild(inner);

  let closed = false;
  const close = (value) => {
    if (closed) return;
    closed = true;
    scrim.style.animation = 'fade-in 160ms reverse';
    inner.style.opacity = '0';
    setTimeout(() => {
      scrim.remove();
      host.remove();
    }, 150);
    onClose?.(value);
  };

  if (dismissible) scrim.addEventListener('click', () => close(null));
  document.body.appendChild(scrim);
  document.body.appendChild(host);

  const onKey = (e) => {
    if (e.key === 'Escape') {
      close(null);
      document.removeEventListener('keydown', onKey);
    }
  };
  document.addEventListener('keydown', onKey);

  return { close, scrim, host, inner };
}

/* ---------------- Sheet ---------------- */

/**
 * Bottom sheet serbaguna.
 * @returns {{close: Function, body: HTMLElement, root: HTMLElement}}
 */
export function sheet({ title, subtitle, body = '', footer = '', dismissible = true, onClose } = {}) {
  const node = el('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true' });
  node.innerHTML = `
    <div class="sheet__grip"></div>
    <div class="sheet__head">
      <div class="grow">
        <h2>${title || ''}</h2>
        ${subtitle ? `<p>${subtitle}</p>` : ''}
      </div>
      ${dismissible ? `<button class="btn btn--icon btn--ghost" data-role="x" aria-label="Tutup">${icon('x')}</button>` : ''}
    </div>
    <div class="sheet__body">${body}</div>
    ${footer ? `<div class="sheet__foot">${footer}</div>` : ''}
  `;

  const handle = mountOverlay(node, { dismissible, onClose });
  const bodyEl = $('.sheet__body', node);
  if (typeof body === 'string' && body.trim().startsWith('<')) {
    // sudah berupa HTML
  }
  $('[data-role="x"]', node)?.addEventListener('click', () => handle.close(null));

  handle.body = bodyEl;
  handle.root = node;
  return handle;
}

/* ---------------- Modal ---------------- */

export function modal({ title, text, iconName = 'alert', tone = 'brand', okLabel = 'Lanjut', cancelLabel = 'Batal', okTone = 'primary', showCancel = true, extraHtml = '' } = {}) {
  return new Promise((resolve) => {
    const node = el('div', { class: 'modal', role: 'alertdialog', 'aria-modal': 'true' });
    node.innerHTML = `
      <div class="modal__body">
        <div class="modal__ico modal__ico--${tone}">${icon(iconName)}</div>
        <div class="modal__title">${title || ''}</div>
        ${text ? `<div class="modal__text">${text}</div>` : ''}
        ${extraHtml}
      </div>
      <div class="modal__foot">
        ${showCancel ? `<button class="btn" data-role="cancel">${cancelLabel}</button>` : ''}
        <button class="btn btn--${okTone}" data-role="ok">${okLabel}</button>
      </div>
    `;
    const handle = mountOverlay(node, { dismissible: false, onClose: resolve });
    $('[data-role="ok"]', node).addEventListener('click', () => handle.close(true));
    $('[data-role="cancel"]', node)?.addEventListener('click', () => handle.close(false));
    setTimeout(() => $('[data-role="ok"]', node)?.focus(), 80);
  });
}

export function confirmDialog(title, text, opts = {}) {
  return modal({ title, text, iconName: 'alert', tone: 'warn', ...opts });
}

/* ---------------- Prompt teks ---------------- */

export function promptDialog({ title, label = 'Nilai', value = '', placeholder = '', okLabel = 'Simpan', type = 'text', inputMode, hint = '' } = {}) {
  return new Promise((resolve) => {
    const node = el('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true' });
    node.innerHTML = `
      <div class="modal__body">
        <div class="modal__title">${title}</div>
        <div class="field" style="margin-top:12px;margin-bottom:0">
          <label class="field__label" for="prompt-input">${label}</label>
          <input class="input" id="prompt-input" type="${type}" value="${value ?? ''}" placeholder="${placeholder}" ${inputMode ? `inputmode="${inputMode}"` : ''} />
          ${hint ? `<div class="field__hint">${hint}</div>` : ''}
        </div>
      </div>
      <div class="modal__foot">
        <button class="btn" data-role="cancel">Batal</button>
        <button class="btn btn--primary" data-role="ok">${okLabel}</button>
      </div>
    `;
    const handle = mountOverlay(node, { dismissible: false, onClose: resolve });
    const input = $('#prompt-input', node);
    const submit = () => handle.close(input.value.trim() || null);
    $('[data-role="ok"]', node).addEventListener('click', submit);
    $('[data-role="cancel"]', node).addEventListener('click', () => handle.close(null));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') submit();
    });
    setTimeout(() => input.focus(), 90);
  });
}

/* ---------------- Preview gambar ---------------- */

export function imageViewer(src, caption = '') {
  const node = el('div', { class: 'modal', style: 'max-width:min(96vw,720px);background:transparent;box-shadow:none' });
  node.innerHTML = `
    <img src="${src}" alt="${caption}" style="width:100%;border-radius:18px;box-shadow:var(--sh-3)" />
    ${caption ? `<p style="text-align:center;color:#fff;font-size:13px;margin-top:10px;text-shadow:0 1px 6px rgba(0,0,0,.6)">${caption}</p>` : ''}
  `;
  const handle = mountOverlay(node, { dismissible: true, onClose: () => {} });
  node.addEventListener('click', () => handle.close(null));
  return handle;
}

/* ---------------- Utilitas form ---------------- */

export function readForm(root) {
  const out = {};
  root.querySelectorAll('[name]').forEach((f) => {
    const key = f.dataset.key || f.name;
    if (f.type === 'checkbox') out[key] = f.checked;
    else if (f.type === 'number') out[key] = f.value === '' ? null : Number(f.value);
    else out[key] = f.value.trim();
  });
  return out;
}

export function markInvalid(root, errors) {
  root.querySelectorAll('.field__err').forEach((n) => n.remove());
  root.querySelectorAll('[aria-invalid]').forEach((n) => n.removeAttribute('aria-invalid'));

  const first = Object.keys(errors)[0];
  for (const [name, msg] of Object.entries(errors)) {
    const f = root.querySelector(`[name="${name}"]`);
    if (!f) continue;
    f.setAttribute('aria-invalid', 'true');
    const wrap = f.closest('.field') || f.parentElement;
    const err = el('div', { class: 'field__err' }, `${icon('alert')} ${msg}`);
    err.style.display = 'flex';
    err.style.gap = '5px';
    err.style.alignItems = 'center';
    wrap.appendChild(err);
  }
  if (first) {
    const f = root.querySelector(`[name="${first}"]`);
    f?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    f?.focus({ preventScroll: true });
  }
  return !first;
}

/* ---------------- Pilihan dari daftar ---------------- */

export function actionSheet({ title, subtitle, actions = [] }) {
  return new Promise((resolve) => {
    const html = `<ul class="list">${actions
      .map(
        (a, i) => `
      <li>
        <button class="row row--tap" data-i="${i}" style="width:100%;text-align:left">
          <div class="row__ico ${a.tone ? `row__ico--${a.tone}` : ''}">${icon(a.icon || 'chevronRight')}</div>
          <div class="row__body">
            <div class="row__title">${a.label}</div>
            ${a.hint ? `<div class="row__sub">${a.hint}</div>` : ''}
          </div>
          <div class="row__end">${icon('chevronRight')}</div>
        </button>
      </li>`
      )
      .join('')}</ul>`;

    const s = sheet({ title, subtitle, body: html });
    s.body.addEventListener('click', (ev) => {
      const btn = ev.target.closest('[data-i]');
      if (!btn) return;
      const action = actions[Number(btn.dataset.i)];
      s.close(action?.value ?? null);
      resolve(action?.value ?? null);
    });
    s.root.addEventListener('click', (ev) => {
      if (ev.target.closest('[data-role="x"]')) resolve(null);
    });
  });
}
