// Trusted local IO ownership only. DBOS/Host own admission and business progression.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { createInterface } from 'node:readline';
import type { OarPrepared } from './oar-task-adapter.js';
import { taskToolOutput } from './task-contract.js';
export interface LocalMemberLease {
    sessionKey: string;
    generation: number;
    memberId: string;
    controlDirectory: string;
    workDirectory: string;
    pid?: number;
    processGroup?: number;
    startIdentity?: string;
}
export interface LocalMemberAssets {
    oarModule: string;
    nodeExecutable: string;
    opencodeCommand: string;
    opencodeVersion: string;
}
export interface LocalMemberConfiguration {
    prepared: OarPrepared;
    model: {
        provider: string;
        model: string;
        baseUrl: string;
        apiKey: string;
        nativeBaseUrl?: string;
    };
    outputSchemaVersion: string;
    controlDirectory?: string;
    workDirectory?: string;
    assets?: LocalMemberAssets;
}
export interface LocalMemberClosure {
    closed: boolean;
    reason?: string;
    proof?: {
        group: number;
        observedAt: string;
        absent: true;
        pids?: readonly number[];
    };
}
type Row = {
    pid: number;
    parent: number;
    group: number;
    birth: string;
    rss: number;
};
type Held = {
    lease: LocalMemberLease;
    config: LocalMemberConfiguration;
    child?: ChildProcess;
    seq: number;
    streamGeneration: string;
    nativeSession?: string;
    authorized?: boolean;
    failureReason?: string;
    current?: {
        id: string;
        initial: boolean;
        received: boolean;
        terminal?: any;
    };
    stopping?: Promise<LocalMemberClosure>;
    owned?: Row[];
    monitor?: ReturnType<typeof setInterval>;
};
const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
const object = (v: any): v is Record<string, any> => v !== null && typeof v === 'object' && !Array.isArray(v);
const safe = (s: string) => { if (!/^[a-zA-Z0-9_-]{1,200}$/.test(s))
    throw Error('Invalid member path identity'); return s; };
