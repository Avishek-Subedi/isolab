/**
 * Zero-dependency test harness: suite/test/assert plus the result registry.
 * Kept separate from run.mjs so that test files can import it without creating
 * an import cycle with the runner's top-level await.
 */

const filter = process.argv[2] || '';
let passed = 0, failed = 0, skipped = 0;
const failures = [];
let currentSuite = '';

export function suite(name, fn) {
  currentSuite = name;
  console.log(`\n\x1b[1m${name}\x1b[0m`);
  fn();
}

export function test(name, fn) {
  const full = `${currentSuite} > ${name}`;
  if (filter && !full.toLowerCase().includes(filter.toLowerCase())) { skipped++; return; }
  try {
    fn();
    passed++;
    console.log(`  \x1b[32m✓\x1b[0m ${name}`);
  } catch (e) {
    failed++;
    failures.push({ full, error: e });
    console.log(`  \x1b[31m✗\x1b[0m ${name}`);
    console.log(`      \x1b[31m${e.message}\x1b[0m`);
  }
}

export const assert = {
  ok(v, msg) { if (!v) throw new Error(msg || `expected truthy, got ${v}`); },
  equal(a, b, msg) { if (a !== b) throw new Error(msg || `expected ${b}, got ${a}`); },
  close(a, b, tol, msg) {
    if (!isFinite(a)) throw new Error(msg || `expected finite number, got ${a}`);
    if (Math.abs(a - b) > tol) throw new Error(msg || `expected ${b} ± ${tol}, got ${a.toFixed(3)} (error ${(a - b).toFixed(3)})`);
  },
  greater(a, b, msg) { if (!(a > b)) throw new Error(msg || `expected ${a} > ${b}`); },
  less(a, b, msg) { if (!(a < b)) throw new Error(msg || `expected ${a} < ${b}`); },
  between(a, lo, hi, msg) {
    if (!(a >= lo && a <= hi)) throw new Error(msg || `expected ${lo} <= ${a} <= ${hi}`);
  },
  finiteArray(arr, msg) {
    for (let i = 0; i < arr.length; i++) {
      if (!isFinite(arr[i])) throw new Error(msg || `non-finite value at index ${i}: ${arr[i]}`);
    }
  },
  monotonic(arr, dir = 'up', tol = 0, msg) {
    for (let i = 1; i < arr.length; i++) {
      const d = arr[i] - arr[i - 1];
      if (dir === 'up' && d < -tol) throw new Error(msg || `not monotonic up at ${i}: ${arr[i - 1]} -> ${arr[i]}`);
      if (dir === 'down' && d > tol) throw new Error(msg || `not monotonic down at ${i}: ${arr[i - 1]} -> ${arr[i]}`);
    }
  },
  throws(fn, msg) {
    try { fn(); } catch { return; }
    throw new Error(msg || 'expected function to throw');
  },
};


/** Snapshot of results, read by the runner after all suites have executed. */
export function results() {
  return { passed, failed, skipped, failures };
}
