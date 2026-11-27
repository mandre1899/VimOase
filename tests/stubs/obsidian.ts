/*
 * A tiny stand-in for the `obsidian` module, which only exists inside the Obsidian app.
 * It implements just what the code under test touches at runtime.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

export function normalizePath(path: string): string {
  let p = path.replace(/([\\/])+/g, '/').replace(/(^\/+|\/+$)/g, '');
  if (p === '') p = '/';
  return p;
}

export class TAbstractFile {
  name: string;
  parent: TFolder | null;
  constructor(public path: string, parent: TFolder | null) {
    this.name = path === '/' ? '' : path.split('/').pop() || '';
    this.parent = parent;
    if (parent) parent.children.push(this);
  }
}

export class TFolder extends TAbstractFile {
  children: TAbstractFile[] = [];
  isRoot(): boolean {
    return this.path === '/';
  }
}

export class TFile extends TAbstractFile {
  stat = { size: 0, ctime: 0, mtime: 0 };
  get extension(): string {
    const i = this.name.lastIndexOf('.');
    return i > 0 ? this.name.slice(i + 1) : '';
  }
  get basename(): string {
    const i = this.name.lastIndexOf('.');
    return i > 0 ? this.name.slice(0, i) : this.name;
  }
}

export const Vault = {
  recurseChildren(root: TAbstractFile, cb: (f: TAbstractFile) => void): void {
    cb(root);
    if (root instanceof TFolder) for (const c of root.children) Vault.recurseChildren(c, cb);
  },
};

/** Messages shown with `new Notice()`, for assertions. */
export const notices: string[] = [];
export class Notice {
  constructor(message: string) {
    notices.push(message);
  }
}

/** Modals that were opened, for assertions. */
export const openedModals: Modal[] = [];
export class Modal {
  titleEl: any;
  contentEl: any;
  modalEl: any;
  scope = { register() {} };
  constructor(public app: any) {}
  open(): void {
    openedModals.push(this);
  }
  close(): void {
    (this as any).onClose?.();
  }
}

export class FuzzySuggestModal<T> extends Modal {
  setPlaceholder(_p: string): void {}
  getItems(): T[] {
    return [];
  }
}

export class Plugin {
  domEvents: { target: unknown; type: string; handler: (e: any) => void }[] = [];
  constructor(public app: any, public manifest: any) {}
  async loadData(): Promise<unknown> {
    return null;
  }
  async saveData(_data: unknown): Promise<void> {}
  registerDomEvent(target: unknown, type: string, handler: (e: any) => void): void {
    this.domEvents.push({ target, type, handler });
  }
  registerEvent(_ref: unknown): void {}
  addSettingTab(_tab: unknown): void {}
}

export class PluginSettingTab {
  constructor(public app: any, public plugin: any) {}
  hide(): void {}
}

export class Setting {}
export class MarkdownView {}
export const Platform = { isMacOS: true };

export function debounce<T extends unknown[]>(fn: (...args: T) => void): (...args: T) => void {
  return fn;
}
