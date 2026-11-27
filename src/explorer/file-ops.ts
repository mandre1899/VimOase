/*
 * Explorer file operations: create (a / A), rename (r), delete (d), move / copy to folder (m),
 * cut / copy / paste (x c p) and undo (u).
 */
import { Notice, TFile, TFolder, Vault, normalizePath, type TAbstractFile } from 'obsidian';
import type VimoasePlugin from '../main';
import { vaultConfig, type ExplorerView } from '../obsidian-internals';
import { ConfirmModal } from '../ui/confirm-modal';
import { renderCreateHints } from '../ui/create-hints';
import { FolderPickerModal } from '../ui/folder-picker/modal';
import type { PickerMode, PickerTarget } from '../ui/folder-picker/rows';
import { PromptModal } from '../ui/prompt-modal';
import { reportError } from '../util/errors';
import { basename, dirname, formatMB, hasExtension, joinPath } from '../util/paths';
import { createTypes, folderNotePath, resolveCreate, type CreatePlan, type CreateType } from './create-types';
import { UNDO_SNAPSHOT_LIMIT, UndoStack } from './undo';

/** A deleted file or folder's contents, kept so undo can restore it. */
type Snapshot =
  | { kind: 'file'; path: string; data: ArrayBuffer }
  | { kind: 'folder'; path: string; children: Snapshot[] };

export class FileOps {
  readonly undo = new UndoStack();
  /** What x / c put on the explorer clipboard. */
  private clip: { mode: 'cut' | 'copy'; path: string } | null = null;

  constructor(private readonly plugin: VimoasePlugin) {}

  private get app() {
    return this.plugin.app;
  }

  private get explorer() {
    return this.plugin.explorer;
  }

  /* ---------------------------------------------------------------- vault helpers */

  get(path: string): TAbstractFile | null {
    return this.app.vault.getAbstractFileByPath(normalizePath(path));
  }

  /** Creates every missing folder along `path`, recording each in `created`. */
  async ensureFolder(path: string, created?: string[]): Promise<TAbstractFile | null> {
    if (!path || path === '/') return this.app.vault.getRoot();
    let cur = '';
    for (const part of normalizePath(path).split('/')) {
      cur = cur ? cur + '/' + part : part;
      const existing = this.get(cur);
      if (existing instanceof TFile) throw new Error(`"${cur}" is a file`);
      if (!existing) {
        await this.app.vault.createFolder(cur);
        created?.push(cur);
      }
    }
    return this.get(path);
  }

  /** `name` in `folderPath`, or "name 1", "name 2" … if it is taken. */
  uniquePath(folderPath: string, name: string): string {
    const isFile = hasExtension(name);
    const dot = name.lastIndexOf('.');
    const base = isFile ? name.slice(0, dot) : name;
    const ext = isFile ? name.slice(dot) : '';
    let candidate = joinPath(folderPath, name);
    for (let n = 1; this.get(candidate); n++) candidate = joinPath(folderPath, `${base} ${n}${ext}`);
    return candidate;
  }

  async renameTo(file: TAbstractFile, newPath: string): Promise<TAbstractFile | null> {
    if (newPath === file.path) return file;
    if (this.get(newPath)) throw new Error(`"${newPath}" already exists`);
    await this.ensureFolder(dirname(newPath));
    await this.app.fileManager.renameFile(file, newPath);
    return this.get(newPath);
  }

  private async copyEntry(file: TAbstractFile, dest: string, created: string[]): Promise<void> {
    if (this.get(dest)) throw new Error(`"${dest}" already exists`);
    await this.ensureFolder(dirname(dest), created);
    if (file instanceof TFile) {
      await this.app.vault.copy(file, dest);
      created.push(dest);
      return;
    }
    if (!(file instanceof TFolder)) return;
    await this.ensureFolder(dest, created);
    for (const child of file.children) await this.copyEntry(child, joinPath(dest, child.name), created);
  }

  private async trash(file: TAbstractFile): Promise<void> {
    if (typeof this.app.fileManager.trashFile === 'function') await this.app.fileManager.trashFile(file);
    else await this.app.vault.trash(file, true);
  }

