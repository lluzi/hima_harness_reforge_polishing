// Driver mode: the shell answers questions about its own window over standard input and output.
//
// Started with `--driver`, the main process does everything it does for a person — prepares the
// home, launches the host, exchanges the token in the window's own session, loads the page — and
// then reads JSON lines on stdin and answers each with exactly one JSON line on stdout. That is the
// one seam every step-3 contract test drives the product through (D42, ADR-0004): a test asserts on
// what the window renders and on what the routes answer with the session the shell established,
// and on nothing a person could not see.
//
// Reads, waits, clicks and fills run from this process through `webContents.executeJavaScript` and
// `webContents.sendInputEvent`. The page gets no preload and no IPC surface for any of it (D39,
// ADR-0003): the driver looks at the document the way developer tools would, a click is a real
// mouse event at the control's centre, and a fill sets a field through the page — focused, its value
// replaced, the `input` and `change` events a person's typing raises dispatched — so the page's own
// handlers run whichever window on the machine holds the keyboard. There is no third-party
// automation and no second host-to-window mechanism.
//
// The fence stands here as it does everywhere: `open` takes a path under the host's origin and
// refuses everything else — an absolute URL elsewhere, `file:`, another port — in the fence's own
// words.
import type { BrowserWindow } from 'electron';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline';

/** The ops this driver answers, in the order the README lists them. */
const OPS = ['host', 'open', 'read', 'wait', 'click', 'fill', 'zoom', 'screenshot', 'quit'] as const;

/** How often `wait` looks at the document, and how long it looks unless told otherwise. */
const WAIT_POLL_MS = 200;
const WAIT_DEFAULT_MS = 30_000;

/**
 * How often `click` asks the page whether the click arrived, how long one send is given to arrive
 * before the same click is sent again, and how long the whole op keeps trying.
 *
 * A window that has just been opened sometimes discards the first mouse events sent to it: measured
 * on this Mac at about four clicks in a hundred with several suites booting shells at once, and
 * every one of them recovered by sending the same click again, after the page had sat idle for
 * fourteen seconds proving the first one was gone rather than slow (#43). So `click` sends, asks,
 * and sends again until the page has it.
 *
 * The resend interval is a second and the ask is every fifty milliseconds on purpose: the ask goes
 * to the same renderer over the same channel as the input event, so a renderer answering an ask
 * inside fifty milliseconds is not one sitting on a second-old mouse event. An event that is going
 * to arrive has arrived long before the next send, and a control is never activated twice.
 */
const CLICK_ASK_MS = 50;
const CLICK_RESEND_MS = 1_000;
const CLICK_ARRIVES_MS = 6_000;


/** The attribute a driver-readable region carries, and the prefix of its state attributes. */
const REGION_ATTRIBUTE = 'data-hima-region';
const STATE_PREFIX = 'data-hima-state-';
const CONTROL_ATTRIBUTE = 'data-hima-control';

export interface DriverHost { readonly url: string; readonly origin: string }
export interface DriverSession { readonly cookieName: string; readonly cookieValue: string }

export interface DriverOptions {
  readonly win: BrowserWindow;
  readonly host: DriverHost;
  /** The session cookie the shell established, read from the window's own cookie jar. */
  readonly session: () => Promise<DriverSession | undefined>;
  /** The navigation fence's own words for a target it refuses. */
  readonly refusal: (target: string) => string;
  /** End the app the way closing the window does: `quit` and a closed stdin call it once their answer is out. */
  readonly quit: () => void;
  /** What the shell says about what it did, for the one fact an answer has no room for: a click the
   *  window took more than one send to receive. It belongs in the driver's stderr beside the shell's
   *  other lines, because that is where a flake is read back from afterwards. */
  readonly note?: (line: string) => void;
  readonly input: NodeJS.ReadableStream;
  readonly output: NodeJS.WritableStream;
}

type Answer = { readonly ok: true; readonly [field: string]: unknown } | { readonly ok: false; readonly error: string };

