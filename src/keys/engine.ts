/*
 * The key engine. Every keydown (capture phase) is turned into a token, matched against the
 * trie of the context it happened in, and either runs an action, starts / continues a key
 * sequence (with the which-key popup), or is left alone.
 */
import type VimoasePlugin from '../main';
import { getEditorCtx, isVimInputIdle } from '../editor/vim';
import { vimApi } from '../obsidian-internals';
import { WhichKeyPopup } from '../ui/which-key';
import { asElement, isEditable, isSynthetic } from '../util/dom';
import { reportError } from '../util/errors';
import { TYPING_CONTEXTS, type Action, type KeyContext, type TrieNode } from './keymap';
import { eventToken, vimKeyFor, type Token } from './notation';

/** Views where Vimoase leaves all keys alone. */
const SKIPPED_VIEW_TYPES = new Set(['canvas', 'excalidraw']);
const SKIPPED_VIEW_SELECTOR = '.workspace-leaf-content[data-type="canvas"], .workspace-leaf-content[data-type="excalidraw"]';

/** A key sequence in progress, e.g. after <Space> f. */
interface Sequence {
  ctx: KeyContext;
  path: Token[];
  node: TrieNode;
  popupShown: boolean;
}

const delay = (value: unknown): number => Math.max(0, Number(value) || 0);

export class KeyEngine {
  private seq: Sequence | null = null;
  private readonly popup = new WhichKeyPopup();
  private popupTimer: number | undefined;
  private seqTimer: number | undefined;
  private ambiguousTimer: number | undefined;

  constructor(private readonly plugin: VimoasePlugin) {}

  readonly onKeyDown = (e: KeyboardEvent): void => {
    if (isSynthetic(e) || e.isComposing) return;
    const target = asElement(e.target) as HTMLElement | null;
    if (!target) return;
    const token = eventToken(e);
    if (token === null) return;

    if (this.seq) {
      consume(e);
      this.feed(token);
      return;
    }

    const ctx = this.resolveContext(target);
    if (!ctx) return;

    // Ctrl-A's select-all ends on Esc (back to the old cursor) or when visual mode ends.
    const ed = ctx.ed;
    if (ed?.vim && ed.adapter) {
      this.plugin.vim.ensureYankPatch();
      const clipboard = this.plugin.clipboard;
      if (clipboard.selectAll) {
        if (clipboard.selectAll.adapter !== ed.adapter || !ed.vim.visualMode) {
          clipboard.selectAll = null;
        } else if (token === 'escape') {
          consume(e);
          clipboard.restoreSelectAll({ ...ed, adapter: ed.adapter, vim: ed.vim });
          return;
        }
      }
    }

    if (TYPING_CONTEXTS.has(ctx.name) && !(e.ctrlKey || e.altKey || e.metaKey)) return;

    const child = this.plugin.keymap.tries[ctx.name].children.get(token);
    if (!child) return;
    if (!child.children.size) {
      const action = child.action;
      if (!action || (action.when && !action.when(ctx))) return;
      if (!action.passThrough) consume(e);
      this.runAction(action, ctx);
      return;
    }

    consume(e);
    this.seq = { ctx, path: [token], node: child, popupShown: false };
    this.popupTimer = window.setTimeout(() => {
      if (!this.seq) return;
      this.seq.popupShown = true;
      this.popup.show(this.seq.path, this.seq.node);
    }, delay(this.plugin.settings.whichKeyDelay));
    this.onSeqNode();
  };

  /** Which context a key press at `target` belongs to, or null to leave the key alone. */
  private resolveContext(target: HTMLElement): KeyContext | null {
    if (target.closest('.prompt')) return { name: 'picker', target };
    const doc = target.ownerDocument || document;
    if (doc.querySelector('.modal-container, .menu')) return null;

    const ed = getEditorCtx(this.plugin.app, target);
    if (ed) {
      if (target.closest(SKIPPED_VIEW_SELECTOR)) return null;
      if (!ed.vim || ed.vim.insertMode) return { name: 'insert', target, ed };
      if (!isVimInputIdle(ed.vim)) return null;
      return { name: ed.vim.visualMode ? 'visual' : 'normal', target, ed };
    }

    if (isEditable(target)) return null;
    if (this.plugin.settings.explorerKeys && this.plugin.explorer.isExplorerFocus(target)) return { name: 'explorer', target };
    if (target.closest(SKIPPED_VIEW_SELECTOR)) return null;
    const type = this.plugin.app.workspace.activeLeaf?.view?.getViewType();
    if (type && SKIPPED_VIEW_TYPES.has(type)) return null;
    return { name: 'other', target };
  }

