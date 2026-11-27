/*
 * "Keep focus in explorer after clicking a file".
 *
 * A plain click on a file opens it, and Obsidian then moves keyboard focus into the note. This
 * remembers the clicked file; whenever focus lands in a pane showing that file, it sends focus
 * back to the explorer with the cursor on the file, so m / r / d … act on it. It reacts to
 * Obsidian's focus changes instead of waiting a fixed time, and the next mouse press or key
 * press ends it, so clicking into the note or pressing Enter / l still edits it.
 */
import { TFile, type TAbstractFile, type WorkspaceLeaf } from 'obsidian';
import { leafFile, type ExplorerView } from '../obsidian-internals';
import { asElement } from '../util/dom';

export interface KeepFocusHost {
  enabled(): boolean;
  explorerLeaf(): WorkspaceLeaf | null;
  getFile(path: string): TAbstractFile | null;
  /** Every leaf in the workspace, to find the pane that received focus. */
  leaves(): WorkspaceLeaf[];
  /** Focuses the explorer with the cursor on `path`. */
  focusExplorerOn(path: string): void;
}

export class KeepFocusOnClick {
  /** The clicked file, until the next mouse or key press. */
  pendingPath: string | null = null;

  constructor(private readonly host: KeepFocusHost) {}

  /** Mouse down or key down anywhere: the user is doing something else now. */
  end(): void {
    this.pendingPath = null;
  }

  onExplorerClick(view: ExplorerView, e: MouseEvent): void {
    this.pendingPath = null;
    if (!this.host.enabled()) return;
    const plainClick = e.button === 0 && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey;
    const target = asElement(e.target);
    if (!plainClick || !target) return;
    const row = target.closest('.tree-item-self');
    if (!row || target.closest('input, textarea, [contenteditable="true"]')) return;
    const path = row.getAttribute('data-path') || pathOfRow(view, row);
    if (path && this.host.getFile(path) instanceof TFile) this.pendingPath = path;
  }

  onFocusIn(e: FocusEvent): void {
    const path = this.pendingPath;
    const target = asElement(e.target);
    if (!path || !target) return;
    const explorer = this.host.explorerLeaf();
    if (!explorer) {
      this.pendingPath = null;
      return;
    }
    if (explorer.view.containerEl.contains(target)) return;
    const leaf = this.host.leaves().find((l) => l.view?.containerEl?.contains(target));
    if (leafFile(leaf)?.path === path) this.host.focusExplorerOn(path);
  }
}

function pathOfRow(view: ExplorerView, row: Element): string | null {
  const entry = Object.entries(view.fileItems).find(([, item]) => item?.selfEl === row);
  return entry ? entry[0] : null;
}