/** A request this driver cannot act on: it reaches the caller as `ok: false` with its own message. */
class Refused extends Error {}

const refuse = (why: string): never => { throw new Refused(why); };

/** What a region shows: its rendered text (`innerText`, so block lines are lines), trimmed, and every
 *  `data-hima-state-*` attribute it carries. */
interface Region { readonly text: string; readonly state: Readonly<Record<string, string>> }

/** Where a control is on screen, after it was scrolled into view. */
interface Spot { readonly x: number; readonly y: number; readonly width: number; readonly height: number }

/**
 * Start answering driver requests on `input`, one at a time, in order.
 *
 * Sequential on purpose: a `wait` holds the line until it resolves, so a test that sends `wait`
 * and then `read` gets the read after the wait, which is what it asked for. A test that wants
 * concurrency does not get it from a single stdin.
 *
 * @param opts - the window, the host, and how to end.
 */
export function startDriver(opts: DriverOptions): void {
  const lines = readline.createInterface({ input: opts.input, crlfDelay: Infinity });
  let turn: Promise<void> = Promise.resolve();
  let ending = false;
  const end = (): void => {
    if (ending) return;
    ending = true;
    opts.quit();
  };
  // An answer that cannot be written is the caller gone, which is a closed stdin by another name: the
  // shell ends the way that ends it, host and all. Left to itself an EPIPE on stdout is an uncaught
  // exception in Electron's main process — a dialog nobody is there to dismiss, and a host and its
  // tmux Job left running — so both the write's own error and the stream's are handled here.
  const answer = (line: string): Promise<void> => new Promise((resolve) => {
    opts.output.write(`${line}\n`, (failed) => { if (failed) end(); resolve(); });
  });
  opts.output.on('error', () => { end(); });
  lines.on('line', (line) => {
    turn = turn.then(async () => {
      if (ending) return;
      const request = parse(line);
      if (!request.ok) { await answer(JSON.stringify({ id: null, ok: false, error: request.error })); return; }
      const result = await perform(opts, request.body);
      // The answer is on the wire before anything ends: stdout to a pipe is asynchronous here, and an
      // `app.quit` that raced the write would leave the caller with no answer to its quit.
      await answer(JSON.stringify({ id: request.id, ...result }));
      if (request.body.op === 'quit') end();
    });
  });
  // A closed stdin is the caller gone; the shell ends the way `quit` ends it, host and all.
  lines.on('close', () => { turn = turn.then(() => { end(); }); });
}

/** A line read as a request: its id and body, or why it is not one — answered with `id: null`. */
type Request =
  | { readonly ok: true; readonly id: string | number; readonly body: Record<string, unknown> }
  | { readonly ok: false; readonly error: string };

function parse(line: string): Request {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch (err) {
    return { ok: false, error: `the line is not JSON: ${(err as Error).message}` };
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return { ok: false, error: 'the request is not a JSON object' };
  const body = parsed as Record<string, unknown>;
  if (typeof body.op !== 'string') return { ok: false, error: 'the request has no "op"' };
  const id = body.id;
  if (typeof id !== 'string' && typeof id !== 'number') return { ok: false, error: 'the request has no "id" (a string or a number)' };
  return { ok: true, id, body };
}

/** One request, performed; whatever it refuses or fails on is the answer, never an exception. */
async function perform(opts: DriverOptions, body: Record<string, unknown>): Promise<Answer> {
  try {
    switch (body.op) {
      case 'host': return await hostOp(opts);
      case 'open': return await openOp(opts, string(body, 'path'));
      case 'read': return await readOp(opts, string(body, 'region'));
      case 'wait': return await waitOp(opts, string(body, 'region'), string(body, 'text'), optionalMs(body, 'timeoutMs'));
      case 'click': return await clickOp(opts, string(body, 'control'));
      case 'fill': return await fillOp(opts, string(body, 'control'), string(body, 'value'));
      case 'zoom': return await zoomOp(opts, factor(body, 'factor'));
      case 'screenshot': return await screenshotOp(opts, string(body, 'path'));
      case 'quit': return { ok: true };
      default: return refuse(`unknown op ${JSON.stringify(body.op)}; this driver answers ${OPS.join(', ')}`);
    }
  } catch (err) {
    return { ok: false, error: err instanceof Refused ? err.message : `${String(body.op)} failed: ${(err as Error).message}` };
  }
}

function string(body: Record<string, unknown>, key: string): string {
  const value = body[key];
  if (typeof value !== 'string' || value === '') return refuse(`"${key}" is required and must be a non-empty string`);
  return value;
}

/** A page zoom, held to the range Chromium itself accepts: outside it the window shows nothing new. */
function factor(body: Record<string, unknown>, key: string): number {
  const value = body[key];
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0.25 || value > 5) {
    return refuse(`"${key}" must be a zoom factor between 0.25 and 5`);
  }
  return value;
}

