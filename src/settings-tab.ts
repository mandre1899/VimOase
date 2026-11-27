import { PluginSettingTab, Setting, type TextComponent } from 'obsidian';
import { CONTEXT_LABEL, type Action } from './keys/keymap';
import { displaySeq, parseSeq } from './keys/notation';
import type VimoasePlugin from './main';
import { vaultConfig } from './obsidian-internals';
import { DEFAULT_SETTINGS, defaultVimMaps, type CursorStyle, type VimMode, type VimoaseSettings } from './settings';

type NumberSetting = 'whichKeyDelay' | 'ambiguousTimeout' | 'sequenceTimeout';

export class VimoaseSettingTab extends PluginSettingTab {
  private filter = '';

  constructor(private readonly plugin: VimoasePlugin) {
    super(plugin.app, plugin);
  }

  override display(): void {
    const { containerEl } = this;
    const scroll = containerEl.scrollTop;
    containerEl.empty();
    containerEl.addClass('vmk-settings');

    const config = vaultConfig(this.app);
    if (typeof config.getConfig === 'function' && !config.getConfig('vimMode')) {
      containerEl.createEl('p', {
        cls: 'vmk-warning',
        text: 'Vim key bindings are off (Settings → Editor → Vim key bindings). Normal / visual / insert bindings and vim mappings need vim mode; explorer and other-view keys work without it.',
      });
    }

    this.renderGeneral(containerEl);
    this.renderCursor(containerEl);
    this.renderVimMaps(containerEl);
    this.renderKeyBindings(containerEl);
    containerEl.scrollTop = scroll;
  }

  override hide(): void {
    super.hide();
    this.plugin.explorer.sync();
  }

  private get s(): VimoaseSettings {
    return this.plugin.settings;
  }

  private changed(): void {
    this.plugin.settingsChanged();
  }

  private toggle(el: HTMLElement, name: string, desc: string, key: 'explorerKeys' | 'explorerClickKeepsFocus' | 'yankToClipboard' | 'cursorEnabled') {
    return new Setting(el).setName(name).setDesc(desc).addToggle((t) =>
      t.setValue(this.s[key]).onChange((v) => {
        this.s[key] = v;
        this.changed();
      }),
    );
  }

  private numberField(key: NumberSetting) {
    return (t: TextComponent) =>
      t.setValue(String(this.s[key])).onChange((v) => {
        const n = Number(v);
        if (Number.isFinite(n) && n >= 0) {
          this.s[key] = n;
          this.changed();
        }
      });
  }

  private renderGeneral(el: HTMLElement): void {
    new Setting(el).setName('General').setHeading();
    this.toggle(el, 'File explorer keys', 'Use the explorer bindings below while the file explorer is focused.', 'explorerKeys');
    this.toggle(
      el,
      'Keep focus in explorer after clicking a file',
      'Clicking a file still opens it, but keys stay in the file explorer (m, r, d … act on the clicked file). Click into the note or press Enter / l to edit it.',
      'explorerClickKeepsFocus',
    );
    this.toggle(el, 'Yank to system clipboard', 'y, yy, yw … into the unnamed register also go to the system clipboard. Deletes stay in vim registers.', 'yankToClipboard');
    new Setting(el).setName('Which-key popup delay').setDesc('Milliseconds before the popup with the next possible keys appears.').addText(this.numberField('whichKeyDelay'));
    new Setting(el)
      .setName('Ambiguous key timeout')
      .setDesc("When a binding is also the start of longer ones (e.g. <leader>x and <leader>xt), run it after this many milliseconds. Like Neovim's timeoutlen.")
      .addText(this.numberField('ambiguousTimeout'));
    new Setting(el)
      .setName('Key sequence timeout')
      .setDesc('Milliseconds before an unfinished sequence is cancelled (keys go back to vim). 0 waits forever.')
      .addText(this.numberField('sequenceTimeout'));
  }

