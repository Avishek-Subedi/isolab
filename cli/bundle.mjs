#!/usr/bin/env node
/**
 * Single-file bundler.
 *
 * Produces one self-contained HTML page containing the whole engine, the data
 * layer, the UI and the stylesheet, so IsoLab can be hosted anywhere that
 * serves a static file — including environments where a strict CSP forbids
 * fetching sibling modules.
 *
 * There is no dependency to add for this: the module graph is small (24 files),
 * acyclic and plain ESM, so a correct bundle is a lazy module registry plus a
 * mechanical import/export rewrite.
 *
 *   node cli/bundle.mjs [--out dist/isolab.html] [--artifact]
 *
 * --artifact emits a fragment (no <!doctype>/<html>/<head>/<body>) for hosts
 * that supply their own document skeleton.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, normalize, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = normalize(join(fileURLToPath(new URL('.', import.meta.url)), '..'));
const args = process.argv.slice(2);
const flag = (n) => args.includes('--' + n);
const opt = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : d; };

const ARTIFACT = flag('artifact');
const OUT = opt('out', ARTIFACT ? 'dist/isolab.artifact.html' : 'dist/isolab.html');
const ENTRY = 'src/ui/app.mjs';

/* ------------------------------------------------------------------ *
 * 1. Walk the module graph
 * ------------------------------------------------------------------ */

/** @type {Map<string, {src:string, deps:string[]}>} */
const modules = new Map();

const resolve = (fromId, spec) => normalize(join(dirname(fromId), spec)).split('\\').join('/');

function load(id) {
  if (modules.has(id)) return;
  const src = readFileSync(join(ROOT, id), 'utf8');
  const deps = [];
  for (const m of src.matchAll(/from\s+'([^']+)'/g)) {
    if (!m[1].startsWith('.')) throw new Error(`${id}: bare specifier "${m[1]}" cannot be bundled`);
    deps.push(resolve(id, m[1]));
  }
  modules.set(id, { src, deps });
  for (const d of deps) load(d);
}

load(ENTRY);

/* ------------------------------------------------------------------ *
 * 2. Rewrite each module: imports -> __req(), exports -> a returned object
 * ------------------------------------------------------------------ */

function transform(id, src) {
  const exported = new Set();
  let out = src;

  // --- imports (single- and multi-line) ---
  out = out.replace(
    /^import\s+\*\s+as\s+(\w+)\s+from\s+'([^']+)';?[ \t]*$/gm,
    (_, ns, spec) => `const ${ns} = __req(${JSON.stringify(resolve(id, spec))});`
  );
  out = out.replace(
    /^import\s*\{([\s\S]*?)\}\s*from\s*'([^']+)';?[ \t]*$/gm,
    (_, names, spec) => {
      const binds = names
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) => {
          const as = s.match(/^(\w+)\s+as\s+(\w+)$/);
          return as ? `${as[1]}: ${as[2]}` : s;
        })
        .join(', ');
      return `const { ${binds} } = __req(${JSON.stringify(resolve(id, spec))});`;
    }
  );
  if (/^import\b/m.test(out)) {
    throw new Error(`${id}: unhandled import form:\n` + out.match(/^import\b.*$/m)[0]);
  }

  // --- named exports ---
  out = out.replace(/^export\s+(async\s+)?function\s+(\w+)/gm, (_, a, n) => {
    exported.add(n); return `${a || ''}function ${n}`;
  });
  out = out.replace(/^export\s+class\s+(\w+)/gm, (_, n) => { exported.add(n); return `class ${n}`; });
  out = out.replace(/^export\s+(const|let|var)\s+(\w+)/gm, (_, k, n) => {
    exported.add(n); return `${k} ${n}`;
  });
  out = out.replace(/^export\s*\{([^}]*)\};?[ \t]*$/gm, (_, names) => {
    for (const s of names.split(',')) {
      const t = s.trim();
      if (!t) continue;
      const as = t.match(/^(\w+)\s+as\s+(\w+)$/);
      exported.add(as ? as[2] : t);
    }
    return '';
  });
  if (/^export\b/m.test(out)) {
    throw new Error(`${id}: unhandled export form:\n` + out.match(/^export\b.*$/m)[0]);
  }

  const assign = exported.size
    ? `\nObject.assign(__e, { ${[...exported].join(', ')} });`
    : '';

  return `__M[${JSON.stringify(id)}] = (__e, __req) => {\n${out}${assign}\n};`;
}

const runtime = `
/* IsoLab single-file bundle — lazy module registry.
   Each module is a factory; __req evaluates once and caches. The graph is
   acyclic, so evaluation order falls out of the dependency walk. */
const __M = Object.create(null);
const __C = Object.create(null);
function __req(id) {
  if (id in __C) return __C[id];
  const e = (__C[id] = {});
  const f = __M[id];
  if (!f) throw new Error('module not bundled: ' + id);
  f(e, __req);
  return e;
}
`.trim();

const body = [...modules.entries()]
  .map(([id, { src }]) => transform(id, src))
  .join('\n\n');

const script = `${runtime}\n\n${body}\n\n__req(${JSON.stringify(ENTRY)});\n`;

/* ------------------------------------------------------------------ *
 * 3. Assemble the page
 * ------------------------------------------------------------------ */

const css = readFileSync(join(ROOT, 'src/ui/styles.css'), 'utf8');
const html = readFileSync(join(ROOT, 'src/ui/index.html'), 'utf8');

// Take everything between <body> and </body>, minus the module script tag.
const inner = html
  .slice(html.indexOf('<body>') + 6, html.lastIndexOf('</body>'))
  .replace(/<script[^>]*src="app\.mjs"[^>]*><\/script>/, '')
  .trim();

const title = 'IsoLab — acoustic isolation simulator';

const page = ARTIFACT
  ? `<title>${title}</title>\n<style>\n${css}\n</style>\n\n${inner}\n\n<script type="module">\n${script}\n</script>\n`
  : `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>
${css}
</style>
</head>
<body>
${inner}
<script type="module">
${script}
</script>
</body>
</html>
`;

mkdirSync(join(ROOT, dirname(OUT)), { recursive: true });
writeFileSync(join(ROOT, OUT), page);

const kb = (s) => (Buffer.byteLength(s) / 1024).toFixed(0) + ' KB';
console.log(`\n  bundled ${modules.size} modules -> ${OUT}`);
console.log(`    script ${kb(script)}   css ${kb(css)}   markup ${kb(inner)}`);
console.log(`    total  ${kb(page)}${ARTIFACT ? '   (artifact fragment)' : ''}\n`);
