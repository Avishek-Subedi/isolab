/**
 * Simple mode — a guided, visual builder.
 *
 * The expert UI exposes every input the engine has, which is right for an
 * acoustician and wrong for someone who just wants to build a booth. This
 * mode asks four questions in plain language, answers them with big clickable
 * cards instead of dropdowns and sliders, and shows one number.
 *
 * It drives exactly the same engine — nothing here is a simplified model, only
 * a simplified set of choices.
 */

import { MATERIALS } from '../data/materials.mjs';
import { swatchCSS } from './appearance.mjs';

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

/** The wall materials worth offering without explanation. */
export const SIMPLE_MATERIALS = [
  { id: 'plywood', name: 'Plywood', note: 'Common, stiff' },
  { id: 'mdf', name: 'MDF', note: 'Best value wood' },
  { id: 'osb', name: 'OSB', note: 'Cheap sheathing' },
  { id: 'chipboard', name: 'Chipboard', note: 'Cheap, heavy' },
  { id: 'hardwood', name: 'Oak / hardwood', note: 'Heavy, pricey' },
  { id: 'gypsum', name: 'Plasterboard', note: 'Cheapest mass' },
  { id: 'gypsum-acoustic', name: 'Acoustic board', note: 'Denser board' },
  { id: 'cement-board', name: 'Cement board', note: 'Very dense' },
  { id: 'concrete', name: 'Concrete', note: 'The best there is' },
  { id: 'glass-laminated', name: 'Laminated glass', note: 'For windows' },
];

/** Door choices, worst to best, with what they actually cost you. */
const DOORS = [
  { id: 'hollow', name: 'Old hollow door', sub: 'What most people already have', tone: 'bad' },
  { id: 'solid-core', name: 'Solid door + tape', sub: 'Cheap upgrade', tone: 'warn' },
  { id: 'mdf-heavy', name: 'Home-made heavy door', sub: 'Two sheets of MDF, good seals', tone: 'ok' },
  { id: 'acoustic-45', name: 'Proper acoustic door', sub: 'Bought as a set', tone: 'good' },
  { id: 'double-airlock', name: 'Two doors + lobby', sub: 'Best value for real isolation', tone: 'good' },
];

const SOURCES = [
  { id: 'speech-normal', name: 'Talking', level: 60, icon: '🗣' },
  { id: 'speech-raised', name: 'Loud voice', level: 72, icon: '📢' },
  { id: 'singing-male', name: 'Singing', level: 92, icon: '🎤' },
  { id: 'scream', name: 'Screaming', level: 100, icon: '😱' },
  { id: 'guitar-electric-amp', name: 'Guitar amp', level: 105, icon: '🎸' },
  { id: 'drums_acoustic', name: 'Drums', level: 110, icon: '🥁' },
];

const LISTENERS = [
  { id: 'bedroom-rented', sep: 'none', dist: 1, name: 'Same room', sub: 'Standing next to it' },
  { id: 'apartment-neighbour', sep: 'brick-215', dist: 3, name: 'Neighbour', sub: 'Through the party wall' },
  { id: 'apartment-below', sep: 'timber-floor', dist: 3, name: 'Flat below', sub: 'Through the floor' },
  { id: 'outdoor-garden', sep: 'none', dist: 5, name: 'Outside', sub: 'In the garden' },
];

const VENTS = [
  { id: 'open-hole', name: 'Just a hole', tone: 'bad' },
  { id: 'flex-2bend', name: 'Flexible duct', tone: 'warn' },
  { id: 'labyrinth', name: 'Lined, with bends', tone: 'ok' },
  { id: 'silenced-pro', name: 'Proper silencer', tone: 'good' },
];

/**
 * @param {HTMLElement} root
 * @param {object} ctx  { state, result, selectedSurface, on }
 */
