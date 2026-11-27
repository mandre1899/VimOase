/*
 * The Move to / Copy to folder browser. One prompt line (the browsed path, then the input), a
 * list of the browsed folder's subfolders plus "move here" and "..", and one hint line.
 * Typing filters the list; "../", "/" and "a/b/" navigate as you type. See rows.ts for what
 * the list contains.
 */
import { Modal, type App, type TAbstractFile, type TFolder } from 'obsidian';
import {
  buildRows,
  defaultSelection,
  folderAt,
  isDisabled,
  isInsideItself,
  folderPath,
  resolvePath,
  rowTarget,
  type FolderLookup,
  type PickerMode,
  type PickerRow,
  type PickerTarget,
} from './rows';

export interface FolderPickerOptions {
  mode: PickerMode;
  item: TAbstractFile;
  start: TFolder;
  onSubmit(target: PickerTarget): void;
  onCancel?(): void;
}

/** Path segments to show before the input; longer paths keep the root and the last two folders. */
const MAX_CRUMBS = 4;

export class FolderPickerModal extends Modal {
  private folder: TFolder;
  private rows: PickerRow[] = [];
  private rowEls: HTMLElement[] = [];
  private sel = 0;
  private submitted = false;
  private readonly vault: FolderLookup;
  private readonly verb: string;

  private crumbsEl!: HTMLElement;
  private inputEl!: HTMLInputElement;
  private listEl!: HTMLElement;

  constructor(app: App, private readonly opts: FolderPickerOptions) {
    super(app);
    this.folder = opts.start;
    this.verb = opts.mode === 'move' ? 'move' : 'copy';
    this.vault = { root: app.vault.getRoot(), get: (path) => app.vault.getAbstractFileByPath(path) };
  }

  override onOpen(): void {
    const { contentEl } = this;
    this.modalEl.addClass('vmk-fp-modal');
    this.titleEl.empty();

    const line = contentEl.createDiv({ cls: 'vmk-fp-line' });
    this.crumbsEl = line.createSpan({ cls: 'vmk-fp-crumbs' });
    this.inputEl = line.createEl('input', {
      type: 'text',
      cls: 'vmk-fp-input',
      attr: { placeholder: `${this.verb} ${this.opts.item.name} to…`, spellcheck: 'false', autocomplete: 'off' },
    });
    this.inputEl.addEventListener('input', () => this.onInput());
    this.inputEl.addEventListener('keydown', (ev) => this.onKeyDown(ev));
    line.addEventListener('click', (ev) => {
      if (ev.target === line) this.inputEl.focus();
    });

    this.listEl = contentEl.createDiv({ cls: 'vmk-fp-list' });
    contentEl.createDiv({ cls: 'vmk-fp-hint', text: `↵ ${this.verb}   ⇥ open   ⌫ up   ⇧↵ here` });

    this.render(null);
    window.setTimeout(() => this.inputEl.focus(), 0);
  }

  override onClose(): void {
    this.contentEl.empty();
    if (!this.submitted && this.opts.onCancel) this.opts.onCancel();
  }

  /* ---------------------------------------------------------------- navigation */

  private navigate(folder: TFolder | null, rest = ''): void {
    if (!folder || folder === this.folder) return;
    const from = this.folder;
    this.folder = folder;
    this.inputEl.value = rest;
    this.render(from);
  }

  private goUp(): void {
    if (!this.folder.isRoot()) this.navigate(this.folder.parent || this.vault.root);
  }

  /** Opens the folder in a row (or goes up for ".."), without choosing it. */
  private openRow(row: PickerRow | undefined): void {
    if (!row || isDisabled(row)) return;
    if (row.kind === 'up') this.goUp();
    else if (row.kind === 'folder') this.navigate(row.folder);
  }

  /** Typing "a/b/" or "../" moves into that folder and keeps what follows the last slash. */
  private onInput(): void {
    const q = this.inputEl.value;
    const slash = q.lastIndexOf('/');
    if (slash >= 0) {
      const dir = folderAt(this.vault, resolvePath(this.folder, q.slice(0, slash + 1)));
      if (dir) {
        if (dir === this.folder) this.inputEl.value = q.slice(slash + 1);
        else return this.navigate(dir, q.slice(slash + 1));
      }
    }
    this.render(null);
  }

  /* ---------------------------------------------------------------- choosing */

  private submit(target: PickerTarget): void {
    this.submitted = true;
    this.close();
    this.opts.onSubmit(target);
  }

  private activate(row: PickerRow | undefined): void {
    const target = row && rowTarget(row);
    if (target === 'up') this.goUp();
    else if (target) this.submit(target);
  }

  private submitHere(): void {
    const path = folderPath(this.folder);
    if (!isInsideItself(this.opts.item, path)) this.submit({ kind: 'into', path });
  }

  private moveSelection(delta: number): void {
    const n = this.rows.length;
    if (!n) return;
    let i = this.sel;
    for (let step = 0; step < n; step++) {
      i = (i + delta + n) % n;
      if (!isDisabled(this.rows[i])) break;
    }
    this.select(i);
  }

  private select(i: number): void {
    this.sel = i;
    this.rowEls.forEach((el, j) => el.toggleClass('is-selected', j === i));
    this.rowEls[i]?.scrollIntoView({ block: 'nearest' });
  }

