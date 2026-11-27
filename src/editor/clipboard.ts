/*
 * System-clipboard keys in vim mode: Ctrl-A selects the whole note (Esc returns to where you
 * were), Ctrl-C / Ctrl-X copy or cut the selection or the current line, Ctrl-V pastes.
 */
import type { EditorView } from '@codemirror/view';
import { vimApi, type CmAdapter, type VimState } from '../obsidian-internals';
import { reportError } from '../util/errors';
import { cmpPos, orderRange, posAfterInsert, type Pos, type Range } from '../util/positions';
import type { EditorCtx } from './vim';

/** What a copy / cut / paste acts on: whole lines, or the current selections. */
type ClipTarget =
  | { kind: 'lines'; from: number; to: number; text: string }
  | { kind: 'ranges'; ranges: Range[]; text: string };

/** An editor with its vim adapter, which every clipboard key needs. */
export type VimEditor = EditorCtx & { adapter: CmAdapter; vim: VimState };

interface SelectAllState {
  adapter: CmAdapter;
  cursor: Pos;
  scrollTop: number;
}

const withOp = (adapter: CmAdapter, fn: () => void): void => {
  if (typeof adapter.operation === 'function') adapter.operation(fn);
  else fn();
};

/** Ranges sorted from last to first, so replacing them one by one keeps the others valid. */
const lastToFirst = (ranges: Range[]): [Pos, Pos][] => ranges.map(orderRange).sort((x, y) => cmpPos(y[0], x[0]));

export class ClipboardKeys {
  /** Set while the whole note is selected by Ctrl-A, so Esc can return to the old cursor. */
  selectAll: SelectAllState | null = null;
  /** The last text this plugin put on the clipboard linewise. */
  lastLinewise: string | null = null;

  writeClipboard(text: string, linewise: boolean): void {
    this.lastLinewise = linewise ? text : null;
    navigator.clipboard.writeText(text).catch(reportError);
  }

  doSelectAll(ed: VimEditor): void {
    const Vim = vimApi();
    const { view, adapter, vim } = ed;
    if (!Vim) return;
    if (!this.selectAll || this.selectAll.adapter !== adapter) {
      this.selectAll = { adapter, cursor: adapter.getCursor('head'), scrollTop: view.scrollDOM.scrollTop };
    }
    const top = this.selectAll.scrollTop;
    if (vim.insertMode) Vim.handleKey(adapter, '<Esc>');
    if (vim.visualMode) Vim.exitVisualMode(adapter);
    adapter.setCursor({ line: 0, ch: 0 });
    Vim.handleKey(adapter, 'V');
    Vim.handleKey(adapter, 'G');
    keepScroll(view, top);
  }

  restoreSelectAll(ed: VimEditor): void {
    const Vim = vimApi();
    const { view, adapter, vim } = ed;
    const saved = this.selectAll;
    this.selectAll = null;
    if (!saved) return;
    if (Vim && vim.visualMode) Vim.exitVisualMode(adapter);
    const line = Math.min(saved.cursor.line, adapter.lastLine());
    const ch = Math.min(saved.cursor.ch, Math.max(0, adapter.getLine(line).length - 1));
    adapter.setCursor({ line, ch });
    keepScroll(view, saved.scrollTop);
  }

  doCopy(ed: VimEditor, cut: boolean): void {
    const Vim = vimApi();
    const { adapter, vim } = ed;
    const t = clipTarget(adapter, vim);
    this.writeClipboard(t.text, t.kind === 'lines');
    if (cut) {
      this.selectAll = null;
      if (vim.visualMode && Vim) Vim.exitVisualMode(adapter);
      deleteTarget(adapter, t);
      return;
    }
    if (this.selectAll && this.selectAll.adapter === adapter) {
      this.restoreSelectAll(ed);
    } else if (vim.visualMode && Vim) {
      Vim.exitVisualMode(adapter);
      if (t.kind === 'lines') adapter.setCursor({ line: t.from, ch: 0 });
      else if (t.ranges.length) adapter.setCursor(orderRange(t.ranges[0])[0]);
    }
  }

