// Enforces ADR-0001's visibility rule: every file that imports a DeepSeek Harness package states
// which seam it uses and whether that seam is direct or wrapped, in a greppable marker:
//   // @hima-seam <seam-name> direct|wrapped
// Every file, not only the bundle's: the test support, the contract tests, and the acceptance
// script face dsh too, and the claim in ADR-0001 and the README is about files that face dsh.
// A type-only import counts: a bare `import type {}` of a dsh package is how a file takes that
// package's declaration merge, which is exactly the seam moving under it that ADR-0001 tracks.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const roots = ['packages', 'test', 'scripts'];
const marker = /^\/\/ @hima-seam [a-z0-9-]+ (direct|wrapped)$/m;
const dshImport = /from ['"]@deepseek-ai\//;
const failures = [];

function walk(dir) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'lib') continue;
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(ts|tsx|mts|js|mjs)$/.test(name)) {
      const text = readFileSync(p, 'utf8');
      if (dshImport.test(text) && !marker.test(text)) failures.push(p);
    }
  }
}
for (const r of roots) walk(r);
if (failures.length) {
  console.error('Files import @deepseek-ai/* without a "// @hima-seam <name> direct|wrapped" marker:\n  ' + failures.join('\n  '));
  process.exit(1);
}
console.log('seams: every dsh-facing source file declares its seam');
