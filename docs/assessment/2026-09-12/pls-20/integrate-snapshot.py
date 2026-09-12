"""One-shot mapped B/P/U integration. Run only from a clean, pinned PLS-20 branch."""
import hashlib
import json
import pathlib
import subprocess

ROOT = pathlib.Path.cwd()
B = 'b4ac9d9360ad6da68b5fd2824621ba6edab7408b'
P = '0c8f127a93a4ad933aedd9b08e10330d87868cf5'
U = 'ca47fa05ebe7417c23f0aebbb769db627bbf08a0'
TMP = ROOT / '.hima-tmp/pls20'

def git(*args):
    return subprocess.check_output(['git', *args])

def tree(ref):
    entries = {}
    for record in git('ls-tree', '-rz', ref).split(b'\0'):
        if not record:
            continue
        meta, name = record.split(b'\t', 1)
        mode, kind, oid = meta.decode().split()
        assert kind == 'blob' and mode in ('100644', '100755'), (name, mode, kind)
        entries[name.decode()] = (mode, oid)
    return entries

def data(entry):
    return git('cat-file', 'blob', entry[1]) if entry else None

def digest(content):
    return hashlib.sha256(content).hexdigest() if content is not None else None

def reference(name):
    return name.startswith('docs/') or name in ('AGENTS.md', 'CLAUDE.md', 'CONTEXT.md', 'README.md')

def destination(name):
    if not reference(name):
        return name
    return 'docs/upstream/ca47fa0/' + ('CLAUDE.reference.md' if name == 'CLAUDE.md' else name)

assert git('rev-parse', 'HEAD').decode().strip() == P
assert not git('status', '--porcelain').strip()
base, polish, upstream = tree(B), tree(P), tree(U)
rows, conflicts = [], []
for name in sorted(set(base) | set(upstream)):
    target = destination(name)
    b, p, u = base.get(name), polish.get(target), upstream.get(name)
    bb, pp, uu = data(b), data(p), data(u)
    if reference(name):
        result, action = uu, 'versioned-reference' if u else 'absent-reference'
    elif p == b:
        result, action = uu, 'upstream-only' if u != b else 'unchanged'
    elif u == b:
        result, action = pp, 'polishing-only'
    elif p == u:
        result, action = pp, 'same-change'
    elif name == 'pnpm-lock.yaml':
        result, action = pp, 'regenerate-from-combined-manifests'
    elif pp is None or uu is None or bb is None:
        result, action = pp, 'manual-add-delete'
        conflicts.append(name)
    else:
        inputs = []
        for key, content in [('P', pp), ('B', bb), ('U', uu)]:
            f = TMP / 'merge-inputs' / key / name
            f.parent.mkdir(parents=True, exist_ok=True)
            f.write_bytes(content)
            inputs.append(str(f))
        merged = subprocess.run(['git', 'merge-file', '-p', '--diff3', '-L', 'polishing', '-L', 'base', '-L', 'upstream', *inputs], capture_output=True)
        assert 0 <= merged.returncode < 128, (name, merged.stderr)
        result = merged.stdout
        action = 'textual-conflict' if merged.returncode else 'three-way-clean'
        if merged.returncode:
            conflicts.append(name)
    out = ROOT / target
    if result is None:
        if out.exists():
            out.unlink()
    elif not (result == pp and out.exists()):
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_bytes(result)
        mode = (p if action == 'polishing-only' else u or p or b)[0]
        out.chmod(0o755 if mode == '100755' else 0o644)
    rows.append(dict(sourcePath=name, localPath=target, base=b, polishing=p, upstream=u,
                     baseSHA256=digest(bb), polishingSHA256=digest(pp), upstreamSHA256=digest(uu),
                     initialAction=action, initialSHA256=digest(result)))

payload = dict(schema='hima-polishing-snapshot-integration/1', base=B, polishing=P,
               upstream=U, sourceProductWrites=0, files=rows, conflicts=conflicts)
(TMP / 'initial-manifest.json').write_text(json.dumps(payload, indent=2)+'\n')
print(json.dumps(dict(files=len(rows), conflicts=conflicts), indent=2))
