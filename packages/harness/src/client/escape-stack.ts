// One shared Escape key, for every dismissible surface Hima ever stacks on top of the canvas (#41
// task 8 review): the node card, the Diagnostics sheet, and whatever comes after them. Each surface
// pushes its own close handler on mount and pops it on unmount; a single `document` listener in the
// capture phase — capture runs before any bubble-phase handler a surface might also carry — calls
// only the *topmost* handler and stops the event there. Two surfaces open at once (a node card, and
// the Diagnostics sheet opened on top of it) therefore close one at a time, most-recently-opened
// first, never both on the same key press.
import { useEffect, useRef } from 'react';

const stack: (() => void)[] = [];

function onKeyDown(event: KeyboardEvent): void {
  if (event.key !== 'Escape') return;
  const top = stack.at(-1);
  if (top === undefined) return;
  event.preventDefault();
  event.stopPropagation();
  top();
}

let installed = false;

function ensureInstalled(): void {
  if (installed) return;
  document.addEventListener('keydown', onKeyDown, { capture: true });
  installed = true;
}

/**
 * Register `handler` as the current topmost Escape target.
 *
 * @param handler - called, with the event already stopped, when Escape is pressed while this is the
 *                  topmost registrant.
 * @returns a disposer to call on unmount; safe to call more than once.
 */
export function pushEscape(handler: () => void): () => void {
  ensureInstalled();
  stack.push(handler);
  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    const at = stack.lastIndexOf(handler);
    if (at !== -1) stack.splice(at, 1);
  };
}

/**
 * The hook every dismissible surface (the node card, the Diagnostics sheet) should call instead of
 * `useEffect(() => pushEscape(onClose), [onClose])` directly (review C4).
 *
 * `onClose` is almost always a fresh arrow function every render (`onClose={() => onSelectNode(
 * undefined)}` in `FabricCanvas.tsx`, `onClose={() => setDiagnosticsOpen(false)}` in
 * `HimaWorkbench.tsx`) — neither caller memoises it, and neither should have to just to register an
 * Escape handler. Depending on `[onClose]` directly means every render pops this surface's own
 * registration and pushes a fresh one, which reorders `stack` on every render rather than only on
 * mount/unmount — two surfaces open at once could then close in whichever order they last happened to
 * re-render in, not the order they were actually opened in.
 *
 * The fix is the standard "latest callback in a ref" shape: the *registration* (the one `pushEscape`
 * call, and so this surface's own position in `stack`) happens exactly once, in an effect with `[]`
 * deps, so `stack`'s order is mount order and nothing else. The ref is updated every render (in the
 * render body, not an effect — no need to wait a tick for it), so the one long-lived closure `stack`
 * holds always calls whatever the latest `onClose` actually is.
 */
export function useEscape(onClose: () => void): void {
  const ref = useRef(onClose);
  ref.current = onClose;
  useEffect(() => pushEscape(() => { ref.current(); }), []);
}
