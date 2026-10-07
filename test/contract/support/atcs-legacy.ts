import path from 'node:path';
import { cp, rm, access } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import type { LayoutGraph } from '@hima/harness';
import { repoRoot } from './dsh-home.ts';

export const ATCS_PACK_ID = 'agentic-timing-closure-system';
const snapshotFiles = ['contract.yml', 'graph.yml', 'semantics.yml', 'INTENT.md', 'SPEC.md', 'FABRIC.md'] as const;

export async function copyLegacyAtcsPack(targetPacksDir: string): Promise<string> {
  const source = path.join(repoRoot, 'packs', ATCS_PACK_ID);
  const target = path.join(targetPacksDir, ATCS_PACK_ID);
  await cp(source, target, { recursive: true, filter: (file) => !file.includes('__pycache__') });
  for (const file of snapshotFiles) {
    await cp(path.join(target, 'legacy/0.2.10', file), path.join(target, file));
  }
  for (const directory of ['knowledge', 'readers', 'rules', 'choosers']) {
    const archived = path.join(target, 'legacy/0.2.10', directory);
    await access(archived);
    await cp(archived, path.join(target, directory), { recursive: true });
  }
  // This composite fixture overlays retained 0.2.10 declarations on shared current tooling;
  // neither the current test record nor its release seal identifies those composite bytes.
  await rm(path.join(target, 'TEST.md'), { force: true });
  await rm(path.join(target, 'VERSION.yml'), { force: true });
  return target;
}

export function legacyAtcsGraph(): LayoutGraph {
  return parse(readFileSync(
    path.join(repoRoot, 'packs', ATCS_PACK_ID, 'legacy/0.2.10/graph.yml'), 'utf8')) as LayoutGraph;
}
