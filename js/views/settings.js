// Tab Setelan — data tetap deliman, integrasi Google Drive, tampilan,
// dan pemeliharaan penyimpanan lokal.

import { APP, DEFAULTS } from '../config.js';
import { icon } from '../icons.js';
import { $, download, esc, fmtBytes, fmtDateTime, isValidPhone, prettyPhone, safeName } from '../util.js';
import { confirmDialog, modal, toast, withBusy } from '../ui.js';
import { exportAll, kv, media, requestPersistence, storageEstimate, wipeAll } from '../db.js';
import * as drive from '../drive.js';
import * as sync from '../sync.js';

let installPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installPrompt = e;
});

export default {
  title: 'Setelan',
  sub: 'Perangkat & integrasi',
  brand: false,
  tab: true,

  async mount(root, ctx) {
    this._ctx = ctx;
    const s = { ...DEFAULTS, ...((await kv.get('settings', {})) || {}) };

    root.innerHTML = `
      <section class="section">
        <div class="section__head">
          <div class="section__title">Data Tetap Deliman</div>
          <div class="section__line"></div>
        </div>
        <div class="card card__pad">
          <div class="field">
            <label class="field__label" for="s-crew-nama">${icon('user')} Nama Lengkap</label>
            <input class="input" id="s-crew-nama" value="${esc(s.crewNama || '')}" placeholder="Nama deliman" />
          </div>
          <div class="field">
            <label class="field__label" for="s-crew-hp">${icon('phone')} Nomor HP Deliman</label>
            <input class="input" id="s-crew-hp" type="tel" inputmode="numeric" value="${esc(s.crewHp || '')}" placeholder="08xxxxxxxxxx" />
          </div>
          <div class="field">
            <label class="field__label" for="s-kantor-nama">${icon('store')} Nama Kantor</label>
            <input class="input" id="s-kantor-nama" value="${esc(s.kantorNama || '')}" placeholder="Contoh: Toko Sejahtera Cabang Utama" />
          </div>
          <div class="field" style="margin-bottom:0">
            <label class="field__label" for="s-kantor-nomor">${icon('whatsapp')} Nomor Kantor (tujuan laporan)</label>
            <input class="input" id="s-kantor-nomor" type="tel" inputmode="numeric" value="${esc(s.kantorNomor || '')}" placeholder="08xxxxxxxxxx" />
            <div class="field__hint">Dipakai sebagai nilai awal saat membuat pengantaran baru.</div>
          </div>
          <button class="btn btn--primary btn--block mt-12" id="btnSaveCrew" type="button">${icon('check')} Simpan Data Tetap</button>
        </div>
      </section>

      <section class="section">
        <div class="section__head">
          <div class="section__title">Google Drive (Arsip Cloud)</div>
          <div class="section__line"></div>
        </div>
        <div class="card card__pad">
          <div id="driveStatus"></div>
          <div class="field mt-12">
            <label class="field__label" for="s-client">${icon('key')} OAuth Client ID</label>
            <input class="input mono" id="s-client" value="${esc(await drive.driveClientId())}" placeholder="xxxxxxxx.apps.googleusercontent.com" />
            <div class="field__hint">
              Buat di Google Cloud Console → APIs &amp; Services → Credentials → OAuth client ID (tipe <b>Web application</b>),
              lalu tambahkan alamat aplikasi ini ke <b>Authorized JavaScript origins</b>.
            </div>
          </div>
          <div class="field">
            <label class="field__label" for="s-folder">${icon('cloud')} Nama Folder Induk</label>
            <input class="input" id="s-folder" value="${esc(s.driveFolderName || 'DelivTrack')}" placeholder="DelivTrack" />
            <div class="field__hint">Struktur arsip: <b>Folder Induk / Bulan / ID Transaksi</b>.</div>
          </div>
          <div class="card__pad" style="padding:0">
            <label class="switch">
              <div class="switch__text">
                <b>Unggah otomatis</b>
                <span>Kirim berkas begitu internet tersambung kembali.</span>
              </div>
              <input type="checkbox" id="s-autoupload" ${s.autoUpload !== false ? 'checked' : ''} />
              <span class="switch__track"></span>
            </label>
            <label class="switch">
              <div class="switch__text">
                <b>Tautan publik</b>
                <span>Berkas bisa dibuka siapa pun yang memiliki tautan (memudahkan kantor mengunduh).</span>
              </div>
              <input type="checkbox" id="s-public" ${s.drivePublicLinks !== false ? 'checked' : ''} />
              <span class="switch__track"></span>
            </label>
          </div>
          <div class="btnrow mt-12">
            <button class="btn btn--soft" id="btnConnect" type="button">${icon('drive')} Sambungkan</button>
            <button class="btn btn--ghost" id="btnSignout" type="button">${icon('logOut')} Putuskan</button>
          </div>
          <button class="btn btn--soft btn--block mt-8" id="btnFlush" type="button">${icon('upload')} Unggah Antrean Sekarang</button>
          <div id="queueInfo" class="mt-12"></div>
        </div>
      </section>

      <section class="section">
        <div class="section__head">
          <div class="section__title">Tampilan</div>
          <div class="section__line"></div>
        </div>
        <div class="card card__pad">
          <div class="chips" id="themeChips"></div>
          <p class="field__hint" style="margin-bottom:0">Mode otomatis mengikuti pengaturan gelap/terang HP Anda.</p>
        </div>
      </section>

      <section class="section">
        <div class="section__head">
          <div class="section__title">Penyimpanan di HP</div>
          <div class="section__line"></div>
        </div>
        <div class="card card__pad">
          <div id="storageInfo"></div>
          <div class="btnrow mt-12">
            <button class="btn btn--soft" id="btnBackup" type="button">${icon('download')} Cadangkan Data</button>
            <button class="btn btn--ghost" id="btnPersist" type="button">${icon('shield')} Kunci Penyimpanan</button>
          </div>
          <button class="btn btn--danger btn--block mt-8" id="btnWipe" type="button">${icon('trash')} Hapus Semua Data di HP</button>
          <p class="field__hint" style="margin-bottom:0">
            Foto, tanda tangan, dan PDF disimpan di HP Anda agar tetap aman saat offline, lalu diunggah ke Google Drive.
          </p>
        </div>
      </section>

      <section class="section">
        <div class="section__head">
          <div class="section__title">Tentang Aplikasi</div>
          <div class="section__line"></div>
        </div>
        <div class="card card__pad">
          <div class="kv">
            <div class="kv__k">Aplikasi</div><div class="kv__v">${esc(APP.name)} v${esc(APP.version)}</div>
            <div class="kv__k">Mode</div><div class="kv__v">Progressive Web App (offline-first)</div>
            <div class="kv__k">Peta</div><div class="kv__v">OpenStreetMap (gratis, tanpa API key)</div>
          </div>
          <button class="btn btn--soft btn--block mt-12" id="btnInstall" type="button" hidden>
            ${icon('sparkles')} Pasang Aplikasi ke Layar Utama
          </button>
          <div class="banner banner--info mt-12">
            ${icon('info')}
            <div>Pasang ke layar utama agar aplikasi tidak mudah tertutup dan perekaman perjalanan lebih stabil.</div>
          </div>
        </div>
      </section>

      <div style="height:12px"></div>
    `;

    /* ---- Status Drive ---- */
    await paintDrive(root);

    /* ---- Simpan data tetap ---- */
    $('#btnSaveCrew', root).addEventListener('click', async () => {
      const crewHp = $('#s-crew-hp', root).value.trim();
      const kantorNomor = $('#s-kantor-nomor', root).value.trim();
      if (crewHp && !isValidPhone(crewHp)) return toast('Nomor HP deliman tidak valid.', 'warn');
      if (kantorNomor && !isValidPhone(kantorNomor)) return toast('Nomor kantor tidak valid.', 'warn');

      await kv.set('settings', {
        ...((await kv.get('settings', {})) || {}),
        crewNama: $('#s-crew-nama', root).value.trim(),
        crewHp: crewHp ? prettyPhone(crewHp) : '',
        kantorNama: $('#s-kantor-nama', root).value.trim(),
        kantorNomor: kantorNomor ? prettyPhone(kantorNomor) : '',
      });
      toast('Data tetap disimpan.', 'ok');
    });
    ['s-crew-hp', 's-kantor-nomor'].forEach((id) => {
      const f = $(`#${id}`, root);
      f.addEventListener('blur', () => {
        if (f.value.trim()) f.value = prettyPhone(f.value);
      });
    });

    /* ---- Drive: client id, folder, switch ---- */
    $('#s-client', root).addEventListener('change', async () => {
      await drive.setDriveClientId($('#s-client', root).value);
      toast('Client ID disimpan.', 'ok');
      await paintDrive(root);
    });

    const patch = async (key, value) => {
      await kv.set('settings', { ...((await kv.get('settings', {})) || {}), [key]: value });
    };

    $('#s-folder', root).addEventListener('change', async () => {
      await patch('driveFolderName', $('#s-folder', root).value.trim() || 'DelivTrack');
      toast('Nama folder disimpan.', 'ok');
    });
    $('#s-autoupload', root).addEventListener('change', (e) => patch('autoUpload', e.target.checked));
    $('#s-public', root).addEventListener('change', (e) => {
      patch('drivePublicLinks', e.target.checked);
      toast(
        e.target.checked
          ? 'Tautan berkas akan dapat dibuka siapa pun yang memilikinya.'
          : 'Tautan berkas hanya bisa dibuka akun yang tersambung.',
        'info',
        4200
      );
    });

    $('#btnConnect', root).addEventListener('click', async () => {
      try {
        await withBusy('Menyambungkan ke Google…', async () => {
          await drive.setDriveClientId($('#s-client', root).value);
          await drive.connect();
        });
        toast('Google Drive tersambung.', 'ok');
        await paintDrive(root);
      } catch (e) {
        toast(e.message, 'err', 6000);
      }
    });

    $('#btnSignout', root).addEventListener('click', async () => {
      const ok = await confirmDialog('Putuskan Google Drive?', 'Arsip otomatis akan berhenti sampai Anda menyambungkan ulang.');
      if (!ok) return;
      await drive.signOut();
      toast('Sambungan Google Drive diputus.', 'ok');
      await paintDrive(root);
    });

    $('#btnFlush', root).addEventListener('click', async () => {
      const res = await withBusy('Mengunggah ke Google Drive…', () => sync.retryAllNow()).catch((e) => {
        toast(e.message, 'err', 5000);
        return null;
      });
      if (res && !res.skipped) await paintQueue(root);
    });

    /* ---- Tema ---- */
    paintThemes(root, s.theme || 'auto');

    /* ---- Penyimpanan ---- */
    await paintStorage(root);

    $('#btnBackup', root).addEventListener('click', async () => {
      try {
        const data = await withBusy('Menyiapkan cadangan…', () => exportAll());
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        download(blob, `${APP.name}_cadangan_${safeName(fmtDateTime(Date.now()))}.json`);
        toast('Cadangan data diunduh (tanpa berkas foto).', 'ok', 5000);
      } catch (e) {
        toast(e.message, 'err', 5000);
      }
    });

    $('#btnPersist', root).addEventListener('click', async () => {
      const ok = await requestPersistence();
      toast(
        ok
          ? 'Penyimpanan terkunci — data tidak akan dihapus otomatis oleh sistem.'
          : 'Peramban belum memberi izin penyimpanan permanen. Pasang aplikasi ke layar utama untuk hasil terbaik.',
        ok ? 'ok' : 'warn',
        5200
      );
    });

    $('#btnWipe', root).addEventListener('click', async () => {
      const ok = await modal({
        title: 'Hapus semua data di HP?',
        text: 'Seluruh transaksi, foto, tanda tangan, dan PDF di perangkat ini akan dihapus. Berkas yang sudah terunggah ke Google Drive tidak terpengaruh.',
        iconName: 'trash',
        tone: 'danger',
        okLabel: 'Hapus Semua',
        okTone: 'danger',
      });
      if (!ok) return;
      await withBusy('Menghapus data…', () => wipeAll());
      await kv.set('settings', { ...DEFAULTS, theme: s.theme || DEFAULTS.theme });
      toast('Data lokal dihapus.', 'ok');
      await paintStorage(root);
      await paintQueue(root);
    });

    /* ---- Install PWA ---- */
    const installBtn = $('#btnInstall', root);
    installBtn.hidden = isStandalone();
    installBtn.addEventListener('click', async () => {
      if (!installPrompt) {
        toast('Gunakan menu peramban → "Tambahkan ke layar utama".', 'info', 5200);
        return;
      }
      installPrompt.prompt();
      const choice = await installPrompt.userChoice;
      installPrompt = null;
      installBtn.hidden = true;
      toast(choice?.outcome === 'accepted' ? 'Aplikasi dipasang.' : 'Pemasangan dibatalkan.', choice?.outcome === 'accepted' ? 'ok' : 'info');
    });

    this._off = sync.syncEvents.on((evt) => {
      if (['start', 'end', 'job-done', 'job-error', 'trip-synced', 'queued'].includes(evt.type)) {
        paintQueue(root).catch(() => {});
        paintDrive(root).catch(() => {});
      }
    });
  },

  unmount() {
    this._off?.();
    this._off = null;
  },

  async onBack() {
    return true;
  },
};

