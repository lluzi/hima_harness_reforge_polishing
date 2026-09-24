import readline from 'node:readline';

const adapter = process.argv[2] ?? 'fixture-repl';
const version = process.argv[3] ?? '1';
const state = new Map();
process.stdout.write(`HIMA:${adapter}:${version}:READY\n`);
let releaseInterrupt;
process.on('SIGINT', () => {
  process.stdout.write('INTERRUPTED\n');
  releaseInterrupt?.();
});

const marker = (token, kind) => `HIMA:${token}:${kind}`;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const interrupted = () => new Promise((resolve) => { releaseInterrupt = resolve; });

async function execute(line) {
  const command = JSON.parse(line);
  process.stdout.write(`${marker(command._himaToken, 'ACK')}\n`);
  try {
    if (command.op === 'set') state.set(command.key, command.value);
    else if (command.op === 'get') process.stdout.write(`VALUE ${command.key}=${String(state.get(command.key))}\n`);
    else if (command.op === 'slow') await Promise.race([sleep(command.ms), interrupted()]);
    else if (command.op === 'fake-prompt') {
      process.stdout.write(`HIMA:${adapter}:${version}:${command.id}:DONE\n`);
      await sleep(command.ms);
    } else if (command.op === 'spam') process.stdout.write(`${'x'.repeat(command.bytes)}\n`);
    else if (command.op !== 'exit') throw new Error(`unknown op ${String(command.op)}`);
  } catch (error) {
    process.stdout.write(`ERROR ${error.message}\n${marker(command._himaToken, 'FAIL')}\n`);
    return;
  }
  releaseInterrupt = undefined;
  process.stdout.write(`${marker(command._himaToken, 'DONE')}\n`);
  if (command.op === 'exit') process.exit(0);
}

const lines = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
let queue = Promise.resolve();
lines.on('line', (line) => {
  queue = queue.then(() => execute(line)).catch((error) => process.stdout.write(`ERROR ${error.message}\n`));
});
