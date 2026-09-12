// Markdown a live check writes: the one function both of them need to put an observed value into a
// table without the table eating it.
//
// A live check's record is D24's shape — every claim a check with its own predicate and what was
// actually seen — and the seen value is whatever the product handed back: a path, a JSON blob, a
// list of file names, a model's own sentence. None of that is written for a table, and a record that
// mangles the thing it is evidence of is not evidence.

/**
 * One observed value as a cell of a GFM table: the whole value, on one line, inside a code span.
 *
 * Whole, because a record's reader must not have to open the JSON companion to find out what was
 * actually seen — a truncated path or a clipped sentence is exactly the part of the evidence that
 * decides whether the check meant anything.
 *
 * Three characters cannot cross a table row as they are, and each is dealt with rather than dropped:
 *
 *   - a **pipe** would end the cell, so it is written `\|`, which is GFM's own escape and is honoured
 *     inside a code span;
 *   - a **newline** would end the row, so it is written as the two characters `\n` (the JSON beside
 *     the record carries every byte as it was, unescaped, for anything that needs the original);
 *   - a **backtick** would close the span early, so the span is fenced with one backtick more than
 *     the longest run inside it — CommonMark's own answer — and padded with a space when the value
 *     itself begins or ends with one, which is how CommonMark says a span may hold a leading or
 *     trailing backtick.
 *
 * CRLF is normalised to LF first, so a value that crossed a process boundary on one platform reads
 * the same as one that did not.
 *
 * @param saw - what the check actually saw, whole.
 * @returns the cell's text, safe to put between two pipes.
 */
export const cell = (saw: string): string => {
  const oneLine = saw.replaceAll('\r\n', '\n').replaceAll('\n', '\\n').replaceAll('|', '\\|');
  const longestRun = [...oneLine.matchAll(/`+/g)].reduce((most, run) => Math.max(most, run[0].length), 0);
  const fence = '`'.repeat(longestRun + 1);
  const pad = oneLine.startsWith('`') || oneLine.endsWith('`') ? ' ' : '';
  return `${fence}${pad}${oneLine}${pad}${fence}`;
};
