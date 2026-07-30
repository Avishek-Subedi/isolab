/**
 * Visual appearance of materials in the 3D builder.
 *
 * Kept out of `data/materials.mjs` on purpose: that file is the physics record
 * and should not accumulate presentation concerns. This module maps a material
 * to how it *looks* — a base colour plus a procedural surface treatment drawn
 * in the face's own UV space, so grain and courses follow the perspective.
 */

/** Base colours, chosen to read as the real material rather than as swatches. */
const COLORS = {
  plywood: '#c9a26b', mdf: '#b8875a', osb: '#c6a678', chipboard: '#bfa075',
  softwood: '#dcb885', hardwood: '#96683d',

  gypsum: '#ebe8e1', 'gypsum-acoustic': '#d3dfe8', 'gypsum-fibre': '#d5d1c6',
  'cement-board': '#b6b6b0', 'fibre-cement': '#a6a8a4', 'osb-plus-gypsum': '#cfcabe',

  concrete: '#9a9a95', 'concrete-block-dense': '#a3a099',
  'concrete-block-light': '#c3c0b6', brick: '#9c5b45', screed: '#a8a49c',

  steel: '#97a0aa', 'steel-stud': '#8f98a2', aluminium: '#c0c6cc', lead: '#767981',

  glass: '#9fc4d6', 'glass-laminated': '#a6cadb', 'glass-acoustic-laminated': '#aed0df',
  acrylic: '#bcd6e2', polycarbonate: '#b4cfdd',

  mlv: '#3a3a40', 'rubber-epdm': '#46464a', 'bitumen-sheet': '#33333a',
  'damping-compound': '#5c5a6b',

  'rockwool-rwa45': '#d9c24e', 'rockwool-flexi': '#dfcd6a', 'rockwool-rw3': '#cbb241',
  'mineral-wool-140': '#c2a93a', 'fibreglass-batt': '#e6d98a', 'fibreglass-703': '#dcc96a',
  'polyester-acoustic': '#dcdce0', cellulose: '#b9a98c', 'sheep-wool': '#d8cdb8',
  'denim-insulation': '#6b7f9c',

  'acoustic-foam': '#4b4b53', 'acoustic-panel-fabric': '#6d6f78',
  'egg-box-foam': '#54545c', carpet: '#6a5e57', air: '#dfe4ea',
};

/** Which procedural treatment to draw. */
function textureOf(m) {
  if (!m) return 'flat';
  if (m.category === 'Wood') return 'grain';
  if (m.category === 'Masonry') return m.id === 'brick' ? 'brick' : 'block';
  if (m.category === 'Metal') return 'sheen';
  if (m.category === 'Glazing') return 'glass';
  if (m.category === 'Porous') return 'fibre';
  if (m.category === 'Board') return 'speckle';
  return 'flat';
}

export function materialColor(m) {
  return (m && COLORS[m.id]) || '#b0b3b8';
}

/** Slightly darken/lighten a hex colour. */
export function shade(hex, k) {
  const n = parseInt(hex.slice(1), 16);
  const f = (v) => Math.max(0, Math.min(255, Math.round(v * k)));
  return `rgb(${f((n >> 16) & 255)},${f((n >> 8) & 255)},${f(n & 255)})`;
}

/** Materials that should render see-through. */
export const isTransparent = (m) => m && m.category === 'Glazing';

/**
 * Paint a face's material treatment.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {(u:number,v:number)=>{x:number,y:number}|null} uv  UV -> screen point
 * @param {object} material
 * @param {number} area  projected area in px², used to skip detail when tiny
 */
