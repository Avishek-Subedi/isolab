/**
 * Canvas charting — no dependencies.
 *
 * Log-frequency line charts, bar charts, pie/donut charts and a cost/level
 * scatter, all drawn with the 2D context and all theme-aware via CSS custom
 * properties read off the document root.
 */

const css = (name, fallback) => {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
};

export const PALETTE = () => ({
  ink: css('--ink', '#1a1d23'),
  muted: css('--muted', '#6b7280'),
  grid: css('--grid', '#e5e7eb'),
  bg: css('--panel', '#ffffff'),
  inside: css('--c-inside', '#7c3aed'),
  outside: css('--c-outside', '#dc2626'),
  background: css('--c-background', '#94a3b8'),
  tl: css('--c-tl', '#059669'),
  target: css('--c-target', '#f59e0b'),
  series: [
    css('--c-1', '#2563eb'), css('--c-2', '#dc2626'), css('--c-3', '#059669'),
    css('--c-4', '#d97706'), css('--c-5', '#7c3aed'), css('--c-6', '#0891b2'),
  ],
});

/** Prepare a canvas for crisp drawing at device pixel ratio. */
function setup(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  const w = Math.max(rect.width, 200);
  const h = Math.max(rect.height, 120);
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  return { ctx, w, h };
}

/**
 * Log-frequency line chart.
 * @param {HTMLCanvasElement} canvas
 * @param {{freqs:number[], series:{label:string,values:number[],color:string,dash?:number[],fill?:boolean,width?:number}[], yLabel?:string, yMin?:number, yMax?:number, markers?:{f:number,label:string,color?:string}[], bands?:{f0:number,f1:number,color:string,label?:string}[]}} spec
 */
