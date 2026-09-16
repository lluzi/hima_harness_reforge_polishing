// One shared Escape key, for every dismissible surface Hima ever stacks on top of the canvas (#41
// task 8 review): the node card, the Diagnostics sheet, and whatever comes after them. Each surface
// pushes its own close handler on mount and pops it on unmount; a single `document` listener in the
// capture phase — capture runs before any bubble-phase handler a surface might also carry — calls
// only the *topmost* handler and stops the event there. Two surfaces open at once (a node card, and
// the Diagnostics sheet opened on top of it) therefore close one at a time, most-recently-opened
// first, never both on the same key press.
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
