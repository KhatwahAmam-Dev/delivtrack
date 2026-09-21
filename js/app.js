// DelivTrack — kerangka aplikasi & router layar.
// Layar ditentukan oleh status sesi pengantaran, sehingga deliman selalu
// dikembalikan ke langkah yang benar walau aplikasi sempat tertutup.

import { APP, TRIP_STATE, DEFAULTS } from './config.js';
import { icon } from './icons.js';
import { $, $$, el } from './util.js';
import { toast, confirmDialog } from './ui.js';
import { kv, requestPersistence } from './db.js';
import * as trip from './trip.js';
import * as sync from './sync.js';
import { warmVendor } from './vendor.js';

import setupView from './views/setup.js';
import prepareView from './views/prepare.js';
import routeView from './views/route.js';
import handoverView from './views/handover.js';
import doneView from './views/done.js';
import historyView from './views/history.js';
import settingsView from './views/settings.js';

const VIEWS = {
  setup: setupView,
  prepare: prepareView,
  route: routeView,
  handover: handoverView,
  done: doneView,
  history: historyView,
  settings: settingsView,
};

const TABS = [
  { key: 'home', label: 'Beranda', icon: 'home' },
  { key: 'history', label: 'Riwayat', icon: 'history' },
  { key: 'settings', label: 'Setelan', icon: 'settings' },
];

const NO_TAB = ['prepare', 'route', 'handover', 'done'];

const shell = {
  view: null,
  route: null,
  params: {},
  tab: 'home',
};

/** Paksa muat ulang layar saat ini dengan parameter terbaru. */
export function applyRoute() {
  return go(shell.route, { ...shell.params, changed: true });
}

export const ctx = {
  go,
  applyRoute,
  shell,
  reload: () => mount(shell.route, shell.params, { force: true }),
};

/* ---------------- Tema ---------------- */

async function applyTheme() {
  const settings = await kv.get('settings', {});
  const mode = settings.theme || DEFAULTS.theme || 'auto';
  const root = document.documentElement;
  if (mode === 'auto') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', mode);
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', mode === 'dark' ? '#0b1020' : '#4f46e5');
}

export function setTheme(mode) {
  const root = document.documentElement;
  if (mode === 'auto') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', mode);
}

/* ---------------- Bilah atas & bawah ---------------- */

function paintTabs() {
  $$('#tabbar .tabbar__btn').forEach((btn) => {
    const tab = TABS.find((t) => t.key === btn.dataset.tab);
    btn.innerHTML = `${icon(tab.icon)}<span>${tab.label}</span>`;
    btn.setAttribute('aria-selected', String(shell.tab === tab.key));
  });
}

function paintTopbar(view) {
  const back = $('#btnBack');
  const brand = $('#brandTitle');
  const page = $('#pageTitle');
  const actions = $('#topbarActions');

  if (view.brand !== false) {
    brand.hidden = false;
    page.hidden = true;
  } else {
    brand.hidden = true;
    page.hidden = false;
    $('#topbarTitle').textContent = view.title || APP.name;
    $('#topbarSub').textContent = view.sub || APP.tagline;
  }

  back.hidden = !view.onBack;
  back.innerHTML = icon('chevronLeft');
  back.onclick = view.onBack || null;

  actions.innerHTML = '';
  (view.actions || []).forEach((a) => {
    const b = el('button', {
      class: `topbar__icon ${a.tone ? `topbar__icon--${a.tone}` : ''}`,
      type: 'button',
      'aria-label': a.label,
      title: a.label,
    });
    b.innerHTML = icon(a.icon);
    b.addEventListener('click', () => a.onClick(ctx));
    actions.appendChild(b);
  });

  const tabless = NO_TAB.includes(shell.route);
  $('#tabbar').hidden = tabless || view.tab === false;
  $('#view').classList.toggle('screen--notab', tabless || view.tab === false);
}

function paintNetbar() {
  const bar = $('#netbar');
  const text = $('#netbarText');
  const dot = bar.querySelector('.dotlive');
  const online = navigator.onLine !== false;
  const syncing = !!sync.__syncing;

  if (online && !shell.offlineNotice) {
    bar.hidden = true;
    return;
  }

  bar.hidden = false;
  bar.classList.toggle('netbar--online', online);
  dot.className = `dotlive ${online ? '' : 'dotlive--warn'}`;
  text.textContent = online
    ? syncing
      ? 'Mengunggah data ke Google Drive…'
      : 'Internet kembali tersambung.'
    : 'Mode offline — data disimpan aman di HP dan diunggah otomatis saat internet kembali.';
}

/* ---------------- Pemasangan layar ---------------- */

async function mount(route, params = {}, { force = false } = {}) {
  const view = VIEWS[route];
  if (!view) {
    toast(`Layar "${route}" tidak ditemukan.`, 'err');
    return;
  }
  if (!force && shell.route === route && !params.changed) {
    shell.params = params;
    return;
  }

  if (shell.view?.unmount) {
    try {
      shell.view.unmount();
    } catch (e) {
      console.warn('[app] unmount gagal', e);
    }
  }

  shell.route = route;
  shell.params = {
    get: (k, d = null) => (k in params ? params[k] : d),
    ...params,
  };
  shell.view = view;

  const root = $('#view');
  root.innerHTML = '';
  paintTopbar(view);

  try {
    await view.mount(root, ctx);
  } catch (e) {
    console.error('[app] mount gagal', e);
    root.innerHTML = `
      <div class="empty">
        <div class="empty__ico">${icon('alert')}</div>
        <h3>Layar gagal dibuka</h3>
        <p>${e?.message || 'Terjadi kesalahan tak terduga.'}</p>
      </div>`;
    return;
  }

  paintNetbar();
  root.scrollTo?.({ top: 0 });
  window.scrollTo({ top: 0, behavior: 'instant' in document.body.style ? 'instant' : 'auto' });
}

