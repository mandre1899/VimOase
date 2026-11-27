/* Telescope-style pickers, and Ctrl-n/p/v/x/t inside them and Obsidian's own pickers. */
import { FuzzySuggestModal, Notice, Platform, TFile, TFolder, type TAbstractFile, type WorkspaceLeaf } from 'obsidian';
import { CONTEXT_LABEL, type Action, type KeyContext } from '../keys/keymap';
import { displaySeq, type Token } from '../keys/notation';
import type VimoasePlugin from '../main';
import { leafFile, type SuggestChooser } from '../obsidian-internals';
import { dispatchSyntheticKey } from '../util/dom';
import type { OpenMode } from './navigation';

export interface PickerOptions<T> {
  placeholder?: string;
  items(): T[];
  text(item: T): string;
  onChoose(item: T, mode: OpenMode): void;
}

export type PickerKey = 'down' | 'up' | 'vertical' | 'horizontal' | 'tab';

class PickerModal<T> extends FuzzySuggestModal<T> {
  /** Set by Ctrl-v / Ctrl-x / Ctrl-t right before the chosen item is used. */
  openMode: OpenMode = null;

  constructor(private readonly pickers: Pickers, private readonly opts: PickerOptions<T>) {
    super(pickers.plugin.app);
    this.setPlaceholder(opts.placeholder || 'Search…');
  }

  getItems(): T[] {
    return this.opts.items();
  }

  getItemText(item: T): string {
    return this.opts.text(item);
  }

  onChooseItem(item: T): void {
    this.opts.onChoose(item, this.openMode);
  }

  /** FuzzySuggestModal's internal list of results. */
  get chooser(): SuggestChooser | undefined {
    return (this as unknown as { chooser?: SuggestChooser }).chooser;
  }

  override onOpen(): void {
    super.onOpen();
    this.pickers.active = this as PickerModal<unknown>;
  }

  override onClose(): void {
    super.onClose();
    if (this.pickers.active === (this as PickerModal<unknown>)) this.pickers.active = null;
  }
}

export class Pickers {
  /** The Vimoase picker that is open, if any. */
  active: PickerModal<unknown> | null = null;

  constructor(readonly plugin: VimoasePlugin) {}

  open<T>(opts: PickerOptions<T>): void {
    new PickerModal(this, opts).open();
  }

  private get nav() {
    return this.plugin.workspaceNav;
  }

  allFiles(): void {
    this.open<TFile>({
      placeholder: 'Find all files…',
      items: () => this.plugin.app.vault.getFiles(),
      text: (f) => f.path,
      onChoose: (f, mode) => void this.nav.openFile(f, mode),
    });
  }

  recent(): void {
    this.open<TFile>({
      placeholder: 'Recent files…',
      items: () =>
        this.plugin.app.workspace
          .getLastOpenFiles()
          .map((p) => this.plugin.files.get(p))
          .filter((f): f is TFile => f instanceof TFile),
      text: (f) => f.path,
      onChoose: (f, mode) => void this.nav.openFile(f, mode),
    });
  }

  tabs(): void {
    this.open<WorkspaceLeaf>({
      placeholder: 'Open tabs…',
      items: () => {
        const leaves: WorkspaceLeaf[] = [];
        this.plugin.app.workspace.iterateRootLeaves((leaf) => {
          leaves.push(leaf);
        });
        return leaves;
      },
      text: (leaf) => leafFile(leaf)?.path ?? leaf.getDisplayText(),
      onChoose: (leaf, mode) => {
        const file = leafFile(leaf);
        if (mode && file instanceof TFile) void this.nav.openFile(file, mode);
        else this.plugin.app.workspace.setActiveLeaf(leaf, { focus: true });
      },
    });
  }

  reveal(): void {
    this.open<TAbstractFile>({
      placeholder: 'Reveal in file explorer…',
      items: () => this.plugin.app.vault.getAllLoadedFiles().filter((f) => !(f instanceof TFolder && f.isRoot())),
      text: (f) => (f instanceof TFolder ? f.path + '/' : f.path),
      onChoose: async (f) => {
        await this.plugin.explorer.focusExplorer();
        const view = this.plugin.explorer.view();
        if (view) this.plugin.explorer.revealFile(view, f);
      },
    });
  }

  bindings(): void {
    const keymap = this.plugin.keymap;
    const items: { a: Action; s: Token[] }[] = [];
    for (const a of keymap.actions) for (const s of keymap.validSeqs(a.id)) items.push({ a, s });
    this.open({
      placeholder: 'Search key bindings…',
      items: () => items,
      text: (it) => `${displaySeq(it.s)}   ${it.a.label}   (${it.a.contexts.map((c) => CONTEXT_LABEL[c]).join(', ')})`,
      onChoose: (it) => new Notice(displaySeq(it.s) + ' → ' + it.a.label),
    });
  }

  /**
   * Ctrl-n / Ctrl-p move through results; Ctrl-v / Ctrl-x / Ctrl-t open the selected one in a
   * split or tab. In Obsidian's own pickers these are sent as the keys Obsidian understands.
   */
  key(ctx: KeyContext, what: PickerKey): void {
    const prompt = ctx.target.closest('.prompt');
    const input: EventTarget = prompt?.querySelector('input') || ctx.target;
    const send = (key: string, mods: KeyboardEventInit = {}) => dispatchSyntheticKey(input, { key, code: key, ...mods });
    const picker = this.active;

    if (what === 'down' || what === 'up') {
      const chooser = picker?.chooser;
      if (chooser && typeof chooser.setSelectedItem === 'function' && typeof chooser.selectedItem === 'number') {
        const len = Array.isArray(chooser.values) ? chooser.values.length : 0;
        if (len) chooser.setSelectedItem((chooser.selectedItem + (what === 'down' ? 1 : -1) + len) % len, null);
        return;
      }
      send(what === 'down' ? 'ArrowDown' : 'ArrowUp');
      return;
    }

    if (picker) {
      picker.openMode = what;
      const chooser = picker.chooser;
      if (chooser && typeof chooser.useSelectedItem === 'function') chooser.useSelectedItem(new KeyboardEvent('keydown', { key: 'Enter' }));
      else send('Enter');
      return;
    }

    // Obsidian's own pickers: Mod+Enter opens in a new tab, Mod+Alt+Enter in a split.
    const mod: KeyboardEventInit = Platform.isMacOS ? { metaKey: true } : { ctrlKey: true };
    if (what === 'tab') send('Enter', mod);
    else if (what === 'vertical') send('Enter', { altKey: true, ...mod });
    else new Notice('Horizontal split is only available in Vimoase pickers');
  }
}
