import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { createLibInsightAnalyses, LibInsightAnalysisError } from '@hima/harness';
import { repoRoot } from './support/dsh-home.ts';

// Data Insight's Resident analyses module (ADR-0020) over stub Run views: what the list calls admitted,
// what a detail shows, and how Site and index failures read. The full route is in
// libinsight-resident-durable.host.test.ts; this file covers the cases a live Run rarely produces.
const sha = (c: string) => c.repeat(64);
const observation = (contentSha256: string) => ({ type: 'observation', outputName: 'analysisResult', runId: 'run-1', bytes: 10, retainedPath: '/r', contentSha256, values: [{ type: 'li_analysis_plot_count', value: 2 }] });
const view = (admit: { value?: Record<string, unknown>; failed?: string } | undefined, packId = 'libinsight-analysis') => ({
  run: { id: 'run-1', packId },
  tasks: [
    { taskId: 'custom-analysis', current: true, projection: { state: 'succeeded' }, result: { value: { observations: [observation(sha('a'))] } } },
    ...(admit ? [{ taskId: 'admit-analysis', current: true, projection: admit.failed ? { state: 'failed', reason: { code: 'x', message: admit.failed, source: 'tool' } } : { state: 'succeeded' }, ...(admit.value ? { result: { value: admit.value } } : {}) }] : []),
  ],
});

async function fixture(views: Record<string, unknown>, extra: Partial<Parameters<typeof createLibInsightAnalyses>[0]> = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'hima-analyses-'));
  const packsDir = path.join(root, 'packs'), sitesDir = path.join(root, 'sites');
  await mkdir(path.join(packsDir, 'libinsight-analysis'), { recursive: true });
  await mkdir(sitesDir, { recursive: true });
  const analyses = createLibInsightAnalyses({
    packsDir, sitesDir, indexFile: path.join(root, 'home', 'libinsight-analyses.json'), site: 'local',
    preparation: () => { throw new Error('not used'); },
    startGuidedRun: () => { throw new Error('not used'); },
    listRunHeads: async () => Object.keys(views).map((id, i) => ({ id, campaignId: id, siteId: 'local', createdAt: `2026-10-05T0${i}:00:00Z`, packId: 'libinsight-analysis', status: 'ended-goal-met' })) as never,
    readRunView: async (runId: string) => views[runId] as never,
    readRetained: async () => Buffer.from(JSON.stringify({ schema: 'hima-libinsight-analysis/1', plots: [], datasets: {} })),
    authorize: async () => undefined,
    ...extra,
  });
  return { root, packsDir, sitesDir, analyses, cleanup: () => rm(root, { recursive: true, force: true }) };
}

test('only an admission of the very bytes the Reader accepted is listed as admitted', async () => {
  const f = await fixture({
    'run-ok': view({ value: { admitted: true, id: 'a', version: 1, resultSha256: sha('a') } }),
    'run-other-bytes': view({ value: { admitted: true, id: 'a', version: 1, resultSha256: sha('b') } }),
    'run-blocked': view({ value: { admitted: false, id: 'a', version: 1, reason: 'the resident reported outcome blocked: licence' } }),
    'run-conflict': view({ failed: 'version-conflict: a@1 already exists with different content' }),
    'run-pending': view(undefined),
  });
  try {
    const { analyses } = await f.analyses.list('s');
    const byRun = Object.fromEntries(analyses.map(entry => [entry.runId, entry.analysis]));
    assert.deepEqual(byRun['run-ok'], { id: 'a', version: 1, plotCount: 2, admitted: true, resultSha256: sha('a') });
    assert.equal(byRun['run-other-bytes']?.admitted, false);
    assert.match(byRun['run-other-bytes']?.notAdmittedReason ?? '', /different result bytes/);
    assert.equal(byRun['run-blocked']?.admitted, false);
    assert.match(byRun['run-blocked']?.notAdmittedReason ?? '', /outcome blocked/);
    assert.equal(byRun['run-conflict']?.admitted, false);
    assert.match(byRun['run-conflict']?.notAdmittedReason ?? '', /version-conflict/);
    assert.equal(byRun['run-pending']?.notAdmittedReason, 'admission has not finished');
    assert.ok(analyses.every(entry => !('result' in entry)), 'summaries only');
    const detail = await f.analyses.detail('s', 'run-conflict');
    assert.equal(detail.admission.admitted, false);
    assert.ok(detail.result, 'a Reader-accepted result is still shown, labelled not admitted');
  } finally { await f.cleanup(); }
});

test('a detail is scoped to the project and to analysis Runs', async () => {
  const f = await fixture({ 'run-x': view(undefined, 'agentic-timing-closure-system') }, {
    authorize: async (_session: string, runId: string) => { if (runId === 'run-foreign') throw new Error('other project'); },
  });
  try {
    await assert.rejects(f.analyses.detail('s', 'run-foreign'), (error: unknown) => error instanceof LibInsightAnalysisError && /not available/.test(error.message));
    await assert.rejects(f.analyses.detail('s', 'run-x'), /not a library analysis/);
  } finally { await f.cleanup(); }
});

test('an unreadable index still lists every Run, and an unreachable Site is a clear refusal', async () => {
  const f = await fixture({ 'run-ok': view({ value: { admitted: true, id: 'a', version: 1, resultSha256: sha('a') } }) }, {
    writeSiteFile: async () => { throw new LibInsightAnalysisError('unavailable', 'The request could not be written on the Site local: ssh: connect timed out'); },
  });
  try {
    await mkdir(path.join(f.root, 'home'), { recursive: true });
    await writeFile(path.join(f.root, 'home', 'libinsight-analyses.json'), '{ not json');
    assert.equal((await f.analyses.list('s')).analyses.length, 1);
    await writeFile(path.join(f.sitesDir, 'local.yml'), `name: local\nkind: local\nworkspaceRoot: ${f.root}/ws\npermit: ./local.permit.yml\nbindings:\n  analysisRequests: ${f.root}/ws/requests\ncapacity:\n  cores: 1\n  memoryGiB: 1\n  parallelJobs: 1\n`);
    await writeFile(path.join(f.sitesDir, 'local.permit.yml'), `allowedReadRoots: [${f.root}]\nallowedWriteRoots: [${f.root}/ws]\nallowedWrappers: [python3]\nforbidden: [services]\n`);
    await cp(path.join(repoRoot, 'packs/libinsight-analysis'), path.join(f.packsDir, 'libinsight-analysis'), { recursive: true, filter: p => !p.includes('__pycache__') });
    await assert.rejects(f.analyses.propose('s', { question: 'q' }), (error: unknown) => error instanceof LibInsightAnalysisError && error.code === 'unavailable' && /could not be written/.test(error.message));
  } finally { await f.cleanup(); }
});
