// Render ../SCRIPT.md from beats.mjs, so the script a person reads and the script the App plays are
// the same file. Run after any edit to beats.mjs:  node mkscript.mjs
import { writeFileSync, readFileSync } from 'node:fs';
const B = (await import('./beats.mjs')).default;
const head = readFileSync(new URL('./script-head.md', import.meta.url), 'utf8');

const PANE = {
  front: 'Project 1 · bgcore front end', layout: 'Project 2 · bgcore layout',
};
const rows = [];
let project = null;
for (const beat of B.beats) {
  if (beat.project) project = beat.project;
  const typed = (beat.act ?? []).filter((s) => s.typeHuman !== undefined).map((s) => s.typeHuman);
  const bits = [];
  if (beat.pane !== undefined) bits.push(`pane → \`${beat.pane}\`${beat.status ? ` · ${beat.status}` : ''}`);
  if (beat.waitTurn) bits.push(`waits for the Guide's \`${beat.waitTurn}\``);
  if (typed.length === 0 && bits.length === 0 && !beat.label) continue;
  rows.push(`| ${beat.label ?? ''} | ${project ? PANE[project] : '—'} | ${typed.map((t) => `**${t}**`).join('<br>') || ''} | ${bits.join('; ')} |`);
}

const turns = B.turns.map((t) => {
  const tools = (t.tools ?? []).map((x) => `\`${x.name}\`` + (x.name === 'read' ? ` ${x.args.file_path.split('/').slice(-2).join('/')}` : '')).join(', ');
  return [`### \`${t.id}\``,
    t.reasoning ? `*thinks:* ${t.reasoning}` : null,
    tools ? `*tool rows:* ${tools}` : null,
    t.hold ? `*held until the pane reaches \`${t.hold}\`*` : null,
    t.text ? `\n${t.text.split('\n').map((l) => `> ${l}`).join('\n')}` : null].filter(Boolean).join('\n');
}).join('\n\n');

writeFileSync(new URL('../SCRIPT.md', import.meta.url),
  `${head}\n## The take, beat by beat\n\n| Beat | Project pane | The engineer types | What else happens |\n|---|---|---|---|\n${rows.join('\n')}\n\n` +
  `## Every Guide turn, in order\n\nThese are played by the model stand-in, in this order, one per model request.\n\n${turns}\n`);
console.log('SCRIPT.md written:', B.beats.length, 'beats,', B.turns.length, 'turns');
