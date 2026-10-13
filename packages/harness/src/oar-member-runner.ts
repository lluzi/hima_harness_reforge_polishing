// Trusted local SDK child. Host/DBOS own authorization, persistence and closure.
// This entrypoint never writes Host result, state or journal files.
import * as fs from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline';
import { isAbsolute, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

type ObjectValue = Record<string, any>;
type Configuration = {
  prepared: { sessionKey: string; generation: number; memberId: string; runtime: 'pi' | 'opencode';
    inputId: string; prompt: string; deadlineAt: string };
  model: { provider: string; model: string; baseUrl: string; apiKey: string; nativeBaseUrl?: string };
  outputSchemaVersion: string;
  controlDirectory: string;
  workDirectory: string;
  assets: { oarModule: string; nodeExecutable: string; opencodeCommand: string; opencodeVersion: string };
};

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
const object = (value: unknown): ObjectValue | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as ObjectValue : undefined;
function writeJson(path: string, value: unknown): void {
  const temporary = `${path}.${randomUUID()}.tmp`;
  const fd = fs.openSync(temporary, 'wx', 0o600);
  try { fs.writeFileSync(fd, JSON.stringify(value)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(temporary, path);
  const directory = fs.openSync(path.slice(0, path.lastIndexOf('/')), 'r');
  try { fs.fsyncSync(directory); } finally { fs.closeSync(directory); }
}
function configuration(value: unknown): Configuration {
  const v = object(value), p = object(v?.prepared), m = object(v?.model), assets = object(v?.assets);
  if (!v || !p || !m || !assets || !['pi', 'opencode'].includes(p.runtime)
    || ![p.sessionKey, p.memberId, p.inputId, p.prompt, m.provider, m.model, m.baseUrl, m.apiKey,
      v.outputSchemaVersion, assets.opencodeVersion].every(s => typeof s === 'string' && s.length > 0)
    || ![v.controlDirectory, v.workDirectory, assets.oarModule, assets.nodeExecutable, assets.opencodeCommand]
      .every(s => typeof s === 'string' && isAbsolute(s))
    || !Number.isSafeInteger(p.generation) || p.generation < 0 || !Number.isFinite(Date.parse(p.deadlineAt))
    || (m.nativeBaseUrl !== undefined && (typeof m.nativeBaseUrl !== 'string' || !m.nativeBaseUrl))) {
    throw new Error('Invalid local member configuration');
  }
  return v as Configuration;
}
function loadConfiguration(): Configuration {
  const home = process.env.HIMA_MEMBER_HOME;
  if (!home || !isAbsolute(home)) throw new Error('Absolute HIMA_MEMBER_HOME required');
  const config = configuration(JSON.parse(fs.readFileSync(join(home, 'config.json'), 'utf8')));
  if (config.controlDirectory !== home) throw new Error('Member configuration directory mismatch');
  return config;
}

// This bridge only spools requests; Host owns grant resolution and replies.
// The Host resolves the file request against the exact member lease on observation.
async function mcp(): Promise<void> {
  const config = loadConfiguration(), home = config.controlDirectory;
  fs.mkdirSync(`${home}/native/requests`, { recursive: true, mode: 0o700 });
  const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
  const respond = (id: unknown, result: unknown) => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, result })}\n`);
  for await (const line of lines) {
    let rpc: ObjectValue;
    try { const parsed = object(JSON.parse(line)); if (!parsed) continue; rpc = parsed; } catch { continue; }
    if (rpc.id === undefined) continue;
    try {
      if (rpc.method === 'initialize') {
        respond(rpc.id, { protocolVersion: rpc.params?.protocolVersion ?? '2024-11-05', capabilities: { tools: {} },
          serverInfo: { name: 'hima-member-context', version: '1' } });
      } else if (rpc.method === 'ping') respond(rpc.id, {});
      else if (rpc.method === 'tools/list') respond(rpc.id, { tools: [{ name: 'member_context',
        description: 'Request authorized task, message or material context from the Host for this member.',
        inputSchema: { type: 'object', properties: { action: { type: 'string' }, request: { type: 'object' } },
          required: ['action', 'request'], additionalProperties: false } }] });
      else if (rpc.method === 'tools/call') {
        const args = object(rpc.params?.arguments);
        if (rpc.params?.name !== 'member_context' || !args || typeof args.action !== 'string'
          || !args.action || !object(args.request) || Object.keys(args).some(k => !['action', 'request'].includes(k))) {
          throw new Error('Expected member_context {action,request}');
        }
        const id = randomUUID();
        writeJson(`${home}/native/requests/${id}.json`, { id, action: args.action, request: args.request });
        const deadline = Math.min(Date.parse(config.prepared.deadlineAt), Date.now() + 60_000);
        while (!fs.existsSync(`${home}/replies/${id}.json`)) {
          if (Date.now() >= deadline) throw new Error(`Host member_context response timeout: ${id}`);
          await sleep(100);
        }
        const reply = JSON.parse(fs.readFileSync(`${home}/replies/${id}.json`, 'utf8'));
        respond(rpc.id, { content: [{ type: 'text', text: JSON.stringify(reply) }],
          ...(reply?.error ? { isError: true } : {}) });
      } else process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: rpc.id,
        error: { code: -32601, message: 'Unknown method' } })}\n`);
    } catch (error) {
      process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: rpc.id,
        error: { code: -32000, message: error instanceof Error ? error.message : String(error) } })}\n`);
    }
  }
}

// IPC is the observation channel. Host persists identity before created_ack/input.
async function sdkRun(): Promise<void> {
  if (!process.send || !process.connected) throw new Error('SDK IPC unavailable');
  const sendWire = (message: ObjectValue) => {
    if (!process.connected || !process.send) throw new Error('SDK IPC disconnected');
    process.send(message, error => { if (error) process.exit(1); });
  };
  const initial = await new Promise<Configuration>((resolve, reject) => {
    process.once('message', (message: unknown) => {
      const item = object(message);
      if (item?.type !== 'config') reject(new Error('Expected Host configuration'));
      else { try { resolve(configuration(item.config)); } catch (error) { reject(error); } }
    });
    process.once('disconnect', () => reject(new Error('Host disconnected')));
    sendWire({ type: 'ready' });
  });
  const config = initial, prepared = config.prepared, home = config.controlDirectory;
  let nativeSession: string | undefined, session: any, stopping = false, failed = false;
  let current: { id: string; nativeId: string; input: string; initial: boolean; received: boolean; text: string;
    clearText: boolean; ended?: ObjectValue } | undefined;
  const journal = (kind: string, payload: unknown) => sendWire({ type: kind, payload });
  const fail = (error: unknown) => {
    if (failed) return;
    failed = true;
    if (process.connected) sendWire({ type: 'failure', reason: error instanceof Error ? error.message : String(error) });
  };
  const received = (evidence: string, native: unknown) => {
    if (!current || current.received) return;
    current.received = true;
    journal('received', { inputId: current.id, evidence, native });
  };
  const stop = async (reason: string) => {
    if (stopping) return;
    stopping = true;
    if (process.connected) journal('control', { action: 'stop', reason, closure: 'unconfirmed' });
    const timeout = setTimeout(() => process.exit(1), 10_000);
    try { if (session) { try { await session.abort(); } finally { await session.dispose(); } } }
    catch (error) { fail(error); }
    finally {
      // Flush preceding failure/control IPC before exiting, still bounded by timeout.
      if (process.connected && process.send) {
        process.send({ type: 'control', payload: { action: 'stop_cleanup', reason, closure: 'unconfirmed' } }, error => {
          clearTimeout(timeout); process.exit(error || failed ? 1 : 0);
        });
      } else { clearTimeout(timeout); process.exit(failed ? 1 : 0); }
    }
  };
  process.on('SIGTERM', () => { void stop('SIGTERM'); });
  process.on('SIGINT', () => { void stop('SIGINT'); });
  // Covers SDK creation and prompt ACK waits as well as the idle polling loop.
  setTimeout(() => {
    if (!nativeSession || current) fail(new Error('Native member deadline exceeded'));
    void stop('deadline');
  }, Math.min(2_147_483_647, Math.max(0, Date.parse(prepared.deadlineAt) - Date.now())));
  const send = async (id: string, input: string, initial: boolean) => {
    // OAR requires UUID input IDs; keep Host IDs stable and map only at this seam.
    const digest = createHash('sha256').update(JSON.stringify([prepared.sessionKey, id])).digest('hex');
    const nativeId = `${digest.slice(0,8)}-${digest.slice(8,12)}-8${digest.slice(13,16)}-8${digest.slice(17,20)}-${digest.slice(20,32)}`;
    current = { id, nativeId, input, initial, received: false, text: '', clearText: false };
    const acknowledgement = await session.prompt(input, { inputId: nativeId });
    journal('control', { action: 'prompt_ack', inputId: id, nativeInputId: nativeId, acknowledgement });
    if (acknowledgement.kind !== 'accepted') throw new Error(`Native prompt refused: ${acknowledgement.reason}`);
    // Pinned Pi prompt() waits for native agent_start; queue()/steer() ACKs do not.
    // This child uses prompt exclusively and retains the exact current input.
    if (prepared.runtime === 'pi') received('pi_agent_start_prompt_ack', acknowledgement);
  };
  let authorized = false;
  let sending = false;
  let initialSent = false;
  const inputIds = new Set<string>();
  process.on('message', (message: unknown) => {
    const item = object(message);
    if (item?.type === 'stop') { void stop(String(item.reason)); return; }
    if (item?.type === 'created_ack' && nativeSession && !authorized) { authorized = true; return; }
    if (item?.type !== 'input' || !authorized || stopping || failed || current || sending
      || typeof item.id !== 'string' || !item.id || typeof item.input !== 'string' || !item.input
      || typeof item.initial !== 'boolean' || item.initial !== !initialSent || inputIds.has(item.id)
      || (item.initial && (item.id !== prepared.inputId || item.input !== prepared.prompt))) {
      fail(new Error('Invalid Host SDK input')); void stop('invalid input'); return;
    }
    inputIds.add(item.id);
    initialSent = true;
    sending = true;
    void send(item.id, item.input, item.initial).catch(error => { fail(error); void stop('prompt failed'); })
      .finally(() => { sending = false; });
  });
  process.on('disconnect', () => { failed = true; void stop('Host disconnected'); });
  try {
    const native = join(home, 'native');
    const env: Record<string, string> = { HOME: native, XDG_CONFIG_HOME: join(native, '.config'),
      XDG_DATA_HOME: join(native, 'data'), XDG_CACHE_HOME: join(native, 'cache'),
      XDG_STATE_HOME: join(native, 'state'), TMPDIR: join(native, 'tmp'),
      OAR_PI_AGENT_DIR: join(native, 'pi'), HIMA_MEMBER_HOME: home };
    for (const path of [native, join(native, '.config'), join(native, 'data'), join(native, 'cache'),
      join(native, 'state'), join(native, 'tmp'), join(native, 'pi'), join(native, '.config/opencode')]) {
      fs.mkdirSync(path, { recursive: true, mode: 0o700 });
    }
    Object.assign(process.env, env);
    if (prepared.runtime === 'pi') {
      writeJson(`${home}/native/pi/models.json`, { providers: { hima: { baseUrl: config.model.nativeBaseUrl ?? config.model.baseUrl,
        api: config.model.provider, models: [{ id: config.model.model }] } } });
      writeJson(`${home}/native/pi/auth.json`, { hima: { type: 'api_key', key: config.model.apiKey } });
    } else {
      // Host supplies the exact provider/model; no background catalogue discovery.
      env.OPENCODE_DISABLE_MODELS_FETCH = 'true';
      process.env.OPENCODE_DISABLE_MODELS_FETCH = 'true';
      process.env.OPENCODE_CONFIG_CONTENT = JSON.stringify({ provider: { hima: {
        npm: config.model.provider==='anthropic-messages'?'@ai-sdk/anthropic':'@ai-sdk/openai-compatible', name: config.model.provider,
        options: { baseURL: config.model.nativeBaseUrl ?? config.model.baseUrl, apiKey: config.model.apiKey },
        models: { [config.model.model]: { name: config.model.model } } } }, model: `hima/${config.model.model}`,
        instructions: [join(config.workDirectory, 'AGENTS.md')] });
      // OAR passes options.env to the native server as well as the current process.
      Object.assign(env, { OPENCODE_CONFIG_CONTENT: process.env.OPENCODE_CONFIG_CONTENT });
    }
    const sdk = await import(pathToFileURL(config.assets.oarModule).href);
    if (stopping) return;
    const options = { cwd: config.workDirectory, model: `hima/${config.model.model}`, env,
      mcpServers: [{ name: 'hima', command: config.assets.nodeExecutable,
        args: [fileURLToPath(import.meta.url), 'mcp'], env: { HIMA_MEMBER_HOME: home } }] };
    session = prepared.runtime === 'pi' ? await sdk.piSession({ kind: 'available', via: 'bundled' }, options)
      : await sdk.opencodeSession({ kind: 'available', via: 'executable',
        command: config.assets.opencodeCommand, version: config.assets.opencodeVersion }, options);
    if (stopping) { await session.abort(); await session.dispose(); return; }
    nativeSession = session.id;
    if (!nativeSession) throw new Error('OAR opened no native session identity');
    // Host persists creation before acknowledging or issuing any prompt.
    journal('created', { runtime: prepared.runtime, nativeSession });
    session.rawEvents((raw: ObjectValue) => {
      try {
        journal('raw', raw);
        if (raw.sessionId !== nativeSession || raw.agentPath?.length || !current) return;
        if (raw.kind === 'frame' && raw.body?.type === 'message_start' && raw.body.native?.message?.role === 'assistant') {
          current.text = ''; current.clearText = false;
        }
        if (prepared.runtime === 'opencode' && raw.kind === 'frame' && raw.body?.type === 'session/prompt') {
          received('native_session_prompt_response', raw);
        }
      } catch (error) { fail(error); void stop('journal failure'); }
    }, { sessionId: nativeSession, afterSeq: -1 });
    session.events((event: ObjectValue) => {
      try {
        journal('event', event);
        if (event.sessionId !== nativeSession || event.agentPath?.length) return;
        if (event.kind === 'exited' && !stopping) {
          fail(new Error('Native runtime exited')); void stop('native exited'); return;
        }
        if (!current) return;
        if (event.kind === 'user_message' && event.input === current.input
          && (event.inputId === undefined || event.inputId === current.nativeId)) received(`native_user_message:${event.evidence}`, event);
        if (event.kind === 'tool_call_started') current.clearText = true;
        if (event.kind === 'text_delta') {
          if (current.clearText) { current.text = ''; current.clearText = false; }
          current.text += event.text;
        }
        if (event.kind === 'turn_ended') current.ended = event.outcome;
      } catch (error) { fail(error); void stop('observation failure'); }
    }, { cursor: { sessionId: nativeSession, afterSeq: -1 } });
    while (!stopping && !failed) {
      if (Date.now() >= Date.parse(prepared.deadlineAt)) {
        if (current) fail(new Error('Native member deadline exceeded'));
        await stop('deadline'); break;
      }
      if (current?.ended && !sending) {
        const finished = current;
        journal('terminal', { inputId: finished.id, outcome: finished.ended, received: finished.received });
        if (finished.ended!.kind !== 'completed') throw new Error(`Native turn ended ${finished.ended!.kind}`);
        if (!finished.received) throw new Error('Native turn has no correlated input reception');
        if (finished.initial && !finished.text) throw new Error('Completed native turn has no delivered text deltas');
        sendWire({ type: 'finished', inputId: finished.id, text: finished.text });
        current = undefined;
      }
      await sleep(100);
    }
    if (failed) await stop('failed');
  } catch (error) { fail(error); await stop('failed'); }
}

if (process.argv[2] === 'mcp') {
  mcp().catch(() => { process.stderr.write('Member MCP failed\n'); process.exitCode = 1; });
} else if (process.argv[2] === 'sdk') {
  sdkRun().catch(() => {
    if (process.connected && process.send) {
      process.send({ type: 'failure', reason: 'SDK child failed before configuration' }, () => process.exit(1));
    } else process.exitCode = 1;
  });
} else {
  process.stderr.write('Expected explicit sdk or mcp mode\n');
  process.exitCode = 1;
}
