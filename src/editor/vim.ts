/*
 * Access to the CodeMirror editor and Obsidian's vim mode: finding the editor behind a key
 * event, mirroring yanks to the system clipboard, and applying the user's vim mappings.
 */
import type { App } from 'obsidian';
import type { EditorView } from '@codemirror/view';
import { vimApi, type CmAdapter, type RegisterController, type VimState } from '../obsidian-internals';
import type VimoasePlugin from '../main';

/* CodeMirror modules are provided by Obsidian; load them defensively in case that ever changes. */
/* eslint-disable @typescript-eslint/no-require-imports */
let EditorViewClass: typeof EditorView | null = null;
try {
  EditorViewClass = require('@codemirror/view').EditorView;
} catch {
  EditorViewClass = null;
}
export let cmLanguage: typeof import('@codemirror/language') | null = null;
try {
  cmLanguage = require('@codemirror/language');
} catch {
  cmLanguage = null;
}
/* eslint-enable @typescript-eslint/no-require-imports */

/** The editor a key event belongs to. */
export interface EditorCtx {
  view: EditorView;
  adapter: CmAdapter | null;
  vim: VimState | null;
}

type ViewWithAdapter = EditorView & { cm?: CmAdapter };

export function getEditorCtx(app: App, target: Element): EditorCtx | null {
  const cmEl = target.closest('.cm-editor') as HTMLElement | null;
  if (!cmEl) return null;
  let view: ViewWithAdapter | null = null;
  if (EditorViewClass && typeof EditorViewClass.findFromDOM === 'function') view = EditorViewClass.findFromDOM(cmEl);
  if (!view) {
    const editor = app.workspace.activeEditor?.editor as { cm?: ViewWithAdapter } | undefined;
    if (editor?.cm && editor.cm.dom === cmEl) view = editor.cm;
  }
  if (!view || !view.contentDOM || !view.contentDOM.contains(target)) return null;
  const adapter = view.cm || null;
  const vim = adapter?.state?.vim || null;
  return { view, adapter, vim };
}

/** True when vim is not in the middle of a command (no operator, count or pending key). */
export function isVimInputIdle(vim: VimState): boolean {
  const s = vim.inputState;
  if (!s) return true;
  const len = (x?: { length: number }) => (x ? x.length || 0 : 0);
  return !s.operator && !s.motion && !s.selectedCharacter
    && len(s.keyBuffer) === 0 && len(s.prefixRepeat) === 0 && len(s.motionRepeat) === 0;
}

/* Shift+A on a soft-wrapped line: append after the last word of the visual row instead of at
 * the end of the whole paragraph. Obsidian's g$ lands on the row's trailing space, so g$a would
 * put the cursor at the start of the next row; this skips back over that space first. */
function appendAtDisplayLineEnd(cm: CmAdapter): void {
  const Vim = vimApi();
  if (!Vim) return;
  cm.execCommand('goLineRight'); // last char of the visual row, or end of the line
  const pos = cm.getCursor();
  const text = cm.getLine(pos.line);
  let ch = text.length;
  if (pos.ch < text.length) {
    ch = pos.ch;
    while (ch > 0 && /\s/.test(text[ch])) ch--;
    ch += 1;
  }
  Vim.enterInsertMode(cm);
  cm.setCursor({ line: pos.line, ch });
}

export class VimIntegration {
  private patchedRegisters: { rc: RegisterController; original: RegisterController['pushText'] } | null = null;
  private appliedMaps: { lhs: string; mode: string }[] = [];

  constructor(private readonly plugin: VimoasePlugin) {}

  /** Also send yanks into the unnamed register to the system clipboard. Deletes stay in vim. */
  ensureYankPatch(): void {
    if (!this.plugin.settings.yankToClipboard) return;
    const rc = vimApi()?.getRegisterController?.();
    if (!rc || typeof rc.pushText !== 'function') return;
    if (this.patchedRegisters && this.patchedRegisters.rc === rc) return;
    this.removeYankPatch();

    const original = rc.pushText;
    const clipboard = this.plugin.clipboard;
    rc.pushText = function (this: RegisterController, registerName, operator, text, linewise, ...rest) {
      const result = original.call(this, registerName, operator, text, linewise, ...rest);
      try {
        const unnamed = !registerName || registerName === '"';
        if (operator === 'yank' && unnamed && typeof text === 'string') {
          clipboard.writeClipboard(linewise && !text.endsWith('\n') ? text + '\n' : text, !!linewise);
        }
      } catch (err) {
        console.error('[vimoase]', err);
      }
      return result;
    };
    this.patchedRegisters = { rc, original };
  }

  removeYankPatch(): void {
    const p = this.patchedRegisters;
    if (!p) return;
    p.rc.pushText = p.original;
    this.patchedRegisters = null;
  }

  /** Real vim mappings (jk → <Esc>, ; → :) through Obsidian's vim API. */
  applyVimMaps(): void {
    const Vim = vimApi();
    this.removeVimMaps();
    if (!Vim || typeof Vim.map !== 'function') return;
    for (const m of this.plugin.settings.vimMaps) {
      const lhs = (m.lhs || '').trim();
      const rhs = (m.rhs || '').trim();
      const mode = m.mode || 'normal';
      if (!lhs || !rhs) continue;
      try {
        Vim.map(lhs, rhs, mode);
        this.appliedMaps.push({ lhs, mode });
      } catch (err) {
        console.error('[vimoase] vim map', m, err);
      }
    }
    if (this.plugin.settings.wrapAppend && Vim.defineAction && Vim.mapCommand) {
      try {
        Vim.defineAction('vmkAppendDisplayLine', appendAtDisplayLineEnd);
        Vim.mapCommand('A', 'action', 'vmkAppendDisplayLine', {}, { context: 'normal' });
        this.appliedMaps.push({ lhs: 'A', mode: 'normal' });
      } catch (err) {
        console.error('[vimoase] wrap append', err);
      }
    }
  }

  removeVimMaps(): void {
    const Vim = vimApi();
    if (Vim && typeof Vim.unmap === 'function') {
      for (const m of this.appliedMaps) {
        try {
          Vim.unmap(m.lhs, m.mode);
        } catch {
          /* already gone */
        }
      }
    }
    this.appliedMaps = [];
  }
}
