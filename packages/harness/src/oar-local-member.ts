import { resolveRetainedMemberRoot } from './run-backup.js';
export const retainedMemberRootProtocol = 'hima-native-original-roots/1';
// Trusted local IO ownership only. DBOS/Host own admission and business progression.
import * as fs from 'node:fs';
import type { FileHandle } from 'node:fs/promises';
import { TextDecoder, isDeepStrictEqual } from 'node:util';
import * as path from 'node:path';
import os from 'node:os';
import { randomUUID, createHash } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';
import { spawn, execFile, execFileSync, type ChildProcess } from 'node:child_process';
import { createInterface } from 'node:readline';
import type { OarPrepared } from './oar-task-adapter.js';
import { type TaskIdentity, taskToolOutput } from './task-contract.js';
export interface LocalContextLimits { readonly maxFiles: number; readonly maxBytes: number; readonly maxFileBytes: number; }
export interface LocalContextOrigin {
    readonly identity: TaskIdentity; readonly sessionKey: string; readonly generation: number;
    readonly memberId: string; readonly runtime: 'pi' | 'opencode'; readonly nativeSession: string; readonly cwd: string;
}
export interface LocalContextFile { readonly path: string; readonly bytes: number; readonly sha256: string; }
export interface LocalNativeCheckpoint {
    readonly schema: 'hima-oar-native-checkpoint/1'; readonly checkpointId: string; readonly requestId: string;
    readonly origin: LocalContextOrigin; readonly capturedAt: string; readonly boundary: 'after-physical-close';
    readonly format: 'pi-session-jsonl' | 'opencode-opaque-data'; readonly files: readonly LocalContextFile[];
    readonly excluded: readonly string[]; readonly sha256: string;
}
export type LocalContextCapture = { readonly state: 'captured'; readonly checkpoint: LocalNativeCheckpoint }
    | { readonly state: 'unavailable'; readonly reason: string };