  /** Undo for create / copy: trash what was created, newest first, skipping folders that filled up. */
  private async trashPaths(paths: string[]): Promise<void> {
    for (const p of [...paths].reverse()) {
      const f = this.get(p);
      if (!f) continue;
      if (f instanceof TFolder && f.children.length) continue;
      await this.trash(f);
    }
  }

  /** Total size in bytes of a file, or of every file inside a folder. */
  private treeSize(f: TAbstractFile): number {
    if (f instanceof TFile) return f.stat?.size || 0;
    if (!(f instanceof TFolder)) return 0;
    return f.children.reduce((n, c) => n + this.treeSize(c), 0);
  }

  /** Where Obsidian's "Deleted files" setting sends trashed files. */
  private trashLabel(): string {
    const config = vaultConfig(this.app);
    const option = typeof config.getConfig === 'function' ? config.getConfig('trashOption') : null;
    if (option === 'none') return 'deleted permanently';
    if (option === 'local') return "moved to the vault's .trash folder";
    return 'moved to the system trash';
  }

  private async snapshot(f: TAbstractFile): Promise<Snapshot> {
    if (f instanceof TFile) return { kind: 'file', path: f.path, data: await this.app.vault.readBinary(f) };
    const children: Snapshot[] = [];
    if (f instanceof TFolder) for (const c of f.children) children.push(await this.snapshot(c));
    return { kind: 'folder', path: f.path, children };
  }

  private async restoreSnapshot(s: Snapshot): Promise<void> {
    if (s.kind === 'folder') {
      await this.ensureFolder(s.path);
      for (const c of s.children) await this.restoreSnapshot(c);
      return;
    }
    await this.ensureFolder(dirname(s.path));
    if (!this.get(s.path)) await this.app.vault.createBinary(s.path, s.data);
  }

  /** Runs a file operation, reporting errors and returning focus to the explorer if it fails. */
  async wrap(fn: () => Promise<unknown>, view?: ExplorerView | null): Promise<void> {
    try {
      await fn();
    } catch (err) {
      reportError(err);
      if (view) this.explorer.refocus(view);
    }
  }

  /** Undo for rename / move: move it back. `label` is shown as "Undid <label>". */
  private pushMoveUndo(label: string, oldPath: string, newPath: string): void {
    this.undo.push(label, async () => {
      const f = this.get(newPath);
      if (f) await this.renameTo(f, oldPath);
    });
  }

  /* ---------------------------------------------------------------- a / A: create */

  add(view: ExplorerView, folderOnly: boolean): void {
    const base = this.explorer.targetFolder(view);
    const types = createTypes(this.app);
    const plan = (value: string): CreatePlan | null =>
      resolveCreate(value, base.path, types, folderOnly, (path) => folderNotePath(this.app, path));

    new PromptModal(this.app, {
      title: folderOnly ? 'Create folder' : 'Create',
      desc: 'in ' + (base.isRoot() ? '/' : base.path + '/'),
      placeholder: folderOnly ? 'folder or a/b/folder' : 'name, name/, name.cv, name.ex, name.fc …',
      render: (value, el) => {
        const p = plan(value);
        renderCreateHints(el, { plan: p, exists: !!p && !!this.get(p.path), types, folderOnly });
      },
      onCancel: () => this.explorer.refocus(view),
      onSubmit: (value) => void this.wrap(async () => {
        const p = plan(value);
        if (!p) return this.explorer.refocus(view);
        const result = await this.create(p);
        this.explorer.refocus(view, result);
      }, view),
    }).open();
  }

  private async create({ type, path, notePath }: CreatePlan): Promise<TAbstractFile | null> {
    if (this.get(path)) throw new Error(`"${path}" already exists`);
    if (notePath && this.get(notePath)) throw new Error(`"${notePath}" already exists`);
    const created: string[] = [];
    let result: TAbstractFile | null;
    if (type.folder) {
      result = await this.ensureFolder(path, created);
      if (notePath) {
        await this.ensureFolder(dirname(notePath), created);
        const note = await this.app.vault.create(notePath, '');
        created.push(note.path);
      }
    } else {
      await this.ensureFolder(dirname(path), created);
      result = await this.app.vault.create(path, await contentOf(type));
      created.push(result.path);
    }
    this.undo.push('create ' + path, () => this.trashPaths(created));
    return result;
  }

