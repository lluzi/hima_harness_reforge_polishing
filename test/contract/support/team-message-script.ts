// Test-only process transport. Actual separate process receives the structured Host wrapper and
// retains receipt evidence before responding. It never creates a Run or schedules a task.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { teamMessageNativeInput, type TeamTransport, type TeamMessageEnvelope, type TeamMessageDelivery, type TeamDeliveryResult } from '@hima/harness';
const program = `
const fs=require('node:fs');let body='';process.stdin.on('data',d=>body+=d);process.stdin.on('end',()=>{
 const received=JSON.parse(body);const receipt={state:'accepted',received:{nativeReceiptId:received.receiptId,receivedAt:new Date().toISOString(),target:received.target}};
 fs.writeFileSync(received.file,JSON.stringify({input:JSON.parse(received.input),receipt}),{flag:'wx'});
 if(received.loseResponse)process.exit(3);process.stdout.write(JSON.stringify(receipt));
});`;
export class TeamMessageScriptTransport implements TeamTransport {
  readonly directory: string; readonly loseResponseMemberIds: readonly string[]; readonly rejectMemberIds: readonly string[];
  constructor(directory: string, loseResponseMemberIds: readonly string[] = [], rejectMemberIds: readonly string[] = []) {
    this.directory = directory; this.loseResponseMemberIds = loseResponseMemberIds; this.rejectMemberIds = rejectMemberIds;
  }
  private file(delivery: TeamMessageDelivery): string {
    if (!delivery.target) throw new Error('Actual claimed invocation is required.');
    return path.join(this.directory, createHash('sha256').update(JSON.stringify([delivery.target.runId, delivery.target.effectId, delivery.target.memberId, delivery.target.generation, delivery.target.attemptId])).digest('hex') + '.json');
  }
  async deliver(message: TeamMessageEnvelope, delivery: TeamMessageDelivery): Promise<TeamDeliveryResult> {
    if (this.rejectMemberIds.includes(delivery.recipientMemberId)) return { state: 'rejected', reason: 'Script endpoint explicitly rejected this recipient.' };
    await mkdir(this.directory, { recursive: true });
    const file = this.file(delivery);
    const child = spawn(process.execPath, ['-e', program], { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = ''; child.stdout.on('data', chunk => { stdout += chunk; });
    const finished = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('Script receive timed out.')); }, 5000);
      child.on('error', error => { clearTimeout(timeout); reject(error); });
      child.on('close', code => { clearTimeout(timeout); code === 0 ? resolve() : reject(new Error('Script response was lost after possible receipt.')); });
    });
    child.stdin.end(JSON.stringify({ file, input: teamMessageNativeInput(message), target: delivery.target,
      receiptId: `script-${delivery.target!.attemptId}`, loseResponse: this.loseResponseMemberIds.includes(delivery.recipientMemberId) }));
    await finished;
    return JSON.parse(stdout) as TeamDeliveryResult;
  }
  async observeDelivery(delivery: TeamMessageDelivery): Promise<TeamDeliveryResult | { state: 'unavailable'; reason: string }> {
    try { return (JSON.parse(await readFile(this.file(delivery), 'utf8')) as { receipt: TeamDeliveryResult }).receipt; }
    catch (caught) { if ((caught as NodeJS.ErrnoException).code !== 'ENOENT') throw caught; return { state: 'unavailable', reason: 'No retained script receive evidence for this exact attempt.' }; }
  }
}