  async doPaste(ed: VimEditor): Promise<void> {
    const Vim = vimApi();
    const { adapter, vim } = ed;
    let text: string;
    try {
      text = await navigator.clipboard.readText();
    } catch (err) {
      return reportError(err);
    }
    if (!text) return;
    const linewise = text.endsWith('\n');

    // Replace the selection.
    if (vim.visualMode || (!vim.insertMode && adapter.somethingSelected())) {
      const t = clipTarget(adapter, vim);
      this.selectAll = null;
      if (vim.visualMode && Vim) Vim.exitVisualMode(adapter);
      withOp(adapter, () => {
        if (t.kind === 'lines') {
          const body = linewise ? text.slice(0, -1) : text;
          adapter.replaceRange(body, { line: t.from, ch: 0 }, { line: t.to, ch: adapter.getLine(t.to).length });
          adapter.setCursor({ line: t.from, ch: 0 });
        } else {
          for (const [s, e] of lastToFirst(t.ranges)) adapter.replaceRange(text, s, e);
        }
      });
      return;
    }

    if (vim.insertMode) {
      adapter.replaceSelection(text);
      return;
    }

    // Normal mode: whole lines go above the cursor line, other text at the cursor.
    const cur = adapter.getCursor();
    withOp(adapter, () => {
      if (linewise) {
        adapter.replaceRange(text, { line: cur.line, ch: 0 });
        adapter.setCursor({ line: cur.line, ch: 0 });
      } else {
        adapter.replaceRange(text, cur);
        const end = posAfterInsert(cur, text);
        adapter.setCursor({ line: end.line, ch: Math.max(0, end.ch - 1) });
      }
    });
  }
}

function clipTarget(adapter: CmAdapter, vim: VimState): ClipTarget {
  if (vim.visualMode && vim.visualLine) {
    const sel = vim.sel || {};
    const a = sel.anchor || adapter.getCursor('anchor');
    const h = sel.head || adapter.getCursor('head');
    const from = Math.min(a.line, h.line);
    const to = Math.max(a.line, h.line);
    const lines: string[] = [];
    for (let i = from; i <= to; i++) lines.push(adapter.getLine(i));
    return { kind: 'lines', from, to, text: lines.join('\n') + '\n' };
  }
  if (vim.visualMode || adapter.somethingSelected()) {
    return { kind: 'ranges', ranges: adapter.listSelections(), text: adapter.getSelections().join('\n') };
  }
  const line = adapter.getCursor().line;
  return { kind: 'lines', from: line, to: line, text: adapter.getLine(line) + '\n' };
}

function deleteTarget(adapter: CmAdapter, t: ClipTarget): void {
  withOp(adapter, () => {
    if (t.kind === 'lines') {
      const last = adapter.lastLine();
      let from: Pos = { line: t.from, ch: 0 };
      let to: Pos;
      if (t.to < last) {
        to = { line: t.to + 1, ch: 0 };
      } else {
        // Deleting through the last line: take the newline before the block instead.
        to = { line: t.to, ch: adapter.getLine(t.to).length };
        if (t.from > 0) from = { line: t.from - 1, ch: adapter.getLine(t.from - 1).length };
      }
      adapter.replaceRange('', from, to);
      adapter.setCursor({ line: Math.min(t.from, adapter.lastLine()), ch: 0 });
      return;
    }
    const ranges = lastToFirst(t.ranges);
    for (const [s, e] of ranges) adapter.replaceRange('', s, e);
    if (ranges.length) adapter.setCursor(ranges[ranges.length - 1][0]);
  });
}

/** Keeps the editor scrolled where it was while vim moves the cursor (and CodeMirror re-scrolls). */
function keepScroll(view: EditorView, top: number): void {
  const restore = () => {
    view.scrollDOM.scrollTop = top;
  };
  restore();
  window.requestAnimationFrame(() => {
    restore();
    window.requestAnimationFrame(restore);
  });
}