function optionalMs(body: Record<string, unknown>, key: string): number | undefined {
  const value = body[key];
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return refuse(`"${key}" must be a non-negative number of milliseconds when given`);
  return value;
}

/** `host`: where the host is and the session this window holds for it, for route calls from a test. */
async function hostOp(opts: DriverOptions): Promise<Answer> {
  const session = await opts.session();
  if (session === undefined) return refuse(`this window holds no dsh-auth-* cookie for ${opts.host.origin}: the token exchange did not happen`);
  return { ok: true, url: opts.host.url, origin: opts.host.origin, session };
}

/**
 * `open`: load a path under the host's origin and answer once the load finished, with the HTTP
 * status the navigation got. Anything that does not resolve to the host's own origin is refused in
 * the fence's words — the fence is about origins, and what the host answers for a path is the
 * host's own business, reported rather than judged.
 */
async function openOp(opts: DriverOptions, target: string): Promise<Answer> {
  let parsed: URL;
  try {
    parsed = new URL(target, opts.host.origin);
  } catch {
    return refuse(`${JSON.stringify(target)} is neither a path nor a URL`);
  }
  if (parsed.origin !== opts.host.origin) return refuse(opts.refusal(parsed.href));
  const contents = opts.win.webContents;
  let status: number | undefined;
  const navigated = (_event: unknown, _url: string, httpResponseCode: number): void => { status = httpResponseCode; };
  contents.on('did-navigate', navigated);
  try {
    await opts.win.loadURL(parsed.href);
  } finally {
    contents.off('did-navigate', navigated);
  }
  return { ok: true, url: contents.getURL(), status: status ?? -1, title: opts.win.getTitle() };
}

/** `read`: what the region marked `data-hima-region="<region>"` shows right now. */
async function readOp(opts: DriverOptions, region: string): Promise<Answer> {
  const found = await inspect(opts.win, region);
  if (found === null) return refuse(absent(opts, region));
  return { ok: true, ...found };
}

/**
 * `wait`: the region's text contains `text`, polled from this process; on timeout, what it last
 * showed — or that it was absent, or that the page could not be asked at all — and the page it was
 * asked on, so a test that waited for the wrong words is told which words were there, and a test
 * that waited on the wrong page is told which page that was.
 *
 * The URL is in all three sentences because the commonest reason a region is absent is that the
 * window never went where the test believes it did: a card that was never opened reads exactly like
 * a card with nothing in it, and only the URL tells the two apart. The third sentence is here for
 * the same reason — a document that could not be asked used to be reported as an absent region,
 * which is a different fault with a different fix, and the message hid it.
 */
