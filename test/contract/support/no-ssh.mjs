import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { appendFileSync } from 'node:fs';
import path from 'node:path';
for (const name of ['spawn', 'spawnSync', 'execFile', 'execFileSync', 'exec', 'execSync']) {
  const original = childProcess[name];
  childProcess[name] = function (command, ...args) {
    if (path.basename(String(command)) === 'ssh' || /(^|[\s;&|])(?:\/[^\s;&|]+\/)?ssh(?:\s|$)/.test(String(command))) {
      appendFileSync(process.env.HIMA_SSH_ATTEMPTS, JSON.stringify({ api: name, command }) + '\n');
      throw new Error('PLS-01: SSH subprocess forbidden in local tests');
    }
    return original.call(this, command, ...args);
  };
}
syncBuiltinESMExports();
