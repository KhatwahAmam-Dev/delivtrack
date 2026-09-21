// Integrasi Google Drive: arsip PDF, foto, dan rekap ke folder terstruktur.
// Memakai Google Identity Services (OAuth 2.0 token model) + Drive REST API v3.

import { kv } from './db.js';
import { safeName } from './util.js';

const SCOPE = 'https://www.googleapis.com/auth/drive.file';
const GIS_SRC = 'https://accounts.google.com/gsi/client';
const TOKEN_KEY = 'drive_token';
const FOLDER_MIME = 'application/vnd.google-apps.folder';
const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';

let gisPromise = null;
let tokenClient = null;
let token = null; // { access_token, expires_at, scope }
let connectResolve = null;

/* ---------------- Pemuatan pustaka ---------------- */

function loadGis() {
  if (gisPromise) return gisPromise;
  gisPromise = new Promise((resolve, reject) => {
    if (window.google?.accounts?.oauth2) return resolve(window.google.accounts.oauth2);
    const s = document.createElement('script');
    s.src = GIS_SRC;
    s.async = true;
    s.defer = true;
    s.onload = () => {
      if (window.google?.accounts?.oauth2) resolve(window.google.accounts.oauth2);
      else reject(new Error('Google Identity gagal dimuat.'));
    };
    s.onerror = () => reject(new Error('Tidak dapat memuat Google Identity. Periksa koneksi internet.'));
    document.head.appendChild(s);
  });
  return gisPromise;
}

/* ---------------- Konfigurasi & status ---------------- */

export async function driveClientId() {
  return (await kv.get('driveClientId', '')) || '';
}

export async function setDriveClientId(id) {
  await kv.set('driveClientId', (id || '').trim());
  tokenClient = null;
  return id;
}

export async function isConfigured() {
  return !!(await driveClientId());
}

async function loadToken() {
  if (token) return token;
  const saved = await kv.get(TOKEN_KEY, null);
  if (saved && saved.expires_at > Date.now() + 30_000) token = saved;
  return token;
}

export async function isConnected() {
  return !!(await loadToken());
}

export async function accountInfo() {
  const t = await loadToken();
  if (!t) return null;
  try {
    const res = await fetch(`${API}/about?fields=user,storageQuota`, {
      headers: { Authorization: `Bearer ${t.access_token}` },
    });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

export async function signOut() {
  try {
    const t = await loadToken();
    if (t && window.google?.accounts?.oauth2) {
      window.google.accounts.oauth2.revoke(t.access_token, () => {});
    }
  } catch { /* diabaikan */ }
  token = null;
  await kv.del(TOKEN_KEY);
}

/* ---------------- Otorisasi ---------------- */

export async function ensureToken({ interactive = false } = {}) {
  const existing = await loadToken();
  if (existing) return existing.access_token;

  const clientId = await driveClientId();
  if (!clientId) {
    throw new Error('Client ID Google Drive belum diatur. Buka Setelan → Google Drive.');
  }
  if (!navigator.onLine) {
    throw new Error('Butuh internet untuk menyambungkan ke Google Drive.');
  }

  const oauth2 = await loadGis();

  if (!interactive) {
    // Coba perpanjang tanpa popup (berhasil bila sesi Google masih aktif).
    try {
      return await new Promise((resolve, reject) => {
        const c = oauth2.initTokenClient({
          client_id: clientId,
          scope: SCOPE,
          prompt: '',
          callback: (resp) => (resp.access_token ? resolve(resp) : reject(new Error(resp.error || 'gagal'))),
          error_callback: (err) => reject(new Error(err?.message || 'gagal')),
        });
        c.requestAccessToken({ prompt: '' });
      }).then(async (resp) => {
        token = { ...resp, expires_at: Date.now() + (Number(resp.expires_in || 3600) - 60) * 1000 };
        await kv.set(TOKEN_KEY, token);
        return token.access_token;
      });
    } catch {
      throw new Error('Sesi Google Drive berakhir. Buka Setelan → Google Drive → Sambungkan ulang.');
    }
  }

  // Interaktif: tampilkan popup pemilihan akun.
  return new Promise((resolve, reject) => {
    if (!tokenClient) {
      tokenClient = oauth2.initTokenClient({
        client_id: clientId,
        scope: SCOPE,
        callback: async (resp) => {
          if (resp.error) {
            connectResolve?.(null);
            connectResolve = null;
            reject(new Error(resp.error_description || resp.error));
            return;
          }
          token = { ...resp, expires_at: Date.now() + (Number(resp.expires_in || 3600) - 60) * 1000 };
          await kv.set(TOKEN_KEY, token);
          connectResolve?.(token);
          connectResolve = null;
          resolve(token.access_token);
        },
        error_callback: (err) => {
          connectResolve?.(null);
          connectResolve = null;
          reject(new Error(err?.message || 'Otorisasi Google dibatalkan.'));
        },
      });
    }
    tokenClient.requestAccessToken({ prompt: 'consent' });
  });
}

export async function connect() {
  token = null;
  await kv.del(TOKEN_KEY);
  const at = await ensureToken({ interactive: true });
  return !!at;
}

/* ---------------- Helper REST ---------------- */

async function api(path, { method = 'GET', body, headers = {} } = {}) {
  const at = await ensureToken({ interactive: false });
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${at}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (res.status === 401) {
    token = null;
    await kv.del(TOKEN_KEY);
    throw new Error('Sesi Google Drive berakhir. Sambungkan ulang di Setelan.');
  }
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`Drive API ${res.status}: ${txt.slice(0, 200)}`);
  }
  if (res.status === 204) return {};
  return res.json();
}

