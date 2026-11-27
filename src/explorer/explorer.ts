/*
 * The file explorer: finding it, focusing it, its coloured cursor, and switching off
 * Obsidian's own explorer keys that Vimoase binds.
 */
import { Platform, TFolder, type TAbstractFile, type TFolder as Folder, type WorkspaceLeaf } from 'obsidian';
import { scopeKeyToken } from '../keys/notation';
import type VimoasePlugin from '../main';
import { asExplorerView, type ExplorerTree, type ExplorerView, type FileItem, type ScopeInternals, type ScopeKey } from '../obsidian-internals';
import { DEFAULT_SETTINGS } from '../settings';

export class Explorer {
  private disabledScope: { scope: ScopeInternals; removed: ScopeKey[] } | null = null;
  private patchedTree: { tree: ExplorerTree; original: NonNullable<ExplorerTree['setFocusedItem']> } | null = null;
  private cursorEl: HTMLElement | null = null;

  constructor(private readonly plugin: VimoasePlugin) {}

  leaf(): WorkspaceLeaf | null {
    return this.plugin.app.workspace.getLeavesOfType('file-explorer')[0] || null;
  }

  view(): ExplorerView | null {
    const leaf = this.leaf();
    return leaf ? asExplorerView(leaf.view) : null;
  }

  /** True when keys typed at `target` go to the explorer. */
  isExplorerFocus(target: Element): boolean {
    const leaf = this.leaf();
    if (!leaf || !leaf.view) return false;
    if (leaf.view.containerEl.contains(target)) return true;
    const doc = target.ownerDocument || document;
    return this.plugin.app.workspace.activeLeaf === leaf && target === doc.body;
  }

  /* ---------------------------------------------------------------- showing and focusing */

  async focusExplorer(): Promise<void> {
    let leaf = this.leaf();
    if (!leaf) {
      this.plugin.workspaceNav.cmd('file-explorer:open');
      leaf = this.leaf();
      if (!leaf) return;
    }
    const ws = this.plugin.app.workspace;
    const sidebar = this.plugin.workspaceNav.sidebarOf(leaf);
    if (sidebar && sidebar.collapsed) sidebar.expand();
    await ws.revealLeaf(leaf);
    ws.setActiveLeaf(leaf, { focus: true });
    this.sync();
    this.updateCursor();
  }

  async revealInExplorer(): Promise<void> {
    const file = this.plugin.app.workspace.getActiveFile();
    await this.focusExplorer();
    const view = this.view();
    if (view && file) this.revealFile(view, file);
  }

  async toggleExplorer(): Promise<void> {
    const leaf = this.leaf();
    if (leaf) {
      const sidebar = this.plugin.workspaceNav.sidebarOf(leaf);
      const shown = (!sidebar || !sidebar.collapsed) && leaf.view.containerEl.isShown();
      if (shown) {
        this.closeExplorer();
        return;
      }
    }
    await this.revealInExplorer();
  }

  closeExplorer(): void {
    const leaf = this.leaf();
    const sidebar = leaf && this.plugin.workspaceNav.sidebarOf(leaf);
    if (sidebar) sidebar.collapse();
    this.plugin.workspaceNav.focusEditor();
  }

  /** Expands the folders above `file` and puts the cursor on it. */
  revealFile(view: ExplorerView, file: TAbstractFile): void {
    window.setTimeout(() => {
      if (typeof view.revealInFolder === 'function') view.revealInFolder(file);
      const item = view.fileItems[file.path];
      if (item) this.setFocus(view, item);
    }, 50);
  }

  /** Focuses the explorer again after a prompt, with the cursor on `file` if given. */
  refocus(view: ExplorerView, file?: TAbstractFile | null): void {
    void this.focusExplorer().then(() => {
      if (file) this.revealFile(view, file);
    });
  }

  /* ---------------------------------------------------------------- cursor */

  focusedItem(view: ExplorerView): FileItem | null {
    return view.tree?.focusedItem || null;
  }

  focusedFile(view: ExplorerView): TAbstractFile | null {
    return this.focusedItem(view)?.file || null;
  }

