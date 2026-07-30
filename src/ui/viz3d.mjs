/**
 * Dependency-free 3D booth visualiser.
 *
 * Renders the booth as an exploded box whose faces are coloured by their share
 * of the escaping acoustic power (green = good, red = the path that is losing
 * you the most). Doors, vents, gaps and the flanking path are drawn as
 * overlaid badges on the face they belong to, sized by their contribution, so
 * the picture answers "where is it getting out" at a glance.
 *
 * Implementation: right-handed world space, a simple look-at + perspective
 * projection, painter's algorithm depth sorting, and polygon hit-testing for
 * click selection. No WebGL, no external library.
 */

import { heatColor } from './charts.mjs';
import { materialColor, shade, isTransparent, paintTexture, shortMaterialName } from './appearance.mjs';

/* ---------------- small vector helpers ---------------- */
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const norm = (a) => { const l = Math.hypot(...a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const centroid = (pts) => pts.reduce((s, p) => add(s, p), [0, 0, 0]).map((v) => v / pts.length);

/**
 * @typedef {Object} FaceSpec
 * @property {string} key            'front'|'back'|'left'|'right'|'ceiling'|'floor'
 * @property {string} label
 * @property {number[][]} corners    4 world-space points, counter-clockwise seen from outside
 * @property {number} percent        share of escaping power
 * @property {string} sublabel
 * @property {{id:string,label:string,percent:number,u:number,v:number,kind:string}[]} badges
 */

export class Booth3D {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {{onSelect?:(key:string, id?:string)=>void}} [opts]
   */
  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    this.opts = opts;
    this.yaw = -0.6;
    this.pitch = 0.42;
    this.dist = 5.4;
    this.explode = 0.14;
    this.faces = [];
    this.hot = null;
    this.selected = null;
    // Continuous motion is decorative here; honour the viewer's preference.
    this.reducedMotion = typeof window !== 'undefined'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.showWaves = !this.reducedMotion;
    this.phase = 0;
    this._picks = [];
    /** 'materials' shows what the booth is made of; 'leakage' shows where sound escapes. */
    this.mode = 'materials';
    this.dims = { L: 1.4, W: 1.4, H: 2.1 };
    this.showHandles = true;
    this._handles = [];
    this._drag = null;
    this._bind();
  }

  _bind() {
    const c = this.canvas;
    let dragging = false, lx = 0, ly = 0, moved = 0;
    // Pointer capture is a convenience, not a requirement: it throws if the
    // pointer id is not currently active, and an exception here would abort the
    // handler and silently break click-to-select. Never let it do that.
    const capture = (e) => { try { c.setPointerCapture(e.pointerId); } catch { /* not fatal */ } };
    const release = (e) => { try { c.releasePointerCapture(e.pointerId); } catch { /* not fatal */ } };

    /** Canvas-local position of a pointer event. */
    const posOf = (e) => {
      const r = c.getBoundingClientRect();
      return [e.clientX - r.left, e.clientY - r.top];
    };

    c.addEventListener('pointerdown', (e) => {
      const at = posOf(e);
      this.mouse = at;
      const h = this._pickHandle(at);
      if (h) {
        // Grab a dimension handle: drag translates to metres along that axis.
        this._drag = { handle: h, startPx: at, startVal: this.dims[h.axis] };
        capture(e);
        c.style.cursor = 'grabbing';
        return;
      }
      dragging = true; moved = 0;
      lx = e.clientX; ly = e.clientY;
      capture(e);
    });
    c.addEventListener('pointermove', (e) => {
      this.mouse = posOf(e);

      if (this._drag) {
        const d = this._drag;
        // Project the screen movement onto the handle's on-screen axis direction,
        // then convert pixels to metres using that handle's own pixel scale.
        const dx = this.mouse[0] - d.startPx[0];
        const dy = this.mouse[1] - d.startPx[1];
        const along = dx * d.handle.dir[0] + dy * d.handle.dir[1];
        const next = d.startVal + along / d.handle.pxPerMetre;
        const lim = d.handle.axis === 'H' ? [1.8, 4] : [0.8, 6];
        const v = Math.round(Math.max(lim[0], Math.min(lim[1], next)) * 20) / 20;
        if (v !== this.dims[d.handle.axis]) {
          this.dims[d.handle.axis] = v;
          if (this.opts.onResize) this.opts.onResize({ ...this.dims });
        }
        this.draw();
        return;
      }

      if (dragging) {
        const dx = e.clientX - lx, dy = e.clientY - ly;
        moved += Math.abs(dx) + Math.abs(dy);
        this.yaw += dx * 0.008;
        this.pitch = Math.max(-1.35, Math.min(1.35, this.pitch + dy * 0.006));
        lx = e.clientX; ly = e.clientY;
        this.draw();
      } else {
        const h = this._pickHandle(this.mouse);
        const prev = this.hot, prevH = this.hotHandle;
        this.hotHandle = h;
        this.hot = h ? null : this._pick(this.mouse);
        if (prev !== this.hot || prevH !== h) {
          this.draw();
          c.style.cursor = h ? (h.axis === 'H' ? 'ns-resize' : 'ew-resize') : this.hot ? 'pointer' : 'grab';
        }
      }
    });
    c.addEventListener('pointerup', (e) => {
      if (this._drag) {
        this._drag = null;
        release(e);
        c.style.cursor = 'grab';
        if (this.opts.onResizeEnd) this.opts.onResizeEnd({ ...this.dims });
        return;
      }
      dragging = false;
      release(e);
      if (moved < 6) {
        // Take the position from the event, not from the last hover: a tap on a
        // touch screen produces no pointermove at all, so relying on cached
        // hover state would make the whole builder unselectable there.
        const at = posOf(e);
        this.mouse = at;
        const hit = this._pick(at);
        this.selected = hit;
        if (this.opts.onSelect) this.opts.onSelect(hit?.faceKey, hit?.badgeId);
        this.draw();
      }
    });
    c.addEventListener('pointerleave', () => { this.hot = null; this.draw(); });
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.dist = Math.max(3, Math.min(18, this.dist * (1 + Math.sign(e.deltaY) * 0.08)));
      this.draw();
    }, { passive: false });
    c.style.cursor = 'grab';
    c.style.touchAction = 'none';
  }

  /** @param {FaceSpec[]} faces */
  setFaces(faces) { this.faces = faces; }

  /** Half-extents in world units plus the real metre dimensions. */
  setGeometry(geom, dims) { this._geom = geom; this.dims = { ...dims }; }

  setMode(mode) { this.mode = mode; this.draw(); }

  setExplode(v) { this.explode = v; this.draw(); }

  /* ---------------- projection ---------------- */
  _camera(w, h) {
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    const eye = [
      this.dist * cp * Math.sin(this.yaw),
      this.dist * sp,
      this.dist * cp * Math.cos(this.yaw),
    ];
    const target = [0, 0, 0];
    const fwd = norm(sub(target, eye));
    const right = norm(cross(fwd, [0, 1, 0]));
    const up = cross(right, fwd);
    const fov = 1.0;
    const f = Math.min(w, h) / (2 * Math.tan(fov / 2));
    return { eye, fwd, right, up, f, cx: w / 2, cy: h / 2 };
  }

  _project(p, cam) {
    const d = sub(p, cam.eye);
    const z = dot(d, cam.fwd);
    if (z <= 0.05) return null;
    return {
      x: cam.cx + (dot(d, cam.right) * cam.f) / z,
      y: cam.cy - (dot(d, cam.up) * cam.f) / z,
      z,
    };
  }

  /* ---------------- picking ---------------- */
  _pickHandle(mouse) {
    if (!mouse || !this.showHandles) return null;
    for (const h of this._handles) {
      if (Math.hypot(mouse[0] - h.sx, mouse[1] - h.sy) <= 13) return h;
    }
    return null;
  }

  _pick(mouse) {
    if (!mouse) return null;
    // _picks is populated during draw(), nearest-first
    for (const p of this._picks) {
      if (pointInPoly(mouse, p.poly)) return p;
    }
    return null;
  }

  /* ---------------- draw ---------------- */
  draw() {
    const canvas = this.canvas;
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const w = Math.max(rect.width, 240), h = Math.max(rect.height, 200);
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const cam = this._camera(w, h);
    const maxPct = Math.max(0.001, ...this.faces.map((f) => f.percent));

    // Build renderables
    const items = [];
    for (const f of this.faces) {
      const c = centroid(f.corners);
      const outward = norm(c);
      const pts = f.corners.map((p) => add(p, scale(outward, this.explode)));
      const proj = pts.map((p) => this._project(p, cam));
      if (proj.some((p) => !p)) continue;
      const n = norm(cross(sub(pts[1], pts[0]), sub(pts[2], pts[0])));
      const toEye = norm(sub(cam.eye, centroid(pts)));
      const facing = dot(n, toEye);
      items.push({
        kind: 'face', face: f, pts, proj,
        depth: proj.reduce((s, p) => s + p.z, 0) / proj.length,
        facing, outward,
      });
    }

    // Painter's algorithm: far to near
    items.sort((a, b) => b.depth - a.depth);

    this._picks = [];
    const picksNear = [];

    // Source glow at the centre
    const srcP = this._project([0, 0, 0], cam);

    for (const it of items) {
      const f = it.face;
      const backFacing = it.facing < 0;
      const t = f.percent / maxPct;
      const matMode = this.mode === 'materials';
      const base = matMode ? materialColor(f.material) : heatColor(Math.pow(t, 0.65));

      ctx.beginPath();
      it.proj.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.closePath();

      // Shade by facing so the box reads as a solid
      const lambert = 0.55 + 0.45 * Math.abs(it.facing);
      const glassy = matMode && isTransparent(f.material);
      ctx.globalAlpha = backFacing ? 0.16 : (glassy ? 0.5 : 0.92) * lambert;
      ctx.fillStyle = matMode ? shade(base, lambert) : base;
      ctx.fill();

      // Procedural material treatment, clipped to this face and drawn in its
      // own UV space so grain and courses follow the perspective.
      if (matMode && !backFacing) {
        const poly4 = it.proj.map((p) => [p.x, p.y]);
        ctx.save();
        ctx.clip();
        paintTexture(
          ctx,
          (u, v) => this._project(bilinear(it.pts, u, v), cam),
          f.material,
          polyArea(poly4)
        );
        ctx.restore();
      }

      const isHot = this.hot?.faceKey === f.key && !this.hot?.badgeId;
      const isSel = this.selected?.faceKey === f.key && !this.selected?.badgeId;
      ctx.globalAlpha = backFacing ? 0.25 : 1;
      ctx.lineWidth = isSel ? 2.5 : isHot ? 2 : 1;
      ctx.strokeStyle = isSel ? '#111827' : isHot ? '#374151' : 'rgba(0,0,0,0.35)';
      ctx.stroke();
      ctx.globalAlpha = 1;

      if (!backFacing) {
        const poly = it.proj.map((p) => [p.x, p.y]);
        picksNear.push({ faceKey: f.key, label: f.label, poly, depth: it.depth, percent: f.percent });

        // Face label
        const c2 = it.proj.reduce((s, p) => [s[0] + p.x, s[1] + p.y], [0, 0]).map((v) => v / 4);
        const area = polyArea(poly);
        if (area > 2200) {
          const matMode2 = this.mode === 'materials';
          // In materials view the label sits at the face centroid, which keeps
          // adjacent faces' labels well apart. In leakage view it moves up so
          // the badges can own the middle of the face.
          let lx = c2[0], ly = c2[1];
          if (!matMode2) {
            const top = [(it.proj[2].x + it.proj[3].x) / 2, (it.proj[2].y + it.proj[3].y) / 2];
            lx = top[0] * 0.72 + c2[0] * 0.28;
            ly = top[1] * 0.72 + c2[1] * 0.28;
          }
          const name = f.label;
          const sub = matMode2 ? f.materialShort : f.percent.toFixed(1) + '%';

          ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.font = '600 11px ui-sans-serif, system-ui, sans-serif';
          const w1 = ctx.measureText(name).width;
          ctx.font = '10px ui-sans-serif, system-ui, sans-serif';
          const w2 = ctx.measureText(sub).width;
          const pw = Math.max(w1, w2) + 12;
          const ph = sub ? 30 : 18;

          // A pill keeps the text readable over any texture, and stops
          // neighbouring labels from visually merging.
          ctx.fillStyle = (isSel || isHot) ? 'rgba(37,99,235,0.92)' : 'rgba(17,24,39,0.72)';
          roundRect(ctx, lx - pw / 2, ly - ph / 2, pw, ph, 5);
          ctx.fill();

          ctx.fillStyle = 'rgba(255,255,255,0.97)';
          ctx.font = '600 11px ui-sans-serif, system-ui, sans-serif';
          ctx.fillText(name, lx, ly - (sub ? 6 : 0));
          if (sub) {
            ctx.font = '10px ui-sans-serif, system-ui, sans-serif';
            ctx.fillStyle = 'rgba(255,255,255,0.8)';
            ctx.fillText(sub, lx, ly + 7);
          }
        }

        // Badges: doors, vents, gaps sitting on this face (leakage view only)
        for (const b of (this.mode === 'leakage' ? f.badges || [] : [])) {
          const q = bilinear(it.pts, b.u, b.v);
          const bp = this._project(q, cam);
          if (!bp) continue;
          const rad = 7 + 16 * Math.sqrt(Math.min(1, b.percent / 100));
          const bt = Math.pow(Math.min(1, b.percent / maxPct), 0.6);
          const bhot = this.hot?.badgeId === b.id;
          const bsel = this.selected?.badgeId === b.id;

          // Escape plume
          if (this.showWaves && b.percent > 2) {
            const pulses = 3;
            for (let k = 0; k < pulses; k++) {
              const ph = ((this.phase + k / pulses) % 1);
              ctx.beginPath();
              ctx.arc(bp.x, bp.y, rad + ph * 34, 0, Math.PI * 2);
              ctx.strokeStyle = heatColor(bt);
              ctx.globalAlpha = 0.35 * (1 - ph);
              ctx.lineWidth = 2;
              ctx.stroke();
              ctx.globalAlpha = 1;
            }
          }

          ctx.beginPath();
          ctx.arc(bp.x, bp.y, rad, 0, Math.PI * 2);
          ctx.fillStyle = heatColor(bt);
          ctx.globalAlpha = 0.92;
          ctx.fill();
          ctx.globalAlpha = 1;
          ctx.lineWidth = bsel ? 3 : bhot ? 2.2 : 1.2;
          ctx.strokeStyle = bsel ? '#111827' : '#ffffff';
          ctx.stroke();

          ctx.fillStyle = '#fff';
          ctx.font = '700 10px ui-sans-serif, system-ui, sans-serif';
          ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.fillText(ICONS[b.kind] || '•', bp.x, bp.y);

          if (rad > 12 || bhot || bsel) {
            ctx.font = '600 9px ui-sans-serif, system-ui, sans-serif';
            ctx.fillStyle = 'rgba(17,24,39,0.9)';
            ctx.strokeStyle = 'rgba(255,255,255,0.85)';
            ctx.lineWidth = 3;
            const txt = b.percent.toFixed(0) + '%';
            ctx.strokeText(txt, bp.x, bp.y + rad + 8);
            ctx.fillText(txt, bp.x, bp.y + rad + 8);
          }

          picksNear.push({
            faceKey: f.key, badgeId: b.id, label: b.label,
            poly: circlePoly(bp.x, bp.y, rad + 2), depth: bp.z - 0.01, percent: b.percent,
          });
        }
      }
    }

    // Source marker (leakage view only)
    if (srcP && this.mode === 'leakage') {
      ctx.beginPath();
      ctx.arc(srcP.x, srcP.y, 5, 0, Math.PI * 2);
      ctx.fillStyle = '#7c3aed';
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      if (this.showWaves) {
        for (let k = 0; k < 3; k++) {
          const ph = ((this.phase + k / 3) % 1);
          ctx.beginPath();
          ctx.arc(srcP.x, srcP.y, 6 + ph * 26, 0, Math.PI * 2);
          ctx.strokeStyle = '#7c3aed';
          ctx.globalAlpha = 0.30 * (1 - ph);
          ctx.stroke();
          ctx.globalAlpha = 1;
        }
      }
    }

    // Pick list: nearest first
    this._picks = picksNear.sort((a, b) => a.depth - b.depth);

    // Dimension handles and labels
    this._handles = [];
    if (this.showHandles) this._drawHandles(ctx, cam, w, h);

    // Hover tooltip
    const hv = this.hot;
    if (hv && this.mouse) {
      const txt = `${hv.label} — ${hv.percent.toFixed(1)}%`;
      ctx.font = '11px ui-sans-serif, system-ui, sans-serif';
      const tw = ctx.measureText(txt).width + 12;
      let tx = this.mouse[0] + 12, ty = this.mouse[1] - 10;
      if (tx + tw > w) tx = w - tw - 4;
      ctx.fillStyle = 'rgba(17,24,39,0.92)';
      roundRect(ctx, tx, ty - 9, tw, 20, 4);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.fillText(txt, tx + 6, ty + 1);
    }
  }


  /**
   * Draw the three dimension handles with their measure lines and labels.
   *
   * Each handle records its on-screen axis direction and a pixel-per-metre
   * scale taken at its own depth, so dragging converts screen movement into
   * metres correctly regardless of how the camera is oriented.
   */
  _drawHandles(ctx, cam, w, h) {
    const g = this._geom;
    if (!g) return;
    const e = this.explode;
    const specs = [
      { axis: 'L', label: 'Length', from: [-g.x, -g.y, g.z + e], to: [g.x, -g.y, g.z + e], dirW: [1, 0, 0], value: this.dims.L },
      { axis: 'W', label: 'Width', from: [g.x + e, -g.y, -g.z], to: [g.x + e, -g.y, g.z], dirW: [0, 0, 1], value: this.dims.W },
      { axis: 'H', label: 'Height', from: [g.x + e, -g.y, g.z], to: [g.x + e, g.y, g.z], dirW: [0, 1, 0], value: this.dims.H },
    ];

    for (const sp of specs) {
      const a = this._project(sp.from, cam);
      const b = this._project(sp.to, cam);
      if (!a || !b) continue;
      const mid = [(a.x + b.x) / 2, (a.y + b.y) / 2];

      // Measure line with end ticks
      ctx.save();
      ctx.strokeStyle = 'rgba(120,130,145,0.85)';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 3]);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      ctx.setLineDash([]);
      for (const p of [a, b]) {
        ctx.beginPath(); ctx.arc(p.x, p.y, 2, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(120,130,145,0.9)'; ctx.fill();
      }
      ctx.restore();

      // Screen direction of this axis, and its pixel scale at the handle depth
      const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      const dir = [(b.x - a.x) / len, (b.y - a.y) / len];
      // The drawn line spans `value` metres, so pixels-per-metre islen/value.
      const pxPerMetre = len / Math.max(sp.value, 0.01);

      const hot = this.hotHandle?.axis === sp.axis || this._drag?.handle.axis === sp.axis;
      const r = hot ? 9 : 7;

      ctx.save();
      ctx.beginPath();
      ctx.arc(mid[0], mid[1], r, 0, Math.PI * 2);
      ctx.fillStyle = hot ? '#2563eb' : 'rgba(90,100,115,0.92)';
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = 'rgba(255,255,255,0.92)';
      ctx.stroke();

      // Double-headed arrow inside the handle
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1.4;
      const ax = dir[0] * (r - 3), ay = dir[1] * (r - 3);
      ctx.beginPath();
      ctx.moveTo(mid[0] - ax, mid[1] - ay);
      ctx.lineTo(mid[0] + ax, mid[1] + ay);
      ctx.stroke();
      ctx.restore();

      // Label
      const txt = `${sp.label} ${sp.value.toFixed(2)} m`;
      ctx.font = '600 10px ui-sans-serif, system-ui, sans-serif';
      const tw = ctx.measureText(txt).width + 10;
      const off = 16;
      let lx = mid[0] - dir[1] * off - tw / 2;
      let ly = mid[1] + dir[0] * off;
      lx = Math.max(2, Math.min(w - tw - 2, lx));
      ly = Math.max(12, Math.min(h - 6, ly));
      ctx.fillStyle = hot ? 'rgba(37,99,235,0.95)' : 'rgba(17,24,39,0.82)';
      roundRect(ctx, lx, ly - 9, tw, 18, 4);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.fillText(txt, lx + 5, ly + 1);

      this._handles.push({ axis: sp.axis, sx: mid[0], sy: mid[1], dir, pxPerMetre });
    }
  }

  /** Advance the wave animation. */
  tick(dt) {
    if (!this.showWaves || this.reducedMotion) return;
    this.phase = (this.phase + dt * 0.35) % 1;
    this.draw();
  }
}