export function renderSimple(root, ctx) {
  const { state, result, on } = ctx;
  root.innerHTML = '';

  /* ---------- the one number that matters ---------- */
  const t = result.totals;
  const lvl = t.outsideWithFanA;
  const tone = lvl > 45 ? 'bad' : lvl > 33 ? 'warn' : 'good';

  const answer = el('div', 'sim-answer ' + tone);
  const top = el('div', 'sim-answer-top');
  top.appendChild(el('span', 'sim-answer-label', 'Someone outside hears'));
  const big = el('div', 'sim-big');
  big.appendChild(el('span', 'sim-big-num', lvl.toFixed(1)));
  big.appendChild(el('span', 'sim-big-unit', 'dB'));
  top.appendChild(big);
  top.appendChild(el('p', 'sim-answer-plain', plainLevel(lvl)));
  answer.appendChild(top);

  const cmp = el('div', 'sim-compare');
  cmp.appendChild(el('span', null, `Inside it's ${t.insideA.toFixed(0)} dB.`));
  cmp.appendChild(el('span', null, `The room outside is already ${t.backgroundA.toFixed(0)} dB.`));
  cmp.appendChild(el('strong', null, verdictLine(t.audibleExcessA)));
  answer.appendChild(cmp);

  // Biggest leak + one-tap fix
  const worst = result.breakdown.weakest;
  if (worst && worst.percent > 20) {
    const fix = el('div', 'sim-worst');
    fix.appendChild(el('span', 'sim-worst-label', 'Biggest leak'));
    fix.appendChild(el('strong', null, friendlyPath(worst.label) + ` — ${worst.percent.toFixed(0)}% of it`));
    const suggestion = suggestFix(worst, state);
    if (suggestion) {
      const b = el('button', 'sim-fix-btn', suggestion.label);
      b.addEventListener('click', () => on.patch(suggestion.patch));
      fix.appendChild(b);
    }
    answer.appendChild(fix);
  }
  // If one path dominates, say so plainly — otherwise changing a wall appears
  // to "do nothing" and the interface feels broken when it is actually right.
  if (worst && worst.percent > 45) {
    const note = el('p', 'sim-answer-note',
      `Almost everything is escaping through ${friendlyPath(worst.label)}, so changing the walls will barely move this number until that is fixed.`);
    answer.appendChild(note);
  }
  root.appendChild(answer);

  /* ---------- step 1: size ---------- */
  const s1 = step('1', 'How big is it?', 'Or drag the arrows on the booth.');
  const sizes = el('div', 'sim-sizes');
  for (const [key, label] of [['L', 'Length'], ['W', 'Width'], ['H', 'Height']]) {
    const row = el('div', 'sim-size-row');
    row.appendChild(el('span', 'sim-size-label', label));
    const minus = el('button', 'sim-step-btn', '−');
    const val = el('span', 'sim-size-val', (state.spec[key] ?? 1.4).toFixed(1) + ' m');
    const plus = el('button', 'sim-step-btn', '+');
    const lim = key === 'H' ? [1.8, 4] : [0.8, 6];
    minus.addEventListener('click', () => on.patch({ [key]: clamp((state.spec[key] ?? 1.4) - 0.1, lim) }));
    plus.addEventListener('click', () => on.patch({ [key]: clamp((state.spec[key] ?? 1.4) + 0.1, lim) }));
    row.append(minus, val, plus);
    sizes.appendChild(row);
  }
  s1.body.appendChild(sizes);
  const area = result.geometry;
  s1.body.appendChild(el('p', 'sim-hint',
    `Floor space ${(area.L * area.W).toFixed(1)} m². ${area.volume < 2.5 ? 'That is tight for one person.' : 'Room for one person and a mic stand.'}`));
  root.appendChild(s1.card);

  /* ---------- step 2: material ---------- */
  const target = ctx.selectedSurface;
  const s2 = step('2', 'What are the walls made of?',
    target ? `Changing the ${target} only. Click another face to switch, or use the button below.`
           : 'Click a wall in the picture to change just that one.');

  const grid = el('div', 'sim-mat-grid');
  const currentId = currentMaterialId(state, target);
  for (const m of SIMPLE_MATERIALS) {
    const mat = MATERIALS[m.id];
    const card = el('button', 'sim-mat' + (m.id === currentId ? ' on' : ''));
    const sw = el('span', 'sim-mat-swatch');
    sw.style.background = swatchCSS(mat);
    card.appendChild(sw);
    card.appendChild(el('span', 'sim-mat-name', m.name));
    card.appendChild(el('span', 'sim-mat-note', m.note));
    card.title = mat.notes;
    card.addEventListener('click', () => on.setMaterial(m.id, target));
    grid.appendChild(card);
  }
  s2.body.appendChild(grid);

  // thickness + second layer
  const thick = el('div', 'sim-inline');
  thick.appendChild(el('span', 'sim-inline-label', 'Thickness'));
  const tv = currentThickness(state, target);
  const curMat = MATERIALS[currentMaterialId(state, target) || 'plywood'];
  for (const mm of (curMat.availableThicknessesMm || [9, 12, 18, 25]).slice(0, 7)) {
    const b = el('button', 'sim-chip' + (Math.abs(tv - mm) < 0.6 ? ' on' : ''), mm + ' mm');
    b.addEventListener('click', () => on.setThickness(mm, target));
    thick.appendChild(b);
  }
  s2.body.appendChild(thick);

  const dbl = el('div', 'sim-inline');
  dbl.appendChild(el('span', 'sim-inline-label', 'Build'));
  const isDouble = currentIsDouble(state, target);
  for (const [v, label, note] of [[false, 'Single skin', 'one layer'], [true, 'Double wall + insulation', 'far better']]) {
    const b = el('button', 'sim-chip wide' + (isDouble === v ? ' on' : ''), label);
    b.title = note;
    b.addEventListener('click', () => on.setDouble(v, target));
    dbl.appendChild(b);
  }
  s2.body.appendChild(dbl);

  if (target) {
    const all = el('button', 'sim-ghost-btn', 'Use this on every wall');
    all.addEventListener('click', () => on.applyToAll());
    s2.body.appendChild(all);
  }
  root.appendChild(s2.card);

  /* ---------- step 3: door + vent ---------- */
  const s3 = step('3', 'What about the door?', 'This is usually the biggest leak.');
  s3.body.appendChild(pickList(DOORS, state.spec.door, (id) => on.patch({ door: id })));
  s3.body.appendChild(el('p', 'sim-sub-label', 'Air vent'));
  s3.body.appendChild(pickList(VENTS, state.spec.ventPreset, (id) => on.patch({ ventPreset: id })));
  s3.body.appendChild(el('p', 'sim-hint',
    'A booth with no vent gets dangerous within about 15 minutes, so this is not optional.'));
  root.appendChild(s3.card);

  /* ---------- step 4: sound + listener ---------- */
  const s4 = step('4', 'What happens inside, and who might hear?');
  const srcGrid = el('div', 'sim-src-grid');
  for (const s of SOURCES) {
    const b = el('button', 'sim-src' + (state.spec.sourceId === s.id ? ' on' : ''));
    b.appendChild(el('span', 'sim-src-icon', s.icon));
    b.appendChild(el('span', 'sim-src-name', s.name));
    b.appendChild(el('span', 'sim-src-db', s.level + ' dB'));
    b.addEventListener('click', () => on.patch({ sourceId: s.id, level: s.level }));
    srcGrid.appendChild(b);
  }
  s4.body.appendChild(srcGrid);

  const loud = el('div', 'sim-inline');
  loud.appendChild(el('span', 'sim-inline-label', 'Loudness'));
  const sl = el('input');
  sl.type = 'range'; sl.min = '40'; sl.max = '120'; sl.step = '1';
  sl.value = String(state.spec.level ?? 100);
  sl.className = 'sim-range';
  const slv = el('span', 'sim-inline-val', (state.spec.level ?? 100) + ' dB');
  sl.addEventListener('input', () => { slv.textContent = sl.value + ' dB'; on.patch({ level: Number(sl.value) }, true); });
  loud.append(sl, slv);
  s4.body.appendChild(loud);

  s4.body.appendChild(el('p', 'sim-sub-label', 'Who is listening?'));
  const curListener = LISTENERS.find((l) => l.id === state.spec.envId) || LISTENERS[0];
  s4.body.appendChild(pickList(
    LISTENERS.map((l) => ({ id: l.id, name: l.name, sub: l.sub })),
    curListener.id,
    (id) => {
      const l = LISTENERS.find((x) => x.id === id);
      on.patch({ envId: l.id, separatingElementId: l.sep, distanceM: l.dist });
    }
  ));
  root.appendChild(s4.card);

  /* ---------- cost ---------- */
  const money = el('div', 'sim-cost');
  money.appendChild(el('span', null, 'Rough materials cost'));
  money.appendChild(el('strong', null, '£' + Math.round(result.cost.total).toLocaleString()));
  money.appendChild(el('span', 'sim-hint', 'Materials only — no labour, tools or waste.'));
  root.appendChild(money);
}