async function waitOp(opts: DriverOptions, region: string, text: string, timeoutMs = WAIT_DEFAULT_MS): Promise<Answer> {
  const deadline = Date.now() + timeoutMs;
  let last: Region | null = null;
  let unaskable: string | undefined;
  for (;;) {
    try {
      last = await inspect(opts.win, region);
      unaskable = undefined;
    } catch (err) {
      // The document is mid-navigation and cannot be asked this instant; the next poll can. Kept
      // rather than dropped, so a document that never becomes askable says so at the deadline.
      last = null;
      unaskable = (err as Error).message;
    }
    if (last !== null && last.text.includes(text)) return { ok: true, ...last };
    if (Date.now() >= deadline) {
      const waited = `waited ${String(timeoutMs)} ms for region ${JSON.stringify(region)} to show ${JSON.stringify(text)} on ${opts.win.webContents.getURL()};`;
      if (last !== null) return refuse(`${waited} it last showed ${JSON.stringify(last.text)}`);
      if (unaskable !== undefined) return refuse(`${waited} the page could not be asked: ${unaskable}`);
      return refuse(`${waited} the region was absent`);
    }
    await new Promise((r) => setTimeout(r, WAIT_POLL_MS));
  }
}

/**
 * `click`: the control marked `data-hima-control="<control>"`, scrolled into view and then clicked
 * with a real mouse event at its centre — mouse down, mouse up — so the page's handlers run exactly
 * as they run for a person. An unknown control, or one with no size on screen, is refused: a click
 * that lands nowhere is never a no-op.
 *
 * And neither is a click the window swallowed. `sendInputEvent` hands an event to the window and
 * says nothing about whether the page ever got it, and a window that has just opened sometimes gets
 * none of the three: the page then sits on the form it was already showing, and everything a test
 * does afterwards waits for something that can no longer happen (#43). So the click is *armed*
 * before it is sent — the page counts the clicks it takes — and this op answers only once the page
 * has counted one, sending the same click again every `CLICK_RESEND_MS` until it does. A window
 * that has taken none of them inside `CLICK_ARRIVES_MS` is refused saying exactly that, so the
 * failure lands on the click that was lost rather than minutes later on a region that never came.
 *
 * A document that is no longer the one that was armed counts as taken: only a navigation replaces
 * it, and a navigation here is a click that was taken and acted on.
 *
 * What the page took it *on* is answered too, in the answer's `note`: the marked control the event
 * actually landed inside, read with `closest('[data-hima-control]')` from the element the page
 * dispatched to. The acceptance stays as broad as it was — the question this op answers is whether
 * the window passed the event on at all, and a click counted only when it reached the intended
 * control would hide exactly the fault #43 is about — but a click that arrived somewhere else is now
 * on the record of the run that saw it, rather than being a mystery two regions later.
 */
async function clickOp(opts: DriverOptions, control: string): Promise<Answer> {
  const spot = await opts.win.webContents.executeJavaScript(locateScript(control)) as Spot | null;
  if (spot === null) return refuse(`no element marked ${CONTROL_ATTRIBUTE}=${JSON.stringify(control)} on ${opts.win.webContents.getURL()}`);
  if (spot.width <= 0 || spot.height <= 0) return refuse(`the control ${JSON.stringify(control)} has no size on screen and cannot be clicked`);
  const x = Math.round(spot.x);
  const y = Math.round(spot.y);
  armed += 1;
  const mark = `${String(armed)}-${String(Date.now())}`;
  await opts.win.webContents.executeJavaScript(armScript(mark));
  const deadline = Date.now() + CLICK_ARRIVES_MS;
  let sent = 0;
  let resendAt = 0;
  for (;;) {
    if (Date.now() >= resendAt) {
      // Input events reach the page's focus. The window itself is never focused for a first attempt:
      // focusing it activates this app and takes the keyboard from whatever the person was typing
      // into, once per click, across a whole suite. Only a click the page did not take after a
      // resend earns the real focus, which is the one case where the window is known to need it.
      if (sent === 0) opts.win.webContents.focus();
      else opts.win.focus();
      opts.win.webContents.sendInputEvent({ type: 'mouseMove', x, y });
      opts.win.webContents.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 });
      opts.win.webContents.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 });
      sent += 1;
      resendAt = Date.now() + CLICK_RESEND_MS;
    }
    await new Promise((r) => setTimeout(r, CLICK_ASK_MS));
    const took = await taken(opts.win, mark);
    if (took.taken) {
      if (sent > 1) opts.note?.(`the click on ${JSON.stringify(control)} was sent ${String(sent)} times before the window let the page have it`);
      return { ok: true, x, y, note: landedSaid(control, took) };
    }
    if (Date.now() >= deadline) {
      return refuse(`the click on ${JSON.stringify(control)} at ${String(x)},${String(y)} on ${opts.win.webContents.getURL()} was sent ${String(sent)} times in ${String(CLICK_ARRIVES_MS)} ms and the page took none of them: this window is not passing on the input events the driver sends it`);
    }
  }
}

