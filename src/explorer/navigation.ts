/* Moving the explorer cursor (j k h l gg G …) and opening what is under it. */
import { Notice, TFile, TFolder } from 'obsidian';
import type VimoasePlugin from '../main';
import { adapterPaths, type ExplorerView, type FileItem } from '../obsidian-internals';
import { fakeKey } from '../util/dom';
import type { OpenMode } from '../workspace/navigation';

const FILE_ORDER = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

export type YankKind = 'name' | 'relative' | 'absolute';

function itemChildren(item: FileItem | null | undefined): FileItem[] | null {
  const vc = item?.vChildren;
  const arr = vc && (vc.children || vc._children);
  return Array.isArray(arr) ? arr : null;
}

export class ExplorerNav {
  constructor(private readonly plugin: VimoasePlugin) {}

  private get explorer() {
    return this.plugin.explorer;
  }

  /** Every row currently visible in the tree, top to bottom. */
  visibleItems(view: ExplorerView): FileItem[] {
    const out: FileItem[] = [];
    const root = view.tree?.root || view.fileItems['/'];
    if (root && itemChildren(root)) {
      const walk = (item: FileItem) => {
        for (const child of itemChildren(item) || []) {
          out.push(child);
          if (child.file instanceof TFolder && !child.collapsed) walk(child);
        }
      };
      walk(root);
      return out;
    }

    // Older explorers without a virtual tree: rebuild the order from the vault (folders first).
    const walk = (folder: TFolder) => {
      const kids = [...folder.children].sort((a, b) => {
        const fa = a instanceof TFolder ? 0 : 1;
        const fb = b instanceof TFolder ? 0 : 1;
        return fa - fb || FILE_ORDER.compare(a.name, b.name);
      });
      for (const f of kids) {
        const item = view.fileItems[f.path];
        if (!item) continue;
        out.push(item);
        if (f instanceof TFolder && !item.collapsed) walk(f);
      }
    };
    walk(this.plugin.app.vault.getRoot());
    return out;
  }

  private step(view: ExplorerView, delta: number): void {
    const list = this.visibleItems(view);
    if (!list.length) return;
    const cur = this.explorer.focusedItem(view);
    let i = cur ? list.indexOf(cur) : -1;
    if (i < 0) i = delta > 0 ? 0 : list.length - 1;
    else i = Math.max(0, Math.min(list.length - 1, i + delta));
    this.explorer.setFocus(view, list[i]);
  }

  down(view: ExplorerView): void {
    const t = view.tree;
    if (t && typeof t.onKeyArrowDown === 'function') t.onKeyArrowDown(fakeKey('ArrowDown'));
    else this.step(view, 1);
  }

  up(view: ExplorerView): void {
    const t = view.tree;
    if (t && typeof t.onKeyArrowUp === 'function') t.onKeyArrowUp(fakeKey('ArrowUp'));
    else this.step(view, -1);
  }

  edge(view: ExplorerView, last: boolean): void {
    const list = this.visibleItems(view);
    if (list.length) this.explorer.setFocus(view, last ? list[list.length - 1] : list[0]);
  }

  private setCollapsed(view: ExplorerView, item: FileItem, collapsed: boolean): void {
    if (typeof item.setCollapsed === 'function') item.setCollapsed(collapsed, true);
    else if (item.collapsed !== collapsed && typeof item.toggleCollapsed === 'function') item.toggleCollapsed(true);
    else if (view.tree) {
      const fn = collapsed ? view.tree.onKeyArrowLeft : view.tree.onKeyArrowRight;
      if (typeof fn === 'function') fn.call(view.tree, fakeKey(collapsed ? 'ArrowLeft' : 'ArrowRight'));
    }
  }

  /** h: close the folder under the cursor, or go to the parent. */
  left(view: ExplorerView): void {
    const item = this.explorer.focusedItem(view);
    if (!item) return this.down(view);
    if (item.file instanceof TFolder && !item.collapsed) this.setCollapsed(view, item, true);
    else this.parent(view);
  }

  parent(view: ExplorerView): void {
    const parent = this.explorer.focusedItem(view)?.file.parent;
    if (parent && !parent.isRoot()) this.explorer.setFocus(view, view.fileItems[parent.path]);
  }

  /** l: open the file, expand the folder, or step into an expanded folder. */
  right(view: ExplorerView): void {
    const item = this.explorer.focusedItem(view);
    if (!item) return this.down(view);
    if (item.file instanceof TFile) {
      void this.plugin.workspaceNav.openFile(item.file);
      return;
    }
    if (item.collapsed) {
      this.setCollapsed(view, item, false);
      return;
    }
    const kids = itemChildren(item);
    if (kids && kids.length) this.explorer.setFocus(view, kids[0]);
  }

  /** Enter / o: open the file, or toggle the folder. */
  enter(view: ExplorerView): void {
    const item = this.explorer.focusedItem(view);
    if (!item) return;
    if (item.file instanceof TFile) void this.plugin.workspaceNav.openFile(item.file);
    else this.setCollapsed(view, item, !item.collapsed);
  }

  /** Tab: show the file in the main pane but keep focus in the explorer. */
  async preview(view: ExplorerView): Promise<void> {
    const file = this.explorer.focusedFile(view);
    if (!(file instanceof TFile)) return;
    const ws = this.plugin.app.workspace;
    const leaf = this.plugin.workspaceNav.mainLeaf() || ws.getLeaf('tab');
    await leaf.openFile(file, { active: false });
    const explorerLeaf = this.explorer.leaf();
    if (explorerLeaf) ws.setActiveLeaf(explorerLeaf, { focus: true });
    this.explorer.updateCursor();
  }

  openFocused(view: ExplorerView, mode: OpenMode): void {
    const file = this.explorer.focusedFile(view);
    if (file instanceof TFile) void this.plugin.workspaceNav.openFile(file, mode);
  }

  /** z: collapse every folder, keeping the cursor on the top-level folder it was in. */
  collapseAll(view: ExplorerView): void {
    const focused = this.explorer.focusedFile(view);
    if (view.tree && typeof view.tree.setCollapseAll === 'function') {
      view.tree.setCollapseAll(true);
    } else {
      for (const item of Object.values(view.fileItems)) {
        if (item && item.file instanceof TFolder && !item.file.isRoot() && !item.collapsed) this.setCollapsed(view, item, true);
      }
    }
    if (focused) {
      let top = focused;
      while (top.parent && !top.parent.isRoot()) top = top.parent;
      this.explorer.setFocus(view, view.fileItems[top.path]);
    }
  }

  reload(view: ExplorerView): void {
    if (typeof view.requestSort === 'function') view.requestSort();
    else if (typeof view.sort === 'function') view.sort();
    new Notice('File explorer refreshed');
  }

  yankPath(view: ExplorerView, kind: YankKind): void {
    const file = this.explorer.focusedFile(view);
    if (!file) return;
    let text = file.path;
    if (kind === 'name') {
      text = file.name;
    } else if (kind === 'absolute') {
      const adapter = adapterPaths(this.plugin.app);
      if (typeof adapter.getFullPath === 'function') text = adapter.getFullPath(file.path);
      else if (adapter.basePath) text = adapter.basePath + '/' + file.path;
    }
    this.plugin.clipboard.writeClipboard(text, false);
    new Notice('Copied: ' + text);
  }
}
