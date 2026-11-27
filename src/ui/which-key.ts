import type { TrieNode } from '../keys/keymap';
import { displaySeq, displayToken, type Token } from '../keys/notation';

/** The popup in the corner that lists which keys can follow the ones typed so far. */
export class WhichKeyPopup {
  private el: HTMLElement | null = null;

  show(path: Token[], node: TrieNode): void {
    if (!this.el) this.el = activeDocument.body.createDiv({ cls: 'vmk-whichkey' });
    const el = this.el;
    el.empty();

    let title = displaySeq(path);
    if (node.action) title += '  → ' + node.action.label;
    else if (node.label) title += '  ' + node.label;
    el.createDiv({ cls: 'vmk-whichkey-title', text: title });

    // Single keys first, then groups; each alphabetically, lower case before upper case.
    const entries = [...node.children.entries()].sort(([a, na], [b, nb]) => {
      const groupA = na.children.size ? 1 : 0;
      const groupB = nb.children.size ? 1 : 0;
      return groupA - groupB || a.toLowerCase().localeCompare(b.toLowerCase()) || a.localeCompare(b);
    });

    const grid = el.createDiv({ cls: 'vmk-whichkey-grid' });
    for (const [key, child] of entries) {
      const isGroup = child.children.size > 0;
      const row = grid.createDiv({ cls: 'vmk-whichkey-row' + (isGroup ? ' is-group' : '') });
      row.createSpan({ cls: 'vmk-whichkey-key', text: displayToken(key) });
      row.createSpan({ cls: 'vmk-whichkey-arrow', text: '→' });
      row.createSpan({ cls: 'vmk-whichkey-label', text: isGroup ? child.label || '+more' : child.action?.label ?? '' });
    }
  }

  hide(): void {
    if (this.el) {
      this.el.remove();
      this.el = null;
    }
  }
}
