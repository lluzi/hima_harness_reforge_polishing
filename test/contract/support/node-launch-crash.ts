// Real Host crash fixture. The durable callback writes the launch intent to a real file; no Ledger
// method is replaced. A parent-owned tmux wrapper can hold the launch response after actual launch.
import { readFile, writeFile } from 'node:fs/promises';
import { bootInProcess } from './boot-inprocess.ts';
import { launchJob } from '@hima/harness';
import type { HimaHome } from './dsh-home.ts';

const [description, intentFile, script, holdBefore] = process.argv.slice(2);
const h: HimaHome = JSON.parse(await readFile(description!, 'utf8'));
const host = await bootInProcess(h);
await launchJob({ ledger: host.ctx.hima.ledger, sitesDir: `${h.home}/hima/sites` }, {
  site: 'local', workspace: h.workspace, argv: ['sh', script!], name: 'crash-window',
  nodeId: 'mechanism-node', branchId: 'mechanism-branch', attempt: 2, licences: { fixture: 1 },
  beforeLaunch: async (intent) => {
    await writeFile(intentFile!, JSON.stringify(intent));
    if (holdBefore === 'yes') await new Promise(() => { setInterval(() => {}, 1000); });
  },
});
throw new Error('the fixture must be killed before the launch receipt is delivered');
