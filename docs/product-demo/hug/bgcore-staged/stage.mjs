// Staged take player for the packaged HimaHarness App (HUG-DBOS build).
//  1. A local OpenAI-compatible stand-in for the DeepSeek API: it answers the Guide's model requests with
//     scripted turns (reasoning, text, tool calls), streamed at a model's pace. The App, its tools and
//     its chat rendering are real; only the model's words are scripted.
//  2. A CDP Fetch feeder: it answers the Project pane's /hima/api/runs* polls with the scripted Run, so
//     the real station view (view.yml) draws it.
//  3. A director: it plays the beats (typing, pointer glides, clicks via appcdp.mjs), releases held
//     turns and moves the pane between states.
// usage: node stage.mjs <beats.mjs> [--serve-only]   env: MOCK_PORT (18431), CDP_PORT (9333), APPCDP
import http from 'node:http';
import { readFileSync, appendFileSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const HERE = new URL('.', import.meta.url).pathname;
const MOCK_PORT = Number(process.env.MOCK_PORT ?? 18431);
const CDP_PORT = Number(process.env.CDP_PORT ?? 9333);
const APPCDP = process.env.APPCDP ?? '/Users/lluzi/.claude/skills/aix-demo-video/scripts/appcdp.mjs';
const beatsFile = process.argv[2];
const serveOnly = process.argv.includes('--serve-only');
const B = (await import(pathToFileURL(beatsFile).href)).default;
const LOG = B.log ?? `${HERE}/take-log.txt`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const now = () => new Date().toISOString();
const log = (...a) => { const line = `${now()} ${a.join(' ')}`; console.log(line); appendFileSync(LOG, line + '\n'); };

// ---------- events (director <-> held model turns) ----------
const fired = new Set(); const waiters = new Map();
function emit(ev) { fired.add(ev); for (const r of waiters.get(ev) ?? []) r(); waiters.delete(ev); log('emit', ev); }
function until(ev) { return fired.has(ev) ? Promise.resolve() : new Promise((r) => waiters.set(ev, [...(waiters.get(ev) ?? []), r])); }

// ---------- 1. model stand-in ----------
const turns = B.turns; let cursor = 0; let served = 0; const turnDone = [];
const requests = [];
function chunk(id, delta, finish = null) {
  return `data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model: 'deepseek-chat', choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
}
function pieces(text, cps) {
  // Model-like bursts: 2-6 characters a delta, at about `cps` characters a second.
  const out = []; let i = 0;
  while (i < text.length) { const n = 2 + Math.floor(Math.random() * 5); out.push(text.slice(i, i + n)); i += n; }
  return out.map((p) => ({ p, ms: (p.length / cps) * 1000 * (0.6 + Math.random() * 0.8) }));
}
async function streamTurn(res, turn, body) {
  const id = `chatcmpl-${Date.now()}`;
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
  let alive = true; res.on('close', () => { alive = false; });
  const send = (s) => { if (alive) res.write(s); };
  if (turn.hold) {
    const keep = setInterval(() => send(': keep-alive\n\n'), 5000);
    await until(turn.hold); clearInterval(keep);
  }
  await sleep(turn.firstTokenMs ?? 700 + Math.random() * 500);
  send(chunk(id, { role: 'assistant', content: '' }));
  if (turn.reasoning) for (const { p, ms } of pieces(turn.reasoning, turn.reasonCps ?? 60)) { send(chunk(id, { reasoning_content: p })); await sleep(ms); }
  if (turn.text) for (const { p, ms } of pieces(turn.text, turn.cps ?? 38)) { send(chunk(id, { content: p })); await sleep(ms); }
  (turn.tools ?? []).forEach((t, index) => {
    send(chunk(id, { tool_calls: [{ index, id: `call_${Date.now()}_${index}`, type: 'function', function: { name: t.name, arguments: JSON.stringify(t.args) } }] }));
  });
  const promptTokens = Math.round(JSON.stringify(body.messages ?? []).length / 3.2);
  const completion = Math.round(((turn.text ?? '').length + (turn.reasoning ?? '').length) * 0.9) + 20;
  send(chunk(id, {}, (turn.tools ?? []).length ? 'tool_calls' : 'stop'));
  send(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', choices: [], usage: { prompt_tokens: promptTokens, completion_tokens: completion, total_tokens: promptTokens + completion, prompt_cache_hit_tokens: Math.round(promptTokens * 0.8), prompt_cache_miss_tokens: promptTokens - Math.round(promptTokens * 0.8) } })}\n\n`);
  send('data: [DONE]\n\n'); res.end();
}
const server = http.createServer(async (req, res) => {
  let raw = ''; for await (const c of req) raw += c;
  let body = {}; try { body = JSON.parse(raw || '{}'); } catch {}
  requests.push({ at: now(), method: req.method, url: req.url, tools: (body.tools ?? []).map((t) => t.function?.name), messages: (body.messages ?? []).length });
  writeFileSync(`${HERE}/requests.json`, JSON.stringify(requests, null, 1));
  if (req.method === 'POST' && req.url.endsWith('/chat/completions')) {
    const last = (body.messages ?? []).at(-1);
    const isTitle = !(body.tools?.length) ;
    if (isTitle) { log('model: title request'); return streamTurn(res, { text: B.title, firstTokenMs: 200, cps: 200 }, body); }
    if (process.env.DUMP_REQUESTS) writeFileSync(`${HERE}/last-request.json`, raw);
    const turn = turns[cursor];
    if (!turn) { log('model: no scripted turn left; last role', last?.role); return streamTurn(res, { text: B.fallback ?? '好的。' }, body); }
    const n = cursor++;
    log(`model: turn ${n} ${turn.id ?? ''} (last message role ${last?.role})`);
    await streamTurn(res, turn, body);
    served = n + 1; emit(`turn:${turn.id ?? n}`);
    return;
  }
  if (req.url.endsWith('/models')) { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ object: 'list', data: [{ id: 'deepseek-chat', object: 'model' }, { id: 'deepseek-reasoner', object: 'model' }] })); }
  if (req.url.includes('balance')) { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ is_available: true, balance_infos: [{ currency: 'CNY', total_balance: '100.00' }] })); }
  log('mock: unhandled', req.method, req.url);
  res.writeHead(404); res.end('{}');
});
server.listen(MOCK_PORT, '127.0.0.1', () => log('model stand-in on', MOCK_PORT));
if (serveOnly) { await new Promise(() => {}); }