export function paintTexture(ctx, uv, material, area) {
  if (area < 900) return;
  const kind = textureOf(material);
  const base = materialColor(material);
  const line = (u0, v0, u1, v1, steps = 6) => {
    ctx.beginPath();
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const p = uv(u0 + (u1 - u0) * t, v0 + (v1 - v0) * t);
      if (!p) return;
      i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y);
    }
    ctx.stroke();
  };

  ctx.save();
  ctx.lineWidth = 1;

  switch (kind) {
    case 'grain': {
      // Long grain with gentle waviness, plus a few darker figure lines.
      const n = 13;
      for (let i = 1; i < n; i++) {
        const v = i / n;
        ctx.strokeStyle = shade(base, i % 4 === 0 ? 0.84 : 0.93);
        ctx.globalAlpha = i % 4 === 0 ? 0.55 : 0.34;
        ctx.beginPath();
        for (let s = 0; s <= 16; s++) {
          const u = s / 16;
          const wob = 0.012 * Math.sin(u * 7 + i * 2.1) + 0.006 * Math.sin(u * 17 + i);
          const p = uv(u, Math.min(0.995, Math.max(0.005, v + wob)));
          if (!p) break;
          s ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y);
        }
        ctx.stroke();
      }
      break;
    }
    case 'brick':
    case 'block': {
      const rows = kind === 'brick' ? 9 : 5;
      const cols = kind === 'brick' ? 6 : 3;
      ctx.strokeStyle = shade(base, 1.14);
      ctx.globalAlpha = 0.5;
      for (let r = 1; r < rows; r++) line(0, r / rows, 1, r / rows, 4);
      for (let r = 0; r < rows; r++) {
        const off = r % 2 ? 0.5 / cols : 0;
        for (let c = 0; c <= cols; c++) {
          const u = c / cols + off;
          if (u <= 0.001 || u >= 0.999) continue;
          line(u, r / rows, u, (r + 1) / rows, 2);
        }
      }
      break;
    }
    case 'sheen': {
      const a = uv(0, 0), b = uv(1, 1);
      if (a && b) {
        const g = ctx.createLinearGradient(a.x, a.y, b.x, b.y);
        g.addColorStop(0, shade(base, 0.86));
        g.addColorStop(0.45, shade(base, 1.16));
        g.addColorStop(0.6, shade(base, 1.02));
        g.addColorStop(1, shade(base, 0.88));
        ctx.globalAlpha = 0.85;
        ctx.fillStyle = g;
        ctx.fill();
      }
      break;
    }
    case 'glass': {
      const a = uv(0, 1), b = uv(1, 0);
      if (a && b) {
        const g = ctx.createLinearGradient(a.x, a.y, b.x, b.y);
        g.addColorStop(0, 'rgba(255,255,255,0.30)');
        g.addColorStop(0.5, 'rgba(255,255,255,0.06)');
        g.addColorStop(1, 'rgba(255,255,255,0.22)');
        ctx.globalAlpha = 1;
        ctx.fillStyle = g;
        ctx.fill();
      }
      ctx.strokeStyle = 'rgba(255,255,255,0.5)';
      ctx.globalAlpha = 0.5;
      line(0.12, 0.95, 0.42, 0.05, 2);
      line(0.2, 0.95, 0.5, 0.05, 2);
      break;
    }
    case 'fibre': {
      ctx.strokeStyle = shade(base, 0.88);
      ctx.globalAlpha = 0.32;
      for (let i = 0; i < 26; i++) {
        const v = (i * 0.137) % 1, u = (i * 0.311) % 1;
        line(Math.max(0, u - 0.08), v, Math.min(1, u + 0.08), v + 0.02, 2);
      }
      break;
    }
    case 'speckle': {
      ctx.fillStyle = shade(base, 0.9);
      ctx.globalAlpha = 0.3;
      for (let i = 0; i < 40; i++) {
        const u = (i * 0.2371) % 1, v = (i * 0.4813) % 1;
        const p = uv(u, v);
        if (p) ctx.fillRect(p.x, p.y, 1.6, 1.6);
      }
      break;
    }
    default:
      break;
  }
  ctx.restore();
}

/** A small swatch for menus and legends. */
export function swatchCSS(m) {
  const base = materialColor(m);
  const kind = textureOf(m);
  if (kind === 'grain') {
    return `repeating-linear-gradient(92deg, ${base} 0 3px, ${shade(base, 0.9)} 3px 4px)`;
  }
  if (kind === 'brick' || kind === 'block') {
    return `repeating-linear-gradient(0deg, ${base} 0 4px, ${shade(base, 1.14)} 4px 5px)`;
  }
  if (kind === 'sheen') {
    return `linear-gradient(115deg, ${shade(base, 0.85)}, ${shade(base, 1.18)} 45%, ${shade(base, 0.9)})`;
  }
  if (kind === 'glass') return `linear-gradient(115deg, ${base}, rgba(255,255,255,.65) 50%, ${base})`;
  if (kind === 'fibre') {
    return `repeating-linear-gradient(45deg, ${base} 0 3px, ${shade(base, 0.9)} 3px 5px)`;
  }
  return base;
}

/** Short label for on-face annotation, where space is tight. */
const SHORT = {
  gypsum: 'Plasterboard', 'gypsum-acoustic': 'Acoustic board', 'gypsum-fibre': 'Fibreboard',
  'cement-board': 'Cement board', 'fibre-cement': 'Fibre cement', 'osb-plus-gypsum': 'Calcium silicate',
  plywood: 'Plywood', mdf: 'MDF', osb: 'OSB', chipboard: 'Chipboard',
  softwood: 'Softwood', hardwood: 'Hardwood',
  concrete: 'Concrete', 'concrete-block-dense': 'Dense block',
  'concrete-block-light': 'Aerated block', brick: 'Brick', screed: 'Screed',
  steel: 'Steel', 'steel-stud': 'Steel stud', aluminium: 'Aluminium', lead: 'Lead',
  glass: 'Glass', 'glass-laminated': 'Laminated glass',
  'glass-acoustic-laminated': 'Acoustic glass', acrylic: 'Acrylic', polycarbonate: 'Polycarbonate',
  mlv: 'MLV', 'rubber-epdm': 'EPDM rubber', 'bitumen-sheet': 'Bitumen sheet',
  'damping-compound': 'Damping compound', air: 'Air',
};

export function shortMaterialName(m) {
  if (!m) return '';
  return SHORT[m.id] || m.name.replace(/\s*\([^)]*\)/, '');
}
