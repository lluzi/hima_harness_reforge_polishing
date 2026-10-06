// A question at heading size (ADR-0021): a Guide often restates the person's question as a full
// specification, which the analysis page and the conversation card head by its first sentence.
// Pure, so the server page and the browser card share it.
/** A heading-sized question: the whole of a short one, else its first sentence, else its first words. */
export function headlineOf(question: string): string {
  const text = question.trim().replace(/\s+/gu, ' ');
  if (text.length <= 140) return text;
  const first = /^(.{20,180}?[.?!])(\s|$)/u.exec(text)?.[1];
  if (first !== undefined) return first;
  const cut = text.slice(0, 140);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), 80))}…`;
}
