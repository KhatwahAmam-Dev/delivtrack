import { icon } from './icons.js';

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

export function el(tag, attrs = {}, html) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === false || v === null || v === undefined) continue;
    if (k === 'class') node.className = v;
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? '' : String(v));
  }
  if (html !== undefined) node.innerHTML = html;
  return node;
}

export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const uid = (p = 'id') =>
  `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------------- Format ---------------- */

const ID_MONTHS = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];
const ID_DAYS = ['Minggu','Senin','Selasa','Rabu','Kamis','Jumat','Sabtu'];

const pad = (n) => String(n).padStart(2, '0');

export function fmtTime(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function fmtTimeShort(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function fmtDate(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
}

export function fmtDateLong(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  return `${ID_DAYS[d.getDay()]}, ${d.getDate()} ${ID_MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

export function fmtDateTime(ts) {
  if (!ts) return '—';
  return `${fmtDate(ts)} ${fmtTime(ts)}`;
}

export function fmtDuration(ms) {
  if (!ms || ms < 0) return '00:00';
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0 ? `${h}j ${pad(m)}m ${pad(s)}d` : `${pad(m)}m ${pad(s)}d`;
}

export function fmtDurationShort(ms) {
  if (!ms || ms < 0) return '0m';
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  if (h > 0) return `${h}j ${m}m`;
  return `${m}m`;
}

export function fmtDistance(m) {
  if (m === null || m === undefined || Number.isNaN(m)) return '—';
  if (m < 1000) return `${Math.round(m)} m`;
  return `${(m / 1000).toFixed(m < 10000 ? 2 : 1)} km`;
}

export function fmtBytes(b) {
  if (!b) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let v = b;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(i === 0 ? 0 : 1)} ${u[i]}`;
}

export function fmtCoord(lat, lng) {
  if (lat === null || lat === undefined) return '—';
  return `${Number(lat).toFixed(6)}, ${Number(lng).toFixed(6)}`;
}

export function timeAgo(ts) {
  if (!ts) return '—';
  const d = Date.now() - ts;
  if (d < 60_000) return 'baru saja';
  if (d < 3_600_000) return `${Math.floor(d / 60_000)} menit lalu`;
  if (d < 86_400_000) return `${Math.floor(d / 3_600_000)} jam lalu`;
  if (d < 2_592_000_000) return `${Math.floor(d / 86_400_000)} hari lalu`;
  return fmtDate(ts);
}

/* ---------------- Telepon ---------------- */

export function normalizePhone(raw) {
  if (!raw) return '';
  let s = String(raw).replace(/[^\d+]/g, '');
  if (s.startsWith('+')) s = s.slice(1);
  if (s.startsWith('0')) s = `62${s.slice(1)}`;
  else if (s.startsWith('620')) s = `62${s.slice(3)}`;
  else if (s.startsWith('8')) s = `62${s}`;
  return s;
}

export function prettyPhone(raw) {
  const s = normalizePhone(raw);
  if (!s) return '—';
  if (s.startsWith('62')) {
    const rest = s.slice(2);
    return `+62 ${rest.slice(0, 3)}-${rest.slice(3, 7)}-${rest.slice(7)}`.replace(/-$/, '');
  }
  return s;
}

export function isValidPhone(raw) {
  const s = normalizePhone(raw);
  return /^62\d{8,13}$/.test(s);
}

/* ---------------- Berkas ---------------- */

export function safeName(s, fallback = 'berkas') {
  const v = String(s ?? '')
    .normalize('NFKD')
    .replace(/[^\w\s.-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 60);
  return v || fallback;
}

export function slugName(s) {
  return safeName(s).toLowerCase();
}

export function blobToDataURL(blob) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = () => reject(fr.error);
    fr.readAsDataURL(blob);
  });
}

export function dataURLToBlob(dataUrl) {
  const [head, body] = dataUrl.split(',');
  const mime = (head.match(/:(.*?);/) || [, 'application/octet-stream'])[1];
  const bin = atob(body);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

export function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function debounce(fn, ms = 250) {
  let t;
  return (...a) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
}

export function throttle(fn, ms = 500) {
  let last = 0;
  let timer;
  let pending;
  return (...a) => {
    const now = Date.now();
    pending = a;
    if (now - last >= ms) {
      last = now;
      fn(...pending);
    } else if (!timer) {
      timer = setTimeout(() => {
        timer = null;
        last = Date.now();
        fn(...pending);
      }, ms - (now - last));
    }
  };
}

/* ---------------- Template ---------------- */

export function fill(tpl, vars) {
  return String(tpl).replace(/\{\{(\w+)\}\}/g, (_, k) => (vars[k] ?? '').toString());
}

/* ---------------- Unduh gambar dari blob ---------------- */

export async function imageSize(blob) {
  const url = URL.createObjectURL(blob);
  try {
    const img = await new Promise((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = rej;
      i.src = url;
    });
    return { w: img.naturalWidth, h: img.naturalHeight };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/* ---------------- Clipboard ---------------- */

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = el('textarea', { style: 'position:fixed;opacity:0' });
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}

export const iconHtml = icon;
