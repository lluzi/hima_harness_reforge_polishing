// Reproduce the migration ledger without evaluating a test, Host, driver or SSH probe.
import ts from 'typescript';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const baseline = 'd6cadfbe820594d543655ff32d27e8ba270c423a';
const groups = JSON.parse(readFileSync('test/contract-groups.json', 'utf8'));
const originalFiles = execFileSync('git', ['ls-tree', '-r', '--name-only', baseline, 'test/contract'], { encoding: 'utf8' }).trim().split('\n').filter(f => f.endsWith('.test.ts'));
const currentFiles = Object.values(groups).flat();
const groupOf = f => Object.entries(groups).find(([, files]) => files.includes(f))[0];
const parse = (file, text) => {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const tests = [], assertions = [], helpers = new Map();
  const line = n => source.getLineAndCharacterOfPosition(n.getStart(source)).line + 1;
  const visit = (n, owner = null) => {
    if (ts.isFunctionDeclaration(n) && n.name) helpers.set(n.name.text, n.getText(source));
    if (ts.isVariableDeclaration(n) && n.initializer && (ts.isArrowFunction(n.initializer) || ts.isFunctionExpression(n.initializer))) helpers.set(n.name.getText(source), n.getText(source));
    if (ts.isCallExpression(n)) {
      const call = n.expression.getText(source);
      if (call === 'test' || call === 'it') {
        owner = { title: n.arguments[0]?.getText(source), line: line(n), body: n.getText(source) };
        tests.push(owner);
      }
      if (call === 'assert' || call.startsWith('assert.')) assertions.push({ line: line(n), text: n.getText(source), owner: owner?.title ?? 'shared helper / module scope' });
    }
    ts.forEachChild(n, child => visit(child, owner));
  };
  visit(source);
  for (const item of tests) {
    const seen = new Set(); let material = item.body;
    for (let changed = true; changed;) {
      changed = false;
      for (const [name, body] of helpers) if (!seen.has(name) && new RegExp('\\b' + name + '\\b').test(material)) { seen.add(name); material += '\n'+body; changed = true; }
    }
    const calls = [...material.matchAll(/\b([\w.]+)\s*\(/g)].map(m => m[1]);
    item.dependencies = [...new Set(calls.filter(c => /boot|Home|Fixture|Standin|localFabric|localHome|himaCommand|api|Session|Socket|onTheSite|observeOverSsh|install/.test(c)))].sort();
    item.cleanup = [...new Set(calls.filter(c => /dispose|restore|heal|kill|^rm$|^chmod$|^rename$|plantStale/.test(c)))].sort();
    item.localHelpers = [...seen].sort();
  }
  return { tests, assertions };
};
const current = new Map(currentFiles.map(f => [f, parse(f, readFileSync(f, 'utf8'))]));
const cases = [], assertions = [], files = [];
for (const file of originalFiles) {
  const old = parse(file, execFileSync('git', ['show', `${baseline}:${file}`], { encoding: 'utf8' }));
  const destinations = [file, file.replace('.test.ts', '.live.test.ts')].filter(f => current.has(f));
  for (const item of old.tests) {
    const matches = destinations.flatMap(f => current.get(f).tests.filter(t => t.title === item.title).map(t => ({ path: f, line: t.line })));
    if (matches.length !== 1) throw new Error(`case mapping ambiguous or absent: ${file}:${item.line}`);
    const executionGroup = groupOf(matches[0].path);
    const level = executionGroup === 'live-site' ? 'L4 Site' : item.dependencies.includes('bootDriver') ? 'L3' : item.dependencies.length ? 'L2' : 'L1';
    cases.push({ original: { path: file, line: item.line }, current: matches[0], title: item.title, executionGroup, level, dependencies: item.dependencies, cleanup: item.cleanup, localHelpers: item.localHelpers });
  }
  for (const item of old.assertions) {
    const matches = destinations.flatMap(f => current.get(f).assertions.filter(a => a.text === item.text).map(a => ({ path: f, line: a.line, executionGroup: groupOf(f), level: groupOf(f) === 'live-site' ? 'L4 Site' : (cases.find(c => c.current.path === f && c.title === a.owner)?.level ?? 'shared; caller determines level') })));
    if (!matches.length) throw new Error(`assertion changed or lost: ${file}:${item.line}: ${item.text}`);
    assertions.push({ original: { path: file, line: item.line }, current: matches, owner: item.owner, sha256: createHash('sha256').update(item.text).digest('hex'), assertion: item.text });
  }
  files.push({ original: file, destinations, testDeclarations: old.tests.length, assertionExpressions: old.assertions.length });
}
const out = 'docs/assessment/2026-09-11/pls-01/';
writeFileSync(out+'case-mapping.json', JSON.stringify({ baseline, notes: 'Static test declarations; parameterized declarations can register multiple runtime cases. Dependencies and cleanup include transitively called file-local helpers; imported support and resource ownership are reviewed in README.md. Levels describe assertions; group selection can conservatively include lower-cost checks.', files, cases }, null, 2)+'\n');
writeFileSync(out+'assertion-mapping.jsonl', assertions.map(a => JSON.stringify(a)).join('\n')+'\n');
const summary = { originalFiles: originalFiles.length, originalTestDeclarations: cases.length, originalAssertionExpressions: assertions.length, originalAssertionsPreserved: assertions.length, groups: Object.fromEntries(Object.entries(groups).map(([g,fs])=>[g,{files:fs.length,originalDeclarations:cases.filter(c=>c.executionGroup===g).length}])), newCases: [...current.entries()].flatMap(([f,p])=>p.tests.filter(t=>!cases.some(c=>c.current.path===f&&c.title===t.title)).map(t=>({file:f,title:t.title}))) };
writeFileSync(out+'inventory-summary.json', JSON.stringify(summary,null,2)+'\n');
console.log(JSON.stringify(summary));