// ---------- 2. Project pane feeder over CDP ----------
// One entry per Project the conversation opens. A beat names `project` to switch the pane to it; the
// others stay in `/runs`, so the Run selector keeps them and a finished Project remains readable.
const projects = new Map();
for (const p of B.projects) {
  projects.set(p.key, {
    meta: p,
    pack: JSON.parse(readFileSync(`${HERE}/${p.pack}`, 'utf8')),
    states: JSON.parse(readFileSync(`${HERE}/${p.states}`, 'utf8')),
    open: false, state: null, status: 'running', revision: 1, startedAt: 0,
  });
}
let active = null;
async function cdpConnect() {
  for (;;) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json`)).json();
      const target = list.find((t) => t.type === 'page');
      if (target) {
        const ws = new WebSocket(target.webSocketDebuggerUrl);
        await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
        return ws;
      }
    } catch {}
    await sleep(1000);
  }
}
const ws = await cdpConnect();
let msgId = 0; const pend = new Map();
const cdp = (method, params = {}) => new Promise((res) => { const i = ++msgId; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const openProjects = () => [...projects.values()].filter((p) => p.open);
const byId = (id) => openProjects().find((p) => p.meta.id === id);
function head(project, sessionId) {
  const m = project.meta;
  return {
    id: m.id, campaignId: m.campaignId, siteId: m.siteId, createdAt: m.createdAt, status: project.status,
    packId: project.pack.contract.id, goal: m.goal,
    control: { mode: 'agent', owner: sessionId, epoch: 1, revision: project.revision, paused: [], executions: {}, requests: {} },
    meters: { elapsedMs: project.startedAt ? Date.now() - project.startedAt : 0 },
    budget: { timeBoxMs: project.pack.contract.budget?.timeBoxMs ?? 3600000 },
  };
}
function answer(url) {
  const u = new URL(url); const sessionId = u.searchParams.get('sessionId') ?? '';
  const p = u.pathname.replace(/^.*\/hima\/api/, '');
  // Newest first, so the chip and the Run selector lead with the Project now running.
  if (p === '/runs') return { runs: openProjects().reverse().map((x) => head(x, sessionId)) };
  const run = p.match(/^\/runs\/([^/]+)(\/context)?$/);
  if (run) {
    const project = byId(run[1]);
    if (project === undefined) return undefined;
    if (run[2] === undefined) return { run: head(project, sessionId), tasks: project.states[project.state] ?? [], observations: [], refusals: [], verdicts: [], nodes: [], generations: [], jobs: [], blockers: [], cancels: [], resumes: [], decision: null, code: [], knowledge: [] };
    return {
      run: head(project, sessionId), nodes: [], budget: { phase: 'active', closingReserveMs: 0, attempts: 0, attemptLimitSpent: false },
      available: [], executions: [], growths: [], revisions: [],
      method: { id: project.pack.contract.id, version: project.pack.contract.version, digest: project.meta.digest, dir: '/packs/' + project.pack.contract.id, contract: project.pack.contract, reference: project.pack.graph },
    };
  }
  if (p.startsWith('/delegations')) return { delegations: [], asOf: now() };
  if (p.startsWith('/memory')) return { kind: 'none', scope: { kind: 'campaign', workspaceRef: active?.meta.campaignId ?? 'demo', runId: active?.meta.id ?? 'run' } };
  if (p.startsWith('/experience/candidates')) return { candidates: [] };
  return undefined;
}
ws.onmessage = async (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); return; }
  if (m.method === 'Fetch.requestPaused') {
    const { requestId, request } = m.params;
    const body = openProjects().length > 0 ? answer(request.url) : undefined;
    if (body === undefined) return cdp('Fetch.continueRequest', { requestId });
    return cdp('Fetch.fulfillRequest', { requestId, responseCode: 200, responseHeaders: [{ name: 'content-type', value: 'application/json' }, { name: 'cache-control', value: 'no-store' }], body: Buffer.from(JSON.stringify(body)).toString('base64') });
  }
};
await cdp('Fetch.enable', { patterns: ['*/hima/api/runs*', '*/hima/api/delegations*', '*/hima/api/memory*', '*/hima/api/experience/candidates*'].map((urlPattern) => ({ urlPattern, requestStage: 'Request' })) });
log('pane feeder on CDP', CDP_PORT);

// ---------- 3. director ----------
function act(steps) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [APPCDP, JSON.stringify(steps)], { stdio: ['ignore', 'pipe', 'inherit'], env: process.env });
    child.stdout.on('data', (d) => process.stdout.write(`  appcdp: ${d}`));
    child.on('exit', (code) => resolve(code));
  });
}
const { existsSync, rmSync } = await import('node:fs');
log('director: waiting for GO file');
while (!existsSync(`${HERE}/GO`)) await sleep(500);
rmSync(`${HERE}/GO`);
const startAt = Date.now();
for (const beat of B.beats) {
  if (beat.at !== undefined) { const wait = startAt + beat.at * 1000 - Date.now(); if (wait > 0) await sleep(wait); }
  if (beat.label) log('beat', beat.label);
  if (beat.waitTurn !== undefined) await until(`turn:${beat.waitTurn}`);
  if (beat.sleep) await sleep(beat.sleep);
  if (beat.project !== undefined) {
    active = projects.get(beat.project);
    if (active === undefined) { log('director: no such project', beat.project); process.exit(4); }
  }
  if (beat.pane !== undefined) {
    if (active === undefined) { log('director: a pane beat before any project'); process.exit(4); }
    if (!active.open) { active.open = true; active.startedAt = Date.now(); }
    active.state = beat.pane; active.revision += 1; if (beat.status) active.status = beat.status;
    log('pane', active.meta.key, beat.pane, active.status);
  }
  if (beat.emit) emit(beat.emit);
  if (beat.act) { const code = await act(beat.act); if (code !== 0) log('act exit', code); }
}
log('director: all beats played');
await new Promise(() => {});