/** How many clicks this driver has armed, so each one is armed under a mark of its own. */
let armed = 0;

/** What the page says of the click armed under a mark: whether it took one, which marked control it
 *  landed inside, and whether the document it was armed on is gone. */
interface Took { readonly taken: boolean; readonly hit?: string | null; readonly gone?: boolean }

/**
 * Has the page taken the click armed under `mark`, and what did it land on?
 *
 * A document that cannot be asked this instant is one that is moving, which the next ask decides
 * on: the deadline in `clickOp` is what ends the op, not one failed ask.
 */
async function taken(win: BrowserWindow, mark: string): Promise<Took> {
  try {
    return await win.webContents.executeJavaScript(takenScript(mark)) as Took;
  } catch {
    return { taken: false };
  }
}

/** The answer's note: where the click the page took actually landed, in the words a person reading a
 *  test's failure needs — the control it was aimed at, the one it reached, or that it reached none. */
function landedSaid(control: string, took: Took): string {
  if (took.gone === true) return `the click on ${JSON.stringify(control)} replaced the document it was armed on, which is a click that was taken and acted on`;
  if (took.hit === control) return `the click landed on ${JSON.stringify(control)}`;
  if (took.hit === null || took.hit === undefined) return `the click aimed at ${JSON.stringify(control)} was taken by the page on no marked control`;
  return `the click aimed at ${JSON.stringify(control)} was taken by the page on ${JSON.stringify(took.hit)}`;
}

/**
 * `fill`: the control marked `data-hima-control="<control>"` receives `value` the way a person
 * leaves it, and answers with what the control holds afterwards, read back out of the document.
 *
 * A text field is focused, its content replaced by `value`, and the `input` and `change` events a
 * person's typing raises are dispatched, so the page's own handlers run. It is set through the page
 * rather than typed through the keyboard on purpose: keystrokes go to whichever window on the machine
 * holds the keyboard, and two suites driving two windows at once each took the other's characters —
 * a field read back empty, every time it lost the race. What the page sees is the same either way:
 * a focused field whose value changed and whose `input` handlers fired.
 *
 * A `<select>` is set the way a person picks from the list — by choosing the option whose `value` is
 * `value`, or failing that the one whose visible text is — and the same two events are dispatched. An
 * option no `<select>` offers is refused naming the ones it does, so a test that named a pack this
 * home has not installed is told so rather than left with the first option.
 *
 * An element that is neither is refused: `fill` is for a control that holds a value, and a click is
 * what a button takes.
 */
async function fillOp(opts: DriverOptions, control: string, value: string): Promise<Answer> {
  const filled = await opts.win.webContents.executeJavaScript(fillScript(control, value)) as Filled | null;
  if (filled === null) return refuse(`no element marked ${CONTROL_ATTRIBUTE}=${JSON.stringify(control)} on ${opts.win.webContents.getURL()}`);
  if (filled.kind === 'not-fillable') {
    return refuse(`the control ${JSON.stringify(control)} is a <${filled.what}>, which holds no value to fill; click it instead`);
  }
  if (filled.kind === 'no-option') {
    return refuse(`the control ${JSON.stringify(control)} offers no option whose value or text is ${JSON.stringify(value)}; it offers ${filled.options.map((o) => JSON.stringify(o)).join(', ')}`);
  }
  return { ok: true, value: filled.value };
}

