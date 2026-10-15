// Lightweight admission only. No dependency import, build, Host, native runtime or model.
import assert from 'node:assert/strict';
import { readFile, readdir, lstat } from 'node:fs/promises';
import { publicFixture, sha256 } from './fixture.mjs';
const root = new URL('../../../../', import.meta.url);
const teamPath = new URL('packages/harness/skills/hima-team-spec/team.json', root);
const team = JSON.parse(await readFile(teamPath, 'utf8'));
assert.deepEqual(Object.keys(team).sort(), ['schema','title','members','leaderMemberId','collaboration','delivery'].sort());
assert.equal(team.schema, 'hima-team-definition/1');
assert.deepEqual(new Set(team.members.map(member => member.runtime)), new Set(['pi','opencode']));
assert.equal(new Set(team.members.map(member => member.id)).size, team.members.length);
assert.ok(team.members.some(member => member.id === team.leaderMemberId));
for (const member of team.members) {
  assert.deepEqual(Object.keys(member).sort(), ['id','role','runtime','modelRef','skills','instructions','toolRefs','knowledgeRefs'].sort());
  assert.equal(member.modelRef, 'default'); assert.deepEqual(member.skills, ['hima-team-spec']);
  assert.deepEqual(member.toolRefs, ['hima-member-context']); assert.deepEqual(member.knowledgeRefs, []);
  for (const skill of member.skills) assert.ok((await readFile(new URL('packages/harness/skills/' + skill + '/SKILL.md', root), 'utf8')).includes('# ' + skill));
}
assert.equal(team.delivery.output.version, 'hima-functional-spec/1');
assert.equal(team.delivery.output.schema.$schema, 'https://json-schema.org/draft/2020-12/schema');
const schema = team.delivery.output.schema;
assert.deepEqual(new Set(schema.required), new Set(Object.keys(schema.properties)));
for (const field of ['value','userBehavior','inputsOutputs','interfaces','exceptions','nonGoals']) assert.ok(schema.properties.functionalSpec.required.includes(field));
for (const field of ['facts','sources','conflicts','assumptions','openQuestions','acceptance','memoryRefs']) assert.ok(schema.required.includes(field));
const task1 = await publicFixture('task1'), task2 = await publicFixture('task2');
assert.deepEqual(task1.map(item => item.name), ['task1.md','document-a.md','document-b.md']);
assert.deepEqual(task2.map(item => item.name), ['task2.md']); await assert.rejects(publicFixture('evaluator'));
assert.deepEqual((await readdir(new URL('./fixtures/', import.meta.url))).sort(), ['document-a.md','document-b.md','task1.md','task2.md']);
// Same staging bounds as the existing native memberSkillFiles seam, without invoking it.
let count = 0;
async function boundedFiles(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const at = new URL(entry.name + (entry.isDirectory() ? '/' : ''), directory);
    assert.equal(entry.isSymbolicLink(), false);
    if (entry.isDirectory()) await boundedFiles(at);
    else { assert.ok((await lstat(at)).size <= 1024 * 1024); count++; }
  }
}
await boundedFiles(new URL('packages/harness/skills/hima-team-spec/', root));
await boundedFiles(new URL('packages/harness/skills/knowledge/', root)); assert.ok(count <= 64);
console.log(JSON.stringify({ result: 'PASS', scope: 'JSON shape, valid existing references, bounded staging, public fixture hashes and input separation only',
  teamSha256: sha256(await readFile(teamPath)), publicFiles: task1.length + task2.length, distinctPublicFiles: 4,
  nativeSkillFilesPerMember: count, hostStarts: 0, services: 0, productModelCalls: 0, semanticSpecOrRecallAcceptance: 'UNRUN' }));