export type LocalMemberContinuity = { readonly kind: 'native-resume'; readonly checkpoint: LocalNativeCheckpoint }
    | { readonly kind: 'reconstruction'; readonly origin: LocalContextOrigin; readonly contextSha256: string };
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
    /** GitHub software members execute under a filesystem boundary, not just a private HOME. */
    softwareGithubIsolation?: true;
    readonly continuity?: LocalMemberContinuity;
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
type JournalEntry = { bytes: Buffer; row: any; resolve: () => void; reject: (error: Error) => void };
const softwareSandboxProfile = (lease: LocalMemberLease, config: LocalMemberConfiguration, runnerModule: string): string => {
    if (process.platform !== 'darwin') throw Error('GitHub software member requires a qualified native filesystem boundary.');
    const assets = config.assets;
    if (!assets) throw Error('GitHub software member has no frozen native assets.');
    const userHome = fs.realpathSync(os.homedir());
    const harnessPackage=path.dirname(path.dirname(runnerModule));
    const workspace=path.dirname(path.dirname(harnessPackage));
    const pnpmMarker=`${path.sep}node_modules${path.sep}.pnpm${path.sep}`;
    const oarModulesIndex=assets.oarModule.indexOf(pnpmMarker);
    const oarModules=oarModulesIndex>=0?assets.oarModule.slice(0,oarModulesIndex)+path.sep+'node_modules'
        :path.dirname(path.dirname(path.dirname(path.dirname(assets.oarModule))));
    const readable = [lease.controlDirectory, lease.workDirectory, harnessPackage,path.join(workspace,'node_modules'),
        oarModules,
        path.dirname(path.dirname(assets.nodeExecutable)),
        ...(config.prepared.runtime==='opencode'?[path.dirname(path.dirname(assets.opencodeCommand))]:[])];
    const writable = [lease.controlDirectory, lease.workDirectory];
    const permit = (operation: string, value: string) => `(allow ${operation} (subpath ${JSON.stringify(fs.realpathSync(value))}))`;
    const ancestors=new Set<string>();
    for(const item of [...readable,...writable]) {
        let current=fs.realpathSync(item);
        while(current!==path.parse(current).root) {current=path.dirname(current);ancestors.add(current);}
    }
    return ['(version 1)', '(allow default)',
        `(deny file-read* (subpath ${JSON.stringify(userHome)}))`,
        `(deny file-write* (subpath ${JSON.stringify(userHome)}))`,
        '(deny file-read* (subpath "/private/tmp"))', '(deny file-write* (subpath "/private/tmp"))',
        '(deny process-exec (literal "/usr/bin/security"))',
        ...[...ancestors].map(value=>`(allow file-read-metadata (literal ${JSON.stringify(value)}))`),
        ...[...new Set(readable)].map(value => permit('file-read*', value)),
        ...[...new Set(writable)].map(value => permit('file-write*', value)), ''].join('\n');
};
type JournalState = {
    queue: JournalEntry[]; pendingBytes: number; pendingRows: number; ackedSeq: number;
    ackedBytes: number; rowOffsets: number[]; evidence: any[];
    lastAccepted?: Promise<void>; fd?: FileHandle; draining?: Promise<void>; error?: Error; closed?: boolean;
};
const journalQueueBytes = 8 * 1024 * 1024, journalQueueRows = 4096, journalBatchBytes = 4 * 1024 * 1024;
const journalTotalBytes = 12 * 1024 * 1024;
const cooperate = () => new Promise<void>(resolve => setImmediate(resolve));
/** Reconstruct the redacted native frame exactly; small frames remain plain JSON. */
export function decodeOarRawObservationPayload(payload: unknown): unknown {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)
        || (payload as {schema?:unknown}).schema !== 'hima-oar-raw-gzip/1') return payload;
    const frame = payload as {bytes?:unknown;sha256?:unknown;dataBase64?:unknown};
    if (!Number.isSafeInteger(frame.bytes) || (frame.bytes as number) < 32768 || (frame.bytes as number) > journalQueueBytes
        || typeof frame.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(frame.sha256)
        || typeof frame.dataBase64 !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(frame.dataBase64))
        throw Error('Invalid retained compressed native frame');
    const compressed = Buffer.from(frame.dataBase64, 'base64');
    if (compressed.toString('base64') !== frame.dataBase64) throw Error('Invalid retained compressed native frame encoding');
    const bytes = gunzipSync(compressed, { maxOutputLength: journalQueueBytes });
    if (bytes.length !== frame.bytes || createHash('sha256').update(bytes).digest('hex') !== frame.sha256)
        throw Error('Retained compressed native frame differs from its original bytes');
    return JSON.parse(bytes.toString('utf8'));
}
type Held = {
    lease: LocalMemberLease;
    config: LocalMemberConfiguration;
    child?: ChildProcess;
    processClosed?: Promise<void>;
    seq: number;
    journalState?: JournalState;
    streamGeneration: string;
    nativeSession?: string;
    rawCreditProtocol?: boolean;
    rawAckedSeq?: number;
    rawFinalDurable?: boolean;
    authorized?: boolean;
    failureReason?: string;
    current?: {
        id: string;
        initial: boolean;
        received: boolean;
        terminal?: any;
        finishing?: boolean;
    };
    stopping?: Promise<LocalMemberClosure>;
    stopRequested?: boolean;
    yieldRequestId?: string;
    yieldInputId?: string;
    yieldAdmission?: Promise<void>;
    owned?: Row[];
    monitor?: ReturnType<typeof setInterval>;
    monitorEpoch?: number;
    monitorInFlight?: object;
    snapshotRevision?: number;
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
function parseTable(text: string): Row[] { return text.split('\n').flatMap(line => { const m = line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(.+)$/); return m ? [{ pid: Number(m[1]), group: Number(m[2]), parent: Number(m[3]), rss: Number(m[4]), birth: m[5]! }] : []; }); }
function table(): Row[] {
    let firstError: unknown;
    for (let attempt = 0; attempt < 2; attempt++) {
        try { return parseTable(execFileSync('ps', ['-axo', 'pid=,pgid=,ppid=,rss=,lstart='], { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 })); }
        catch (error) { firstError ??= error; }
    }
    // No missing PID is inferred from failed observations. The caller retains
    // unknown closure unless a fresh process-table command succeeds.
    throw firstError;
}
function monitorTable(): Promise<string> { return new Promise((resolve, reject) => {
    execFile('ps', ['-axo', 'pid=,pgid=,ppid=,rss=,lstart='], { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 },
        (error, stdout) => { if (error) reject(error); else resolve(stdout); });
}); }
function redact(v: any, key: string): any { if (typeof v === 'string')
    return (key ? v.split(key).join('[redacted]') : v).replace(/\bBearer\s+[^\s"']+/gi, 'Bearer [redacted]'); if (Array.isArray(v))
    return v.map(x => redact(x, key)); if (object(v))
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, /^(api[-_]?key|x-api-key|key|authorization|password|secret|client[-_]?secret|token|credential[s]?|access[-_]?token|refresh[-_]?token|private[-_]?key)$/i.test(k) ? '[redacted]' : redact(x, key)])); return v; }
// Bounded private file IO, independent of Host admission. Only captureClosedContext
// supplies an origin after actual physical closure; these helpers grant no lease authority.
const contextHash = (bytes: string | Uint8Array) => createHash('sha256').update(bytes).digest('hex');
function canonicalContext(value: any): string {
    if (Array.isArray(value)) return '[' + value.map(canonicalContext).join(',') + ']';
    if (object(value)) return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonicalContext(value[k])).join(',') + '}';
    return JSON.stringify(value);
}
function immutableContext<T>(value: T): T {
    if (value && typeof value === 'object') { Object.values(value).forEach(immutableContext); Object.freeze(value); }
    return value;
}
function relativeContextPath(value: string): string {
    if (!value || path.isAbsolute(value) || value.includes('\\') || value.includes(':')
        || value.split('/').some(p => !p || p === '.' || p === '..')) throw Error('Invalid native context path');
    return value;
}
function regularContextPath(root: string, relative = ''): string {
    const absolute = path.resolve(root), pieces = absolute.split(path.sep).filter(Boolean);
    let current = path.parse(absolute).root;
    for (const piece of pieces.concat(relative ? relativeContextPath(relative).split('/') : [])) {
        current = path.join(current, piece);
        const stat = fs.lstatSync(current);
        if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile()) || (stat.isFile() && stat.nlink !== 1))
            throw Error('Native context links/special files rejected');
    }
    return current;
}
function contextLimits(limits: LocalContextLimits): void {
    if (![limits.maxFiles, limits.maxBytes, limits.maxFileBytes].every(n => Number.isSafeInteger(n) && n > 0)
        || limits.maxFiles > 4096 || limits.maxBytes > 64 * 1024 * 1024 || limits.maxFileBytes > limits.maxBytes)
        throw Error('Invalid native context limits');
}
const maximumContextLimits: LocalContextLimits = { maxFiles: 4096, maxBytes: 64 * 1024 * 1024, maxFileBytes: 64 * 1024 * 1024 };
const credentialSidefile = /^(?:auth|credentials?|secrets?|tokens?|config|settings|models|api[-_]?keys?|keyring)(?:\.(?:jsonc?|ya?ml|toml|ini))?$|^opencode\.(?:jsonc?|ya?ml|toml|ini)$|^\.(?:config|aws|npmrc|netrc)$|^\.env(?:\..*)?$|^(?:profiles?|credential-profiles?)\.(?:jsonc?|ya?ml|toml|ini)$/i;
function stableContextBytes(root: string, relative: string, limits: LocalContextLimits): Buffer {
    const filename = regularContextPath(root, relative), before = fs.lstatSync(filename);
    if (!before.isFile() || before.size > limits.maxFileBytes) throw Error('Native context file bound exceeded');
    const fd = fs.openSync(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    try {
        const opened = fs.fstatSync(fd);
        if (opened.ino !== before.ino || opened.dev !== before.dev || opened.nlink !== 1) throw Error('Native context file changed');
        const bytes = Buffer.alloc(before.size);
        let offset = 0;
        while (offset < bytes.length) { const count = fs.readSync(fd, bytes, offset, bytes.length - offset, offset); if (!count) break; offset += count; }
        const after = fs.fstatSync(fd), named = fs.lstatSync(filename);
        if (offset !== bytes.length) throw Error('Native context file short read');
        if (bytes.length !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs
            || after.ctimeMs !== before.ctimeMs || named.ino !== before.ino || named.dev !== before.dev
            || named.isSymbolicLink()) throw Error('Native context file changed during read');
        return bytes;
    } finally { fs.closeSync(fd); }
}
function piContextDirectory(cwd: string): string {
    return 'pi/sessions/--' + path.resolve(cwd).replace(/^[/\\]/u, '').replace(/[/\\:]/gu, '-') + '--';
}
function piContextMatches(bytes: Buffer, origin: LocalContextOrigin): boolean {
    const text = bytes.toString('utf8');
    if (!text.endsWith('\n') || Buffer.from(text, 'utf8').compare(bytes) !== 0) throw Error('Truncated native Pi session');
    const rows = text.trimEnd().split('\n').map(line => JSON.parse(line));
    const header = rows[0];
    if (!object(header) || header.type !== 'session') throw Error('Invalid native Pi session header');
    if (header.id !== origin.nativeSession || header.cwd !== origin.cwd) return false;
    if (!rows.slice(1).some(row => object(row) && row.type === 'message' && object(row.message)))
        throw Error('Native Pi session has no conversation');
    return true;
}
function checkpointId(origin: LocalContextOrigin, requestId: string): string {
    if (!requestId || Buffer.byteLength(requestId) > 200) throw Error('Invalid context request identity');
    return contextHash(canonicalContext({ origin, requestId }));
}
function checkpointBody(checkpoint: LocalNativeCheckpoint): Omit<LocalNativeCheckpoint, 'sha256'> {
    const { sha256, ...body } = checkpoint; return body;
}
export function verifyLocalNativeCheckpoint(controlDirectory: string, checkpoint: LocalNativeCheckpoint,
    limits: LocalContextLimits = maximumContextLimits): LocalNativeCheckpoint {
    contextLimits(limits);
    if (checkpoint.schema !== 'hima-oar-native-checkpoint/1' || checkpoint.boundary !== 'after-physical-close'
        || checkpoint.checkpointId !== checkpointId(checkpoint.origin, checkpoint.requestId)
        || checkpoint.sha256 !== contextHash(canonicalContext(checkpointBody(checkpoint)))
        || !Number.isFinite(Date.parse(checkpoint.capturedAt))
        || checkpoint.format !== (checkpoint.origin.runtime === 'pi' ? 'pi-session-jsonl' : 'opencode-opaque-data'))
        throw Error('Native checkpoint manifest identity/digest mismatch');
    const directory = regularContextPath(controlDirectory, 'checkpoints/' + checkpoint.checkpointId);
    const manifest = stableContextBytes(directory, 'manifest.json', { ...maximumContextLimits, maxFileBytes: 1024 * 1024 });
    if (canonicalContext(JSON.parse(manifest.toString('utf8'))) !== canonicalContext(checkpoint))
        throw Error('Native checkpoint differs from retained manifest');
    if (!checkpoint.files.length || checkpoint.files.length > limits.maxFiles) throw Error('Native checkpoint file bound exceeded');
    let total = 0;
    const names = new Set<string>();
    for (const file of checkpoint.files) {
        relativeContextPath(file.path);
        const key = file.path.toLowerCase();
        if (names.has(key) || file.path === 'manifest.json' || !Number.isSafeInteger(file.bytes) || file.bytes < 0)
            throw Error('Native checkpoint path collision');
        names.add(key);
        const bytes = stableContextBytes(directory, file.path, limits);
        total += bytes.length;
        if (total > limits.maxBytes || bytes.length !== file.bytes || contextHash(bytes) !== file.sha256)
            throw Error('Native checkpoint file size/digest mismatch');
        if (checkpoint.origin.runtime === 'pi' && (!file.path.startsWith(piContextDirectory(checkpoint.origin.cwd) + '/')
            || !piContextMatches(bytes, checkpoint.origin))) throw Error('Native Pi checkpoint identity mismatch');
        if (checkpoint.origin.runtime === 'opencode' && (!file.path.startsWith('data/')
            || credentialSidefile.test(path.posix.basename(file.path)))) throw Error('Native credential/config sidefile rejected');
    }
    if (checkpoint.origin.runtime === 'pi' && checkpoint.files.length !== 1) throw Error('Ambiguous native Pi checkpoint');
    for (const excluded of checkpoint.excluded) relativeContextPath(excluded);
    // Reject unmanifested files and links, including files introduced after capture.
    let verifiedEntries = 0;
    const visit = (relative: string) => {
        if (relative.split('/').length > 32 || ++verifiedEntries > limits.maxFiles * 8 + 64) throw Error('Native checkpoint inventory bound exceeded');
        const entries = fs.readdirSync(regularContextPath(directory, relative));
        if (entries.length + verifiedEntries > limits.maxFiles * 8 + 64) throw Error('Native checkpoint inventory bound exceeded');
        for (const name of entries) {
            if (++verifiedEntries > limits.maxFiles * 8 + 64) throw Error('Native checkpoint inventory bound exceeded');
            const rel = relative ? relative + '/' + name : name;
            const stat = fs.lstatSync(regularContextPath(directory, rel));
            if (stat.isDirectory()) visit(rel);
            else if (rel !== 'manifest.json' && !names.has(rel.toLowerCase())) throw Error('Unmanifested native checkpoint file');
        }
    };
    visit('');
    return immutableContext(JSON.parse(JSON.stringify(checkpoint)));
}
export function captureLocalNativeFiles(controlDirectory: string, origin: LocalContextOrigin,
    requestId: string, limits: LocalContextLimits): LocalContextCapture {
    contextLimits(limits);
    const id = checkpointId(origin, requestId), directory = path.join(controlDirectory, 'checkpoints', id);
    if (fs.existsSync(directory)) {
        const checkpoint = JSON.parse(stableContextBytes(directory, 'manifest.json', { ...maximumContextLimits, maxFileBytes: 1024 * 1024 }).toString('utf8')) as LocalNativeCheckpoint;
        if (canonicalContext(checkpoint.origin) !== canonicalContext(origin) || checkpoint.requestId !== requestId)
            throw Error('Native checkpoint replay identity mismatch');
        return { state: 'captured', checkpoint: verifyLocalNativeCheckpoint(controlDirectory, checkpoint, limits) };
    }
    const native = regularContextPath(controlDirectory, 'native');
    const source = origin.runtime === 'pi' ? piContextDirectory(origin.cwd) : 'data';
    if (!fs.existsSync(path.join(native, source))) return { state: 'unavailable', reason: 'Native conversation data unavailable' };
    const files: { path: string; bytes: Buffer }[] = [], excluded: string[] = [];
    let entries = 0, total = 0;
    const visit = (relative: string) => {
        if (relative.split('/').length > 32) throw Error('Native context directory depth exceeded');
        const absolute = regularContextPath(native, relative), stat = fs.lstatSync(absolute);
        if (++entries > limits.maxFiles * 8 + 64) throw Error('Native context inventory bound exceeded');
        if (stat.isDirectory()) {
            const names = fs.readdirSync(absolute).sort();
            if (names.length + entries > limits.maxFiles * 8 + 64) throw Error('Native context inventory bound exceeded');
            if (new Set(names.map(name => name.toLowerCase())).size !== names.length) throw Error('Native context path collision');
            for (const name of names) visit(relative + '/' + name);
            const after = fs.lstatSync(absolute);
            if (after.ino !== stat.ino || after.mtimeMs !== stat.mtimeMs || after.ctimeMs !== stat.ctimeMs) throw Error('Native context directory changed');
        } else {
            if (origin.runtime === 'opencode' && credentialSidefile.test(path.posix.basename(relative))) { excluded.push(relative); return; }
            if (origin.runtime === 'pi' && !relative.endsWith('.jsonl')) return;
            const bytes = stableContextBytes(native, relative, limits);
            total += bytes.length;
            if (total > limits.maxBytes || files.length >= limits.maxFiles) throw Error('Native context bounds exceeded');
            if (origin.runtime === 'pi' && !piContextMatches(bytes, origin)) return;
            files.push({ path: relative, bytes });
        }
    };
    visit(source);
    if (!files.length) return { state: 'unavailable', reason: 'Matching native conversation unavailable' };
    if (origin.runtime === 'pi' && files.length !== 1) throw Error('Ambiguous native Pi session identity');
    const parent = path.join(controlDirectory, 'checkpoints'); mkdir(parent); regularContextPath(parent);
    const temporary = path.join(parent, '.' + id + '.' + randomUUID()); mkdir(temporary);
    try {
        for (const file of files) {
            const target = path.join(temporary, file.path); mkdir(path.dirname(target));
            const fd = fs.openSync(target, 'wx', 0o600);
            try { fs.writeFileSync(fd, file.bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
        }
        for (const file of files) {
            if (!stableContextBytes(native, file.path, limits).equals(file.bytes)) throw Error('Native context changed before publication');
        }
        const body: Omit<LocalNativeCheckpoint, 'sha256'> = { schema: 'hima-oar-native-checkpoint/1', checkpointId: id,
            requestId, origin: JSON.parse(JSON.stringify(origin)), capturedAt: new Date().toISOString(), boundary: 'after-physical-close',
            format: origin.runtime === 'pi' ? 'pi-session-jsonl' : 'opencode-opaque-data',
            files: files.map(file => ({ path: file.path, bytes: file.bytes.length, sha256: contextHash(file.bytes) })), excluded: excluded.sort() };
        const checkpoint: LocalNativeCheckpoint = { ...body, sha256: contextHash(canonicalContext(body)) };
        atomic(path.join(temporary, 'manifest.json'), checkpoint);
        const syncTree = (directory: string) => {
            for (const name of fs.readdirSync(directory)) { const child = path.join(directory, name); if (fs.lstatSync(child).isDirectory()) syncTree(child); }
            syncDirectory(directory);
        };
        syncTree(temporary);
        // rename cannot replace a populated published checkpoint directory.
        fs.renameSync(temporary, directory); syncDirectory(parent);
        return { state: 'captured', checkpoint: verifyLocalNativeCheckpoint(controlDirectory, checkpoint, limits) };
    } finally { if (fs.existsSync(temporary)) fs.rmSync(temporary, { recursive: true }); }
}
export function validateLocalMemberContinuity(config: LocalMemberConfiguration, controlDirectory: string, workDirectory: string): void {
    const continuity = config.continuity;
    if (!continuity) return;
    const origin = continuity.kind === 'native-resume' ? continuity.checkpoint.origin : continuity.origin;
    const p = config.prepared, old = origin.identity, next = p.identity;
    if (!origin.nativeSession || origin.memberId !== p.memberId || origin.runtime !== p.runtime
        || origin.sessionKey === p.sessionKey || old.effectId === next.effectId || old.runId !== next.runId
        || old.taskId !== next.taskId || origin.cwd !== workDirectory || !path.isAbsolute(origin.cwd)
        || !Number.isSafeInteger(origin.generation) || origin.generation < 0
        || !['inputSha256', 'irSha256', 'applicationVersion', 'adapterVersion'].every(k => (old as any)[k] === (next as any)[k])
        || canonicalContext('source' in old ? old.source : null) !== canonicalContext('source' in next ? next.source : null)
        || canonicalContext('method' in old ? old.method : old.packSha256) !== canonicalContext('method' in next ? next.method : next.packSha256)
        || (continuity.kind === 'reconstruction' && !/^[0-9a-f]{64}$/.test(continuity.contextSha256))
        || !path.isAbsolute(controlDirectory)) throw Error('Invalid native member continuity binding');
}
/** Check native identity before any created observation or engineering prompt. */
export function assertLocalNativeSessionIdentity(continuity: LocalMemberContinuity | undefined, nativeSession: unknown): asserts nativeSession is string {
    if (typeof nativeSession !== 'string' || !nativeSession) throw Error('OAR opened no native session identity');
    if (continuity?.kind === 'native-resume' && nativeSession !== continuity.checkpoint.origin.nativeSession)
        throw Error('Restored native session identity mismatch');
    if (continuity?.kind === 'reconstruction' && nativeSession === continuity.origin.nativeSession)
        throw Error('Reconstruction reused original native session identity');
}
export class OarLocalMemberRuntime {
    private held = new Map<string, Held>();
    private restoredRoots = new Map<string,string>();
    private shuttingDown = false;
    constructor(private options: {
        home: string;
        nodeExecutable: string;
        runnerModule: string;
        assets: LocalMemberAssets;
    }) { }
    private root(key: string) { return this.restoredRoots.get(safe(key)) ?? path.join(this.options.home, 'hima', 'oar-members', safe(key)); }
    private get(lease: LocalMemberLease) { const h = this.held.get(lease.sessionKey); if (!h || h.lease.generation !== lease.generation || h.lease.memberId !== lease.memberId || h.lease.controlDirectory !== lease.controlDirectory || h.lease.workDirectory !== lease.workDirectory)
        throw Error('Unknown local member lease'); return h; }
    /** Fatality is a separate local control fact. It can end business waiting
     * when journal reads are fenced, but never certifies durable rows or close. */
    async fatalState(lease: LocalMemberLease): Promise<{ reason: string } | undefined> {
        this.get(lease);
        const state = load(path.join(lease.controlDirectory, 'state.json'));
        if (state.sessionKey !== lease.sessionKey || state.generation !== lease.generation
            || state.memberId !== lease.memberId || state.controlDirectory !== lease.controlDirectory
            || state.workDirectory !== lease.workDirectory) throw Error('Fatal state belongs to another member lease');
        if (state.fatal !== true) return undefined;
        if (typeof state.failureReason !== 'string' || !state.failureReason) throw Error('Fatal state has no failure reason');
        return { reason: state.failureReason };
    }
    private snapshot(h: Held) { return this.snapshotFromRows(h, table()); }
    private snapshotFromRows(h: Held, all: Row[]) {
        // Any authoritative snapshot supersedes an outstanding periodic sample,
        // including one whose atomic publication subsequently fails.
        h.snapshotRevision = (h.snapshotRevision ?? 0) + 1;
        const known = h.owned ?? [], leader = all.find(r => r.pid === h.lease.pid); if (leader && (leader.birth !== h.lease.startIdentity || leader.group !== h.lease.processGroup))
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
    private state(h: Held, phase: string, extra: any = {}) { atomic(path.join(h.lease.controlDirectory, 'state.json'), { ...h.lease, nativeSession: h.nativeSession, streamGeneration: h.streamGeneration, phase, ...(h.journalState?.error ? { journalFailureReason: h.journalState.error.message } : {}), ...(h.failureReason ? { failureReason: h.failureReason, fatal: true } : {}), ...redact(extra, h.config.model.apiKey) }); }
    private writer(h: Held): JournalState {
        return h.journalState ??= { queue: [], pendingBytes: 0, pendingRows: 0, ackedSeq: -1,
            ackedBytes: 0, rowOffsets: [0], evidence: [] };
    }
    private retentionFailure(h: Held, reason: string): Error {
        const writer = this.writer(h);
        if (!writer.error) {
            writer.error = Error(reason);
            h.failureReason = reason;
            try { this.state(h, 'unknown', { reason }); } catch { }
            // Cleanup does not depend on successfully journaling this failure.
            void this.close(h.lease).catch(() => { });
        }
        return writer.error;
    }
    private journal(h: Held, kind: string, payload: unknown): Promise<void> {
        const writer = this.writer(h);
        if (writer.error) return Promise.reject(writer.error);
        if (writer.closed) return Promise.reject(this.retentionFailure(h, 'Member observation writer closed'));
        let retainedPayload = redact(payload, h.config.model.apiKey);
        if (kind === 'raw') {
            const original = Buffer.from(JSON.stringify(retainedPayload));
            if (original.length > journalQueueBytes)
                return Promise.reject(this.retentionFailure(h, 'Member observation raw frame bound exceeded'));
            if (original.length >= 32768) {
                const compressed = gzipSync(original, { level: 1 });
                if (compressed.length * 4 / 3 + 200 < original.length)
                    retainedPayload = { schema: 'hima-oar-raw-gzip/1', bytes: original.length,
                        sha256: createHash('sha256').update(original).digest('hex'), dataBase64: compressed.toString('base64') };
            }
        }
        const nativeRawSeq = kind === 'raw' && object(payload) && Number.isSafeInteger(payload.seq) ? payload.seq as number : undefined;
        const row = { schema: 'hima-oar-observation/1', sessionKey: h.lease.sessionKey,
            generation: h.lease.generation, memberId: h.lease.memberId, nativeSession: h.nativeSession,
            streamGeneration: h.streamGeneration, seq: h.seq, time: new Date().toISOString(),
            kind, payload: retainedPayload, ...(nativeRawSeq === undefined ? {} : { nativeRawSeq }) };
        const bytes = Buffer.from(JSON.stringify(row) + '\n');
        if (h.config.softwareGithubIsolation && writer.ackedBytes + writer.pendingBytes + bytes.length > journalTotalBytes)
            return Promise.reject(this.retentionFailure(h, 'Member observation journal bound exceeded'));
        if (writer.pendingBytes + bytes.length > journalQueueBytes || writer.pendingRows >= journalQueueRows)
            return Promise.reject(this.retentionFailure(h, 'Member observation queue bound exceeded'));
        h.seq++;
        const fence = new Promise<void>((resolve, reject) => writer.queue.push({ bytes, row: { seq: row.seq, kind }, resolve, reject }));
        writer.lastAccepted = fence;
        writer.pendingBytes += bytes.length; writer.pendingRows++;
        if (!writer.draining) {
            writer.draining = this.drain(h).finally(() => { writer.draining = undefined; });
            void writer.draining.catch(() => { });
        }
        return fence;
    }
    private async drain(h: Held): Promise<void> {
        const writer = this.writer(h);
        let batch: JournalEntry[] = [];
        try {
            writer.fd ??= await fs.promises.open(path.join(h.lease.controlDirectory, 'journal.jsonl'), 'a', 0o600);
            while (writer.queue.length) {
                batch = []; let length = 0;
                while (writer.queue.length && (!batch.length || length + writer.queue[0]!.bytes.length <= journalBatchBytes)) {
                    const entry = writer.queue.shift()!; batch.push(entry); length += entry.bytes.length;
                }
                const bytes = Buffer.concat(batch.map(entry => entry.bytes), length);
                let offset = 0;
                while (offset < bytes.length) {
                    const written = await writer.fd.write(bytes, offset, bytes.length - offset, null);
                    if (!written.bytesWritten) throw Error('Journal short write');
                    offset += written.bytesWritten;
                }
                await writer.fd.sync();
                writer.ackedBytes += length; writer.ackedSeq = batch[batch.length - 1]!.row.seq;
                for (const entry of batch) {
                    writer.rowOffsets.push(writer.rowOffsets.at(-1)! + entry.bytes.length);
                    if (['created', 'received', 'terminal', 'finished', 'control'].includes(entry.row.kind)) writer.evidence.push(JSON.parse(entry.bytes.toString('utf8')));
                    writer.pendingBytes -= entry.bytes.length; writer.pendingRows--; entry.resolve();
                }
                batch = [];
                await cooperate();
            }
        } catch {
            const error = this.retentionFailure(h, 'Member observation retention unavailable');
            for (const entry of [...batch, ...writer.queue.splice(0)]) entry.reject(error);
            writer.pendingBytes = 0; writer.pendingRows = 0;
            if (writer.fd) { try { await writer.fd.close(); } catch { } writer.fd = undefined; }
        }
    }
    private async journalFence(h: Held): Promise<void> {
        const writer = this.writer(h), fence = writer.lastAccepted;
        if (writer.error) throw writer.error;
        if (fence) await fence;
        if (writer.error) throw writer.error;
    }
    private retain(h: Held, kind: string, payload: unknown): void {
        void this.journal(h, kind, payload).catch(() => { });
    }
    private retainObservation(h: Held, kind: 'raw' | 'event', payload: unknown, ackSeq: unknown): void {
        if (!Number.isSafeInteger(ackSeq) || (ackSeq as number) < 0 || !object(payload)
            || payload.seq !== ackSeq) throw Error('Uncorrelated native raw cursor');
        void this.journal(h, kind, payload).then(() => {
            if (ackSeq !== (h.rawAckedSeq ?? -1) + 1) throw Error('Native raw durable ACK skipped an original cursor');
            h.rawAckedSeq = ackSeq as number;
            if (h.child?.connected) this.wire(h, { type: 'raw_ack', seq: ackSeq });
            else throw Error('Native raw durable ACK has no original child');
        }).catch(() => { this.retentionFailure(h, 'Native raw durable ACK could not reach its original child'); });
    }
    private retainRawFinal(h: Held, payload: unknown): void {
        if (!h.rawCreditProtocol || !object(payload) || payload.state !== 'complete'
            || !Number.isSafeInteger(payload.lastSeq) || payload.lastSeq < -1
            || payload.ackedSeq !== payload.lastSeq || payload.lastSeq !== (h.rawAckedSeq ?? -1)) {
            this.retentionFailure(h, 'Native raw final cursor is incomplete or differs from Host durability'); return;
        }
        void this.journal(h, 'control', { action: 'raw_final', lastSeq: payload.lastSeq, state: 'complete' })
            .then(() => { h.rawFinalDurable = true; })
            .catch(() => { /* Journal failure already fences normal closure. */ });
    }
    private async closeWriter(h: Held): Promise<void> {
        const writer = this.writer(h);
        // Wait for already accepted rows even after an overflow latched failure.
        while (writer.draining) await writer.draining;
        writer.closed = true;
        if (writer.fd) { const fd = writer.fd; writer.fd = undefined;
            try { await fd.close(); } catch { throw this.retentionFailure(h, 'Member observation retention unavailable'); } }
        if (writer.error) throw writer.error;
    }
    private wire(h: Held, v: any) { if (!h.child?.connected)
        throw Error('Member IPC unavailable; recovery cannot resend'); h.child.send(v, e => { if (e && !h.stopRequested && !h.stopping)
        this.fail(h, 'Member IPC delivery failed'); }); }
    private fail(h: Held, reason: string) {
        if (h.yieldRequestId && (h.stopRequested || h.stopping)) {
            this.retain(h, 'control', { action: 'yield_observation_error', requestId: h.yieldRequestId, reason, closure: 'unconfirmed' });
            return;
        }
        if (h.failureReason || h.stopRequested || h.stopping) return;
        h.failureReason = reason;
        this.retain(h, 'terminal', { outcome: 'failed', reason, inputId: h.current?.id });
        this.retain(h, 'error', { reason });
        try { this.state(h, 'failed', { reason }); } catch { }
        void this.close(h.lease).catch(() => { });
    }
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
            if (JSON.stringify(previous.config.prepared) !== JSON.stringify(p) || JSON.stringify(previous.config.continuity) !== JSON.stringify(config.continuity) || JSON.stringify(previous.config.model) !== JSON.stringify(config.model) || previous.config.outputSchemaVersion !== config.outputSchemaVersion || JSON.stringify(previous.config.assets) !== JSON.stringify(config.assets ?? this.options.assets) || JSON.stringify(load(path.join(previous.lease.controlDirectory, 'skill-binding.json'))) !== JSON.stringify(skillBinding) || (config.controlDirectory !== undefined && path.resolve(config.controlDirectory) !== previous.lease.controlDirectory) || (config.workDirectory !== undefined && path.resolve(config.workDirectory) !== previous.lease.workDirectory))
                throw Error('Member session identity/configuration differs');
            return previous.lease;
        }
        const controlDirectory = path.resolve(config.controlDirectory ?? path.join(root, 'control')), workDirectory = path.resolve(config.workDirectory ?? path.join(root, 'work'));
        if (!controlDirectory.startsWith(root + path.sep) || (!config.continuity && !workDirectory.startsWith(root + path.sep)))
            throw Error('Member directory must be below original member root');
        validateLocalMemberContinuity(config, controlDirectory, workDirectory);
        let checkpointSource: string | undefined;
        if (config.continuity) {
            const origin = config.continuity.kind === 'native-resume' ? config.continuity.checkpoint.origin : config.continuity.origin;
            const originalLease = await this.recover(origin.sessionKey);
            if (!originalLease) throw Error('Native continuity predecessor lease unavailable');
            const original = this.get(originalLease);
            if (canonicalContext(original.config.prepared.identity) !== canonicalContext(origin.identity)
                || original.lease.generation !== origin.generation || original.lease.memberId !== origin.memberId
                || original.config.prepared.runtime !== origin.runtime || original.nativeSession !== origin.nativeSession
                || original.lease.workDirectory !== origin.cwd || original.lease.controlDirectory === controlDirectory
                || Date.parse(p.deadlineAt) > Date.parse(original.config.prepared.deadlineAt))
                throw Error('Native continuity predecessor binding/deadline mismatch');
            this.assertClosedContext(original);
            regularContextPath(workDirectory);
            if (config.continuity.kind === 'native-resume') {
                verifyLocalNativeCheckpoint(original.lease.controlDirectory, config.continuity.checkpoint);
                checkpointSource = path.join(original.lease.controlDirectory, 'checkpoints', config.continuity.checkpoint.checkpointId);
            }
        }
        const lease = { sessionKey: p.sessionKey, generation: p.generation, memberId: p.memberId, controlDirectory, workDirectory };
        for (const dir of ['', 'native', 'native/pi', 'native/pi/skills', 'native/.config/opencode/skills', 'native/requests', 'native/data', 'native/cache', 'native/state', 'native/tmp', 'replies', 'inbox', 'claims'])
            mkdir(path.join(controlDirectory, dir));
        if (!config.continuity) mkdir(workDirectory);
        if (config.continuity?.kind === 'native-resume' && checkpointSource) {
            for (const file of config.continuity.checkpoint.files) {
                const bytes = stableContextBytes(checkpointSource, file.path, maximumContextLimits);
                if (bytes.length !== file.bytes || contextHash(bytes) !== file.sha256) throw Error('Native checkpoint changed before staging');
                const target = path.join(controlDirectory, 'native', file.path);
                mkdir(path.dirname(target)); regularContextPath(path.dirname(target));
                const fd = fs.openSync(target, 'wx', 0o600);
                try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
                syncDirectory(path.dirname(target));
            }
        }
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
        if (h.yieldRequestId) throw Error('Member yielded rejects start');
        if (h.stopRequested || h.stopping || h.failureReason) throw Error('Member stopping rejects start');
        if (h.child || fs.existsSync(path.join(dir, 'start.claim')))
            return;
        if (!claim(path.join(dir, 'start.claim'), { ...lease, streamGeneration: h.streamGeneration, time: new Date().toISOString() }))
            return;
        this.state(h, 'starting');
        const env: NodeJS.ProcessEnv = { HOME: dir, HIMA_MEMBER_HOME: dir, XDG_CONFIG_HOME: path.join(dir, '.config'), XDG_DATA_HOME: path.join(dir, 'native/data'), XDG_CACHE_HOME: path.join(dir, 'native/cache'), XDG_STATE_HOME: path.join(dir, 'native/state'), TMPDIR: path.join(dir, 'native/tmp'), NODE_OPTIONS: '--max-old-space-size=192 --max-semi-space-size=1' };
        for (const k of ['PATH', 'LANG', 'TZ', 'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY', 'http_proxy', 'https_proxy', 'all_proxy', 'no_proxy'])
            if (process.env[k])
                env[k] = process.env[k];
        let executable=this.options.nodeExecutable,args=[this.options.runnerModule,'sdk'];
        if(h.config.softwareGithubIsolation) {
            const profile=softwareSandboxProfile(lease,h.config,this.options.runnerModule);
            const file=path.join(dir,'software-github.sb');
            if(fs.existsSync(file)) {if(fs.readFileSync(file,'utf8')!==profile)throw Error('Original software member sandbox profile changed.');}
            else fs.writeFileSync(file,profile,{flag:'wx',mode:0o600});
            executable='/usr/bin/sandbox-exec';args=['-f',file,this.options.nodeExecutable,this.options.runnerModule,'sdk'];
        }
        const child = spawn(executable, args, { cwd: lease.workDirectory, env, detached: true, stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
        h.child = child;
        h.processClosed = new Promise<void>(resolve => child.once('close', () => resolve()));
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
        child.on('disconnect', () => { if (!h.stopRequested && !h.stopping)
            this.fail(h, 'Member IPC disconnected'); });
        child.on('exit', () => { if (!h.stopRequested && !h.stopping)
            this.fail(h, 'Member process exited before closure'); });
        if (child.stderr)
            createInterface({ input: child.stderr }).on('line', text => { try {
                this.retain(h, 'raw', { channel: 'untrusted_stderr', text });
            }
            catch {
                void this.close(h.lease).catch(() => { });
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
        const epoch = h.monitorEpoch = (h.monitorEpoch ?? 0) + 1;
        h.monitor = setInterval(() => { void this.monitorSnapshot(h, epoch); }, 500);
        h.monitor.unref();
    }
    private async monitorSnapshot(h: Held, epoch: number): Promise<void> {
        const active = () => this.held.get(h.lease.sessionKey) === h && h.monitorEpoch === epoch
            && !this.shuttingDown && !h.stopRequested && !h.stopping && !h.failureReason;
        if (!active()) return;
        // Deadline enforcement continues even while an earlier ps is outstanding.
        if (Date.now() >= Date.parse(h.config.prepared.deadlineAt)) {
            this.fail(h, 'Member resource/deadline bound exceeded'); return;
        }
        if (h.monitorInFlight) return;
        const cycle = h.monitorInFlight = {}, revision = h.snapshotRevision ?? 0;
        const current = () => active() && h.snapshotRevision === revision;
        let adopting = false;
        try {
            const text = await monitorTable();
            if (!current()) return;
            adopting = true;
            // No await between reading CURRENT ownership, merging and publishing.
            const rows = this.snapshotFromRows(h, parseTable(text));
            const rssKiB=rows.reduce((s, x) => s + x.rss, 0);
            const rssLimitMiB=h.config.prepared.runtime==='opencode'?2048:768;
            if (rows.length > 96 || rssKiB > rssLimitMiB * 1024 || Date.now() >= Date.parse(h.config.prepared.deadlineAt))
                this.fail(h, `Member resource/deadline bound exceeded (RSS ${(rssKiB/1024).toFixed(1)} MiB, ${rows.length} PIDs)`);
        } catch {
            // A stale failure has no authority to change a newer snapshot/close.
            // Merge/publication can advance revision before failing, so eligibility
            // for that synchronous failure is the active lifecycle, not old revision.
            if (active() && (adopting || h.snapshotRevision === revision))
                this.fail(h, 'Member process observations unavailable');
        } finally {
            if (h.monitorInFlight === cycle) h.monitorInFlight = undefined;
        }
    }
    private observe(h: Held, item: any) {
        if (!object(item) || typeof item.type !== 'string') throw Error('Invalid member IPC');
        const payload = item.payload;
        if (item.type === 'raw_failure') {
            this.retentionFailure(h, typeof item.reason === 'string' ? item.reason : 'Native raw observation was not transferred');
            return;
        }
        if (item.type === 'raw_final') { this.retainRawFinal(h, item); return; }
        if (h.yieldRequestId) {
            if (!h.nativeSession)
                throw Error('Invalid yielded member IPC');
            const current = h.current;
            if (item.type === 'received') {
                if (!current || payload?.inputId !== current.id || current.received)
                    throw Error('Uncorrelated input reception');
                current.received = true;
                this.retain(h, 'received', payload);
                return;
            }
            if (item.type === 'terminal') {
                if (!current || payload?.inputId !== current.id || current.terminal || !object(payload?.outcome))
                    throw Error('Uncorrelated yielded turn terminal');
                current.terminal = payload.outcome;
                this.retain(h, 'terminal', { ...payload, received: current.received, yieldRequestId: h.yieldRequestId });
                // Native failure remains a failure until physical cleanup begins.
                if (payload.outcome.kind !== 'completed' && !h.stopRequested && !h.stopping)
                    this.fail(h, typeof payload.outcome.reason === 'string' ? payload.outcome.reason : 'Native yielding turn failed');
                return;
            }
            if (item.type === 'finished') {
                if (!current || current.finishing || item.inputId !== current.id || current.terminal?.kind !== 'completed' || typeof item.text !== 'string')
                    throw Error('Uncorrelated yielded turn finish');
                current.finishing = true;
                this.retain(h, 'finished', { inputId: current.id, text: item.text, yieldRequestId: h.yieldRequestId });
                return;
            }
            if (item.type === 'failure') {
                this.retain(h, 'error', { reason: item.reason, yieldRequestId: h.yieldRequestId });
                this.fail(h, typeof item.reason === 'string' ? item.reason : 'Member failed');
                return;
            }
            if (['raw', 'event', 'control', 'error'].includes(item.type)) {
                if (item.type === 'control' && payload?.action?.startsWith('yield') && payload.requestId !== h.yieldRequestId)
                    throw Error('Uncorrelated yield control');
                if (['raw','event'].includes(item.type) && item.ackSeq !== undefined) this.retainObservation(h, item.type as 'raw'|'event', { ...payload, yieldRequestId: h.yieldRequestId }, item.ackSeq);
                else this.retain(h, item.type, { ...payload, yieldRequestId: h.yieldRequestId });
                return;
            }
            throw Error('Unknown yielded member observation');
        }
        // Business input remains fenced, but the original child may still be
        // transferring records it produced before stop. Keep only that bounded
        // observation tail and its durable ACKs until the final cursor arrives.
        if (h.stopRequested || h.stopping) {
            if (h.rawCreditProtocol && ['raw','event'].includes(item.type)) {
                if (item.ackSeq !== undefined) this.retainObservation(h, item.type as 'raw'|'event', payload, item.ackSeq);
                else this.retain(h, item.type, payload);
            }
            return;
        }
        const p = h.config.prepared;
        if (item.type === 'failure')
            throw Error(typeof item.reason === 'string' ? item.reason : 'Member failed');
        if (item.type === 'created') {
            if (h.nativeSession || payload?.runtime !== p.runtime || typeof payload.nativeSession !== 'string' || !payload.nativeSession)
                throw Error('Invalid native identity');
            if (payload.rawCreditProtocol !== undefined && payload.rawCreditProtocol !== 'hima-oar-raw-credit/1')
                throw Error('Unsupported native raw credit protocol');
            h.nativeSession = payload.nativeSession;
            h.rawCreditProtocol = payload.rawCreditProtocol === 'hima-oar-raw-credit/1';
            this.snapshot(h);
            this.retain(h, 'created', payload);
            this.state(h, 'running');
            return;
        }
        if (!h.nativeSession)
            throw Error('Member observation before native identity');
        if (['raw', 'event', 'control', 'error'].includes(item.type)) {
            if (['raw','event'].includes(item.type) && item.ackSeq !== undefined) this.retainObservation(h, item.type as 'raw'|'event', payload, item.ackSeq);
            else this.retain(h, item.type, payload);
            return;
        }
        const current = h.current;
        if (item.type === 'received') {
            if (!current || payload?.inputId !== current.id || current.received)
                throw Error('Uncorrelated input reception');
            current.received = true;
            this.retain(h, 'received', payload);
            return;
        }
        if (item.type === 'terminal') {
            if (!current || payload?.inputId !== current.id || current.terminal || !object(payload.outcome))
                throw Error('Uncorrelated turn terminal');
            current.terminal = payload.outcome;
            this.retain(h, 'terminal', { ...payload, received: current.received });
            return;
        }
        if (item.type === 'finished') {
            if (!current || current.finishing || item.inputId !== current.id || !current.received || current.terminal?.kind !== 'completed' || typeof item.text !== 'string')
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
            current.finishing = true;
            const finished = this.journal(h, 'finished', { inputId: current.id, text: item.text });
            void finished.then(async () => {
            if (h.current !== current || h.stopRequested || h.stopping || h.yieldRequestId || h.failureReason) return;
            if (parsed.success && parsed.data.schemaVersion === h.config.outputSchemaVersion)
                atomic(path.join(h.lease.controlDirectory, 'result.json'), { sessionKey: p.sessionKey, generation: p.generation, memberId: p.memberId, nativeSession: h.nativeSession, streamGeneration: h.streamGeneration, inputId: p.inputId, ...(current.initial ? {} : { deliveryInputId: current.id }), output: redact(parsed.data, h.config.model.apiKey) });
            this.state(h, 'completed', { inputId: current.id });
            h.current = undefined;
            await this.flush(h);
            }).catch(() => { if (!h.stopping && !h.yieldRequestId && !this.writer(h).error) this.fail(h, 'Member completion persistence unavailable'); });
            return;
        }
        throw Error('Unknown member observation');
    }
    async authorize(lease: LocalMemberLease, body: {
        sessionKey: string;
        generation: number;
        nativeSession: string;
        inputId: string;
    }) {
        const h = this.get(lease), p = h.config.prepared;
        const active = () => { if (this.shuttingDown || h.stopRequested || h.stopping || h.yieldRequestId || h.failureReason)
            throw Error('Member stopping rejects authorization'); };
        active();
        if (body.sessionKey !== p.sessionKey || body.generation !== p.generation || body.nativeSession !== h.nativeSession || body.inputId !== p.inputId)
            throw Error('Wrong creation authorization identity');
        if (h.authorized) return;
        await this.journalFence(h); active();
        if (!h.child?.connected) throw Error('Original member IPC unavailable');
        atomic(path.join(lease.controlDirectory, 'authorization.json'), body);
        if (!claim(path.join(lease.controlDirectory, 'claims', safe(p.inputId) + '.json'), body)) return;
        await this.journal(h, 'control', { action: 'host_identity_persisted', inputId: p.inputId }); active();
        h.authorized = true; this.wire(h, { type: 'created_ack' });
        await this.input(h, p.inputId, p.prompt, true);
    }
    private async input(h: Held, id: string, input: string, initial: boolean): Promise<void> {
        if (h.current || h.stopRequested || h.stopping || h.yieldRequestId || h.failureReason) throw Error('Member stopping or busy rejects input');
        const current = { id, initial, received: false }; h.current = current;
        await this.journal(h, 'control', { action: 'send_intent', inputId: id, input });
        if (h.current !== current || h.stopRequested || h.stopping || h.yieldRequestId || h.failureReason) throw Error('Member stopping rejects input');
        this.state(h, 'running', { inputId: id }); this.wire(h, { type: 'input', id, input, initial });
    }
    private async flush(h: Held): Promise<void> {
        if (!h.authorized || h.current || h.stopRequested || h.stopping || h.yieldRequestId || h.failureReason) return;
        for (const name of fs.readdirSync(path.join(h.lease.controlDirectory, 'inbox')).filter(n => /^[a-zA-Z0-9_-]+\.json$/.test(n)).sort()) {
            const message = load(path.join(h.lease.controlDirectory, 'inbox', name));
            if (claim(path.join(h.lease.controlDirectory, 'claims', name), { inputId: message.id, nativeSession: h.nativeSession })) {
                await this.input(h, message.id, message.input, false); break;
            }
        }
    }
    async sendInput(lease: LocalMemberLease, id: string, input: string) {
        safe(id); if (!input || Buffer.byteLength(input) > 65536) throw Error('Invalid bounded member input');
        const h = this.get(lease);
        if (this.shuttingDown || h.stopRequested || h.stopping || h.yieldRequestId || h.failureReason) throw Error('Member stopping rejects input');
        const file = path.join(lease.controlDirectory, 'inbox', id + '.json');
        if (fs.existsSync(file)) { if (load(file).input !== input) throw Error('Member input identity reused'); return; }
        atomic(file, { id, input }); await this.flush(h);
    }
    private validatedDelivery(h: Held, result: string | null, rows: readonly any[]): string | null {
        if (!result) return null;
        const delivered = JSON.parse(result), id = delivered.deliveryInputId ?? delivered.inputId;
        const finish = rows.findLast((r: any) => r.kind === 'finished' && r.payload.inputId === id);
        const terminal = rows.find((r: any) => r.kind === 'terminal' && r.payload.inputId === id && r.payload.outcome?.kind === 'completed' && r.payload.received === true);
        const received = rows.find((r: any) => r.kind === 'received' && r.payload.inputId === id);
        const output = taskToolOutput.safeParse(delivered.output);
        if (delivered.sessionKey !== h.lease.sessionKey || delivered.generation !== h.lease.generation || delivered.memberId !== h.lease.memberId
            || delivered.inputId !== h.config.prepared.inputId || delivered.nativeSession !== h.nativeSession || delivered.streamGeneration !== h.streamGeneration
            || !finish || !terminal || !received || !output.success || output.data.schemaVersion !== h.config.outputSchemaVersion
            || !isDeepStrictEqual(redact(JSON.parse(finish.payload.text), h.config.model.apiKey), delivered.output)) return null;
        return result;
    }
    private refusePublishedDeliveryYield(h: Held): void {
        let result: string;
        try { result = fs.readFileSync(path.join(h.lease.controlDirectory, 'result.json'), 'utf8'); }
        catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
        // A later ordinary input does not reopen an already published engineering
        // delivery. Use its original deliveryInputId/receive/terminal/finish proof.
        if (this.validatedDelivery(h, result, this.writer(h).evidence))
            throw Error('Published engineering delivery cannot become an admitted yield');
    }
    async admitAcceptedWait(lease: LocalMemberLease, admission: {
        readonly origin: LocalContextOrigin; readonly streamGeneration: string;
        readonly inputId: string; readonly requestId: string;
    }): Promise<void> {
        const h = this.get(lease), p = h.config.prepared;
        const origin: LocalContextOrigin = { identity: p.identity, sessionKey: lease.sessionKey, generation: lease.generation,
            memberId: lease.memberId, runtime: p.runtime, nativeSession: h.nativeSession ?? '', cwd: lease.workDirectory };
        checkpointId(origin, admission.requestId);
        if (canonicalContext(origin) !== canonicalContext(admission.origin) || !h.nativeSession
            || admission.streamGeneration !== h.streamGeneration || !admission.inputId
            || lease.pid !== h.lease.pid || lease.processGroup !== h.lease.processGroup || lease.startIdentity !== h.lease.startIdentity)
            throw Error('Accepted wait differs from original local/native identity');
        if (h.failureReason || this.writer(h).error) throw Error('Failed member cannot admit wait');
        this.refusePublishedDeliveryYield(h);
        if (h.yieldRequestId) {
            if (h.yieldRequestId !== admission.requestId || h.yieldInputId !== admission.inputId)
                throw Error('Member yield request identity reused');
            if (h.yieldAdmission) await h.yieldAdmission;
            await this.journalFence(h);
            if (h.failureReason) throw Error('Accepted wait observation failed');
            return;
        }
        if (this.shuttingDown || h.stopRequested || h.stopping) throw Error('Ordinary close cannot become an admitted yield');
        if (!h.current || h.current.id !== admission.inputId || h.current.terminal || h.current.finishing)
            throw Error('Accepted wait requires the original active native input');
        // Synchronous latch precedes every await: native completion can arrive
        // while the existing journal fsync is outstanding, but cannot deliver.
        h.yieldRequestId = admission.requestId; h.yieldInputId = admission.inputId;
        h.yieldAdmission = this.journal(h, 'control', { action: 'yield_intent', requestId: admission.requestId,
            inputId: admission.inputId, nativeSession: h.nativeSession, closure: 'unconfirmed' });
        await h.yieldAdmission;
        await this.journalFence(h);
        if (h.failureReason || h.stopRequested || h.stopping) throw Error('Accepted wait closed before reply publication');
    }
    async reply(lease: LocalMemberLease, id: string, body: string) { if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id) || Buffer.byteLength(body) > 16384)
        throw Error('Invalid bounded member reply');
        const h = this.get(lease);
        if (h.yieldAdmission) await h.yieldAdmission;
        // This final check and atomic publication have no intervening await.
        // A native/resource/journal fault that won the durability race denies reply.
        if (this.shuttingDown || h.failureReason || this.writer(h).error || h.stopRequested || h.stopping)
            throw Error('Failed or stopping member rejects reply publication');
        atomic(path.join(lease.controlDirectory, 'replies', id + '.json'), JSON.parse(body)); }
    async read(lease: LocalMemberLease, options?: { afterSeq?: number; streamGeneration?: string; maxRows?: number; summaryOnly?: boolean }) {
        const h = this.get(lease);
        await this.journalFence(h);
        const writer = this.writer(h);
        const read = async (name: string) => { try {
            return await fs.promises.readFile(path.join(lease.controlDirectory, name), 'utf8');
        }
        catch (e) {
            if ((e as NodeJS.ErrnoException).code === 'ENOENT')
                return null;
            throw e;
        } };
        const rows = writer.evidence.slice();
        let start = 0, end = writer.ackedBytes, more = false;
        if (options?.summaryOnly) end = 0;
        else if (options?.afterSeq !== undefined) {
            const cursor = options.streamGeneration === h.streamGeneration ? options.afterSeq : -1;
            const maxRows = options.maxRows ?? 256;
            if (!Number.isSafeInteger(cursor) || cursor < -1 || cursor > writer.ackedSeq
                || !Number.isSafeInteger(maxRows) || maxRows < 1 || maxRows > 1024)
                throw Error('Invalid retained member observation cursor');
            start = writer.rowOffsets[cursor + 1]!;
            let last = cursor;
            while (last < writer.ackedSeq && last - cursor < maxRows) {
                const next = writer.rowOffsets[last + 2]!;
                if (last > cursor && next - start > 1024 * 1024) break;
                end = next; last++;
            }
            if (last === cursor) end = start;
            more = last < writer.ackedSeq;
        }
        let journal = '';
        if (end > start) {
            const file = await fs.promises.open(path.join(lease.controlDirectory, 'journal.jsonl'), 'r');
            try {
                const stat = await file.stat();
                if (!stat.isFile() || stat.size < end) throw Error('Retained member observation file is truncated');
                const bytes = Buffer.alloc(end - start);
                let copied = 0;
                while (copied < bytes.length) {
                    const read = await file.read(bytes, copied, bytes.length - copied, start + copied);
                    if (!read.bytesRead) throw Error('Retained member observation short read');
                    copied += read.bytesRead;
                }
                journal = bytes.toString('utf8');
            } finally { await file.close(); }
        }
        const result = this.validatedDelivery(h, await read('result.json'), rows);
        const names = (await fs.promises.readdir(path.join(lease.controlDirectory, 'native/requests'))).filter(n => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.json$/i.test(n));
        if (names.length > 64)
            throw Error('Member request count exceeded');
        const requests = await Promise.all(names.map(async name => {
            const filename = path.join(lease.controlDirectory, 'native/requests', name), info = await fs.promises.lstat(filename);
            if (!info.isFile() || info.isSymbolicLink() || info.size > 16384) throw Error('Invalid bounded member request');
            const fd = await fs.promises.open(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
            try {
                const before = await fd.stat();
                if (!before.isFile() || before.ino !== info.ino || before.dev !== info.dev || before.size !== info.size || before.size > 16384)
                    throw Error('Invalid bounded member request');
                const bytes = Buffer.alloc(before.size);
                let offset = 0;
                while (offset < bytes.length) {
                    const read = await fd.read(bytes, offset, bytes.length - offset, offset);
                    if (!read.bytesRead) throw Error('Member request short read');
                    offset += read.bytesRead;
                }
                const after = await fd.stat();
                if (before.ino !== after.ino || before.size !== after.size || before.mtimeMs !== after.mtimeMs)
                    throw Error('Member request changed during read');
                const body = bytes.toString('utf8');
                if (JSON.parse(body).id !== name.slice(0, -5)) throw Error('Member request identity differs');
                return { id: name.slice(0, -5), body };
            } finally { await fd.close(); }
        }));
        const state = await read('state.json');
        if (writer.error) throw writer.error;
        return { journal, result, state, requests, evidence: rows, more, streamGeneration: h.streamGeneration };
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
    async close(lease: LocalMemberLease, options?: { readonly yieldRequestId: string }): Promise<LocalMemberClosure> {
        const h = this.get(lease);
        if (options) {
            this.refusePublishedDeliveryYield(h);
            checkpointId({ identity: h.config.prepared.identity, sessionKey: lease.sessionKey, generation: lease.generation,
                memberId: lease.memberId, runtime: h.config.prepared.runtime, nativeSession: h.nativeSession ?? '', cwd: lease.workDirectory }, options.yieldRequestId);
            if (h.yieldRequestId && h.yieldRequestId !== options.yieldRequestId) throw Error('Member yield request identity reused');
            if ((h.stopping || h.stopRequested || h.failureReason || (h.current?.terminal && h.current.terminal.kind !== 'completed')) && !h.yieldRequestId) throw Error('Ordinary close cannot become an admitted yield');
            h.yieldRequestId = options.yieldRequestId;
        }
        if (h.stopping) return h.stopping;
        h.stopRequested = true;
        h.monitorEpoch = (h.monitorEpoch ?? 0) + 1;
        if (h.monitor) { clearInterval(h.monitor); h.monitor = undefined; }
        h.stopping = Promise.resolve().then(() => this.closeOwned(h));
        const result = await h.stopping;
        if (!result.closed) h.stopping = undefined;
        return result; }
    private async closeOwned(h: Held): Promise<LocalMemberClosure> {
        if (h.monitor)
            clearInterval(h.monitor);
        const l = h.lease, began = Date.now();
        const barrier = async (promise: Promise<void>, until: number): Promise<boolean> => {
            let timer: ReturnType<typeof setTimeout> | undefined;
            try {
                await Promise.race([promise, new Promise<never>((_, reject) => {
                    timer = setTimeout(() => reject(Error('Journal closure durability deadline')), Math.max(0, until - Date.now()));
                })]);
                return true;
            } catch {
                this.retentionFailure(h, 'Member observation closure durability unconfirmed'); return false;
            } finally { if (timer) clearTimeout(timer); }
        };
        if (h.yieldRequestId) {
            await barrier(h.yieldAdmission ?? this.journal(h, 'control', { action: 'yield_intent', requestId: h.yieldRequestId, nativeSession: h.nativeSession, closure: 'unconfirmed' }), began + 500);
        }
        const finish = async (proof?: LocalMemberClosure['proof']): Promise<LocalMemberClosure> => {
            if (h.processClosed) await barrier(h.processClosed, began + 2500);
            if (!(await barrier(this.closeWriter(h), began + 2500))) {
                try { this.state(h, 'unknown', { reason: h.failureReason }); } catch { }
                return { closed: false, reason: h.failureReason ?? 'Member observation retention unavailable' };
            }
            this.state(h, 'closed', proof ? { proof } : {});
            return proof ? { closed: true, proof } : { closed: true, reason: 'Never started' };
        };
        if (!l.pid || !l.processGroup || !l.startIdentity) {
            if (fs.existsSync(path.join(l.controlDirectory, 'start.claim')))
                return { closed: false, reason: 'Spawn claimed but birth identity unavailable' };
            return finish();
        }
        const group = () => table().filter(r => r.group === l.processGroup);
        const matching = () => { const leader = table().find(r => r.pid === l.pid); return !leader || (leader.birth === l.startIdentity && leader.group === l.processGroup); };
        try {
            if (!matching())
                return { closed: false, reason: 'PID identity mismatch; no signal sent' };
            this.snapshot(h);
            const alive = () => { const all = table(); return (h.owned ?? []).filter(r => all.some(x => x.pid === r.pid)); };
            const intentDurable = await barrier(this.journal(h, 'control', { action: h.yieldRequestId ? 'yield' : 'stop', requestId: h.yieldRequestId, closure: 'unconfirmed' }), began + 500);
            if (intentDurable && h.child?.connected)
                h.child.send(h.yieldRequestId ? { type: 'yield', requestId: h.yieldRequestId, reason: 'Host admitted yield' }
                    : { type: 'stop', reason: 'Host close' }, () => { });
            if (h.rawCreditProtocol && intentDurable) {
                while (!h.rawFinalDurable && !this.writer(h).error && Date.now() < began + 900) await sleep(25);
                if (!h.rawFinalDurable) this.retentionFailure(h, 'Native raw final cursor was not durably transferred before stop');
            }
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
                    // A detached known child can outlive an already-empty original
                    // group. Do not signal a stale PGID merely because that child
                    // still needs its own exact-PID close above.
                    if (group().length)
                        try {
                            process.kill(-l.processGroup, signal);
                        }
                        catch (e) {
                            if ((e as NodeJS.ErrnoException).code === 'EPERM') {
                                // A raced exit can leave a stale PGID before the signal.
                                // Never retry that signal after permission refusal; only
                                // an actual absence observation can settle this lease.
                                while (Date.now() < began + 2500) {
                                    if (!group().length && !alive().length) {
                                        const proof = { group: l.processGroup, observedAt: new Date().toISOString(), absent: true as const, pids: (h.owned ?? []).map(r => r.pid) };
                                        return await finish(proof);
                                    }
                                    await sleep(50);
                                }
                                return { closed: false, reason: 'Owned process group signal refused; closure unproved' };
                            }
                            if ((e as NodeJS.ErrnoException).code !== 'ESRCH') throw e;
                        }
                }
                const until = began + (signal === 'SIGKILL' ? 2500 : signal === 'SIGTERM' ? 1000 : 500);
                while (Date.now() < until) {
                    if (!group().length && !alive().length) {
                        const proof = { group: l.processGroup, observedAt: new Date().toISOString(), absent: true as const, pids: (h.owned ?? []).map(r => r.pid) };
                        return await finish(proof);
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
    private assertClosedContext(h: Held): void {
        if (this.writer(h).error) throw Error('Native capture journal retention unavailable');
        if (h.rawCreditProtocol && !h.rawFinalDurable) throw Error('Native capture requires the durable final raw cursor');
        const l = h.lease, state = load(path.join(l.controlDirectory, 'state.json'));
        const retained = load(path.join(this.root(l.sessionKey), 'lease.json')) as LocalMemberLease;
        const retainedConfig = load(path.join(l.controlDirectory, 'config.json')) as LocalMemberConfiguration;
        if (canonicalContext(retainedConfig.prepared) !== canonicalContext(h.config.prepared)) throw Error('Native capture original configuration identity mismatch');
        if (canonicalContext(retained) !== canonicalContext(l)) throw Error('Native capture original lease identity mismatch');
        if (state.phase !== 'closed' || !l.pid || !l.processGroup || !l.startIdentity
            || state.sessionKey !== l.sessionKey || state.generation !== l.generation || state.memberId !== l.memberId
            || state.pid !== l.pid || state.startIdentity !== l.startIdentity || state.nativeSession !== h.nativeSession
            || state.proof?.group !== l.processGroup || state.proof?.absent !== true)
            throw Error('Native capture requires actual closed owned-process proof');
        const rows = table();
        if (rows.some(r => r.group === l.processGroup) || (h.owned ?? []).some(r => rows.some(x => x.pid === r.pid)))
            throw Error('Native capture owned processes remain');
    }
    async captureClosedContext(lease: LocalMemberLease, requestId: string, limits: LocalContextLimits): Promise<LocalContextCapture> {
        const h = this.get(lease);
        await this.journalFence(h);
        if (h.stopping && !(await h.stopping).closed) throw Error('Native capture closure unconfirmed');
        this.assertClosedContext(h);
        if (!h.nativeSession) return { state: 'unavailable', reason: 'No retained native creation identity' };
        const origin: LocalContextOrigin = { identity: h.config.prepared.identity, sessionKey: lease.sessionKey,
            generation: lease.generation, memberId: lease.memberId, runtime: h.config.prepared.runtime,
            nativeSession: h.nativeSession, cwd: lease.workDirectory };
        const capture = captureLocalNativeFiles(lease.controlDirectory, origin, requestId, limits);
        this.assertClosedContext(h);
        return capture;
    }
    async stopAll() { this.shuttingDown = true; return Promise.all([...this.held.values()].map(h => this.close(h.lease))); }
    async recover(sessionKey: string): Promise<LocalMemberLease | undefined> {
        // Existing ownership lookup must remain usable by cleanup while IO is stalled
        // or failed. read/capture and cold recovery retain their durability checks.
        const current = this.held.get(sessionKey); if (current) return current.lease;
        const root = await resolveRetainedMemberRoot({home:this.options.home,sessionKey});
        const read = async (file: string): Promise<string | undefined> => { try { return await fs.promises.readFile(file, 'utf8'); }
            catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; } };
        const original = await read(path.join(root, 'lease.json')); if (!original) return undefined;
        const lease = JSON.parse(original) as LocalMemberLease;
        if (lease.sessionKey !== sessionKey || !path.resolve(lease.controlDirectory).startsWith(root + path.sep)) throw Error('Invalid retained local lease');
        const config = JSON.parse((await read(path.join(lease.controlDirectory, 'config.json')))!) as LocalMemberConfiguration;
        validateLocalMemberContinuity(config, lease.controlDirectory, lease.workDirectory);
        if (!config.continuity && !path.resolve(lease.workDirectory).startsWith(root + path.sep)) throw Error('Invalid retained local work directory');
        const retainedState = await read(path.join(lease.controlDirectory, 'state.json'));
        const state = retainedState ? JSON.parse(retainedState) : undefined;
        const retainedOwned = await read(path.join(lease.controlDirectory, 'owned-pids.json'));
        const h: Held = { lease, config, stopRequested: retainedState ? ['closed', 'unknown'].includes(state.phase) : false,
            failureReason: retainedState ? state.failureReason : undefined,
            owned: retainedOwned ? JSON.parse(retainedOwned) : undefined, seq: 0, streamGeneration: '' };
        const writer = this.writer(h);
        let tail = '', bytesSinceYield = 0;
        let retainedRawSeq = -1, retainedFinalSeq: number | undefined, invalidRawFinal = false;
        const filename = path.join(lease.controlDirectory, 'journal.jsonl');
        try {
            const stream = fs.createReadStream(filename, { highWaterMark: 65536 });
            const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
            for await (const chunk of stream) {
                if (!Buffer.isBuffer(chunk)) throw Error('Invalid retained member journal bytes');
                let text: string;
                try { text = decoder.decode(chunk, { stream: true }); }
                catch { throw Error('Invalid retained member journal UTF-8'); }
                writer.ackedBytes += chunk.length;
                if(config.softwareGithubIsolation&&writer.ackedBytes>journalTotalBytes)throw Error('Retained member observation journal bound exceeded');
                tail += text; let end: number;
                while ((end = tail.indexOf('\n')) >= 0) {
                    const line = tail.slice(0, end); tail = tail.slice(end + 1);
                    if (Buffer.byteLength(line) + 1 > journalQueueBytes) throw Error('Retained member journal row bound exceeded');
                    const row = JSON.parse(line);
                    if (!h.seq) h.streamGeneration = row.streamGeneration;
                    if (row.schema !== 'hima-oar-observation/1' || row.seq !== h.seq || row.sessionKey !== lease.sessionKey
                        || row.generation !== lease.generation || row.memberId !== lease.memberId || typeof row.streamGeneration !== 'string'
                        || !row.streamGeneration || row.streamGeneration !== h.streamGeneration)
                        throw Error('Invalid retained member yield intent or journal identity/sequence');
                    if (row.kind === 'created') {
                        if (h.nativeSession || typeof row.payload?.nativeSession !== 'string' || !row.payload.nativeSession) throw Error('Invalid retained native creation');
                        h.nativeSession = row.payload.nativeSession;
                        if (row.payload.rawCreditProtocol !== undefined && row.payload.rawCreditProtocol !== 'hima-oar-raw-credit/1')
                            throw Error('Invalid retained native raw credit protocol');
                        h.rawCreditProtocol = row.payload.rawCreditProtocol === 'hima-oar-raw-credit/1';
                    }
                    if (h.nativeSession && row.nativeSession !== h.nativeSession) throw Error('Invalid retained native journal identity');
                    if (h.rawCreditProtocol && row.kind === 'raw' && row.payload?.channel !== 'untrusted_stderr') {
                        const raw = row.nativeRawSeq === undefined ? decodeOarRawObservationPayload(row.payload) : undefined;
                        const nativeSeq = row.nativeRawSeq ?? (object(raw) ? raw.seq : undefined);
                        if (!Number.isSafeInteger(nativeSeq) || nativeSeq !== retainedRawSeq + 1 || retainedFinalSeq !== undefined)
                            invalidRawFinal = true;
                        else retainedRawSeq = nativeSeq;
                    }
                    if (h.rawCreditProtocol && row.kind === 'control' && row.payload?.action === 'raw_final') {
                        if (retainedFinalSeq !== undefined || row.payload.state !== 'complete'
                            || !Number.isSafeInteger(row.payload.lastSeq) || row.payload.lastSeq !== retainedRawSeq)
                            invalidRawFinal = true;
                        else retainedFinalSeq = row.payload.lastSeq;
                    }
                    if (['created', 'received', 'terminal', 'finished', 'control'].includes(row.kind)) writer.evidence.push(row);
                    writer.rowOffsets.push(writer.rowOffsets.at(-1)! + Buffer.byteLength(line) + 1);
                    h.seq++; writer.ackedSeq = row.seq; bytesSinceYield += Buffer.byteLength(line);
                    if (bytesSinceYield >= journalBatchBytes) { bytesSinceYield = 0; await cooperate(); }
                }
                if (Buffer.byteLength(tail) > journalQueueBytes) throw Error('Retained member journal row bound exceeded');
            }
            let final: string;
            try { final = decoder.decode(); }
            catch { throw Error('Invalid retained member journal UTF-8'); }
            tail += final;
            if (tail) throw Error('Truncated retained member journal');
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        }
        if (!h.streamGeneration) h.streamGeneration = randomUUID();
        if (writer.rowOffsets.at(-1)! !== writer.ackedBytes) throw Error('Retained member journal byte offsets differ');
        const journalFailure = retainedState ? state.journalFailureReason : undefined;
        if (journalFailure) writer.error = Error(journalFailure);
        if (h.rawCreditProtocol) {
            h.rawAckedSeq = retainedRawSeq;
            h.rawFinalDurable = !invalidRawFinal && retainedFinalSeq !== undefined && retainedFinalSeq === retainedRawSeq;
            if (!h.rawFinalDurable) writer.error ??= Error('Native raw final cursor is absent or differs after cold recovery');
        }
        let ordinaryStop = false, priorFailure = false, physicalYield = false;
        for (const row of writer.evidence) {
            if (row.kind === 'control' && row.payload?.action === 'stop' && !h.yieldRequestId) ordinaryStop = true;
            if (row.kind === 'control' && row.payload?.action === 'yield') {
                if (!h.yieldRequestId || row.payload.requestId !== h.yieldRequestId)
                    throw Error('Invalid retained physical yield identity');
                physicalYield = true;
            }
            if (row.kind === 'terminal') {
                const localFailure = row.payload?.outcome === 'failed';
                const nativeFailure = row.payload?.outcome?.kind && row.payload.outcome.kind !== 'completed';
                if (!h.yieldRequestId && (localFailure || nativeFailure)) priorFailure = true;
                // A genuine physical shutdown abort is closure evidence. Earlier
                // native faults and explicit Local fatal rows remain truthful.
                if (localFailure || (h.yieldRequestId && nativeFailure && !physicalYield))
                    h.failureReason ??= row.payload.reason ?? row.payload.outcome?.reason ?? 'Retained native failure before physical yield';
            }
            if (row.kind !== 'control' || row.payload?.action !== 'yield_intent') continue;
            const requestId = row.payload.requestId, firstAdmission = h.yieldRequestId === undefined;
            if (firstAdmission && (ordinaryStop || priorFailure)) throw Error('Ordinary stop or failure cannot become a recovered yield');
            if (row.schema !== 'hima-oar-observation/1' || row.sessionKey !== lease.sessionKey
                || row.generation !== lease.generation || row.memberId !== lease.memberId
                || row.streamGeneration !== h.streamGeneration || row.nativeSession !== h.nativeSession
                || row.payload.nativeSession !== h.nativeSession || typeof requestId !== 'string'
                || !requestId || Buffer.byteLength(requestId) > 200
                || (h.yieldRequestId !== undefined && h.yieldRequestId !== requestId))
                throw Error('Invalid retained member yield intent');
            if (row.payload.inputId !== undefined) {
                const inputId = row.payload.inputId;
                if (typeof inputId !== 'string' || !inputId || (h.yieldInputId && h.yieldInputId !== inputId)
                    || !writer.evidence.some((r: any) => r.seq < row.seq && r.kind === 'control' && r.payload?.action === 'send_intent' && r.payload.inputId === inputId)
                    || (firstAdmission && writer.evidence.some((r: any) => r.seq < row.seq && ['terminal', 'finished'].includes(r.kind) && r.payload?.inputId === inputId)))
                    throw Error('Invalid retained accepted wait input');
                h.yieldInputId = inputId;
            }
            h.yieldRequestId = requestId;
            // Recovery read the already fsynced original row. Cleanup replay must
            // reuse it, rather than append another intent after shutdown abort.
            h.yieldAdmission = Promise.resolve();
        }
        if (ordinaryStop || priorFailure) h.stopRequested = true;
        this.restoredRoots.set(sessionKey,root);
        this.held.set(sessionKey, h); if (lease.processGroup && lease.pid && lease.startIdentity) {
        try {
            const present = table().filter(r => r.group === lease.processGroup);
            if (!writer.error && !present.length && !(h.owned ?? []).some(r => table().some(x => x.pid === r.pid)))
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
