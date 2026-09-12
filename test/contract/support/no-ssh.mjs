import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { appendFileSync } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
for (const name of ['spawn', 'spawnSync', 'execFile', 'execFileSync', 'exec', 'execSync']) {
  const original = childProcess[name];
  const check = (command) => {
    if (path.basename(String(command)) === 'ssh' || /(^|[\s;&|])(?:\/[^\s;&|]+\/)?ssh(?:\s|$)/.test(String(command))) {
      appendFileSync(process.env.HIMA_SSH_ATTEMPTS, JSON.stringify({ api: name, command }) + '\n');
      throw new Error('PLS-01: SSH subprocess forbidden in local tests');
    }
  };
  childProcess[name] = function (command, ...args) {
    check(command);
    return original.call(this, command, ...args);
  };
  // Node's exec/execFile promise returns {stdout, stderr}, and exposes both on errors. Preserve
  // that public contract while guarding the promise entry too; copying the original unguarded
  // custom function would let a promisified SSH call escape the sentinel.
  if (typeof original[promisify.custom] === 'function') {
    Object.defineProperty(childProcess[name], promisify.custom, { value: function (command, ...args) {
      check(command);
      return original[promisify.custom].call(this, command, ...args);
    } });
  }
}
syncBuiltinESMExports();
