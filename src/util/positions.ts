/** A cursor position in CodeMirror 5 style coordinates, as used by the vim adapter. */
export interface Pos {
  line: number;
  ch: number;
}

export interface Range {
  anchor: Pos;
  head: Pos;
}

export function cmpPos(a: Pos, b: Pos): number {
  return a.line - b.line || a.ch - b.ch;
}

/** The range's two ends, earliest first. */
export function orderRange(r: Range): [Pos, Pos] {
  return cmpPos(r.anchor, r.head) <= 0 ? [r.anchor, r.head] : [r.head, r.anchor];
}

/** Where the cursor ends up after inserting `text` at `start`. */
export function posAfterInsert(start: Pos, text: string): Pos {
  const lines = text.split('\n');
  if (lines.length === 1) return { line: start.line, ch: start.ch + text.length };
  return { line: start.line + lines.length - 1, ch: lines[lines.length - 1].length };
}