  /** Called whenever the sequence reaches a new node: (re)starts its timers and the popup. */
  private onSeqNode(): void {
    const seq = this.seq;
    if (!seq) return;
    window.clearTimeout(this.ambiguousTimer);
    window.clearTimeout(this.seqTimer);

    // The keys so far are a binding *and* the start of longer ones: run it if nothing follows.
    const action = seq.node.action;
    if (action) {
      this.ambiguousTimer = window.setTimeout(() => {
        if (this.seq !== seq) return;
        this.cancelSeq();
        this.runAction(action, seq.ctx);
      }, delay(this.plugin.settings.ambiguousTimeout));
    }

    const timeout = delay(this.plugin.settings.sequenceTimeout);
    if (timeout > 0) {
      this.seqTimer = window.setTimeout(() => {
        if (this.seq !== seq) return;
        this.cancelSeq();
        this.replay(seq.ctx, seq.path);
      }, timeout);
    }
    if (seq.popupShown) this.popup.show(seq.path, seq.node);
  }

  /** The next key of a sequence in progress. Esc cancels, Backspace goes back one key. */
  private feed(token: Token): void {
    const seq = this.seq;
    if (!seq) return;
    if (token === 'escape') return this.cancelSeq();

    if (token === 'backspace') {
      seq.path.pop();
      if (!seq.path.length) return this.cancelSeq();
      let node: TrieNode | undefined = this.plugin.keymap.tries[seq.ctx.name];
      for (const k of seq.path) node = node?.children.get(k);
      if (!node) return this.cancelSeq();
      seq.node = node;
      this.onSeqNode();
      return;
    }

    const child = seq.node.children.get(token);
    if (child) {
      if (!child.children.size) {
        this.cancelSeq();
        const action = child.action;
        if (action && (!action.when || action.when(seq.ctx))) this.runAction(action, seq.ctx);
        return;
      }
      seq.node = child;
      seq.path.push(token);
      this.onSeqNode();
      return;
    }

    // Not part of any binding: run what the keys so far were bound to, or give them back to vim.
    this.cancelSeq();
    if (seq.node.action) this.runAction(seq.node.action, seq.ctx);
    else this.replay(seq.ctx, seq.path.concat(token));
  }

  /** Keys that did not form a binding go back to vim, so gg, zz, ]] … keep working. */
  private replay(ctx: KeyContext, tokens: Token[]): void {
    const adapter = ctx.ed?.adapter;
    if (!adapter || !ctx.ed?.vim || (ctx.name !== 'normal' && ctx.name !== 'visual')) return;
    const Vim = vimApi();
    if (!Vim) return;
    try {
      for (const t of tokens) Vim.handleKey(adapter, vimKeyFor(t));
    } catch (err) {
      console.error('[vimoase] replay', err);
    }
  }

  cancelSeq(): void {
    this.seq = null;
    window.clearTimeout(this.popupTimer);
    window.clearTimeout(this.seqTimer);
    window.clearTimeout(this.ambiguousTimer);
    this.popup.hide();
  }

  private runAction(action: Action, ctx: KeyContext): void {
    try {
      const result = action.run(ctx);
      if (result && typeof (result as Promise<unknown>).catch === 'function') (result as Promise<unknown>).catch(reportError);
    } catch (err) {
      reportError(err);
    }
    if (ctx.name === 'explorer') window.setTimeout(() => this.plugin.explorer.updateCursor(), 0);
  }
}

function consume(e: KeyboardEvent): void {
  e.preventDefault();
  e.stopImmediatePropagation();
}