export async function go(route, params = {}) {
  if (route === 'home') route = await homeRoute();
  if (route === 'history' || route === 'settings') {
    shell.tab = route;
    paintTabs();
  } else {
    shell.tab = 'home';
    paintTabs();
  }
  history.pushState({ route, params }, '', `?s=${route}`);
  await mount(route, params);
  updateExitGuard();
}

/** Layar beranda mengikuti status sesi pengantaran saat ini. */
export async function homeRoute() {
  const t = trip.getTrip();
  if (!t) return 'setup';
  switch (t.state) {
    case TRIP_STATE.READY:
      return 'prepare';
    case TRIP_STATE.EN_ROUTE:
      return 'route';
    case TRIP_STATE.ARRIVED:
      return 'handover';
    case TRIP_STATE.DONE:
      return 'done';
    default:
      return 'setup';
  }
}

/* ---------------- Penjaga keluar aplikasi ---------------- */

function updateExitGuard() {
  const t = trip.getTrip();
  const guard = !!t && t.state === TRIP_STATE.EN_ROUTE;
  window.onbeforeunload = guard
    ? (e) => {
        e.preventDefault();
        e.returnValue = 'Pengantaran sedang berjalan. Yakin keluar dari aplikasi?';
        return e.returnValue;
      }
    : null;
}

/* ---------------- Navigasi peramban ---------------- */

function wireNavigation() {
  window.addEventListener('popstate', async (e) => {
    const target = e.state?.route;
    const t = trip.getTrip();

    if (t && [TRIP_STATE.EN_ROUTE, TRIP_STATE.ARRIVED].includes(t.state)) {
      const stay = await confirmDialog(
        'Pengantaran belum selesai',
        'Sesi pengantaran masih berjalan. Menekan kembali tidak menghentikan perekaman, tetapi sebaiknya tetap di layar ini.',
        { okLabel: 'Tetap di sini', cancelLabel: 'Tutup', showCancel: false }
      );
      if (stay) return;
    }

    const fallback = await homeRoute();
    if (target && VIEWS[target] && target === shell.route) return;
    mount(target || shell.route || fallback, {}, { force: true });
  });

  $('#btnBack').addEventListener('click', async () => {
    const view = shell.view;
    if (view?.onBack) {
      const done = await view.onBack(ctx);
      if (done) history.back();
      return;
    }
    history.back();
  });

  $('#tabbar').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-tab]');
    if (!btn) return;
    go(btn.dataset.tab === 'home' ? 'home' : btn.dataset.tab);
  });

  document.addEventListener('scroll', () => {
    $('#topbar').classList.toggle('is-scrolled', window.scrollY > 6);
  });
}

/* ---------------- Jaringan ---------------- */

function wireNetwork() {
  const update = () => paintNetbar();

  window.addEventListener('online', () => {
    shell.offlineNotice = false;
    update();
  });

  window.addEventListener('offline', () => {
    shell.offlineNotice = true;
    update();
  });

  setInterval(() => {
    if (navigator.onLine !== false && !sync.__syncing) {
      shell.offlineNotice = false;
      paintNetbar();
    }
  }, 6000);
}

/* ---------------- Awal ---------------- */

async function boot() {
  paintTabs();
  wireNavigation();
  wireNetwork();
  await applyTheme();
  await requestPersistence();

  // Layar awal mengikuti tautan pintasan atau status sesi yang tersimpan.
  const params = new URLSearchParams(location.search);
  const action = params.get('action');

  if (!(await kv.get('settings', null))) await kv.set('settings', { ...DEFAULTS });

  try {
    const resumed = await trip.resumeActiveTrip();
    if (resumed) {
      const label = trip.stateLabel(resumed.state);
      toast(`Melanjutkan sesi ${resumed.id} — ${label}.`, 'info', 4200);
    }
  } catch (e) {
    console.warn('[app] gagal memulihkan sesi', e);
  }

  const start = action === 'history' ? 'history' : action === 'settings' ? 'settings' : await homeRoute();
  await mount(start, {}, { force: true });
  updateExitGuard();

  sync.startSyncWatcher();
  warmVendor(['leaflet', 'zxing']);
  watchSyncStatus();

  // Pastikan sesi benar-benar tersimpan saat aplikasi disembunyikan.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && trip.getTrip()) trip.flushNow();
  });

  const t = trip.getTrip();
  if (t && t.state === TRIP_STATE.EN_ROUTE) {
    toast('Perekaman perjalanan aktif. Aplikasi tetap menyimpan data walau Anda membuka Google Maps.', 'ok', 5200);
  }
}

function watchSyncStatus() {
  sync.syncEvents.on((evt) => {
    if (evt.type === 'start') {
      sync.__syncing = true;
      paintNetbar();
    }
    if (evt.type === 'end' || evt.type === 'job-error') {
      sync.__syncing = false;
      paintNetbar();
      if (evt.type === 'end' && evt.done) toast(`${evt.done} transaksi terunggah ke Google Drive.`, 'ok');
      if (evt.type === 'job-error') toast(`Unggahan tertunda: ${evt.error?.message || 'gagal'}`, 'warn', 4600);
    }
    if (evt.type === 'trip-synced' && shell.route === 'done') applyRoute();
  });
}

window.addEventListener('error', (e) => {
  if (e.message?.includes('ResizeObserver')) return;
  console.warn('[window.error]', e.message);
});

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => boot().catch(onBootError));
} else {
  boot().catch(onBootError);
}

function onBootError(e) {
  console.error(e);
  toast(`Aplikasi gagal dimulai: ${e.message}`, 'err', 6000);
}