/* ---------------- Bagian dinamis ---------------- */

async function paintDrive(root) {
  const box = $('#driveStatus', root);
  if (!box) return;
  const configured = await drive.isConfigured();
  const connected = await drive.isConnected();
  const info = connected ? await drive.accountInfo() : null;

  let cls = 'badge--warn';
  let label = 'Client ID belum diatur';
  let ico = 'key';
  if (configured && !connected) {
    cls = 'badge--info';
    label = 'Siap disambungkan';
    ico = 'cloud';
  }
  if (connected) {
    cls = 'badge--ok';
    label = info?.user?.emailAddress ? `Tersambung: ${info.user.emailAddress}` : 'Tersambung ke Google Drive';
    ico = 'checkCircle';
  }

  box.innerHTML = `
    <div style="display:flex;align-items:center;gap:10px">
      <span class="badge ${cls}">${icon(ico)} ${esc(label)}</span>
      <div class="grow"></div>
      ${connected && info?.storageQuota?.limit
        ? `<span class="tiny muted">${esc(fmtBytes(Number(info.storageQuota.usage || 0)))} / ${esc(fmtBytes(Number(info.storageQuota.limit)))}</span>`
        : ''}
    </div>`;

  await paintQueue(root);
}

async function paintQueue(root) {
  const box = $('#queueInfo', root);
  if (!box) return;
  const q = await sync.queueSummary();
  box.innerHTML = `
    <div class="kv">
      <div class="kv__k">Menunggu diunggah</div><div class="kv__v">${q.pending} transaksi</div>
      <div class="kv__k">Berkas di HP</div><div class="kv__v">${q.files} berkas · ${esc(fmtBytes(q.bytes))}</div>
      ${q.lastError ? `<div class="kv__k">Kesalahan terakhir</div><div class="kv__v tiny">${esc(q.lastError)}</div>` : ''}
    </div>`;
}

