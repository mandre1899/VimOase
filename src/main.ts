/*
 * Vimoase, by mandre1899: Neovim-style keys for Obsidian.
 *
 * This file only wires the parts together; each lives in its own module:
 *   keys/       key notation, the keymap (actions + per-context tries) and the key engine
 *   editor/     CodeMirror / vim access, clipboard keys and other editor commands
 *   explorer/   the file explorer: cursor, navigation, keep-focus, file operations, undo
 *   workspace/  commands, panes, opening files, and the pickers
 *   ui/         modals, the which-key popup and the Move to folder picker
 *
 * Parts rely on undocumented Obsidian internals; they are typed and wrapped in obsidian-internals.ts.
 */
import { Plugin, debounce, type Debouncer } from 'obsidian';
import { ClipboardKeys } from './editor/clipboard';
import { EditorCommands } from './editor/commands';
import { VimIntegration } from './editor/vim';
import { Explorer } from './explorer/explorer';
import { FileOps } from './explorer/file-ops';
import { KeepFocusOnClick } from './explorer/keep-focus';
import { ExplorerNav } from './explorer/navigation';
import { defineActions } from './keys/actions';
import { KeyEngine } from './keys/engine';
import { Keymap } from './keys/keymap';
import type { WorkspaceLeaf } from 'obsidian';
import { migrateSettings, type VimoaseSettings } from './settings';
import { VimoaseSettingTab } from './settings-tab';
import { asElement } from './util/dom';
import { Pickers } from './workspace/pickers';
import { WorkspaceNav } from './workspace/navigation';

export default class VimoasePlugin extends Plugin {
  override settings!: VimoaseSettings;

  workspaceNav!: WorkspaceNav;
  pickers!: Pickers;
  explorer!: Explorer;
  explorerNav!: ExplorerNav;
  files!: FileOps;
  clipboard!: ClipboardKeys;
  editorCommands!: EditorCommands;
  vim!: VimIntegration;
  keymap!: Keymap;
  keys!: KeyEngine;
  private keepFocus!: KeepFocusOnClick;

  requestSave!: Debouncer<[], void>;
  requestVimMaps!: Debouncer<[], void>;

  override async onload(): Promise<void> {
    this.settings = migrateSettings(await this.loadData());

    // Order matters: the actions capture these objects when they are defined.
    this.workspaceNav = new WorkspaceNav(this);
    this.pickers = new Pickers(this);
    this.explorer = new Explorer(this);
    this.explorerNav = new ExplorerNav(this);
    this.files = new FileOps(this);
    this.clipboard = new ClipboardKeys();
    this.editorCommands = new EditorCommands(this);
    this.vim = new VimIntegration(this);
    this.keymap = new Keymap(defineActions(this), () => this.settings.keymap);
    this.keys = new KeyEngine(this);
    this.keepFocus = new KeepFocusOnClick({
      enabled: () => this.settings.explorerKeys && this.settings.explorerClickKeepsFocus,
      explorerLeaf: () => this.explorer.leaf(),
      getFile: (path) => this.files.get(path),
      leaves: () => {
        const all: WorkspaceLeaf[] = [];
        this.app.workspace.iterateAllLeaves((leaf) => {
          all.push(leaf);
        });
        return all;
      },
      focusExplorerOn: (path) => this.focusExplorerOn(path),
    });

    this.requestSave = debounce(() => void this.saveData(this.settings), 400, true);
    this.requestVimMaps = debounce(() => this.vim.applyVimMaps(), 400, true);

    this.registerDomEvent(window, 'keydown', this.keys.onKeyDown, { capture: true });
    this.registerEvent(
      this.app.workspace.on('window-open', (_win, win) => {
        this.registerDomEvent(win, 'keydown', this.keys.onKeyDown, { capture: true });
      }),
    );

    const endKeepFocus = () => this.keepFocus.end();
    this.registerDomEvent(document, 'mousedown', endKeepFocus, { capture: true });
    this.registerDomEvent(window, 'keydown', endKeepFocus, { capture: true });
    this.registerDomEvent(document, 'focusin', (e) => this.keepFocus.onFocusIn(e), { capture: true });
    this.registerDomEvent(
      document,
      'click',
      (e) => {
        const view = this.explorer.view();
        const target = asElement(e.target);
        if (!view || !target || !view.containerEl.contains(target)) return;
        window.setTimeout(() => this.explorer.updateCursor(), 0);
        this.keepFocus.onExplorerClick(view, e);
      },
      { capture: true },
    );

    this.app.workspace.onLayoutReady(() => {
      this.vim.ensureYankPatch();
      this.explorer.sync();
      this.vim.applyVimMaps();
    });
    this.registerEvent(this.app.workspace.on('layout-change', () => this.explorer.sync()));
    this.registerEvent(this.app.workspace.on('active-leaf-change', () => this.explorer.updateCursor()));

    this.explorer.applyCursorStyle();
    this.addSettingTab(new VimoaseSettingTab(this));
  }

  override onunload(): void {
    this.keys.cancelSeq();
    this.explorer.restoreScope();
    this.explorer.unpatchTree();
    this.vim.removeYankPatch();
    this.vim.removeVimMaps();
    this.explorer.removeCursorStyle();
  }

  /** Call after changing any setting: saves, and re-applies what depends on settings. */
  settingsChanged(): void {
    this.requestSave();
    this.explorer.sync();
    if (this.settings.yankToClipboard) this.vim.ensureYankPatch();
    else this.vim.removeYankPatch();
    this.explorer.applyCursorStyle();
    this.explorer.updateCursor();
  }

  /** Saves an action's keys (dropping the override when they equal the defaults). */
  setKeys(id: string, keys: string[]): void {
    const override = this.keymap.overrideFor(id, keys);
    if (override) this.settings.keymap[id] = override;
    else delete this.settings.keymap[id];
    this.keymap.rebuild();
    this.settingsChanged();
  }

  private focusExplorerOn(path: string): void {
    const leaf = this.explorer.leaf();
    const view = this.explorer.view();
    if (!leaf || !view) return;
    this.app.workspace.setActiveLeaf(leaf, { focus: true });
    this.explorer.setFocus(view, view.fileItems[path]);
    const list = (view.containerEl.querySelector('.nav-files-container') as HTMLElement | null) || view.containerEl;
    if (!list.contains(list.ownerDocument.activeElement)) list.focus({ preventScroll: true });
  }
}