  private renderCursor(el: HTMLElement): void {
    new Setting(el).setName('File explorer cursor').setHeading();
    this.toggle(el, 'Show cursor', 'Highlight the item that h / j / k / l moves.', 'cursorEnabled');
    new Setting(el)
      .setName('Cursor color')
      .addColorPicker((cp) =>
        cp.setValue(this.s.cursorColor).onChange((v) => {
          this.s.cursorColor = v;
          this.changed();
        }),
      )
      .addExtraButton((b) =>
        b.setIcon('rotate-ccw').setTooltip('Reset').onClick(() => {
          this.s.cursorColor = DEFAULT_SETTINGS.cursorColor;
          this.changed();
          this.display();
        }),
      );
    new Setting(el).setName('Cursor style').addDropdown((d) =>
      d
        .addOptions({ fill: 'Filled row', outline: 'Outline', bar: 'Left bar' })
        .setValue(this.s.cursorStyle)
        .onChange((v) => {
          this.s.cursorStyle = v as CursorStyle;
          this.changed();
        }),
    );
    new Setting(el)
      .setName('Fill strength')
      .setDesc('How strong the filled row is (filled style only).')
      .addSlider((sl) =>
        sl
          .setLimits(5, 100, 5)
          .setValue(this.s.cursorStrength)
          .setDynamicTooltip()
          .onChange((v) => {
            this.s.cursorStrength = v;
            this.changed();
          }),
      );
  }

  private renderVimMaps(el: HTMLElement): void {
    const plugin = this.plugin;
    const mapsChanged = (now: boolean) => {
      this.changed();
      if (now) plugin.vim.applyVimMaps();
      else plugin.requestVimMaps();
    };

    new Setting(el).setName('Vim mappings').setHeading().setDesc("Passed to Obsidian's vim (like :map in a vimrc). Good for insert-mode sequences such as jk.");
    new Setting(el)
      .setName('Shift+A appends at the end of the visual row')
      .setDesc('On soft-wrapped paragraphs, A types after the last word of the row you see instead of at the end of the paragraph.')
      .addToggle((t) =>
        t.setValue(this.s.wrapAppend).onChange((v) => {
          this.s.wrapAppend = v;
          mapsChanged(true);
        }),
      );

    this.s.vimMaps.forEach((m, i) => {
      new Setting(el)
        .setClass('vmk-vimmap')
        .addDropdown((d) =>
          d
            .addOptions({ normal: 'normal', insert: 'insert', visual: 'visual' })
            .setValue(m.mode || 'normal')
            .onChange((v) => {
              m.mode = v as VimMode;
              mapsChanged(false);
            }),
        )
        .addText((t) =>
          t.setPlaceholder('lhs, e.g. jk').setValue(m.lhs || '').onChange((v) => {
            m.lhs = v;
            mapsChanged(false);
          }),
        )
        .addText((t) =>
          t.setPlaceholder('rhs, e.g. <Esc>').setValue(m.rhs || '').onChange((v) => {
            m.rhs = v;
            mapsChanged(false);
          }),
        )
        .addExtraButton((b) =>
          b.setIcon('trash').setTooltip('Remove').onClick(() => {
            this.s.vimMaps.splice(i, 1);
            mapsChanged(true);
            this.display();
          }),
        );
    });

    new Setting(el)
      .addButton((b) =>
        b.setButtonText('Add mapping').onClick(() => {
          this.s.vimMaps.push({ mode: 'normal', lhs: '', rhs: '' });
          this.changed();
          this.display();
        }),
      )
      .addButton((b) =>
        b.setButtonText('Reset mappings').onClick(() => {
          this.s.vimMaps = defaultVimMaps();
          mapsChanged(true);
          this.display();
        }),
      );
  }