function mkdir(p: string) { fs.mkdirSync(p, { recursive: true, mode: 0o700 }); fs.chmodSync(p, 0o700); }
function syncDirectory(p: string) { const fd = fs.openSync(p, 'r'); try {
    fs.fsyncSync(fd);
}
finally {
    fs.closeSync(fd);
} }
function atomic(p: string, v: unknown) { const temp = p + '.' + randomUUID() + '.tmp'; const fd = fs.openSync(temp, 'wx', 0o600); try {
    fs.writeFileSync(fd, JSON.stringify(v));
    fs.fsyncSync(fd);
}
finally {
    fs.closeSync(fd);
} fs.renameSync(temp, p); syncDirectory(path.dirname(p)); }
function claim(p: string, v: unknown) { try {
    const fd = fs.openSync(p, 'wx', 0o600);
    try {
        fs.writeFileSync(fd, JSON.stringify(v));
        fs.fsyncSync(fd);
    }
    finally {
        fs.closeSync(fd);
    }
    syncDirectory(path.dirname(p));
    return true;
}
catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'EEXIST')
        return false;
    throw e;
} }
function load(p: string): any { return JSON.parse(fs.readFileSync(p, 'utf8')); }
function table(): Row[] { return execFileSync('ps', ['-axo', 'pid=,pgid=,ppid=,rss=,lstart='], { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 }).split('\n').flatMap(line => { const m = line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(.+)$/); return m ? [{ pid: Number(m[1]), group: Number(m[2]), parent: Number(m[3]), rss: Number(m[4]), birth: m[5]! }] : []; }); }
function redact(v: any, key: string): any { if (typeof v === 'string')
    return (key ? v.split(key).join('[redacted]') : v).replace(/\bBearer\s+[^\s"']+/gi, 'Bearer [redacted]'); if (Array.isArray(v))
    return v.map(x => redact(x, key)); if (object(v))
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, /^(api[-_]?key|x-api-key|key|authorization|password|secret|client[-_]?secret|token|credential[s]?|access[-_]?token|refresh[-_]?token|private[-_]?key)$/i.test(k) ? '[redacted]' : redact(x, key)])); return v; }
export class OarLocalMemberRuntime {
    private held = new Map<string, Held>();
    private shuttingDown = false;
    constructor(private options: {
        home: string;
        nodeExecutable: string;
        runnerModule: string;
        assets: LocalMemberAssets;
    }) { }
    private root(key: string) { return path.join(this.options.home, 'hima', 'oar-members', safe(key)); }
    private get(lease: LocalMemberLease) { const h = this.held.get(lease.sessionKey); if (!h || h.lease.generation !== lease.generation || h.lease.memberId !== lease.memberId || h.lease.controlDirectory !== lease.controlDirectory || h.lease.workDirectory !== lease.workDirectory)
        throw Error('Unknown local member lease'); return h; }
    private snapshot(h: Held) { const all = table(), known = h.owned ?? [], leader = all.find(r => r.pid === h.lease.pid); if (leader && (leader.birth !== h.lease.startIdentity || leader.group !== h.lease.processGroup))
        throw Error('Member PID identity mismatch'); const owned = new Map(known.map(r => [r.pid, r])); for (const r of all)
        if (r.group === h.lease.processGroup)
            owned.set(r.pid, owned.get(r.pid) ?? r); let changed = true; while (changed) {
        changed = false;
        for (const r of all) {
            const parent = owned.get(r.parent), liveParent = all.find(x => x.pid === r.parent);
            if (parent && liveParent?.birth === parent.birth && !owned.has(r.pid)) {
                owned.set(r.pid, r);
                changed = true;
            }
        }
    } h.owned = [...owned.values()]; atomic(path.join(h.lease.controlDirectory, 'owned-pids.json'), h.owned); return all.filter(r => owned.has(r.pid)); }
    private state(h: Held, phase: string, extra: any = {}) { atomic(path.join(h.lease.controlDirectory, 'state.json'), { ...h.lease, nativeSession: h.nativeSession, streamGeneration: h.streamGeneration, phase, ...(h.failureReason ? { failureReason: h.failureReason, fatal: true } : {}), ...redact(extra, h.config.model.apiKey) }); }
    private journal(h: Held, kind: string, payload: unknown) { const fd = fs.openSync(path.join(h.lease.controlDirectory, 'journal.jsonl'), 'a', 0o600); try {
        fs.writeFileSync(fd, JSON.stringify({ schema: 'hima-oar-observation/1', sessionKey: h.lease.sessionKey, generation: h.lease.generation, memberId: h.lease.memberId, nativeSession: h.nativeSession, streamGeneration: h.streamGeneration, seq: h.seq++, time: new Date().toISOString(), kind, payload: redact(payload, h.config.model.apiKey) }) + '\n');
        fs.fsyncSync(fd);
    }
    finally {
        fs.closeSync(fd);
    } }
    private wire(h: Held, v: any) { if (!h.child?.connected)
        throw Error('Member IPC unavailable; recovery cannot resend'); h.child.send(v, e => { if (e && !h.stopping)
        this.fail(h, 'Member IPC delivery failed'); }); }
    private fail(h: Held, reason: string) { if (h.failureReason || h.stopping)
        return; h.failureReason = reason; try {
        this.journal(h, 'terminal', { outcome: 'failed', reason, inputId: h.current?.id });
        this.journal(h, 'error', { reason });
        this.state(h, 'failed', { reason });
    }
    catch {
        h.failureReason = 'Member observation retention unavailable';
    } void this.close(h.lease); }
    async stage(config: LocalMemberConfiguration, skills: readonly {
        path: string;
        bytes: Uint8Array;
    }[]): Promise<LocalMemberLease> {
        if (this.shuttingDown)
            throw Error('Host shutdown rejects member staging');
        const p = config.prepared, root = this.root(p.sessionKey);
        mkdir(root);
        const skillBinding = skills.map(file => ({ path: file.path, sha256: createHash('sha256').update(file.bytes).digest('hex') })).sort((a, b) => a.path.localeCompare(b.path));
        const previous = this.held.get(p.sessionKey) ?? (await this.recover(p.sessionKey) ? this.held.get(p.sessionKey) : undefined);
        if (previous) {
            if (JSON.stringify(previous.config.prepared) !== JSON.stringify(p) || JSON.stringify(previous.config.model) !== JSON.stringify(config.model) || previous.config.outputSchemaVersion !== config.outputSchemaVersion || JSON.stringify(previous.config.assets) !== JSON.stringify(config.assets ?? this.options.assets) || JSON.stringify(load(path.join(previous.lease.controlDirectory, 'skill-binding.json'))) !== JSON.stringify(skillBinding) || (config.controlDirectory !== undefined && path.resolve(config.controlDirectory) !== previous.lease.controlDirectory) || (config.workDirectory !== undefined && path.resolve(config.workDirectory) !== previous.lease.workDirectory))
                throw Error('Member session identity/configuration differs');
            return previous.lease;
        }
        const controlDirectory = path.resolve(config.controlDirectory ?? path.join(root, 'control')), workDirectory = path.resolve(config.workDirectory ?? path.join(root, 'work'));
        for (const dir of [controlDirectory, workDirectory])
            if (!dir.startsWith(root + path.sep))
                throw Error('Member directory must be below original member root');
        const lease = { sessionKey: p.sessionKey, generation: p.generation, memberId: p.memberId, controlDirectory, workDirectory };
        for (const dir of ['', 'native', 'native/pi', 'native/pi/skills', 'native/.config/opencode/skills', 'native/requests', 'native/data', 'native/cache', 'native/state', 'native/tmp', 'replies', 'inbox', 'claims'])
            mkdir(path.join(controlDirectory, dir));
        mkdir(workDirectory);
        if (skills.length > 64)
            throw Error('Too many member Skills');
        for (const file of skills) {
            const relative = file.path.replace(/^\/hima-home\/skills\//, '');
            if (relative === file.path || relative.split('/').some(x => !x || x === '.' || x === '..') || file.bytes.length > 1024 * 1024)
                throw Error('Invalid member Skill');
            const target = path.join(controlDirectory, p.runtime === 'pi' ? 'native/pi/skills' : 'native/.config/opencode/skills', relative);
            mkdir(path.dirname(target));
            fs.writeFileSync(target, file.bytes, { mode: 0o600 });
        }
        atomic(path.join(controlDirectory, 'skill-binding.json'), skillBinding);
        const heldConfig = { ...config, controlDirectory, workDirectory, assets: config.assets ?? this.options.assets };
        atomic(path.join(controlDirectory, 'config.json'), heldConfig);
        atomic(path.join(root, 'lease.json'), lease);
        const h: Held = { lease, config: heldConfig, seq: 0, streamGeneration: randomUUID() };
        this.held.set(p.sessionKey, h);
        this.state(h, 'staged');
        return lease;
    }
    async start(lease: LocalMemberLease): Promise<void> {
        if (this.shuttingDown)
            throw Error('Host shutdown rejects member start');
        const h = this.get(lease), dir = lease.controlDirectory;
        if (h.child || fs.existsSync(path.join(dir, 'start.claim')))
            return;
        if (!claim(path.join(dir, 'start.claim'), { ...lease, streamGeneration: h.streamGeneration, time: new Date().toISOString() }))
            return;
        this.state(h, 'starting');
        const env: NodeJS.ProcessEnv = { HOME: dir, HIMA_MEMBER_HOME: dir, XDG_CONFIG_HOME: path.join(dir, '.config'), XDG_DATA_HOME: path.join(dir, 'native/data'), XDG_CACHE_HOME: path.join(dir, 'native/cache'), XDG_STATE_HOME: path.join(dir, 'native/state'), TMPDIR: path.join(dir, 'native/tmp'), NODE_OPTIONS: '--max-old-space-size=192 --max-semi-space-size=1' };
        for (const k of ['PATH', 'LANG', 'TZ', 'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY', 'http_proxy', 'https_proxy', 'all_proxy', 'no_proxy'])
            if (process.env[k])
                env[k] = process.env[k];
        const child = spawn(this.options.nodeExecutable, [this.options.runnerModule, 'sdk'], { cwd: lease.workDirectory, env, detached: true, stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
        h.child = child;
        let born = false, ready = false, configured = false;
        const configure = () => { if (born && ready && !configured) {
            configured = true;
            this.wire(h, { type: 'config', config: h.config });
        } };
        child.on('message', (item: any) => { try {
            if (item?.type === 'ready') {
                ready = true;
                configure();
                return;
            }
            this.observe(h, item);
        }
        catch (e) {
            this.fail(h, e instanceof Error ? e.message : 'Invalid member observation');
        } });
        child.on('error', () => this.fail(h, 'Member process spawn failed'));
        child.on('disconnect', () => { if (!h.stopping)
            this.fail(h, 'Member IPC disconnected'); });
        child.on('exit', () => { if (!h.stopping)
            this.fail(h, 'Member process exited before closure'); });
        if (child.stderr)
            createInterface({ input: child.stderr }).on('line', text => { try {
                this.journal(h, 'raw', { channel: 'untrusted_stderr', text });
            }
            catch {
                void this.close(h.lease);
            } });
        if (!child.pid)
            throw Error('Member has no PID');
        const row = table().find(x => x.pid === child.pid);
        if (!row || row.group !== child.pid) {
            await this.close(lease);
            throw Error('Member birth identity unavailable');
        }
        Object.assign(lease, { pid: row.pid, processGroup: row.group, startIdentity: row.birth });
        atomic(path.join(this.root(lease.sessionKey), 'lease.json'), lease);
        this.snapshot(h);
        born = true;
        configure();
        h.monitor = setInterval(() => { try {
            const rows = this.snapshot(h);
            const rssKiB=rows.reduce((s, x) => s + x.rss, 0);
            const rssLimitMiB=h.config.prepared.runtime==='opencode'?2048:768;
            if (rows.length > 96 || rssKiB > rssLimitMiB * 1024 || Date.now() >= Date.parse(h.config.prepared.deadlineAt))
                this.fail(h, `Member resource/deadline bound exceeded (RSS ${(rssKiB/1024).toFixed(1)} MiB, ${rows.length} PIDs)`);
        }
        catch {
            this.fail(h, 'Member process observations unavailable');
        } }, 500);
        h.monitor.unref();
    }
    private observe(h: Held, item: any) {
        if (h.stopping)
            return;
        if (!object(item) || typeof item.type !== 'string')
            throw Error('Invalid member IPC');
        const payload = item.payload, p = h.config.prepared;
        if (item.type === 'failure')
            throw Error(typeof item.reason === 'string' ? item.reason : 'Member failed');
        if (item.type === 'created') {
            if (h.nativeSession || payload?.runtime !== p.runtime || typeof payload.nativeSession !== 'string' || !payload.nativeSession)
                throw Error('Invalid native identity');
            h.nativeSession = payload.nativeSession;
            this.snapshot(h);
            this.journal(h, 'created', payload);
            this.state(h, 'running');
            return;
        }
        if (!h.nativeSession)
            throw Error('Member observation before native identity');
        if (['raw', 'event', 'control', 'error'].includes(item.type)) {
            this.journal(h, item.type, payload);
            return;
        }
        const current = h.current;
        if (item.type === 'received') {
            if (!current || payload?.inputId !== current.id || current.received)
                throw Error('Uncorrelated input reception');
            current.received = true;
            this.journal(h, 'received', payload);
            return;
        }
        if (item.type === 'terminal') {
            if (!current || payload?.inputId !== current.id || current.terminal || !object(payload.outcome))
                throw Error('Uncorrelated turn terminal');
            current.terminal = payload.outcome;
            this.journal(h, 'terminal', { ...payload, received: current.received });
            return;
        }
        if (item.type === 'finished') {
            if (!current || item.inputId !== current.id || !current.received || current.terminal?.kind !== 'completed' || typeof item.text !== 'string')
                throw Error('Finish lacks correlated received/completed IPC');
            let output: unknown;
            try {
                output = JSON.parse(item.text);
            }
            catch {
                if (current.initial)
                    throw Error('Invalid initial delivery JSON');
            }
            const parsed = taskToolOutput.safeParse(output);
            if (current.initial && (!parsed.success || parsed.data.schemaVersion !== h.config.outputSchemaVersion))
                throw Error('Invalid TaskToolOutput delivery');
            this.journal(h, 'finished', { inputId: current.id, text: item.text });
            if (parsed.success && parsed.data.schemaVersion === h.config.outputSchemaVersion)
                atomic(path.join(h.lease.controlDirectory, 'result.json'), { sessionKey: p.sessionKey, generation: p.generation, memberId: p.memberId, nativeSession: h.nativeSession, streamGeneration: h.streamGeneration, inputId: p.inputId, ...(current.initial ? {} : { deliveryInputId: current.id }), output: redact(parsed.data, h.config.model.apiKey) });
            this.state(h, 'completed', { inputId: current.id });
            h.current = undefined;
            this.flush(h);
            return;
        }
        throw Error('Unknown member observation');
    }
    async authorize(lease: LocalMemberLease, body: {
        sessionKey: string;
        generation: number;
        nativeSession: string;
        inputId: string;
    }) { const h = this.get(lease), p = h.config.prepared; if (this.shuttingDown || h.stopping)
        throw Error('Member stopping rejects authorization'); if (body.sessionKey !== p.sessionKey || body.generation !== p.generation || body.nativeSession !== h.nativeSession || body.inputId !== p.inputId)
        throw Error('Wrong creation authorization identity'); if (h.authorized)
        return; if (!h.child?.connected)
        throw Error('Original member IPC unavailable'); atomic(path.join(lease.controlDirectory, 'authorization.json'), body); if (!claim(path.join(lease.controlDirectory, 'claims', safe(p.inputId) + '.json'), body))
        return; h.authorized = true; this.journal(h, 'control', { action: 'host_identity_persisted', inputId: p.inputId }); this.wire(h, { type: 'created_ack' }); this.input(h, p.inputId, p.prompt, true); }
    private input(h: Held, id: string, input: string, initial: boolean) { h.current = { id, initial, received: false }; this.journal(h, 'control', { action: 'send_intent', inputId: id, input }); this.state(h, 'running', { inputId: id }); this.wire(h, { type: 'input', id, input, initial }); }
    private flush(h: Held) { if (!h.authorized || h.current || h.stopping)
        return; for (const name of fs.readdirSync(path.join(h.lease.controlDirectory, 'inbox')).filter(n => /^[a-zA-Z0-9_-]+\.json$/.test(n)).sort()) {
        const message = load(path.join(h.lease.controlDirectory, 'inbox', name));
        if (claim(path.join(h.lease.controlDirectory, 'claims', name), { inputId: message.id, nativeSession: h.nativeSession })) {
            this.input(h, message.id, message.input, false);
            break;
        }
    } }
    async sendInput(lease: LocalMemberLease, id: string, input: string) { safe(id); if (!input || Buffer.byteLength(input) > 65536)
        throw Error('Invalid bounded member input'); const h = this.get(lease); if (this.shuttingDown || h.stopping)
        throw Error('Member stopping rejects input'); const file = path.join(lease.controlDirectory, 'inbox', id + '.json'); if (fs.existsSync(file)) {
        if (load(file).input !== input)
            throw Error('Member input identity reused');
        return;
    } atomic(file, { id, input }); this.flush(h); }
    async reply(lease: LocalMemberLease, id: string, body: string) { if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id) || Buffer.byteLength(body) > 16384)
        throw Error('Invalid bounded member reply'); this.get(lease); atomic(path.join(lease.controlDirectory, 'replies', id + '.json'), JSON.parse(body)); }
    async read(lease: LocalMemberLease) {
        this.get(lease);
        const read = (name: string) => { try {
            return fs.readFileSync(path.join(lease.controlDirectory, name), 'utf8');
        }
        catch (e) {
            if ((e as NodeJS.ErrnoException).code === 'ENOENT')
                return null;
            throw e;
        } };
        const journal = read('journal.jsonl') ?? '', rows = journal.trim() ? journal.trim().split('\n').map(s => JSON.parse(s)) : [];
        let result = read('result.json');
        if (result) {
            const delivered = JSON.parse(result), id = delivered.deliveryInputId ?? delivered.inputId;
            const finish = rows.findLast((r: any) => r.kind === 'finished' && r.payload.inputId === id);
            const terminal = rows.find((r: any) => r.kind === 'terminal' && r.payload.inputId === id && r.payload.outcome?.kind === 'completed' && r.payload.received === true);
            const received = rows.find((r: any) => r.kind === 'received' && r.payload.inputId === id);
            if (delivered.sessionKey !== lease.sessionKey || delivered.generation !== lease.generation || delivered.memberId !== lease.memberId || delivered.nativeSession !== this.get(lease).nativeSession || delivered.streamGeneration !== this.get(lease).streamGeneration || !finish || !terminal || !received || JSON.stringify(redact(JSON.parse(finish.payload.text), this.get(lease).config.model.apiKey)) !== JSON.stringify(delivered.output))
                result = null;
        }
        const names = fs.readdirSync(path.join(lease.controlDirectory, 'native/requests')).filter(n => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.json$/i.test(n));
        if (names.length > 64)
            throw Error('Member request count exceeded');
        const requests = names.map(name => { const f = path.join(lease.controlDirectory, 'native/requests', name), info = fs.lstatSync(f); if (!info.isFile() || info.isSymbolicLink() || info.size > 16384)
            throw Error('Invalid bounded member request'); const body = fs.readFileSync(f, 'utf8'); if (JSON.parse(body).id !== name.slice(0, -5))
            throw Error('Member request identity differs'); return { id: name.slice(0, -5), body }; });
        return { journal, result, state: read('state.json'), requests };
    }
    async readArtifact(lease: LocalMemberLease, relativePath: string, offset = 0, limit = 65536) { this.get(lease); if (path.isAbsolute(relativePath) || relativePath.split(/[\\/]/).some(p => p === '..') || !Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 65536)
        throw Error('Invalid artifact range/path'); const root = fs.realpathSync(lease.workDirectory), target = fs.realpathSync(path.join(root, relativePath)); if (!target.startsWith(root + path.sep))
        throw Error('Artifact escapes work directory'); const fd = fs.openSync(target, 'r'); try {
        const before = fs.fstatSync(fd);
        if (!before.isFile() || before.size > 16 * 1024 * 1024 || offset > before.size)
            throw Error('Invalid bounded artifact');
        const bytes = Buffer.alloc(Math.min(limit, Math.max(0, before.size - offset)));
        const actual = fs.readSync(fd, bytes, 0, bytes.length, offset);
        if (actual !== bytes.length)
            throw Error('Artifact short read');
        const after = fs.fstatSync(fd);
        if (before.ino !== after.ino || before.size !== after.size || before.mtimeMs !== after.mtimeMs)
            throw Error('Artifact changed during read');
        return { bytes, total: before.size };
    }
    finally {
        fs.closeSync(fd);
    } }
    async close(lease: LocalMemberLease): Promise<LocalMemberClosure> { const h = this.get(lease); if (h.stopping)
        return h.stopping; h.stopping = this.closeOwned(h); const result = await h.stopping; if (!result.closed)
        h.stopping = undefined; return result; }
    private async closeOwned(h: Held): Promise<LocalMemberClosure> {
        if (h.monitor)
            clearInterval(h.monitor);
        const l = h.lease;
        if (!l.pid || !l.processGroup || !l.startIdentity) {
            if (fs.existsSync(path.join(l.controlDirectory, 'start.claim')))
                return { closed: false, reason: 'Spawn claimed but birth identity unavailable' };
            this.state(h, 'closed');
            return { closed: true, reason: 'Never started' };
        }
        const group = () => table().filter(r => r.group === l.processGroup);
        const matching = () => { const leader = table().find(r => r.pid === l.pid); return !leader || (leader.birth === l.startIdentity && leader.group === l.processGroup); };
        try {
            if (!matching())
                return { closed: false, reason: 'PID identity mismatch; no signal sent' };
            this.snapshot(h);
            const alive = () => { const all = table(); return (h.owned ?? []).filter(r => all.some(x => x.pid === r.pid)); };
            this.journal(h, 'control', { action: 'stop', closure: 'unconfirmed' });
            if (h.child?.connected)
                h.child.send({ type: 'stop', reason: 'Host close' }, () => { });
            for (const signal of [undefined, 'SIGTERM', 'SIGKILL'] as const) {
                if (signal && (group().length || alive().length)) {
                    if (!matching())
                        return { closed: false, reason: 'PID identity mismatch; no signal sent' };
                    for (const owned of h.owned ?? []) {
                        const row = table().find(r => r.pid === owned.pid);
                        if (row && row.birth !== owned.birth)
                            return { closed: false, reason: 'Descendant PID identity mismatch; no signal sent' };
                        if (row && row.group !== l.processGroup)
                            try {
                                process.kill(row.pid, signal);
                            }
                            catch (e) {
                                if ((e as NodeJS.ErrnoException).code !== 'ESRCH')
                                    throw e;
                            }
                    }
                    try {
                        process.kill(-l.processGroup, signal);
                    }
                    catch (e) {
                        if ((e as NodeJS.ErrnoException).code !== 'ESRCH')
                            throw e;
                    }
                }
                const until = Date.now() + (signal === 'SIGKILL' ? 1500 : 500);
                while (Date.now() < until) {
                    if (!group().length && !alive().length) {
                        const proof = { group: l.processGroup, observedAt: new Date().toISOString(), absent: true as const, pids: (h.owned ?? []).map(r => r.pid) };
                        this.state(h, 'closed', { proof });
                        return { closed: true, proof };
                    }
                    await sleep(50);
                }
            }
            this.state(h, 'unknown', { reason: 'Owned process group remains' });
            return { closed: false, reason: 'Owned process group remains' };
        }
        catch {
            try {
                this.state(h, 'unknown', { reason: 'Process closure observation unavailable' });
            }
            catch { }
            return { closed: false, reason: 'Process closure observation unavailable' };
        }
    }
    async stopAll() { this.shuttingDown = true; return Promise.all([...this.held.values()].map(h => this.close(h.lease))); }
    async recover(sessionKey: string): Promise<LocalMemberLease | undefined> { const current = this.held.get(sessionKey); if (current)
        return current.lease; const root = this.root(sessionKey); if (!fs.existsSync(path.join(root, 'lease.json')))
        return undefined; const lease = load(path.join(root, 'lease.json')) as LocalMemberLease; if (lease.sessionKey !== sessionKey || ![lease.controlDirectory, lease.workDirectory].every(p => path.resolve(p).startsWith(root + path.sep)))
        throw Error('Invalid retained local lease'); const config = load(path.join(lease.controlDirectory, 'config.json')); const rows = fs.existsSync(path.join(lease.controlDirectory, 'journal.jsonl')) ? fs.readFileSync(path.join(lease.controlDirectory, 'journal.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map(s => JSON.parse(s)) : []; const h: Held = { lease, config, failureReason: fs.existsSync(path.join(lease.controlDirectory, 'state.json')) ? load(path.join(lease.controlDirectory, 'state.json')).failureReason : undefined, owned: fs.existsSync(path.join(lease.controlDirectory, 'owned-pids.json')) ? load(path.join(lease.controlDirectory, 'owned-pids.json')) : undefined, seq: rows.length, streamGeneration: rows[0]?.streamGeneration ?? randomUUID(), nativeSession: rows.find((r: any) => r.kind === 'created')?.payload.nativeSession }; this.held.set(sessionKey, h); if (lease.processGroup && lease.pid && lease.startIdentity) {
        try {
            const present = table().filter(r => r.group === lease.processGroup);
            if (!present.length && !(h.owned ?? []).some(r => table().some(x => x.pid === r.pid)))
                this.state(h, 'closed', { proof: { group: lease.processGroup, observedAt: new Date().toISOString(), absent: true } });
            else
                this.state(h, 'unknown', { reason: 'Recovered original lease without IPC; no restart or input replay' });
        }
        catch {
            this.state(h, 'unknown', { reason: 'Recovery process observations unavailable' });
        }
    }
    else if (fs.existsSync(path.join(lease.controlDirectory, 'start.claim')))
        this.state(h, 'unknown', { reason: 'Spawn claimed without retained birth identity' }); return lease; }
}