/** What the fill script did: a field or a `<select>` now holding a value, or why it holds nothing. */
type Filled =
  | { readonly kind: 'filled'; readonly value: string }
  | { readonly kind: 'no-option'; readonly options: readonly string[] }
  | { readonly kind: 'not-fillable'; readonly what: string };

/**
 * `zoom`: the page's own zoom, which is what this window's View menu sets (`installMenu`, `main.ts`)
 * and therefore something a person does here rather than a capability invented for a driver.
 *
 * It exists because a window is bounded by the display it is on — macOS clamps every window to the
 * work area, and `setContentSize` does not get past it either — so a card taller than the tallest
 * window a given Mac can open cannot be photographed whole at 100 %. Zooming out is what a person
 * does to see the whole of a long page, and the screenshot tool asks for it so a committed picture
 * is the whole card and not the top of it. Answers with the factor the page ended up at, read back
 * off the page rather than echoed, and with what the page shows of itself at that factor — the width
 * the document laid itself out at included, which is how a test asks whether anything on the card is
 * wider than the window holding it.
 */
async function zoomOp(opts: DriverOptions, wanted: number): Promise<Answer> {
  opts.win.webContents.setZoomFactor(wanted);
  // A zoom reaches the renderer asynchronously, so the answer waits for the page to have laid itself
  // out again — two animation frames, which is one frame rendered at the new zoom — and says what
  // the page now shows. Without it a capture taken in the same breath is a picture of the old zoom,
  // which is exactly what the first re-shot of the fork's card turned out to be.
  const shown = await opts.win.webContents.executeJavaScript(SHOWN_SCRIPT) as Shown;
  return { ok: true, factor: opts.win.webContents.getZoomFactor(), ...shown };
}

/**
 * What the page shows of itself once it has been laid out again: how many of its own pixels are
 * across and down the window, the device pixels each of them is drawn with, and how wide the
 * document actually laid itself out.
 *
 * `scrollWidth` is the last of those and the only one that is not about the window: it is the width
 * the page needs, so a page with `scrollWidth > innerWidth` is one a person has to scroll sideways
 * to read — the thing #41 asked the layout never to do at 900 px. It is answered here rather than
 * through an op of its own because it is the same question `innerWidth` answers from the other side,
 * and because the two are comparable only when they are read in one instant, after the same two
 * frames.
 */
interface Shown { readonly innerWidth: number; readonly innerHeight: number; readonly devicePixelRatio: number; readonly scrollWidth: number }

const SHOWN_SCRIPT = `new Promise((resolve) => {
  requestAnimationFrame(() => requestAnimationFrame(() => {
    resolve({ innerWidth: window.innerWidth, innerHeight: window.innerHeight, devicePixelRatio: window.devicePixelRatio, scrollWidth: document.documentElement.scrollWidth });
  }));
})`;

/** `screenshot`: the window's page as a PNG at `path`. A capture that painted nothing is refused. */
async function screenshotOp(opts: DriverOptions, target: string): Promise<Answer> {
  const at = path.resolve(target);
  const image = await opts.win.webContents.capturePage();
  if (image.isEmpty()) return refuse('the window painted nothing to capture');
  const png = image.toPNG();
  await writeFile(at, png);
  const { width, height } = image.getSize();
  return { ok: true, path: at, width, height, bytes: png.byteLength };
}

function absent(opts: DriverOptions, region: string): string {
  return `no element marked ${REGION_ATTRIBUTE}=${JSON.stringify(region)} on ${opts.win.webContents.getURL()}`;
}

/** The region as the document shows it now, or null when nothing is marked with that name. */
function inspect(win: BrowserWindow, region: string): Promise<Region | null> {
  return win.webContents.executeJavaScript(readScript(region)) as Promise<Region | null>;
}

/**
 * The script that reads a region. The name goes in as a JSON string and is escaped for the
 * selector inside the page, so a name with a quote in it finds nothing rather than something else.
 */
