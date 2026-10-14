import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { createHimaHome } from './support/dsh-home.ts';
import { bootInProcess, createRootAgent } from './support/boot-inprocess.ts';

// Native intake evidence. Full task authorization and PG persistence cases are added against
// I's integrated /hima/api/teams handlers in the same batch, not an in-memory store substitute.
test('DSH streamed upload receipts are Agent-scoped and retained original streams survive Host restart', async t => {
  const home = await createHimaHome();
  let host = await bootInProcess(home, { withWebApp: true });
  t.after(async () => { await host.dispose(); await home.dispose(); });
  const owner = await createRootAgent(host.ctx, home.workspace);
  const foreign = await createRootAgent(host.ctx, home.workspace);
  const uploads = host.ctx.get('fileUploads'); const attachments = host.ctx.get('attachments');
  assert.ok(uploads, 'Native fileUploads service must be installed'); assert.ok(attachments);
  const bytes = new TextEncoder().encode('Attachment-only fact: qualifier Q103 uses a 7.625 ns bound.');
  const digest = createHash('sha256').update(bytes).digest('hex');
  async function* input() { yield bytes.slice(0, 17); yield bytes.slice(17); }
  const receipt = await uploads.uploadStream({ sessionId: owner.id, data: input(), name: 'same-name.md' });
  assert.equal(receipt.file.attachmentId, `sha256:${digest}`);
  assert.equal(receipt.file.bytes, bytes.byteLength);
  assert.equal(uploads.resolve(foreign, receipt.receiptId), undefined);
  assert.deepEqual(uploads.resolve(owner, receipt.receiptId), receipt.file);
  async function readOriginal(): Promise<Buffer> {
    const chunks: Uint8Array[] = [];
    for await (const chunk of host.ctx.get('attachments')!.readFileStream(receipt.file)) chunks.push(chunk);
    return Buffer.concat(chunks);
  }
  assert.deepEqual(await readOriginal(), Buffer.from(bytes));
  const changed = new TextEncoder().encode('Revised qualifier Q103 uses 8.5 ns.');
  const revision = await uploads.uploadStream({ sessionId: owner.id, data: (async function* () { yield changed; })(), name: 'same-name.md' });
  assert.notEqual(revision.file.attachmentId, receipt.file.attachmentId, 'same name is not material identity');
  await host.dispose(); host = await bootInProcess(home, { withWebApp: true });
  assert.deepEqual(await readOriginal(), Buffer.from(bytes), 'persisted reference is independent of live receipt scope');
  const reopened = await createRootAgent(host.ctx, home.workspace);
  assert.equal(host.ctx.get('fileUploads')!.resolve(reopened, receipt.receiptId), undefined, 'reopen does not invent upload receipt authority');
});

import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { bootHimaHost } from './support/boot-host.ts';
import { api, openSession, createLiveSession } from './support/hima-api.ts';
import { teamFixture } from './support/himateam.ts';

