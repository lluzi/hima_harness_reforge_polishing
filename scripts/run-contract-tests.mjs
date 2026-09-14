// Explicit file selection: never import a test merely to find out its resource requirements.
// Leaf commands use the current build; check:local prepares it once before checking and testing.
import { spawnSync } from 'node:child_process';
import { lstatSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import './require-node.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const groups = JSON.parse(readFileSync(path.join(root, 'test/contract-groups.json'), 'utf8'));
const [group, ...options] = process.argv.slice(2);

function testFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) return testFiles(file);
    return /\.test\.[cm]?[jt]sx?$/.test(entry.name) ? [path.relative(root, file)] : [];
  });
}

try {
  const found = testFiles(path.join(root, 'test/contract'));
  const declared = Object.values(groups).flat();
  const unclassified = found.filter((file) => !declared.includes(file));
  const missing = declared.filter((file) => !found.includes(file));
  const duplicates = declared.filter((file, i) => declared.indexOf(file) !== i);
  if (unclassified.length || missing.length || duplicates.length) {
    throw new Error(JSON.stringify({ unclassified, missing, duplicates }));
  }
  const list = options[0] === '--list';
  const selection = list ? options.slice(1) : options;
  const explicit = selection[0] === '--files';
  if ((selection.length && !explicit) || (group === '--check' && options.length)) {
    throw new Error('usage: node scripts/run-contract-tests.mjs local|desktop|live-site [--list] [--files <path>...], or --check');
  }
  if (group === '--check') {
    console.log(`contract inventory: ${found.length} files, each assigned exactly once`);
  } else {
    if (!Object.hasOwn(groups, group)) throw new Error('choose a group: local, desktop, live-site');
    const files = explicit ? selection.slice(1) : groups[group];
    if (!files.length) throw new Error(`no tests in ${group}`);
    if (files.some((file) => !groups[group].includes(file)) || new Set(files).size !== files.length) {
      throw new Error(`select distinct files declared in ${group}: ${files.join(', ')}`);
    }
    if (list) {
      console.log(files.join('\n'));
    } else {
      // Short, private paths also isolate tmux/SSH sockets; a macOS Unix socket has little room.
      const temporary = realpathSync(mkdtempSync('/tmp/hima-tests-'));
      const env = {
        ...process.env,
        TMPDIR: temporary, TMUX_TMPDIR: temporary,
        DSH_HOME: path.join(temporary, 'dsh'), DSH_AGENTS_HOME: path.join(temporary, 'agents'),
        HIMA_USER_DATA: path.join(temporary, 'electron'), DSH_TELEMETRY_DISABLED: '1',
        HIMA_TEST_GROUP: group, HIMA_TEST_TMPDIR: temporary,
        HIMA_TEST_BOOT_LOG: path.join(temporary, 'boots.txt'),
        HIMA_TEST_LEGACY_AUTO_DRIVE: process.env.HIMA_TEST_LEGACY_AUTO_DRIVE ?? '1',
        HIMA_TEST_SILENT_AGENT: process.env.HIMA_TEST_SILENT_AGENT ?? '1',
      };
      const sshLog = path.join(temporary, 'ssh-attempts.jsonl');
      delete env.TMUX;
      if (group !== 'live-site') {
        delete env.SSH_AUTH_SOCK;
        env.HIMA_SSH_ATTEMPTS = sshLog;
        const guard = path.join(root, 'test/contract/support/no-ssh.mjs');
        env.NODE_OPTIONS = `${env.NODE_OPTIONS ?? ''} --import=${JSON.stringify(guard)}`;
      }
      console.error(`${group}: ${files.length} selected; ${groups[group].length - files.length} unselected in ${group}; other groups not run (not passes)`);
      const started = performance.now();
      try {
        const result = spawnSync(process.execPath, ['--test', '--test-reporter=tap', '--test-concurrency=1', ...files], {
          cwd: root, env, stdio: 'inherit',
        });
        if (result.error) throw result.error;
        process.exitCode = result.status ?? 1;
        const boots = readdirSync(temporary).includes('boots.txt') ? readFileSync(env.HIMA_TEST_BOOT_LOG, 'utf8').trim().split('\n') : [];
        const counts = Object.fromEntries(['host-process', 'host-in-process', 'electron'].map((kind) => [kind, boots.filter((boot) => boot === kind).length]));
        console.error(`Test boot attempts: ${JSON.stringify(counts)}; Electron window launches also start a Host; diagnostics can exit before either`);
        if (group === 'local' && counts.electron !== 0) {
          console.error('local must not start Electron');
          process.exitCode = 1;
        }
        if (group !== 'live-site') {
          const attempts = readdirSync(temporary).includes('ssh-attempts.jsonl') ? readFileSync(sshLog, 'utf8') : '';
          console.error(`SSH subprocess attempts: ${attempts.trim() ? attempts.trim().split('\n').length : 0}`);
          if (attempts) { console.error(attempts); process.exitCode = 1; }
        }
        console.error(`${group} command exit code: ${process.exitCode}; elapsed: ${((performance.now() - started) / 1000).toFixed(3)} s; pass/fail/skip counts are in the TAP summary above`);
      } finally {
        // Only this invocation's socket directory. Never the user's default tmux server.
        const tmuxSocket = path.join(temporary, `tmux-${process.getuid()}`, 'default');
        spawnSync('tmux', ['-S', tmuxSocket, 'kill-server'], { env, stdio: 'ignore', timeout: 5_000 });
        if (group === 'live-site') {
          for (const name of readdirSync(temporary).filter((name) => /^hima-ssh-[a-f0-9]{16}$/.test(name))) {
            const socket = path.join(temporary, name);
            if (lstatSync(socket).isSocket()) {
              spawnSync('ssh', ['-S', socket, '-O', 'exit', 'unused'], { stdio: 'ignore', timeout: 5_000 });
            }
          }
        }
        rmSync(temporary, { recursive: true, force: true });
      }
    }
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
