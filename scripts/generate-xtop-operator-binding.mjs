#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BUILTIN_TCL_ADAPTER_DIGEST,
  interactiveCommandsDigest,
  interactiveEnvironmentEvidence,
  loadPack,
  packDigestExcludes,
} from '../packages/harness/lib/index.js';

const usage = 'usage: node scripts/generate-xtop-operator-binding.mjs --environment ABSOLUTE_JSON --output ABSOLUTE_JSON';
const args = process.argv.slice(2);
if (args.length === 1 && args[0] === '--help') { console.log(usage); process.exit(0); }
if (args.length !== 4 || args[0] !== '--environment' || args[2] !== '--output') throw new Error(usage);
const environmentArg = args[1];
const output = args[3];
if (!environmentArg || !output || !path.isAbsolute(environmentArg) || !path.isAbsolute(output)) throw new Error(usage);

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const environmentFile = await realpath(environmentArg);
const bytes = await readFile(environmentFile);
const evidence = interactiveEnvironmentEvidence.parse(JSON.parse(bytes.toString('utf8')));
if (evidence.site !== 'linglong-swerv28' || evidence.toolId !== 'run-xtop-fix') {
  throw new Error('the production generator accepts only linglong-swerv28 / run-xtop-fix evidence');
}
const writeRoot = path.posix.resolve(evidence.confinement.privateWriteRoot);
if (environmentFile === writeRoot || environmentFile.startsWith(`${writeRoot}/`)) {
  throw new Error('the administrator environment evidence must stay outside the production write root');
}

const pack = loadPack(path.join(repo, 'packs'), 'xtop-timing-closure');
const tool = pack.contract.tools.find((candidate) => candidate.id === 'run-xtop-fix');
if (!tool?.interactive || tool.interactive.mode !== 'hybrid' || tool.interactive.argv?.[0] !== evidence.wrapper.path) {
  throw new Error('the current retained XTop Pack has no matching hybrid production Operator startup');
}
const packDigest = pack.folder.digest(packDigestExcludes);
const commandsDigest = interactiveCommandsDigest(tool);
if (evidence.pack.id !== pack.id || evidence.pack.digest !== packDigest
    || evidence.adapter.id !== 'hima-tcl-line-v1' || evidence.adapter.digest !== BUILTIN_TCL_ADAPTER_DIGEST
    || evidence.commandsDigest !== commandsDigest) {
  throw new Error('qualification evidence does not name the current retained Pack, adapter and command classification');
}
const environmentSha256 = createHash('sha256').update(bytes).digest('hex');
const document = {
  schema: 'hima-interactive-bindings/1',
  bindings: [{
    id: `linglong-swerv28:xtop-operator-v1:${packDigest.slice(0, 16)}`,
    site: 'linglong-swerv28', packDigest, toolId: tool.id,
    adapter: 'hima-tcl-line-v1', adapterHash: BUILTIN_TCL_ADAPTER_DIGEST,
    commandsDigest,
    environment: { id: 'linglong-swerv28:xtop-operator-v1', file: environmentFile, sha256: environmentSha256 },
    mutation: 'qualified',
  }],
};
await writeFile(output, `${JSON.stringify(document, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
console.log(JSON.stringify({ output, site: evidence.site, pack: `${pack.id}@${pack.contract.version}`, packDigest }));
