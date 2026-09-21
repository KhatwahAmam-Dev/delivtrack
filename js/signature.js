/**
 * Pad tanda tangan digital: DPI-aware, kurva halus, dukungan mouse/touch/stylus.
 */
export class SignaturePad {
  constructor(canvas, { penColor = '#0e1729', penWidth = 2.6, background = '#ffffff' } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.penColor = penColor;
    this.penWidth = penWidth;
    this.background = background;
    this.dirty = false;
    this._points = [];
    this._drawing = false;
    this._resizeObserver = null;

    this._onDown = this._onDown.bind(this);
    this._onMove = this._onMove.bind(this);
    this._onUp = this._onUp.bind(this);

    this._attach();
    this.resize();
  }

  _attach() {
    const c = this.canvas;
    c.addEventListener('pointerdown', this._onDown);
    c.addEventListener('pointermove', this._onMove);
    c.addEventListener('pointerup', this._onUp);
    c.addEventListener('pointercancel', this._onUp);
    c.addEventListener('pointerleave', this._onUp);
    c.style.touchAction = 'none';

    if ('ResizeObserver' in window) {
      this._resizeObserver = new ResizeObserver(() => this.resize());
      this._resizeObserver.observe(c.parentElement || c);
    } else {
      window.addEventListener('resize', () => this.resize());
    }
  }

  destroy() {
    this._resizeObserver?.disconnect();
    const c = this.canvas;
    c.removeEventListener('pointerdown', this._onDown);
    c.removeEventListener('pointermove', this._onMove);
    c.removeEventListener('pointerup', this._onUp);
    c.removeEventListener('pointercancel', this._onUp);
    c.removeEventListener('pointerleave', this._onUp);
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const snapshot = this.dirty ? this.canvas.toDataURL() : null;

    this.canvas.width = Math.round(rect.width * dpr);
    this.canvas.height = Math.round(rect.height * dpr);

    const ctx = this.ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = this.penColor;
    ctx.fillStyle = this.background;
    ctx.fillRect(0, 0, rect.width, rect.height);

    if (snapshot) {
      const img = new Image();
      img.onload = () => ctx.drawImage(img, 0, 0, rect.width, rect.height);
      img.src = snapshot;
    }
  }

  _pos(ev) {
    const rect = this.canvas.getBoundingClientRect();
    return { x: ev.clientX - rect.left, y: ev.clientY - rect.top };
  }

  _onDown(ev) {
    ev.preventDefault();
    try {
      this.canvas.setPointerCapture?.(ev.pointerId);
    } catch {
      // Pointer sudah lepas / tidak dikenal — menggambar tetap boleh lanjut.
    }
    this._drawing = true;
    this._points = [this._pos(ev)];
    this._render();
  }

  _onMove(ev) {
    if (!this._drawing) return;
    ev.preventDefault();
    const p = this._pos(ev);
    const last = this._points[this._points.length - 1];
    if (last && Math.hypot(p.x - last.x, p.y - last.y) < 0.7) return;
    this._points.push(p);
    if (this._points.length > 3000) this._points.shift();
    this._render();
    this.dirty = true;
  }

  _onUp() {
    if (!this._drawing) return;
    this._drawing = false;
    this._render();
    if (this._points.length > 1) this.dirty = true;
  }

  _render() {
    const ctx = this.ctx;
    const pts = this._points;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.fillStyle = this.background;
    const rect = this.canvas.getBoundingClientRect();
    ctx.fillRect(0, 0, rect.width, rect.height);

    if (pts.length === 0) return;

    ctx.strokeStyle = this.penColor;
    ctx.lineWidth = this.penWidth;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    if (pts.length < 3) {
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      ctx.lineTo(pts[0].x + 0.1, pts[0].y + 0.1);
      ctx.stroke();
      return;
    }

    // Kurva kuadratik melalui titik tengah agar garis terasa natural.
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length - 1; i++) {
      const mx = (pts[i].x + pts[i + 1].x) / 2;
      const my = (pts[i].y + pts[i + 1].y) / 2;
      ctx.quadraticCurveTo(pts[i].x, pts[i].y, mx, my);
    }
    const last = pts[pts.length - 1];
    ctx.lineTo(last.x, last.y);
    ctx.stroke();
  }

  clear() {
    this._points = [];
    this.dirty = false;
    this._render();
  }

  get empty() {
    return !this.dirty;
  }

  /** Hasilkan PNG berlatar putih (agar tetap terbaca saat dicetak). */
  toBlob() {
    const src = this.canvas;
    const w = src.width;
    const h = src.height;
    const out = document.createElement('canvas');
    out.width = w;
    out.height = h;
    const ctx = out.getContext('2d', { alpha: false });
    ctx.fillStyle = this.background;
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(src, 0, 0);
    return new Promise((res) => out.toBlob(res, 'image/png'));
  }
}

/** Bangun blok tanda tangan siap pakai berikut label & tombol hapus. */
export function signatureBlock({ id = 'sig', label = 'Tanda tangan penerima' } = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'card';
  wrap.innerHTML = `
    <div class="card__head">
      <h3>${label}</h3>
      <div class="grow"></div>
      <button class="btn btn--sm btn--ghost" data-role="clear" type="button">Hapus</button>
    </div>
    <div class="card__pad">
      <div class="sigpad">
        <canvas id="${id}"></canvas>
        <div class="sigpad__ghost" data-role="ghost">Tanda tangan di sini</div>
        <div class="sigpad__hint"></div>
      </div>
      <p class="field__hint">Minta penerima menandatangani langsung di layar HP. Tanda tangan dapat diulang bila keliru.</p>
    </div>
  `;
  return wrap;
}