/* ---------------- helpers ---------------- */

function step(n, title, hint) {
  const card = el('section', 'sim-step');
  const head = el('div', 'sim-step-head');
  head.appendChild(el('span', 'sim-step-n', n));
  const tw = el('div');
  tw.appendChild(el('h3', 'sim-step-title', title));
  if (hint) tw.appendChild(el('p', 'sim-hint', hint));
  head.appendChild(tw);
  card.appendChild(head);
  const body = el('div', 'sim-step-body');
  card.appendChild(body);
  return { card, body };
}

function pickList(items, current, onPick) {
  const wrap = el('div', 'sim-picks');
  for (const it of items) {
    const b = el('button', 'sim-pick' + (it.id === current ? ' on' : '') + (it.tone ? ' t-' + it.tone : ''));
    b.appendChild(el('span', 'sim-pick-name', it.name));
    if (it.sub) b.appendChild(el('span', 'sim-pick-sub', it.sub));
    b.addEventListener('click', () => onPick(it.id));
    wrap.appendChild(b);
  }
  return wrap;
}

const clamp = (v, [lo, hi]) => Math.round(Math.max(lo, Math.min(hi, v)) * 10) / 10;

function plainLevel(dBA) {
  if (dBA < 20) return 'Silent. You would not know it was on.';
  if (dBA < 28) return 'About as loud as a quiet bedroom at night.';
  if (dBA < 35) return 'Very quiet — like a library.';
  if (dBA < 45) return 'Like a quiet office. Noticeable if the room is still.';
  if (dBA < 55) return 'About as loud as a normal conversation.';
  if (dBA < 65) return 'Loud conversation. Hard to ignore.';
  if (dBA < 75) return 'As loud as a vacuum cleaner in the room.';
  return 'Very loud. Nothing is being contained.';
}

