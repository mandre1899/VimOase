import { Modal } from 'obsidian';
import { CONTEXT_LABEL, type Action, type ContextName } from '../keys/keymap';
import { displaySeq } from '../keys/notation';
import type VimoasePlugin from '../main';

/** Every binding (or one context's), grouped and filterable. Opened by <leader>wK and g?. */
export class CheatsheetModal extends Modal {
  constructor(private readonly plugin: VimoasePlugin, private readonly onlyContext?: ContextName) {
    super(plugin.app);
  }

  override onOpen(): void {
    const { contentEl } = this;
    const keymap = this.plugin.keymap;
    this.modalEl.addClass('vmk-cheatsheet-modal');
    this.titleEl.setText(this.onlyContext ? 'Keys: ' + CONTEXT_LABEL[this.onlyContext] : 'All key bindings');
    const search = contentEl.createEl('input', { type: 'search', cls: 'vmk-cheatsheet-search', attr: { placeholder: 'Filter…' } });
    const list = contentEl.createDiv({ cls: 'vmk-cheatsheet' });

    const matches = (a: Action, q: string): boolean => {
      if (this.onlyContext && !a.contexts.includes(this.onlyContext)) return false;
      const keys = keymap.validSeqs(a.id);
      if (!keys.length) return false;
      return !q || (a.label + ' ' + keys.map(displaySeq).join(' ')).toLowerCase().includes(q);
    };

    const render = () => {
      list.empty();
      const q = search.value.trim().toLowerCase();
      for (const [group, actions] of keymap.groupedActions()) {
        const rows = actions.filter((a) => matches(a, q));
        if (!rows.length) continue;
        list.createEl('h4', { text: group });
        const table = list.createDiv({ cls: 'vmk-cheatsheet-table' });
        for (const a of rows) {
          const row = table.createDiv({ cls: 'vmk-cheatsheet-row' });
          const keys = row.createDiv({ cls: 'vmk-cheatsheet-keys' });
          for (const s of keymap.validSeqs(a.id)) keys.createEl('kbd', { text: displaySeq(s) });
          row.createDiv({ cls: 'vmk-cheatsheet-label', text: a.label });
          row.createDiv({ cls: 'vmk-cheatsheet-ctx', text: a.contexts.map((c) => CONTEXT_LABEL[c]).join(', ') });
        }
      }
      if (!list.childElementCount) list.createDiv({ cls: 'vmk-cheatsheet-empty', text: 'No bindings' });
    };

    search.addEventListener('input', render);
    render();
    window.setTimeout(() => search.focus(), 0);
  }

  override onClose(): void {
    this.contentEl.empty();
  }
}
