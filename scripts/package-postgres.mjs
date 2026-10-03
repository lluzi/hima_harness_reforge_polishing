// Stage the complete pinned native PostgreSQL distribution. This does not download, build, or
// qualify a platform: it consumes a retained official-source build and audits the staged bytes.
import { createHash } from 'node:crypto';
import { closeSync, cpSync, existsSync, lstatSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, readlinkSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const version = '16.15';
const sourceUrl = 'https://ftp.postgresql.org/pub/source/v16.15/postgresql-16.15.tar.bz2';
const sourceSha256 = 'c1575341fa7bd40f5274ea465b34390f4dc64cdd0770af327005caaeb9f6b7ed';
// COPYRIGHT from that exact PostgreSQL 16.15 source distribution. make install does not retain
// this source-root file; the native distribution must carry the upstream notice itself.
const copyright = `PostgreSQL Database Management System
(also known as Postgres, formerly known as Postgres95)

Portions Copyright (c) 1996-2026, PostgreSQL Global Development Group

Portions Copyright (c) 1994, The Regents of the University of California

Permission to use, copy, modify, and distribute this software and its
documentation for any purpose, without fee, and without a written agreement
is hereby granted, provided that the above copyright notice and this
paragraph and the following two paragraphs appear in all copies.

IN NO EVENT SHALL THE UNIVERSITY OF CALIFORNIA BE LIABLE TO ANY PARTY FOR
DIRECT, INDIRECT, SPECIAL, INCIDENTAL, OR CONSEQUENTIAL DAMAGES, INCLUDING
LOST PROFITS, ARISING OUT OF THE USE OF THIS SOFTWARE AND ITS
DOCUMENTATION, EVEN IF THE UNIVERSITY OF CALIFORNIA HAS BEEN ADVISED OF THE
POSSIBILITY OF SUCH DAMAGE.

THE UNIVERSITY OF CALIFORNIA SPECIFICALLY DISCLAIMS ANY WARRANTIES,
INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY
AND FITNESS FOR A PARTICULAR PURPOSE.  THE SOFTWARE PROVIDED HEREUNDER IS
ON AN "AS IS" BASIS, AND THE UNIVERSITY OF CALIFORNIA HAS NO OBLIGATIONS TO
PROVIDE MAINTENANCE, SUPPORT, UPDATES, ENHANCEMENTS, OR MODIFICATIONS.
`;
function run(binary, args) {
  const result = spawnSync(binary, args, { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`package-postgres: ${path.basename(binary)} failed: ${result.stderr || result.stdout}`);
  return result.stdout;
}
function fileHeader(file) {
  const descriptor = openSync(file, 'r');
  try {
    const header = Buffer.alloc(4);
    const size = readSync(descriptor, header, 0, header.length, 0);
    return header.subarray(0, size).toString('hex');
  } finally { closeSync(descriptor); }
}
export function packagePostgres({ prefix, buildManifest, output }) {
  prefix = realpathSync(prefix); output = path.resolve(output);
  const build = JSON.parse(readFileSync(buildManifest, 'utf8'));
  if (build.version !== version || build.sourceUrl !== sourceUrl || build.sourceSha256 !== sourceSha256
    || build.platform !== `${process.platform}-${process.arch}` || realpathSync(build.prefix) !== prefix
    || !['--without-readline', '--without-icu', '--without-zlib'].every(flag => build.configure.includes(flag))) {
    throw new Error('package-postgres: build identity differs from the pinned official-source/native build');
  }
  if (existsSync(output)) throw new Error(`package-postgres: refusing to overwrite ${output}`);
  if (!run(path.join(prefix, 'bin/postgres'), ['--version']).trim().endsWith(` ${version}`)) throw new Error('package-postgres: postgres version differs from the pinned build');
  mkdirSync(output, { recursive: true });
  try {
    for (const directory of ['bin', 'lib', 'share']) cpSync(path.join(prefix, directory), path.join(output, directory), { recursive: true, dereference: false, verbatimSymlinks: true });
    writeFileSync(path.join(output, 'COPYRIGHT'), copyright);
    const files = {};
    const dependencies = {};
    const inventory = [];
    function walk(directory) {
      for (const name of readdirSync(directory).sort()) {
        const file = path.join(directory, name); const info = lstatSync(file);
        if (info.isDirectory()) walk(file);
        else inventory.push(file);
      }
    }
    walk(output);
    for (const file of inventory) {
      if (lstatSync(file).isSymbolicLink()) {
        const target = realpathSync(file);
        if (!target.startsWith(output + path.sep)) throw new Error(`package-postgres: external symlink ${file}`);
        continue;
      }
      const header = fileHeader(file);
      if (process.platform === 'darwin' && ['cffaedfe', 'feedfacf', 'cafebabe'].includes(header)) {
        const linked = run('otool', ['-L', file]).split('\n').slice(1).filter(Boolean).map(line => line.trim().split(' (')[0]);
        const ids = run('otool', ['-D', file]).split('\n').slice(1).filter(Boolean);
        for (const dependency of linked) {
          if (ids.includes(dependency)) continue;
          if (dependency.startsWith(prefix + '/')) {
            const relocated = path.join(output, path.relative(prefix, dependency));
            if (!existsSync(relocated)) throw new Error(`package-postgres: missing native dependency ${dependency}`);
            run('install_name_tool', ['-change', dependency, `@loader_path/${path.relative(path.dirname(file), relocated).split(path.sep).join('/')}`, file]);
          } else if (!(dependency.startsWith('/usr/lib/') || dependency.startsWith('/System/Library/') || dependency.startsWith('@loader_path/'))) {
            throw new Error(`package-postgres: unbundled native dependency ${dependency}`);
          }
        }
        if (ids.length) run('install_name_tool', ['-id', `@rpath/${path.basename(file)}`, file]);
        // install_name_tool invalidates the linker signature on arm64. Seal these relocated native
        // bytes now; the App packager signs the final bundle independently.
        run('codesign', ['--force', '--sign', '-', '--timestamp=none', file]);
        dependencies[path.relative(output, file)] = run('otool', ['-L', file]).split('\n').slice(1).filter(Boolean).map(line => line.trim().split(' (')[0]);
      } else if (process.platform === 'linux' && header === '7f454c46') {
        const dynamic = run('readelf', ['-d', file]);
        if (/\((?:RPATH|RUNPATH)\)/.test(dynamic)) {
          const relativeLib = path.relative(path.dirname(file), path.join(output, 'lib')).split(path.sep).join('/');
          run('patchelf', ['--set-rpath', `$ORIGIN/${relativeLib}`, file]);
        }
        const linked = run('ldd', [file]);
        if (/not found/.test(linked)) throw new Error(`package-postgres: missing Linux native dependency for ${file}`);
        dependencies[path.relative(output, file)] = linked.trim().split('\n').map(line => line.trim());
      }
    }
    for (const file of inventory) {
      const relative = path.relative(output, file).split(path.sep).join('/');
      files[relative] = lstatSync(file).isSymbolicLink()
        ? `symlink:${readlinkSync(file)}`
        : createHash('sha256').update(readFileSync(file)).digest('hex');
    }
    const manifest = { format: 'hima-postgres-runtime/1', version, platform: `${process.platform}-${process.arch}`,
      source: { url: sourceUrl, sha256: sourceSha256 }, build: { configure: build.configure, os: build.os },
      dependencies, files, qualification: 'staged native bytes; lifecycle, relocation and platform qualification recorded separately' };
    writeFileSync(path.join(output, 'postgres-runtime.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    // Both server and libpq client must resolve after their absolute build-prefix references are removed.
    for (const binary of ['postgres', 'psql', 'initdb', 'pg_ctl']) run(path.join(output, 'bin', binary), ['--version']);
    return manifest;
  } catch (error) { rmSync(output, { recursive: true, force: true }); throw error; }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const value = flag => { const at = args.indexOf(flag); return at < 0 ? undefined : args[at + 1]; };
  const prefix = value('--prefix'); const buildManifest = value('--build-manifest'); const output = value('--output');
  if (!prefix || !buildManifest || !output) throw new Error('Usage: package-postgres.mjs --prefix <native install> --build-manifest <build identity.json> --output <new runtime directory>');
  const manifest = packagePostgres({ prefix, buildManifest, output });
  process.stdout.write(`${JSON.stringify({ version: manifest.version, platform: manifest.platform, files: Object.keys(manifest.files).length, output: path.resolve(output) })}\n`);
}
