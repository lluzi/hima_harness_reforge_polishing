// L2: real Host storage and public report I/O, with explicitly seeded historical/write-boundary data.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHimaHome } from './support/dsh-home.ts';
import { bootInProcess } from './support/boot-inprocess.ts';
import { bootHimaHost } from './support/boot-host.ts';
import { api, openSession } from './support/hima-api.ts';
import { writeLocalSite } from './support/site.ts';
import { readExperience, writeExperience, EXPERIENCE_DIR } from '@hima/harness';
import type { ExperienceJson, ExperienceAnswer, RunView } from '@hima/harness';

const hash = (bytes: string) => createHash('sha256').update(bytes).digest('hex');
async function fixture() {
  const h = await createHimaHome();
  const { sitesDir } = await writeLocalSite(h, { allowedReadRoots: [h.workspace], allowedWriteRoots: [h.workspace] });
  const host = await bootInProcess(h);
  const ledger = host.ctx.hima.ledger;
  const run = await ledger.createRun({ campaignId: 'historical-fixture', siteId: 'local', status: 'cancelled', packId: 'recorded-method' });
  const deps = { ledger, sitesDir, packsDir: path.join(h.profileDir, 'packs') };
  let closed = false;
  const close = async () => { if (!closed) { closed = true; await host.dispose(); } };
  return { h, host, run, deps, close };
}

test('an ended Run without a workspace explains why no report is deliverable through projection and read API', async () => {
  const f = await fixture();
  try {
    const written = await writeExperience(f.deps, f.run.id);
    assert.equal(written.kind, 'nothing');
    assert.match(written.kind === 'nothing' ? written.why : '', /no campaign workspace/);
    const read = await readExperience(f.deps, f.run.id);
    assert.equal(read.kind, 'none');
    assert.match(read.kind === 'none' ? read.why ?? '' : '', /no Campaign workspace/);
    assert.equal(f.deps.ledger.records({ runId: f.run.id, type: 'experience' }).length, 0);
    await f.close();
    const next = await bootHimaHost(f.h);
    try {
      const cookie = await openSession(next);
      const view = await (await api(next, cookie, `/hima/api/runs/${f.run.id}`)).json() as RunView;
      assert.equal(view.experience, undefined);
      assert.match(view.experienceUnavailable ?? '', /No report file can be delivered/);
      const response = await api(next, cookie, `/hima/api/runs/${f.run.id}/experience`);
      assert.equal(response.status, 404);
      assert.match(await response.text(), /no Campaign workspace/);
      const page = await api(next, cookie, `/hima/?run=${f.run.id}`);
      assert.match(await page.text(), /data-hima-state-source="not-written"/);
    } finally { assert.equal(await next.stop(), 0, next.stderr()); }
  } finally { await f.close(); await f.h.dispose(); }
});