function verdictLine(excess) {
  if (excess <= -5) return 'Nobody will hear it.';
  if (excess <= 0) return 'Effectively inaudible.';
  if (excess <= 3) return 'Only noticeable if someone listens for it.';
  if (excess <= 8) return 'Clearly audible, but probably tolerable.';
  if (excess <= 15) return 'Clearly audible. Likely to annoy someone at night.';
  return 'Far too loud. Expect complaints.';
}

function friendlyPath(label) {
  const l = String(label);
  if (/threshold/i.test(l)) return 'the gap under the door';
  if (/perimeter/i.test(l)) return 'the gap around the door';
  if (/frame-to-wall/i.test(l)) return 'the gap around the door frame';
  if (/door leaf|through the material/i.test(l)) return 'the door itself';
  if (/bore|duct|vent/i.test(l)) return 'the air vent';
  if (/socket/i.test(l)) return 'the socket box in the wall';
  if (/junction/i.test(l)) return 'the gap where the wall meets the floor';
  if (/flanking/i.test(l)) return 'vibration through the building';
  if (/window|vision/i.test(l)) return 'the window';
  if (/^(Front|Back|Left|Right|Ceiling|Floor)/i.test(l)) return 'the ' + l.split(' ')[0].toLowerCase() + ' wall';
  return l.length > 40 ? l.slice(0, 40) + '…' : l;
}

function suggestFix(worst, state) {
  const l = String(worst.label);
  const order = ['hollow', 'solid-core', 'mdf-heavy', 'acoustic-45', 'double-airlock'];
  if (/door/i.test(l)) {
    const i = order.indexOf(state.spec.door);
    if (i >= 0 && i < order.length - 1) {
      return { label: 'Fix it: upgrade the door', patch: { door: order[i + 1] } };
    }
  }
  const vents = ['open-hole', 'straight-unlined', 'flex-2bend', 'labyrinth', 'silenced-pro'];
  if (/duct|vent|bore/i.test(l)) {
    const i = vents.indexOf(state.spec.ventPreset);
    if (i >= 0 && i < vents.length - 1) {
      return { label: 'Fix it: better vent', patch: { ventPreset: vents[i + 1] } };
    }
  }
  if (/junction|socket|gap/i.test(l)) {
    return { label: 'Fix it: seal the gaps', patch: { __seal: true } };
  }
  return null;
}

/* --- reading the current state for a surface (or the global default) --- */

const SURFACES = ['front', 'back', 'left', 'right', 'ceiling', 'floor'];

export function currentOverride(state, surface) {
  const ov = state.surfaceOverrides || {};
  if (surface && typeof ov[surface] === 'object') return ov[surface];
  const any = SURFACES.map((k) => ov[k]).find((v) => v && typeof v === 'object');
  return any || null;
}

function currentMaterialId(state, surface) {
  const c = currentOverride(state, surface);
  return c ? c.leafA.materialId : null;
}
function currentThickness(state, surface) {
  const c = currentOverride(state, surface);
  return c ? c.leafA.thicknessMm : 18;
}
function currentIsDouble(state, surface) {
  const c = currentOverride(state, surface);
  return c ? !!c.leafB : null;
}

/** A sensible starting wall build-up for a chosen material. */
export function defaultBuildUp(materialId, prev) {
  const m = MATERIALS[materialId];
  // Snap to a thickness the material is actually sold in. Carrying the previous
  // number across gives nonsense like an 18 mm concrete wall, which is both
  // unbuildable and — because thin concrete has a coincidence dip right in the
  // vocal range — performs worse than the plywood it replaced. That reads as a
  // broken control when it is really a bad default.
  const avail = m.availableThicknessesMm || [18];
  const want = prev?.leafA?.thicknessMm ?? 18;
  const t = avail.reduce((best, v) => (Math.abs(v - want) < Math.abs(best - want) ? v : best), avail[0]);
  const base = {
    leafA: { materialId, thicknessMm: t },
    connection: 'separate-frame',
    bonding: 'screwed',
  };
  if (prev?.leafB) {
    base.leafB = { materialId: prev.leafB.materialId, thicknessMm: prev.leafB.thicknessMm };
    base.cavity = prev.cavity || { depthMm: 100, fillId: 'rockwool-rwa45', fillFraction: 0.7 };
  }
  return base;
}