  private onKeyDown(ev: KeyboardEvent): void {
    if (ev.isComposing) return;
    const input = this.inputEl;
    const ctrl = ev.ctrlKey && !ev.metaKey && !ev.altKey;
    const empty = input.value === '';
    const caretAtStart = input.selectionStart === 0 && input.selectionEnd === 0;
    const caretAtEnd = input.selectionStart === input.value.length;
    const row = this.rows[this.sel];
    const rowOpens = !!row && (row.kind === 'folder' || row.kind === 'up');

    const isDown = ev.key === 'ArrowDown' || (ctrl && (ev.key === 'n' || ev.key === 'j'));
    const isUp = ev.key === 'ArrowUp' || (ctrl && (ev.key === 'p' || ev.key === 'k'));
    const isOpen = (ev.key === 'ArrowRight' && caretAtEnd && !ev.shiftKey) || (ctrl && ev.key === 'l');
    const isParent = (ev.key === 'ArrowLeft' && caretAtStart && !ev.shiftKey)
      || (ev.key === 'Backspace' && empty)
      || (ctrl && ev.key === 'h' && empty);

    if (isDown) this.moveSelection(1);
    else if (isUp) this.moveSelection(-1);
    else if (ev.key === 'Enter') {
      if (ev.shiftKey || ev.metaKey || ev.ctrlKey) this.submitHere();
      else if (input.value.trim() === '..') this.goUp();
      else this.activate(row);
    } else if (ev.key === 'Tab') {
      if (ev.shiftKey) this.goUp();
      else this.openRow(row);
    } else if (isOpen && rowOpens) this.openRow(row);
    else if (isParent) this.goUp();
    else return; // not ours: let the input handle it

    ev.preventDefault();
    ev.stopPropagation();
  }

  /* ---------------------------------------------------------------- rendering */

  private render(cameFrom: TFolder | null): void {
    const query = this.inputEl.value;
    this.renderCrumbs();
    this.rows = buildRows({ item: this.opts.item, mode: this.opts.mode, folder: this.folder, query, vault: this.vault });
    this.listEl.empty();

    if (!this.rows.some((r) => r.kind === 'folder')) {
      const typed = query.trim();
      if (!typed) this.listEl.createDiv({ cls: 'vmk-fp-empty', text: 'no subfolders' });
      else if (!typed.includes('/')) this.listEl.createDiv({ cls: 'vmk-fp-empty', text: 'no match' });
    }

    this.rowEls = this.rows.map((row, i) => this.renderRow(row, i));
    this.select(defaultSelection(this.rows, cameFrom, query.trim() !== ''));
  }

  private renderRow(row: PickerRow, i: number): HTMLElement {
    const el = this.listEl.createDiv({ cls: 'vmk-fp-row vmk-fp-' + row.kind });
    if (isDisabled(row)) el.addClass('is-disabled');

    const label = el.createSpan({ cls: 'vmk-fp-label' });
    if (row.kind === 'folder' && row.match) {
      const { start, length } = row.match;
      label.appendText(row.label.slice(0, start));
      label.createEl('mark', { text: row.label.slice(start, start + length) });
      label.appendText(row.label.slice(start + length));
    } else {
      label.setText(row.label);
    }
    if (row.kind === 'folder') label.createSpan({ cls: 'vmk-fp-slash', text: '/' });

    if (row.kind !== 'up' && row.note) {
      const warn = row.kind === 'folder' && row.warn;
      el.createSpan({ cls: 'vmk-fp-meta' + (warn ? ' is-warn' : ''), text: row.note });
    }
    if (row.kind === 'folder' && !row.disabled) {
      const open = el.createSpan({ cls: 'vmk-fp-open', text: '›', attr: { 'aria-label': 'Open folder' } });
      open.addEventListener('click', (ev) => {
        ev.stopPropagation();
        this.openRow(row);
        this.inputEl.focus();
      });
    }

    el.addEventListener('mousemove', () => {
      if (!isDisabled(row) && this.sel !== i) this.select(i);
    });
    el.addEventListener('click', () => {
      this.activate(row);
      if (!this.submitted) this.inputEl.focus();
    });
    return el;
  }

  private renderCrumbs(): void {
    const el = this.crumbsEl;
    el.empty();
    const chain: TFolder[] = [];
    for (let f: TFolder | null = this.folder; f; f = f.parent) {
      chain.unshift(f);
      if (f.isRoot()) break;
    }
    const shown: (TFolder | null)[] = chain.length > MAX_CRUMBS ? [chain[0], null, ...chain.slice(-2)] : chain;
    for (const f of shown) {
      if (!f) {
        el.createSpan({ cls: 'vmk-fp-crumb is-gap', text: '…/' });
        continue;
      }
      const crumb = el.createSpan({ cls: 'vmk-fp-crumb', text: (f.isRoot() ? '' : f.name) + '/' });
      if (f.isRoot()) crumb.setAttribute('aria-label', this.app.vault.getName());
      if (f === this.folder) {
        crumb.addClass('is-current');
      } else {
        crumb.addEventListener('click', () => {
          this.navigate(f);
          this.inputEl.focus();
        });
      }
    }
  }
}
