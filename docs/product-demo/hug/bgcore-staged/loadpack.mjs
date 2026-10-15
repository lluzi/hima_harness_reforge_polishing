const A='/Users/lluzi/code/hima_harness_reforge_polishing/.hima-tmp/hug-release/app-rc2/HimaHarness.app/Contents/Resources/app/node_modules/@hima/harness/lib/index.js';
const { loadPack } = await import(A);
const p = loadPack(new URL('.', import.meta.url).pathname, 'bgcore-frontend');
const fs = await import('node:fs');
fs.writeFileSync(new URL('./pack-loaded.json', import.meta.url), JSON.stringify({graph:p.graph, contract:p.contract, digest:p.digest, dir:p.dir}, null, 1));
console.log('ok', Object.keys(p), p.digest);
