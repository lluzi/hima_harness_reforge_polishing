// Test-only inspection/fault injection for the existing Electron driver's optional Chromium port.
// It never creates another browser or changes production state behind the Host's interfaces.
import assert from 'node:assert/strict';

export async function inspectWindow(port: number) {
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json() as { type: string; webSocketDebuggerUrl: string }[];
  const target = targets.find((entry) => entry.type === 'page');
  assert.ok(target, 'the test driver has a page');
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise<void>((resolve, reject) => { socket.addEventListener('open', () => resolve(), { once: true }); socket.addEventListener('error', reject, { once: true }); });
  let seq = 0;
  const pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>();
  const paused: { requestId: string; request: { url: string; method: string } }[] = [];
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(String(event.data)) as { id?: number; result?: unknown; error?: { message: string }; method?: string; params?: { requestId: string; request: { url: string; method: string } } };
    if (message.id !== undefined) {
      const waiting = pending.get(message.id); pending.delete(message.id);
      if (message.error) waiting?.reject(new Error(message.error.message)); else waiting?.resolve(message.result);
    } else if (message.method === 'Fetch.requestPaused' && message.params) paused.push(message.params);
  });
  const send = <T = unknown>(method: string, params: Record<string, unknown> = {}): Promise<T> => new Promise((resolve, reject) => {
    const id = ++seq;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP ${method} timed out`)); }, 10_000);
    pending.set(id, { resolve: (value) => { clearTimeout(timer); resolve(value as T); }, reject: (error) => { clearTimeout(timer); reject(error); } });
    socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async <T = unknown>(expression: string): Promise<T> => {
    const result = await send<{ result: { value: T }; exceptionDetails?: { text: string } }>('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
    return result.result.value;
  };
  const wait = async (expression: string, timeout = 12_000) => {
    const until = Date.now() + timeout;
    while (!await evaluate(expression)) {
      if (Date.now() >= until) throw new Error(`Window condition timed out: ${expression}`);
      await new Promise((resolve) => setTimeout(resolve, 60));
    }
  };
  return {
    send, evaluate, wait,
    /** Mark an existing semantic control for the same driver's trusted mouse events. */
    mark: (selector: string, name: string) => evaluate(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e) throw new Error('missing control'); e.setAttribute('data-hima-control', ${JSON.stringify(name)}); })()`),
    markText: (selector: string, text: string, name: string) => evaluate(`(() => { const e = [...document.querySelectorAll(${JSON.stringify(selector)})].find(e => e.textContent.trim() === ${JSON.stringify(text)}); if (!e) throw new Error('missing text control'); e.setAttribute('data-hima-control', ${JSON.stringify(name)}); })()`),
    pause: async (urlPattern: string) => {
      await send('Fetch.enable', { patterns: [{ urlPattern, requestStage: 'Response' }] });
    },
    nextPaused: async () => {
      const until = Date.now() + 12_000;
      while (!paused.length) {
        if (Date.now() >= until) throw new Error('No paused window response');
        await new Promise((resolve) => setTimeout(resolve, 30));
      }
      return paused.shift()!;
    },
    close: () => { for (const request of pending.values()) request.reject(new Error('Inspector closed')); pending.clear(); socket.close(); },
  };
}
