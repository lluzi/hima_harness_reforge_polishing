// One shared clock-face reading, for every surface that shows "when" rather than a raw ISO string or
// epoch: the masthead's elapsed figure, the Diagnostics sheet's "last Ledger read", the Campaign
// picker's own Run rows. Hoisted here (final review, C16) after the same one-line function had drifted
// into three separate copies (`CampaignTab.tsx`, `Diagnostics.tsx`, `HimaWorkbench.tsx`) — one now
// reads them all.

/** `at` as a local wall-clock time, to the second — never a date, never a timezone offset; the
 *  surfaces that use this only ever need "when today", not "which day". Accepts an ISO string or an
 *  epoch millisecond number, since callers hold both. */
export const shortTime = (at: string | number): string =>
  new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