const ICONS = { door: 'D', vent: 'V', leak: 'L', 'door-leak': 'L', window: 'W', flanking: 'F', wall: '' };

/** Bilinear interpolation across a quad. */
function bilinear(pts, u, v) {
  const a = pts[0], b = pts[1], c = pts[2], d = pts[3];
  const ab = add(scale(a, 1 - u), scale(b, u));
  const dc = add(scale(d, 1 - u), scale(c, u));
  return add(scale(ab, 1 - v), scale(dc, v));
}

function pointInPoly(pt, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if (((yi > pt[1]) !== (yj > pt[1])) &&
      (pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
}

function polyArea(poly) {
  let a = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    a += poly[j][0] * poly[i][1] - poly[i][0] * poly[j][1];
  }
  return Math.abs(a / 2);
}

function circlePoly(cx, cy, r, n = 12) {
  return Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  });
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/**
 * Build the six face specs for a booth of given internal dimensions, with the
 * simulation breakdown mapped onto them.
 *
 * @param {{L:number,W:number,H:number}} g
 * @param {{byElement:{id:string,label:string,group:string,surface:string,percent:number}[]}} breakdown
 */
export function facesFromResult(g, breakdown, design) {
  // Normalise to a unit-ish box so the camera framing is stable
  const s = 2.4 / Math.max(g.L, g.W, g.H);
  const x = (g.L * s) / 2, y = (g.H * s) / 2, z = (g.W * s) / 2;

  const V = {
    // (x right, y up, z toward viewer)
    lbf: [-x, -y, z], rbf: [x, -y, z], rtf: [x, y, z], ltf: [-x, y, z],
    lbb: [-x, -y, -z], rbb: [x, -y, -z], rtb: [x, y, -z], ltb: [-x, y, -z],
  };

  const defs = [
    { key: 'front', label: 'Front', corners: [V.lbf, V.rbf, V.rtf, V.ltf] },
    { key: 'back', label: 'Back', corners: [V.rbb, V.lbb, V.ltb, V.rtb] },
    { key: 'left', label: 'Left', corners: [V.lbb, V.lbf, V.ltf, V.ltb] },
    { key: 'right', label: 'Right', corners: [V.rbf, V.rbb, V.rtb, V.rtf] },
    { key: 'ceiling', label: 'Ceiling', corners: [V.ltf, V.rtf, V.rtb, V.ltb] },
    { key: 'floor', label: 'Floor', corners: [V.lbb, V.rbb, V.rbf, V.lbf] },
  ];

  // Aggregate percentages per surface, and collect non-wall elements as badges
  const byFace = {};
  for (const d of defs) byFace[d.key] = { percent: 0, badges: [] };

  // deterministic badge placement per face
  const slots = [
    [0.50, 0.56], [0.22, 0.32], [0.78, 0.32],
    [0.22, 0.78], [0.78, 0.78], [0.50, 0.24], [0.50, 0.88],
  ];
  const used = {};

  for (const e of breakdown.byElement) {
    const key = byFace[e.surface] ? e.surface : 'front';
    byFace[key].percent += e.percent;
    if (e.group === 'wall') continue;
    used[key] = (used[key] || 0);
    const slot = slots[used[key] % slots.length];
    used[key]++;
    byFace[key].badges.push({
      id: e.id, label: e.label, percent: e.percent,
      kind: e.group, u: slot[0], v: slot[1],
    });
  }

  return {
    faces: defs.map((d) => {
      // The outermost leaf is what you would see standing outside the booth.
      const part = design?.surfaces?.[d.key];
      const leaves = part?.leaves || [];
      const outer = leaves[leaves.length - 1];
      const material = outer?.layers?.[outer.layers.length - 1]?.material || null;
      return {
        ...d,
        percent: byFace[d.key].percent,
        badges: byFace[d.key].badges.sort((a, b) => b.percent - a.percent).slice(0, 6),
        material,
        materialLabel: material ? material.name.replace(/\s*\([^)]*\)/, '') : '',
        materialShort: shortMaterialName(material),
        sublabel: '',
      };
    }),
    geom: { x, y, z },
  };
}
