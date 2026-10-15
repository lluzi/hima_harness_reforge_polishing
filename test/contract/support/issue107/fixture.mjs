// Public inputs only. This module never opens the operator/evaluator directories.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export async function publicFixture(phase) {
  assert.ok(['task1', 'task2'].includes(phase));
  const lock = JSON.parse(await readFile(new URL('./source-lock.json', import.meta.url), 'utf8'));
  const names = phase === 'task1' ? ['task1.md', 'document-a.md', 'document-b.md'] : ['task2.md'];
  return Promise.all(names.map(async name => {
    const row = lock.files.find(row => row.path === 'members/' + name);
    assert.ok(row && row.visibility === 'member-visible' && row.releasePhases.includes(phase));
    const bytes = await readFile(new URL('./fixtures/' + name, import.meta.url));
    assert.equal(bytes.length, row.bytes); assert.equal(sha256(bytes), row.sha256, name);
    return { name, bytes, text: bytes.toString('utf8'), identity: row };
  }));
}