  /**
   * The item an explorer command acts on: the keyboard cursor, else the item highlighted by a
   * mouse click (selection / active row), else the file open in the editor.
   */
  targetFile(view: ExplorerView): TAbstractFile | null {
    const focused = this.focusedFile(view);
    if (focused) return focused;
    const tree = view.tree;
    const selected = tree?.selectedDoms;
    if (selected && selected.size === 1) {
      const only = selected.values().next().value;
      if (only?.file) return only.file;
    }
    const active = tree?.activeDom?.file || view.activeDom?.file;
    if (active) return active;
    return this.plugin.app.workspace.getActiveFile();
  }

  /** Where new and pasted items go: the folder under the cursor, or the cursor file's folder. */
  targetFolder(view: ExplorerView): Folder {
    const root = this.plugin.app.vault.getRoot();
    const f = this.focusedFile(view);
    if (!f) return root;
    if (f instanceof TFolder) return f;
    return f.parent || root;
  }

  setFocus(view: ExplorerView, item: FileItem | null | undefined): void {
    if (!item) return;
    view.tree?.setFocusedItem?.(item, true);
    this.updateCursor();
  }

  updateCursor(): void {
    const view = this.view();
    const item = view && this.focusedItem(view);
    const el = (this.plugin.settings.cursorEnabled && item && item.selfEl) || null;
    if (this.cursorEl && this.cursorEl !== el) this.cursorEl.removeClass('vmk-cursor');
    if (el) el.addClass('vmk-cursor');
    this.cursorEl = el;
  }

  applyCursorStyle(): void {
    const { cursorColor, cursorStrength, cursorStyle } = this.plugin.settings;
    const body = document.body;
    const strength = Math.max(5, Math.min(100, Number(cursorStrength) || 30));
    body.style.setProperty('--vmk-cursor-color', cursorColor || DEFAULT_SETTINGS.cursorColor);
    body.style.setProperty('--vmk-cursor-strength', strength + '%');
    body.removeClass('vmk-cursor-fill', 'vmk-cursor-outline', 'vmk-cursor-bar');
    body.addClass('vmk-cursor-' + (cursorStyle || 'fill'));
  }

  removeCursorStyle(): void {
    const body = document.body;
    body.style.removeProperty('--vmk-cursor-color');
    body.style.removeProperty('--vmk-cursor-strength');
    body.removeClass('vmk-cursor-fill', 'vmk-cursor-outline', 'vmk-cursor-bar');
  }

  /* ---------------------------------------------------------------- Obsidian's own explorer keys */

  /** Re-applies the scope changes and tree patch; the explorer view can be recreated at any time. */
  sync(): void {
    this.syncScope();
    this.patchTree();
    this.updateCursor();
  }

  /** Obsidian's explorer handles some keys itself (space, enter …); turn off the ones we bind. */
  private syncScope(): void {
    const view = this.view();
    const scope = view && (view.tree?.scope || view.scope);
    this.restoreScope();
    if (!this.plugin.settings.explorerKeys || !scope || !Array.isArray(scope.keys)) return;
    const ours = new Set(this.plugin.keymap.tries.explorer.children.keys());
    const removed = scope.keys.filter((k) => {
      const tok = scopeKeyToken(k, Platform.isMacOS);
      return tok !== null && ours.has(tok);
    });
    for (const k of removed) {
      if (typeof scope.unregister === 'function') scope.unregister(k);
      else scope.keys.remove(k);
    }
    this.disabledScope = { scope, removed };
  }

  restoreScope(): void {
    const d = this.disabledScope;
    if (!d) return;
    for (const k of d.removed) if (!d.scope.keys.includes(k)) d.scope.keys.push(k);
    this.disabledScope = null;
  }

  /** Moves our cursor highlight whenever Obsidian moves its own keyboard focus in the tree. */
  private patchTree(): void {
    const tree = this.view()?.tree;
    if (!tree || typeof tree.setFocusedItem !== 'function') return;
    if (this.patchedTree && this.patchedTree.tree === tree) return;
    this.unpatchTree();
    const original = tree.setFocusedItem;
    const updateCursor = () => this.updateCursor();
    tree.setFocusedItem = function (this: ExplorerTree, ...args) {
      const result = original.apply(this, args);
      updateCursor();
      return result;
    };
    this.patchedTree = { tree, original };
  }

  unpatchTree(): void {
    const p = this.patchedTree;
    if (!p) return;
    p.tree.setFocusedItem = p.original;
    this.patchedTree = null;
    if (this.cursorEl) {
      this.cursorEl.removeClass('vmk-cursor');
      this.cursorEl = null;
    }
  }
}