const q = (s) => encodeURIComponent(s).replace(/%27/g, "'");

export async function findFolder(name, parentId = null) {
  const parts = [
    `name = '${name.replace(/'/g, "\\'")}'`,
    `mimeType = '${FOLDER_MIME}'`,
    'trashed = false',
  ];
  if (parentId) parts.push(`'${parentId}' in parents`);
  const data = await api(`/files?q=${q(parts.join(' and '))}&fields=files(id,name)&pageSize=5`);
  return data.files?.[0] || null;
}

export async function createFolder(name, parentId = null) {
  return api('/files?fields=id,name,webViewLink', {
    method: 'POST',
    body: { name, mimeType: FOLDER_MIME, parents: parentId ? [parentId] : undefined },
  });
}

export async function ensureFolderPath(segments, { onStep } = {}) {
  let parent = null;
  for (const seg of segments) {
    const name = safeName(seg, 'Folder');
    onStep?.(`Menyiapkan folder ${name}…`);
    let found = await findFolder(name, parent);
    if (!found) found = await createFolder(name, parent);
    parent = found.id;
  }
  return parent;
}

function buildMultipart(metadata, blob, boundary) {
  const head = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`;
  const mid = `--${boundary}\r\nContent-Type: ${blob.type || 'application/octet-stream'}\r\n\r\n`;
  const tail = `\r\n--${boundary}--`;
  return new Blob([head, mid, blob, tail]);
}

/**
 * Unggah satu berkas. Mengembalikan metadata termasuk tautan.
 */
export async function uploadFile(blob, name, { folderId = null, makePublic = false } = {}) {
  const at = await ensureToken({ interactive: false });
  const boundary = `dt${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
  const metadata = { name, ...(folderId ? { parents: [folderId] } : {}) };
  const payload = buildMultipart(metadata, blob, boundary);

  const res = await fetch(
    `${UPLOAD}/files?uploadType=multipart&fields=id,name,webViewLink,size,createdTime`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${at}`,
        'Content-Type': `multipart/related; boundary=${boundary}`,
      },
      body: payload,
    }
  );

  if (res.status === 401) {
    token = null;
    await kv.del(TOKEN_KEY);
    throw new Error('Sesi Google Drive berakhir. Sambungkan ulang di Setelan.');
  }
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    if (res.status === 403 && /storageQuota/i.test(txt)) {
      throw new Error('Kuota Google Drive penuh. Kosongkan sebagian ruang lalu coba lagi.');
    }
    throw new Error(`Unggah gagal (${res.status}): ${txt.slice(0, 180)}`);
  }

  const file = await res.json();

  if (makePublic && file.id) {
    try {
      await api(`/files/${file.id}/permissions`, {
        method: 'POST',
        body: { role: 'reader', type: 'anyone' },
      });
    } catch { /* tautan tetap privat bila gagal */ }
  }

  return file;
}

export async function deleteFile(fileId) {
  return api(`/files/${fileId}`, { method: 'DELETE' });
}

/** Folder arsip: <NamaFolder>/<YYYY-MM>/<ID-TRIP> */
export async function tripFolder(trip, rootName = 'DelivTrack') {
  const dt = new Date(trip.startedAt || trip.createdAt || Date.now());
  const month = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`;
  return ensureFolderPath([rootName, month, trip.id]);
}

export const DRIVE_SCOPE = SCOPE;
