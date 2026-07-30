/**
 * Zero-dependency test runner.
 * Usage: node tests/run.mjs [filter]
 */

import { results } from './harness.mjs';

await import('./physics.test.mjs');
await import('./leaks.test.mjs');
await import('./system.test.mjs');
await import('./validation.test.mjs');

const { passed, failed, skipped, failures } = results();

console.log('\n' + '\u2500'.repeat(70));
console.log(`\x1b[1m${passed} passed\x1b[0m` +
  (failed ? `, \x1b[31m${failed} failed\x1b[0m` : '') +
  (skipped ? `, ${skipped} skipped` : ''));
if (failed) {
  console.log('\nFailures:');
  for (const f of failures) {
    console.log(`  ${f.full}`);
    console.log(`    ${f.error.message}`);
  }
  process.exit(1);
}