  private renderKeyBindings(el: HTMLElement): void {
    const plugin = this.plugin;
    const keymap = plugin.keymap;

    new Setting(el).setName('Key bindings').setHeading();
    const help = el.createDiv({ cls: 'vmk-help' });
    help.createEl('p', {
      text: 'Vim notation: <leader>ff, gd, ]t, <C-s>, <S-Tab>, <CR>, <Esc>, <BS>, <Tab>. Or with spaces: "space f f", "C-s". <leader> is Space. C = Ctrl, A/M = Alt, S = Shift, D = Cmd.',
    });
    help.createEl('p', { text: 'Insert mode and pickers only take bindings that start with Ctrl, Alt or Cmd, so typing is never blocked. Leave a field empty to unbind.' });

    if (keymap.conflicts.length) {
      const box = el.createDiv({ cls: 'vmk-warning' });
      box.createEl('strong', { text: 'Conflicts (the later one wins):' });
      const ul = box.createEl('ul');
      for (const c of keymap.conflicts) {
        ul.createEl('li', { text: `${displaySeq(c.seq)} in ${CONTEXT_LABEL[c.ctx]}: "${c.a.label}" vs "${c.b.label}"` });
      }
    }

    const listEl = createDiv();
    const renderList = () => {
      listEl.empty();
      const q = this.filter.trim().toLowerCase();
      for (const [group, actions] of keymap.groupedActions()) {
        const shown = actions.filter((a) => !q || (a.label + ' ' + keymap.keysFor(a.id).join(' ') + ' ' + group).toLowerCase().includes(q));
        if (!shown.length) continue;
        new Setting(listEl).setName(group).setHeading();
        for (const a of shown) this.renderAction(listEl, a, renderList);
      }
    };

    new Setting(el)
      .setName('Filter')
      .addSearch((sr) =>
        sr
          .setPlaceholder('Filter by name or key…')
          .setValue(this.filter)
          .onChange((v) => {
            this.filter = v;
            renderList();
          }),
      )
      .addButton((b) =>
        b
          .setButtonText('Reset all keys')
          .setWarning()
          .onClick(() => {
            this.s.keymap = {};
            keymap.rebuild();
            this.changed();
            this.display();
          }),
      );

    el.appendChild(listEl);
    renderList();
  }

  private renderAction(parent: HTMLElement, a: Action, rerender: () => void): void {
    const plugin = this.plugin;
    const keymap = plugin.keymap;
    const keys = keymap.keysFor(a.id).slice();
    const custom = Array.isArray(this.s.keymap[a.id]);
    const defaults = a.keys.length ? 'default: ' + a.keys.join(', ') : 'default: none';
    const setting = new Setting(parent)
      .setClass('vmk-binding')
      .setName(a.label + (custom ? ' •' : ''))
      .setDesc(a.contexts.map((c) => CONTEXT_LABEL[c]).join(' · ') + '   ' + defaults);
    const save = () => plugin.setKeys(a.id, keys);

    keys.forEach((k, i) => {
      setting.addText((t) => {
        t.setPlaceholder('<leader>…').setValue(k);
        t.inputEl.addClass('vmk-key-input');
        const validate = (v: string) => t.inputEl.toggleClass('vmk-invalid', !!v.trim() && !parseSeq(v));
        validate(k);
        t.onChange((v) => {
          keys[i] = v;
          validate(v);
          save();
        });
      });
    });

    setting.addExtraButton((b) =>
      b.setIcon('plus').setTooltip('Add key').onClick(() => {
        keys.push('');
        save();
        rerender();
      }),
    );
    if (keys.length) {
      setting.addExtraButton((b) =>
        b.setIcon('minus').setTooltip('Remove last key').onClick(() => {
          keys.pop();
          save();
          rerender();
        }),
      );
    }
    if (custom) {
      setting.addExtraButton((b) =>
        b.setIcon('rotate-ccw').setTooltip('Reset to default').onClick(() => {
          delete this.s.keymap[a.id];
          keymap.rebuild();
          plugin.settingsChanged();
          rerender();
        }),
      );
    }
  }
}