function readScript(region: string): string {
  return `(() => {
  const el = document.querySelector('[${REGION_ATTRIBUTE}="' + CSS.escape(${JSON.stringify(region)}) + '"]');
  if (el === null) return null;
  const state = {};
  for (const a of el.attributes) if (a.name.startsWith(${JSON.stringify(STATE_PREFIX)})) state[a.name.slice(${String(STATE_PREFIX.length)})] = a.value;
  return { text: (el.innerText || el.textContent || '').trim(), state };
})()`;
}

/**
 * The script that fills a control: a `<select>` is set to the option asked for, a text field to the
 * value asked for, each with the events a person's choice or typing raises, and either says what it
 * now holds; anything else says what it is. The name and the value go in as JSON strings, and the
 * name is escaped for the selector inside the page, so a name with a quote in it finds nothing.
 */
function fillScript(control: string, value: string): string {
  return `(() => {
  const el = document.querySelector('[${CONTROL_ATTRIBUTE}="' + CSS.escape(${JSON.stringify(control)}) + '"]');
  if (el === null) return null;
  const want = ${JSON.stringify(value)};
  el.scrollIntoView({ block: 'center', inline: 'center' });
  if (el instanceof HTMLSelectElement) {
    const options = Array.from(el.options);
    const picked = options.find((o) => o.value === want) ?? options.find((o) => o.text.trim() === want);
    if (picked === undefined) return { kind: 'no-option', options: options.map((o) => o.value) };
    el.focus();
    el.value = picked.value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return { kind: 'filled', value: el.value };
  }
  if (!(el instanceof HTMLInputElement) && !(el instanceof HTMLTextAreaElement)) return { kind: 'not-fillable', what: el.tagName.toLowerCase() };
  el.focus();
  // Use the native setter: a controlled input's instance setter can update its framework value
  // tracker before the input event, making that event look unchanged and leaving the draft stale.
  const prototype = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, 'value').set.call(el, want);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  return { kind: 'filled', value: el.value };
})()`;
}

/**
 * The script that arms a click: the document counts the clicks it takes, from now, under this mark,
 * and remembers which marked control the last of them landed inside.
 *
 * One listener per document, in the capture phase, so it counts a click wherever in the page it
 * landed — the question this answers is whether the *window* passed the event on at all, not
 * whether it reached the control the driver aimed at, which the count would hide. Where it landed is
 * kept beside the count rather than folded into it, for that same reason: it is reported, never
 * judged (#43).
 */
function armScript(mark: string): string {
  return `(() => {
  const held = window.__himaDriverClick;
  const mark = ${JSON.stringify(mark)};
  if (held !== undefined) { held.mark = mark; held.taken = 0; held.hit = null; return true; }
  const fresh = { mark: mark, taken: 0, hit: null };
  window.__himaDriverClick = fresh;
  document.addEventListener('click', (event) => {
    fresh.taken += 1;
    const target = event.target;
    const on = target && target.closest ? target.closest('[${CONTROL_ATTRIBUTE}]') : null;
    fresh.hit = on === null ? null : on.getAttribute('${CONTROL_ATTRIBUTE}');
  }, true);
  return true;
})()`;
}

/** The script that answers whether the armed click was taken, what it landed on, and whether the
 *  document it was armed on is gone — which is itself a click that was taken and acted on. */
function takenScript(mark: string): string {
  return `(() => {
  const held = window.__himaDriverClick;
  if (held === undefined || held.mark !== ${JSON.stringify(mark)}) return { taken: true, gone: true, hit: null };
  return { taken: held.taken > 0, gone: false, hit: held.hit };
})()`;
}

/** The script that scrolls a control into view and says where its centre is, in page coordinates. */
function locateScript(control: string): string {
  return `(() => {
  const el = document.querySelector('[${CONTROL_ATTRIBUTE}="' + CSS.escape(${JSON.stringify(control)}) + '"]');
  if (el === null) return null;
  el.scrollIntoView({ block: 'center', inline: 'center' });
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2, width: r.width, height: r.height };
})()`;
}
