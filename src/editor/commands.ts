/* Editor actions bound in normal / visual / insert mode. */
import { MarkdownView, Notice } from 'obsidian';
import type { KeyContext } from '../keys/keymap';
import type VimoasePlugin from '../main';
import { vaultConfig, vimApi } from '../obsidian-internals';
import { cmLanguage, type EditorCtx } from './vim';
import type { VimEditor } from './clipboard';

export type InsertMove = 'left' | 'right' | 'up' | 'down' | 'home';

/** Lines that ]t / [t stop at: TODO, FIXME, FIX, or an open task. */
export const TODO_LINE = /\b(TODO|FIXME|FIX)\b|^\s*(?:[-*+]|\d+[.)])\s+\[ \]/;

/** The link under column `ch` of a line: a wikilink or markdown link target, or an external URL. */
export function findLinkAt(text: string, ch: number): string | { external: string } | null {
  const within = (m: RegExpExecArray) => ch >= m.index && ch < m.index + m[0].length;
  const wiki = /!?\[\[([^\]]+?)\]\]/g;
  let m: RegExpExecArray | null;
  while ((m = wiki.exec(text))) {
    if (within(m)) return m[1].split('|')[0].trim();
  }
  const md = /!?\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
  while ((m = md.exec(text))) {
    if (!within(m)) continue;
    let link = m[1];
    try {
      link = decodeURIComponent(link);
    } catch {
      /* keep raw */
    }
    if (/^[a-z][a-z0-9+.-]*:/i.test(link)) return { external: link };
    return link;
  }
  return null;
}

export class EditorCommands {
  constructor(private readonly plugin: VimoasePlugin) {}

  copyWholeFile(ed: EditorCtx): void {
    this.plugin.clipboard.writeClipboard(ed.view.state.doc.toString(), false);
    new Notice('Copied whole note');
  }

  noHighlight(ed: EditorCtx): void {
    const Vim = vimApi();
    if (!Vim || !ed.adapter || typeof Vim.handleEx !== 'function') return;
    try {
      Vim.handleEx(ed.adapter, 'nohlsearch');
    } catch {
      /* no search active */
    }
  }

  toggleComment(ctx: KeyContext): void {
    this.plugin.workspaceNav.cmd('editor:toggle-comments');
    const Vim = vimApi();
    const ed = ctx.ed;
    if (ctx.name === 'visual' && ed?.adapter && ed.vim?.visualMode && Vim) Vim.exitVisualMode(ed.adapter);
  }

  toggleLineNumbers(): void {
    const vault = vaultConfig(this.plugin.app);
    if (typeof vault.getConfig !== 'function' || typeof vault.setConfig !== 'function') {
      new Notice('Vimoase: cannot change line numbers in this Obsidian version');
      return;
    }
    const next = !vault.getConfig('showLineNumber');
    vault.setConfig('showLineNumber', next);
    new Notice('Line numbers ' + (next ? 'on' : 'off'));
  }

  /** Ctrl-h/j/k/l and Ctrl-b in insert mode. */
  insMove(ed: VimEditor, dir: InsertMove): void {
    const a = ed.adapter;
    let { line, ch } = a.getCursor();
    switch (dir) {
      case 'left':
        if (ch > 0) ch--;
        else if (line > 0) {
          line--;
          ch = a.getLine(line).length;
        }
        break;
      case 'right':
        if (ch < a.getLine(line).length) ch++;
        else if (line < a.lastLine()) {
          line++;
          ch = 0;
        }
        break;
      case 'down':
        if (line < a.lastLine()) {
          line++;
          ch = Math.min(ch, a.getLine(line).length);
        }
        break;
      case 'up':
        if (line > 0) {
          line--;
          ch = Math.min(ch, a.getLine(line).length);
        }
        break;
      case 'home': {
        const text = a.getLine(line);
        const first = text.search(/\S/);
        ch = first < 0 ? text.length : first;
        break;
      }
    }
    a.setCursor({ line, ch });
  }

  /** ]t / [t: the next / previous TODO or open task, wrapping around the note. */
  jumpTodo(ed: EditorCtx, dir: 1 | -1): void {
    const a = ed.adapter;
    if (!a) return;
    const count = a.lastLine() + 1;
    const start = a.getCursor().line;
    for (let i = 1; i <= count; i++) {
      const line = (start + dir * i + count * 2) % count;
      const text = a.getLine(line);
      if (!TODO_LINE.test(text)) continue;
      const m = text.match(/\b(TODO|FIXME|FIX)\b|\[ \]/);
      const ch = m && m.index !== undefined ? m.index : 0;
      const editor = this.plugin.app.workspace.activeEditor?.editor;
      if (editor) {
        editor.setCursor({ line, ch });
        editor.scrollIntoView({ from: { line, ch }, to: { line, ch } }, true);
      } else {
        a.setCursor({ line, ch });
      }
      return;
    }
    new Notice('No TODOs in this note');
  }

  fold(ed: EditorCtx, close: boolean): void {
    if (cmLanguage) {
      const fn = close ? cmLanguage.foldCode : cmLanguage.unfoldCode;
      if (typeof fn === 'function' && fn(ed.view)) return;
    }
    this.plugin.workspaceNav.cmd('editor:toggle-fold');
  }

  /** K: show Obsidian's hover preview for the link under the cursor. */
  hoverLink(ed: EditorCtx): void {
    const a = ed.adapter;
    if (!a) return;
    const cur = a.getCursor();
    const link = findLinkAt(a.getLine(cur.line), cur.ch);
    if (!link) {
      new Notice('No link under cursor');
      return;
    }
    if (typeof link === 'object') {
      new Notice(link.external);
      return;
    }
    const ws = this.plugin.app.workspace;
    const mdView = ws.getActiveViewOfType(MarkdownView);
    const file = ws.getActiveFile();
    const pos = ed.view.state.selection.main.head;
    let el: Node;
    try {
      const dom = ed.view.domAtPos(pos);
      el = dom.node.nodeType === Node.TEXT_NODE && dom.node.parentElement ? dom.node.parentElement : dom.node;
    } catch {
      el = ed.view.contentDOM;
    }
    const coords = ed.view.coordsAtPos(pos) || { left: 0, top: 0 };
    const event = new MouseEvent('mouseover', { ctrlKey: true, metaKey: true, clientX: coords.left, clientY: coords.top });
    ws.trigger('hover-link', {
      event,
      source: 'editor',
      hoverParent: mdView || ed.view,
      targetEl: el,
      linktext: link,
      sourcePath: file ? file.path : '',
    });
  }

  visualBlock(ed: VimEditor): void {
    const Vim = vimApi();
    if (!Vim) return;
    if (ed.vim.visualMode && ed.vim.visualBlock) Vim.exitVisualMode(ed.adapter);
    else Vim.handleKey(ed.adapter, '<C-v>');
  }
}