test('schema 1 saved bytes and hashes survive a new renderer, repeat read, write request and restarted Host', async () => {
  const f = await fixture();
  try {
    const writtenAt = '2026-09-01T12:00:00.000Z';
    const old: ExperienceJson = { schema: 'hima-experience/1', runId: f.run.id, campaignId: f.run.campaignId,
      pack: { id: 'recorded-method', version: 'historical' }, site: 'local', ending: { status: 'cancelled', reason: 'original wording' },
      generations: [], path: [], blockers: [], cancels: [], writtenAt };
    // An independently authored v1 file fixture, deliberately unlike the current renderer's text.
    const markdown = '# Preserved schema 1 report\n\nOriginal wording.\n';
    const json = JSON.stringify(old, null, 2) + '\n';
    const mdPath = path.join(f.h.workspace, 'historical.md');
    const jsonPath = path.join(f.h.workspace, 'historical.json');
    await writeFile(mdPath, markdown); await writeFile(jsonPath, json);
    const record = await f.deps.ledger.appendExperience(f.run.id, { writtenAt,
      markdown: { path: mdPath, sha256: hash(markdown), bytes: Buffer.byteLength(markdown) },
      json: { path: jsonPath, sha256: hash(json), bytes: Buffer.byteLength(json) } });
    const times = [(await stat(mdPath)).mtimeMs, (await stat(jsonPath)).mtimeMs];
    for (let i = 0; i < 2; i++) {
      const read = await readExperience(f.deps, f.run.id);
      assert.equal(read.kind, 'read');
      if (read.kind !== 'read') throw new Error(JSON.stringify(read));
      assert.equal(read.markdown, markdown); assert.deepEqual(read.json, old);
    }
    assert.equal((await writeExperience(f.deps, f.run.id)).kind, 'already');
    await f.close();
    const next = await bootHimaHost(f.h);
    try {
      const response = await api(next, await openSession(next), `/hima/api/runs/${f.run.id}/experience`);
      assert.equal(response.status, 200);
      const read = await response.json() as ExperienceAnswer;
      assert.equal(read.markdown, markdown); assert.deepEqual(read.report, old);
      assert.equal(read.experience.json.sha256, record.json.sha256);
      assert.deepEqual([(await stat(mdPath)).mtimeMs, (await stat(jsonPath)).mtimeMs], times);
      assert.equal(await readFile(jsonPath, 'utf8'), json);
    } finally { assert.equal(await next.stop(), 0, next.stderr()); }
  } finally { await f.close(); await f.h.dispose(); }
});

test('failure between the two report writes leaves no record; the next Host completes and verifies both files', async () => {
  const f = await fixture();
  try {
    await f.deps.ledger.appendWorkspace(f.run.id, { event: 'prepared', campaignId: f.run.campaignId, packId: 'recorded-method', packVersion: 'fixture',
      workspace: f.h.workspace, flowRoot: '/declared/flow', design: 'declared-design', containerName: 'declared-container', copied: [], preparedAt: f.run.createdAt });
    const dir = path.join(f.h.workspace, EXPERIENCE_DIR);
    await mkdir(dir);
    const jsonPath = path.join(dir, `${f.run.id}.json`);
    await mkdir(jsonPath); // tee can write Markdown, then refuses the directory occupying JSON.
    await assert.rejects(() => writeExperience(f.deps, f.run.id), /tee|write/);
    assert.ok((await readFile(path.join(dir, `${f.run.id}.md`), 'utf8')).startsWith('# Campaign'));
    assert.equal(f.deps.ledger.records({ runId: f.run.id, type: 'experience' }).length, 0);
    assert.equal((await readExperience(f.deps, f.run.id)).kind, 'none');
    await rm(jsonPath, { recursive: true });
    await f.close();
    const next = await bootHimaHost(f.h);
    try {
      const cookie = await openSession(next);
      let result: Response | undefined;
      for (let i = 0; i < 50; i++) {
        result = await api(next, cookie, `/hima/api/runs/${f.run.id}/experience`);
        if (result.status === 200) break;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      assert.equal(result?.status, 200);
      const read = await result!.json() as ExperienceAnswer;
      assert.equal(read.report.schema, 'hima-experience/2');
      if (read.report.schema !== 'hima-experience/2') throw new Error('newly recovered report uses schema 2');
      assert.equal(read.report.research.environment.declaredDesign, 'declared-design');
      assert.equal(read.report.research.environment.toolVersions, 'not recorded');
      assert.equal(hash(read.markdown), read.experience.markdown.sha256);
      assert.equal(hash(await readFile(jsonPath, 'utf8')), read.experience.json.sha256);
      const records = await api(next, cookie, `/hima/api/runs/${f.run.id}/records?type=experience`);
      assert.equal((await records.json() as { records: unknown[] }).records.length, 1);
    } finally { assert.equal(await next.stop(), 0, next.stderr()); }
  } finally { await f.close(); await f.h.dispose(); }
});