  /* ---------------------------------------------------------------- r: rename */

  rename(view: ExplorerView): void {
    const file = this.explorer.focusedFile(view);
    if (!file || (file instanceof TFolder && file.isRoot())) return;
    const name = file.name;
    // Select the name without its extension.
    const selEnd = file instanceof TFile && file.extension ? name.length - file.extension.length - 1 : name.length;
    new PromptModal(this.app, {
      title: 'Rename',
      desc: file.path,
      value: name,
      select: [0, selEnd],
      onCancel: () => this.explorer.refocus(view, file),
      onSubmit: (value) => void this.wrap(async () => {
        let newName = value.trim();
        if (!newName || newName === name) return this.explorer.refocus(view, file);
        if (file instanceof TFile && file.extension && !hasExtension(basename(newName))) newName += '.' + file.extension;
        const oldPath = file.path;
        const result = await this.renameTo(file, joinPath(file.parent ? file.parent.path : '/', newName));
        if (result) this.pushMoveUndo('rename ' + oldPath, oldPath, result.path);
        this.explorer.refocus(view, result);
      }, view),
    }).open();
  }

  /* ---------------------------------------------------------------- d: delete */

  delete(view: ExplorerView): void {
    const file = this.explorer.focusedFile(view);
    if (!file || (file instanceof TFolder && file.isRoot())) return;

    let message = `Delete "${file.path}"?`;
    if (file instanceof TFolder) {
      let count = 0;
      Vault.recurseChildren(file, () => count++);
      message = `Delete folder "${file.path}" and its ${count - 1} item(s)?`;
    }
    const bytes = this.treeSize(file);
    const undoable = bytes <= UNDO_SNAPSHOT_LIMIT;
    if (!undoable) message += ` It is too large to undo with u (${formatMB(bytes)}) and will be ${this.trashLabel()}.`;

    new ConfirmModal(this.app, {
      title: 'Delete',
      message,
      onCancel: () => this.explorer.refocus(view),
      onConfirm: () => void this.wrap(async () => {
        const nav = this.plugin.explorerNav;
        const index = nav.visibleItems(view).findIndex((item) => item === view.fileItems[file.path]);
        const path = file.path;
        const snap = undoable ? await this.snapshot(file) : null;
        await this.trash(file);
        if (snap) this.undo.push('delete ' + path, () => this.restoreSnapshot(snap), bytes);
        else new Notice(`"${path}" ${this.trashLabel()} (too large to undo)`);

        // Put the cursor on the row that took the deleted one's place.
        await this.explorer.focusExplorer();
        const remaining = nav.visibleItems(view);
        if (remaining.length) this.explorer.setFocus(view, remaining[Math.max(0, Math.min(index, remaining.length - 1))]);
      }, view),
    }).open();
  }

  /* ---------------------------------------------------------------- m: move / copy to folder */

  /** A typed destination ("a/b/", "a/b/name") for `file` → full path, adding the extension if left out. */
  private resolveDest(value: string, file: TAbstractFile): string | null {
    const raw = value.trim();
    if (!raw) return null;
    const withoutSlash = raw.replace(/\/+$/, '');
    if (raw.endsWith('/') || this.get(withoutSlash) instanceof TFolder) return joinPath(withoutSlash || '/', file.name);
    let dest = normalizePath(raw);
    if (file instanceof TFile && file.extension && !hasExtension(basename(dest))) dest += '.' + file.extension;
    return dest;
  }