async function paintStorage(root) {
  const box = $('#storageInfo', root);
  if (!box) return;
  const est = await storageEstimate();
  const usage = await media.usage();
  const persisted = navigator.storage?.persisted ? await navigator.storage.persisted() : false;

  box.innerHTML = `
    <div class="kv">
      <div class="kv__k">Berkas lokal</div><div class="kv__v">${usage.count} berkas · ${esc(fmtBytes(usage.bytes))}</div>
      <div class="kv__k">Ruang terpakai</div><div class="kv__v">${est ? `${esc(fmtBytes(est.usage))} dari ${esc(fmtBytes(est.quota))} (${(est.pct * 100).toFixed(1)}%)` : 'Tidak tersedia'}</div>
      <div class="kv__k">Status penyimpanan</div><div class="kv__v">${persisted ? 'Terkunci permanen' : 'Bisa dibersihkan sistem'}</div>
    </div>
    ${est && est.pct > 0.8
      ? `<div class="banner banner--warn mt-12">${icon('alert')}<div>Penyimpanan hampir penuh. Unggah arsip ke Google Drive lalu hapus data lama.</div></div>`
      : ''}`;
}

function paintThemes(root, current) {
  const box = $('#themeChips', root);
  if (!box) return;
  const opts = [
    { key: 'auto', label: 'Otomatis', ico: 'sparkles' },
    { key: 'light', label: 'Terang', ico: 'sun' },
    { key: 'dark', label: 'Gelap', ico: 'moon' },
  ];
  box.innerHTML = opts
    .map(
      (o) =>
        `<button class="chip" data-theme="${o.key}" type="button" aria-pressed="${current === o.key}">${icon(o.ico)} ${o.label}</button>`
    )
    .join('');

  box.onclick = async (e) => {
    const btn = e.target.closest('[data-theme]');
    if (!btn) return;
    const mode = btn.dataset.theme;
    const rootEl = document.documentElement;
    if (mode === 'auto') rootEl.removeAttribute('data-theme');
    else rootEl.setAttribute('data-theme', mode);
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', mode === 'dark' ? '#0b1020' : '#4f46e5');
    await kv.set('settings', { ...((await kv.get('settings', {})) || {}), theme: mode });
    paintThemes(root, mode);
  };
}

function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
}