export function lineChart(canvas, spec) {
  const { ctx, w, h } = setup(canvas);
  const P = PALETTE();
  const pad = { l: 44, r: 12, t: 12, b: 30 };
  const plotW = w - pad.l - pad.r;
  const plotH = h - pad.t - pad.b;

  const freqs = spec.freqs;
  const all = spec.series.flatMap((s) => s.values).filter((v) => isFinite(v));
  let yMin = spec.yMin ?? Math.floor((Math.min(...all) - 5) / 10) * 10;
  let yMax = spec.yMax ?? Math.ceil((Math.max(...all) + 5) / 10) * 10;
  if (yMax - yMin < 20) yMax = yMin + 20;

  const fMin = Math.log10(freqs[0]);
  const fMax = Math.log10(freqs[freqs.length - 1]);
  const X = (f) => pad.l + ((Math.log10(f) - fMin) / (fMax - fMin)) * plotW;
  const Y = (v) => pad.t + plotH - ((v - yMin) / (yMax - yMin)) * plotH;

  // shaded frequency regions (e.g. resonance warnings)
  for (const b of spec.bands || []) {
    ctx.fillStyle = b.color;
    const x0 = X(Math.max(b.f0, freqs[0]));
    const x1 = X(Math.min(b.f1, freqs[freqs.length - 1]));
    ctx.fillRect(x0, pad.t, Math.max(1, x1 - x0), plotH);
  }

  // grid
  ctx.strokeStyle = P.grid;
  ctx.lineWidth = 1;
  ctx.fillStyle = P.muted;
  ctx.font = '10px ui-sans-serif, system-ui, sans-serif';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  const step = (yMax - yMin) > 80 ? 20 : (yMax - yMin) > 40 ? 10 : 5;
  for (let v = yMin; v <= yMax; v += step) {
    const y = Y(v);
    ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(w - pad.r, y); ctx.stroke();
    ctx.fillText(String(v), pad.l - 6, y);
  }
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  const label = (f) => (f >= 1000 ? (f / 1000) + 'k' : String(f));
  const ticks = freqs.filter((f) => [63, 125, 250, 500, 1000, 2000, 4000, 8000].includes(f));
  for (const f of ticks) {
    const x = X(f);
    ctx.strokeStyle = P.grid;
    ctx.beginPath(); ctx.moveTo(x, pad.t); ctx.lineTo(x, pad.t + plotH); ctx.stroke();
    ctx.fillStyle = P.muted;
    ctx.fillText(label(f), x, pad.t + plotH + 6);
  }

  // vertical markers (f0, fc, resonances)
  for (const m of spec.markers || []) {
    if (m.f < freqs[0] || m.f > freqs[freqs.length - 1]) continue;
    const x = X(m.f);
    ctx.save();
    ctx.strokeStyle = m.color || P.target;
    ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.moveTo(x, pad.t); ctx.lineTo(x, pad.t + plotH); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = m.color || P.target;
    ctx.font = '9px ui-sans-serif, system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.translate(x + 3, pad.t + 2);
    ctx.fillText(m.label, 0, 0);
    ctx.restore();
  }

  // series
  for (const s of spec.series) {
    ctx.strokeStyle = s.color;
    ctx.lineWidth = s.width ?? 2;
    ctx.setLineDash(s.dash || []);
    ctx.beginPath();
    let started = false;
    for (let i = 0; i < freqs.length; i++) {
      const v = s.values[i];
      if (!isFinite(v)) continue;
      const x = X(freqs[i]), y = Y(Math.max(yMin, Math.min(yMax, v)));
      if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.setLineDash([]);

    if (s.fill) {
      ctx.globalAlpha = 0.10;
      ctx.fillStyle = s.color;
      ctx.lineTo(X(freqs[freqs.length - 1]), Y(yMin));
      ctx.lineTo(X(freqs[0]), Y(yMin));
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  }

  // y axis label
  if (spec.yLabel) {
    ctx.save();
    ctx.fillStyle = P.muted;
    ctx.font = '10px ui-sans-serif, system-ui, sans-serif';
    ctx.translate(11, pad.t + plotH / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = 'center';
    ctx.fillText(spec.yLabel, 0, 0);
    ctx.restore();
  }
  ctx.fillStyle = P.muted;
  ctx.font = '10px ui-sans-serif, system-ui, sans-serif';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'bottom';
  ctx.fillText('Hz', w - pad.r, h - 2);
}

/**
 * Grouped bar chart over octave bands.
 */
export function barChart(canvas, spec) {
  const { ctx, w, h } = setup(canvas);
  const P = PALETTE();
  const pad = { l: 40, r: 10, t: 10, b: 26 };
  const plotW = w - pad.l - pad.r;
  const plotH = h - pad.t - pad.b;
  const n = spec.labels.length;
  const groups = spec.series.length;
  const gw = plotW / n;
  const bw = Math.max(2, (gw * 0.72) / groups);

  const all = spec.series.flatMap((s) => s.values);
  const yMin = spec.yMin ?? 0;
  const yMax = spec.yMax ?? Math.ceil((Math.max(...all) + 5) / 10) * 10;
  const Y = (v) => pad.t + plotH - ((Math.max(yMin, v) - yMin) / (yMax - yMin)) * plotH;

  ctx.strokeStyle = P.grid;
  ctx.fillStyle = P.muted;
  ctx.font = '10px ui-sans-serif, system-ui, sans-serif';
  ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
  for (let v = yMin; v <= yMax; v += (yMax - yMin) > 60 ? 20 : 10) {
    const y = Y(v);
    ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(w - pad.r, y); ctx.stroke();
    ctx.fillText(String(v), pad.l - 5, y);
  }

  for (let i = 0; i < n; i++) {
    for (let g = 0; g < groups; g++) {
      const v = spec.series[g].values[i];
      if (!isFinite(v)) continue;
      const x = pad.l + i * gw + gw * 0.14 + g * bw;
      const y = Y(v);
      ctx.fillStyle = spec.series[g].color;
      ctx.fillRect(x, y, bw - 1, pad.t + plotH - y);
    }
    ctx.fillStyle = P.muted;
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    const l = spec.labels[i];
    ctx.fillText(l >= 1000 ? (l / 1000) + 'k' : String(l), pad.l + i * gw + gw / 2, pad.t + plotH + 5);
  }
}

/**
 * Donut chart for the leakage breakdown.
 * @param {{label:string, percent:number, color:string}[]} slices
 */
export function donutChart(canvas, slices, centreLabel) {
  const { ctx, w, h } = setup(canvas);
  const P = PALETTE();
  const cx = w / 2, cy = h / 2;
  const r = Math.min(w, h) / 2 - 6;
  const rInner = r * 0.58;

  let a0 = -Math.PI / 2;
  const total = slices.reduce((s, x) => s + x.percent, 0) || 1;
  for (const s of slices) {
    const a1 = a0 + (s.percent / total) * Math.PI * 2;
    ctx.beginPath();
    ctx.arc(cx, cy, r, a0, a1);
    ctx.arc(cx, cy, rInner, a1, a0, true);
    ctx.closePath();
    ctx.fillStyle = s.color;
    ctx.fill();
    ctx.strokeStyle = P.bg;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    a0 = a1;
  }

  if (centreLabel) {
    ctx.fillStyle = P.ink;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = '600 15px ui-sans-serif, system-ui, sans-serif';
    ctx.fillText(centreLabel.main, cx, cy - 6);
    ctx.fillStyle = P.muted;
    ctx.font = '9px ui-sans-serif, system-ui, sans-serif';
    ctx.fillText(centreLabel.sub, cx, cy + 10);
  }
}

/**
 * Cost vs level scatter for the optimiser Pareto front.
 */
export function paretoChart(canvas, spec) {
  const { ctx, w, h } = setup(canvas);
  const P = PALETTE();
  const pad = { l: 44, r: 12, t: 14, b: 30 };
  const plotW = w - pad.l - pad.r, plotH = h - pad.t - pad.b;
  const pts = spec.points;
  if (!pts.length) return;

  const xMax = Math.max(...pts.map((p) => p.cost)) * 1.05;
  const yAll = pts.map((p) => p.level);
  const yMin = Math.floor((Math.min(...yAll) - 3) / 5) * 5;
  const yMax = Math.ceil((Math.max(...yAll) + 3) / 5) * 5;
  const X = (v) => pad.l + (v / xMax) * plotW;
  const Y = (v) => pad.t + plotH - ((v - yMin) / (yMax - yMin)) * plotH;

  ctx.strokeStyle = P.grid; ctx.fillStyle = P.muted;
  ctx.font = '10px ui-sans-serif, system-ui, sans-serif';
  ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
  for (let v = yMin; v <= yMax; v += 5) {
    const y = Y(v);
    ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(w - pad.r, y); ctx.stroke();
    ctx.fillText(String(v), pad.l - 5, y);
  }
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  for (let i = 0; i <= 4; i++) {
    const v = (xMax * i) / 4;
    ctx.fillText('£' + Math.round(v), X(v), pad.t + plotH + 5);
  }

  // target line
  if (spec.target != null && spec.target >= yMin && spec.target <= yMax) {
    ctx.save();
    ctx.strokeStyle = P.target; ctx.setLineDash([4, 3]); ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(pad.l, Y(spec.target)); ctx.lineTo(w - pad.r, Y(spec.target)); ctx.stroke();
    ctx.restore();
    ctx.fillStyle = P.target;
    ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
    ctx.fillText('target ' + spec.target + ' dB(A)', pad.l + 4, Y(spec.target) - 2);
  }
  // budget line
  if (spec.budget != null && spec.budget <= xMax) {
    ctx.save();
    ctx.strokeStyle = P.muted; ctx.setLineDash([2, 3]);
    ctx.beginPath(); ctx.moveTo(X(spec.budget), pad.t); ctx.lineTo(X(spec.budget), pad.t + plotH); ctx.stroke();
    ctx.restore();
  }

  // front
  ctx.strokeStyle = P.series[0]; ctx.lineWidth = 2;
  ctx.beginPath();
  pts.forEach((p, i) => (i ? ctx.lineTo(X(p.cost), Y(p.level)) : ctx.moveTo(X(p.cost), Y(p.level))));
  ctx.stroke();
  for (const p of pts) {
    ctx.beginPath();
    ctx.arc(X(p.cost), Y(p.level), 3.5, 0, Math.PI * 2);
    ctx.fillStyle = (spec.target != null && p.level <= spec.target) ? P.tl : P.series[0];
    ctx.fill();
  }
}

/** Colour ramp for the leakage heat map: green (good) -> yellow -> red (bad). */
export function heatColor(t) {
  const x = Math.max(0, Math.min(1, t));
  const stops = [
    [0.00, [16, 130, 90]],
    [0.35, [132, 175, 40]],
    [0.60, [232, 178, 30]],
    [0.80, [226, 110, 30]],
    [1.00, [200, 40, 40]],
  ];
  let a = stops[0], b = stops[stops.length - 1];
  for (let i = 1; i < stops.length; i++) {
    if (x <= stops[i][0]) { a = stops[i - 1]; b = stops[i]; break; }
  }
  const u = (x - a[0]) / Math.max(1e-9, b[0] - a[0]);
  const c = a[1].map((v, i) => Math.round(v + u * (b[1][i] - v)));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}