  moveOrCopy(view: ExplorerView, mode: PickerMode): void {
    const file = this.explorer.targetFile(view);
    if (!file) {
      new Notice(`Nothing to ${mode}: put the cursor on a file or folder`);
      return;
    }
    if (file instanceof TFolder && file.isRoot()) {
      new Notice('The vault root cannot be ' + (mode === 'move' ? 'moved' : 'copied'));
      return;
    }
    const item = view.fileItems[file.path];
    if (item && item !== this.explorer.focusedItem(view)) this.explorer.setFocus(view, item);

    new FolderPickerModal(this.app, {
      mode,
      item: file,
      start: file.parent || this.app.vault.getRoot(),
      onCancel: () => this.explorer.refocus(view, file),
      onSubmit: (target) => void this.wrap(() => this.moveOrCopyTo(view, file, mode, target), view),
    }).open();
  }

  private async moveOrCopyTo(view: ExplorerView, file: TAbstractFile, mode: PickerMode, target: PickerTarget): Promise<void> {
    let dest = target.kind === 'into' ? joinPath(target.path, file.name) : this.resolveDest(target.path, file);
    if (!dest) return this.explorer.refocus(view, file);
    if (dest === file.path || (mode === 'copy' && this.get(dest))) {
      if (mode === 'move') return this.explorer.refocus(view, file);
      dest = this.uniquePath(dirname(dest) || '/', basename(dest));
    }
    if (file instanceof TFolder && (dest + '/').startsWith(file.path + '/')) throw new Error(`Cannot ${mode} a folder into itself`);

    if (mode === 'move') {
      const oldPath = file.path;
      const result = await this.renameTo(file, dest);
      this.pushMoveUndo('move ' + oldPath, oldPath, dest);
      this.explorer.refocus(view, result);
    } else {
      const created: string[] = [];
      await this.copyEntry(file, dest, created);
      this.undo.push('copy to ' + dest, () => this.trashPaths(created));
      this.explorer.refocus(view, this.get(dest));
    }
  }

  /* ---------------------------------------------------------------- x / c / p: cut, copy, paste */

  setClip(view: ExplorerView, mode: 'cut' | 'copy'): void {
    const file = this.explorer.focusedFile(view);
    if (!file || (file instanceof TFolder && file.isRoot())) return;
    this.clip = { mode, path: file.path };
    new Notice((mode === 'cut' ? 'Cut: ' : 'Copied: ') + file.path);
  }

  async paste(view: ExplorerView): Promise<void> {
    const clip = this.clip;
    if (!clip) {
      new Notice('Nothing to paste');
      return;
    }
    const src = this.get(clip.path);
    if (!src) {
      this.clip = null;
      new Notice(`"${clip.path}" no longer exists`);
      return;
    }
    const target = this.explorer.targetFolder(view);
    const targetPath = target.isRoot() ? '/' : target.path;
    if (src instanceof TFolder && (targetPath + '/').startsWith(src.path + '/')) {
      new Notice('Cannot paste a folder into itself');
      return;
    }

    await this.wrap(async () => {
      if (clip.mode === 'cut') {
        const oldPath = src.path;
        let dest = joinPath(targetPath, src.name);
        if (dest === oldPath) return;
        if (this.get(dest)) dest = this.uniquePath(targetPath, src.name);
        const result = await this.renameTo(src, dest);
        this.clip = null;
        this.pushMoveUndo('move ' + oldPath, oldPath, dest);
        this.explorer.refocus(view, result);
      } else {
        const dest = this.uniquePath(targetPath, src.name);
        const created: string[] = [];
        await this.copyEntry(src, dest, created);
        this.undo.push('paste ' + dest, () => this.trashPaths(created));
        this.explorer.refocus(view, this.get(dest));
      }
    }, view);
  }

  /* ---------------------------------------------------------------- u: undo */

  async undoLast(): Promise<void> {
    const entry = this.undo.pop();
    if (!entry) {
      new Notice('Nothing to undo');
      return;
    }
    const view = this.explorer.view();
    await this.wrap(async () => {
      await entry.run();
      new Notice('Undid ' + entry.label);
      if (view) this.explorer.refocus(view);
    }, view);
  }
}

async function contentOf(type: CreateType): Promise<string> {
  return type.content ? await type.content() : '';
}