/** Minimal valid PDF fixture with one optional text page and one image-like empty text page. */
function documentPdf(text: string): Uint8Array {
  const stream = text ? `BT /F1 12 Tf 72 720 Td (${text}) Tj ET` : '';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 6 0 R >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << >> /Contents 7 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Length 0 >>\nstream\n\nendstream',
  ];
  let body = '%PDF-1.4\n'; const offsets = [0];
  for (const [index, object] of objects.entries()) { offsets.push(body.length); body += `${index + 1} 0 obj\n${object}\nendobj\n`; }
  const start = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  body += offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`;
  return new TextEncoder().encode(body);
}

test('Host stages native uploads original-first, enforces draft/task read boundaries and retains parse failures', { timeout: 120000 }, async t => {
  const home = await createHimaHome(); const host = await bootHimaHost(home);
  t.after(async () => { await host.stop(); await home.dispose(); });
  const cookie = await openSession(host); const sessionId = await createLiveSession(host, cookie, home.workspace);
  async function call(request: unknown, session = sessionId) {
    const response = await api(host, cookie, '/hima/api/teams', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId: session, request }) });
    return { status: response.status, body: await response.json() as any };
  }
  const team = await call({ action: 'save', definition: teamFixture, expectedVersion: null }); assert.equal(team.status, 200);
  const opened = await call({ action: 'startTask', teamId: team.body.teamId, version: 1, request: { requestId: 'attachment-task', teamId: team.body.teamId, expectedVersion: 1, goal: 'Read supplied materials', input: {}, deadlineAt: new Date(Date.now() + 3600000).toISOString(), closure: 'A source-cited answer' } });
  assert.equal(opened.status, 200, JSON.stringify(opened.body));
  const ref = { teamId: team.body.teamId, taskId: opened.body.taskId };
  async function upload(bytes: Uint8Array, name: string, session = sessionId) {
    const response = await api(host, cookie, `/api/session/uploadFileBinary?sessionId=${encodeURIComponent(session)}&name=${encodeURIComponent(name)}`, { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: bytes });
    assert.equal(response.status, 200); const value = await response.json() as any; assert.equal(value.ok, true, JSON.stringify(value)); return value.value;
  }
  const source = new TextEncoder().encode('# Q103\n\nThe original-only bound is 7.625 ns.');
  const receipt = await upload(source, 'spec.md');
  const staged = await call({ action: 'stage-attachment', ...ref, request: { requestId: 'stage-original', receiptId: receipt.receiptId } });
  assert.equal(staged.status, 200, JSON.stringify(staged.body));
  assert.equal(staged.body.material.sha256, createHash('sha256').update(source).digest('hex'));
  assert.equal(staged.body.parser.status, 'parsed'); assert.ok(staged.body.parser.chunks.some((item: any) => item.text.includes('7.625')));
  assert.equal(JSON.stringify(staged.body).includes(home.home), false, 'wire output never carries a host path');
  const replay = await call({ action: 'stage-attachment', ...ref, request: { requestId: 'stage-original', receiptId: receipt.receiptId } });
  assert.deepEqual(replay, staged);
  const unlinked = await api(host, cookie, `/hima/api/team-material?sessionId=${encodeURIComponent(sessionId)}&teamId=${ref.teamId}&taskId=${ref.taskId}&stageId=${staged.body.stageId}`);
  assert.equal(unlinked.status, 403, 'stage is not a material read grant');
  const foreignSession = await createLiveSession(host, cookie, home.workspace);
  assert.equal((await call({ action: 'stage-attachment', ...ref, request: { requestId: 'foreign', receiptId: receipt.receiptId } }, foreignSession)).status, 403);
  const elsewhere = path.join(home.workspace, 'elsewhere'); await mkdir(elsewhere);
  const wrongProject = await createLiveSession(host, cookie, elsewhere);
  assert.notEqual((await call({ action: 'read-stage', ...ref, request: { stageId: staged.body.stageId } }, wrongProject)).status, 200);
  const cases = [
    { name: 'broken.pdf', bytes: new TextEncoder().encode('%PDF-corrupt'), status: 'failed' },
    { name: 'empty.txt', bytes: new Uint8Array(), status: 'no-text' },
    { name: 'scanned.pdf', bytes: documentPdf(''), status: 'no-text' },
    { name: 'partial.pdf', bytes: documentPdf('Partial-page original fact 42'), status: 'partial' },
    { name: 'archive.bin', bytes: new Uint8Array([0, 1, 255]), status: 'unsupported' },
  ];
  for (const [index, item] of cases.entries()) {
    const value = await upload(item.bytes, item.name);
    const result = await call({ action: 'stage-attachment', ...ref, request: { requestId: `edge-${index}`, receiptId: value.receiptId } });
    assert.equal(result.status, 200, JSON.stringify(result.body)); assert.equal(result.body.parser.status, item.status);
    assert.equal(result.body.material.sha256, createHash('sha256').update(item.bytes).digest('hex'), 'parse outcome cannot lose the original');
  }
  const changed = await upload(new TextEncoder().encode('Different revision'), 'spec.md');
  assert.equal((await call({ action: 'stage-attachment', ...ref, request: { requestId: 'stage-original', receiptId: changed.receiptId } })).status, 409);
  const sent = await call({ action: 'send-message', ...ref, request: { requestId: 'send-staged-original', recipientMemberIds: ['lead'], text: 'Read the original material.', stagedAttachmentIds: [staged.body.stageId] } });
  assert.equal(sent.status, 200, JSON.stringify(sent.body));
  assert.ok(sent.body.message.materialRefs.some((material: any) => material.sha256 === staged.body.material.sha256), 'actual sent envelope retains the linked original');
  async function readLinkedOriginal(): Promise<void> {
    const linked = await api(host, cookie, `/hima/api/team-material?sessionId=${encodeURIComponent(sessionId)}&teamId=${ref.teamId}&taskId=${ref.taskId}&stageId=${staged.body.stageId}`);
    assert.equal(linked.status, 200);
    const bytes = new Uint8Array(await linked.arrayBuffer());
    assert.deepEqual(bytes, source);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), staged.body.material.sha256);
  }
  await readLinkedOriginal();
  const excerpt = await call({ action: 'read-excerpt', ...ref, request: { stageId: staged.body.stageId, location: staged.body.parser.chunks[0].location } });
  assert.equal(excerpt.status, 200, JSON.stringify(excerpt.body));
  assert.match(excerpt.body.text, /7\.625 ns/);
  assert.equal(excerpt.body.sha256, createHash('sha256').update(excerpt.body.text).digest('hex'));
  const removed = await call({ action: 'remove-draft', ...ref, request: { stageId: staged.body.stageId } }); assert.equal(removed.status, 200);
  await readLinkedOriginal();
  const retained = await call({ action: 'list-materials', ...ref });
  assert.equal(retained.status, 200, JSON.stringify(retained.body));
  assert.ok(retained.body.materials.some((material: any) => material.stageId === staged.body.stageId), 'draft removal cannot delete an already sent material version');
  assert.equal(retained.body.draftStageIds.includes(staged.body.stageId), false);
});

import { waitUntil } from './support/fabric.ts';

test('actual invocation member material grants require a sent link and reject missing capability, wrong member, revocation and retired generation', { timeout: 60000 }, async t => {
  const home = await createHimaHome(); const host = await bootInProcess(home, { withWebApp: true });
  t.after(async () => { await host.dispose(); await home.dispose(); });
  const owner = await createRootAgent(host.ctx, home.workspace); const sessionId = String(owner.id);
  const operation = (request: unknown) => host.ctx.hima.teamOperation(sessionId, request, 'human') as Promise<any>;
  const team = await operation({ action: 'save', definition: { ...teamFixture, members: [...teamFixture.members, { ...teamFixture.members[0], id: 'peer', role: 'Peer' }] }, expectedVersion: null });
  const deadlineAt = new Date(Date.now() + 300000).toISOString();
  const task = await operation({ action: 'startTask', teamId: team.teamId, request: { requestId: 'member-material-task', teamId: team.teamId, expectedVersion: 1, goal: 'Read linked source material', input: {}, deadlineAt, closure: 'Preserve an authorized original' } });
  await waitUntil('actual frozen member invocation', async () => (await host.ctx.hima.durable.store.flowProjection(task.currentRunId)).tasks.length === 1, 10000, 25);
  const invocation = (await host.ctx.hima.durable.store.flowProjection(task.currentRunId)).tasks[0] as any;
  const original = new TextEncoder().encode('# Member-only source\n\nThe actual bound is 7.625 ns.');
  const receipt = await host.ctx.get('fileUploads')!.uploadStream({ sessionId: owner.id, data: (async function* () { yield original; })(), name: 'member-material.md' });
  const ref = { teamId: team.teamId, taskId: task.taskId };
  const staged = await operation({ action: 'stage-attachment', ...ref, request: { requestId: 'member-material-original', receiptId: receipt.receiptId } });
  const grant = { grantId: 'material-grant', actorId: 'lead', projectId: task.projectId, teamId: team.teamId, taskId: task.taskId, memberId: 'lead', runId: task.currentRunId, effectId: invocation.identity.effectId, generation: 0, capabilities: ['read-material' as const], expiresAt: deadlineAt, revokedAt: null };
  await assert.rejects(host.ctx.hima.durable.store.issueTeamGrant({ ...grant, grantId: 'wrong-material-member', actorId: 'peer', memberId: 'peer' }), /exact.*member|assigned.*member/);
  const issued = await host.ctx.hima.durable.store.issueTeamGrant(grant);
  const base = `http://127.0.0.1:${(host.ctx.get('webServer' as never) as unknown as { port: number }).port}`;
  async function member(token: string, request: unknown): Promise<{ status: number; body: any }> {
    const response = await fetch(base + '/hima/api/member/task', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token }, body: JSON.stringify(request) });
    return { status: response.status, body: await response.json() };
  }
  const read = { action: 'read-material', request: { stageId: staged.stageId } };
  assert.equal((await member(issued.token, read)).status, 403, 'current material capability cannot read an unlinked stage');
  const sent = await operation({ action: 'send-message', ...ref, request: { requestId: 'member-material-send', recipientMemberIds: ['lead'], text: 'Read this linked source.', stagedAttachmentIds: [staged.stageId] } });
  assert.equal(sent.message.materialRefs[0].sha256, staged.material.sha256);
  const authorized = await member(issued.token, read); assert.equal(authorized.status, 200, JSON.stringify(authorized.body));
  assert.equal(authorized.body.material.sha256, createHash('sha256').update(original).digest('hex'));
  const excerpt = await member(issued.token, { action: 'read-excerpt', request: { stageId: staged.stageId, location: staged.parser.chunks[0].location } });
  assert.equal(excerpt.status, 200, JSON.stringify(excerpt.body)); assert.match(excerpt.body.text, /7\.625 ns/);
  assert.equal(excerpt.body.sha256, createHash('sha256').update(excerpt.body.text).digest('hex'));
  const noCapability = await host.ctx.hima.durable.store.issueTeamGrant({ ...grant, grantId: 'task-only-grant', capabilities: ['read-task'] });
  assert.equal((await member(noCapability.token, read)).status, 403, 'read-task does not imply read-material');
  assert.equal((await member(issued.token, { ...read, projectId: 'foreign' })).status, 400, 'wire project identity cannot override the token');
  await host.ctx.hima.durable.store.revokeTeamGrant(grant.grantId);
  assert.equal((await member(issued.token, read)).status, 403, 'revocation is checked again on material reads');
  // Explicit operator revocation permanently fences this Run lineage. A fresh
  // Task proves generation retirement without trying to regrant the revoked Run.
  const nextTask = await operation({ action: 'startTask', teamId: team.teamId, request: { requestId: 'member-material-next-task',
    teamId: team.teamId, expectedVersion: 1, goal: 'Read a separately linked original', input: {}, deadlineAt,
    closure: 'Preserve the second authorized original' } });
  await waitUntil('second frozen member invocation', async () =>
    (await host.ctx.hima.durable.store.flowProjection(nextTask.currentRunId)).tasks.length === 1, 10000, 25);
  const nextInvocation = (await host.ctx.hima.durable.store.flowProjection(nextTask.currentRunId)).tasks[0] as any;
  const nextReceipt = await host.ctx.get('fileUploads')!.uploadStream({ sessionId: owner.id,
    data: (async function* () { yield original; })(), name: 'member-material-next.md' });
  const nextRef = { teamId: team.teamId, taskId: nextTask.taskId };
  const nextStage = await operation({ action: 'stage-attachment', ...nextRef,
    request: { requestId: 'member-material-next-original', receiptId: nextReceipt.receiptId } });
  await operation({ action: 'send-message', ...nextRef, request: { requestId: 'member-material-next-send',
    recipientMemberIds: ['lead'], text: 'Read this separately linked source.', stagedAttachmentIds: [nextStage.stageId] } });
  const next = await host.ctx.hima.durable.store.issueTeamGrant({ ...grant, grantId: 'next-material-grant',
    projectId: nextTask.projectId, taskId: nextTask.taskId, runId: nextTask.currentRunId,
    effectId: nextInvocation.identity.effectId });
  const nextRead = { action: 'read-material', request: { stageId: nextStage.stageId } };
  assert.equal((await member(next.token, nextRead)).status, 200, 'fresh linked Run grants the material before retirement');
  const run = await host.ctx.hima.durable.store.run(nextTask.currentRunId); assert.ok(run);
  await operation({ action: 'control', ...nextRef, request: { requestId: 'retire-material-generation', action: 'pause',
    expectedEpoch: run.epoch, expectedRevision: run.revision } });
  assert.equal((await member(next.token, nextRead)).status, 403, 'retired invocation generation cannot read linked originals');
});
