import { Modal, type App } from 'obsidian';

export interface PromptOptions {
  title: string;
  desc?: string;
  value?: string;
  placeholder?: string;
  /** Initial selection [start, end] in the input; otherwise the cursor goes to the end. */
  select?: [number, number];
  /** Redraws the area under the input on every change, e.g. a live preview. */
  render?(value: string, el: HTMLElement): void;
  onSubmit(value: string): void;
  onCancel?(): void;
}

/** A one-line text prompt. Enter submits, Esc cancels. */
export class PromptModal extends Modal {
  private submitted = false;

  constructor(app: App, private readonly opts: PromptOptions) {
    super(app);
  }

  override onOpen(): void {
    const { contentEl, opts } = this;
    this.titleEl.setText(opts.title);
    if (opts.desc) contentEl.createDiv({ cls: 'vmk-prompt-desc', text: opts.desc });
    const input = contentEl.createEl('input', { type: 'text', cls: 'vmk-prompt-input' });
    input.value = opts.value || '';
    input.placeholder = opts.placeholder || '';

    const render = opts.render;
    if (render) {
      const extra = contentEl.createDiv({ cls: 'vmk-prompt-extra' });
      const update = () => render(input.value, extra);
      input.addEventListener('input', update);
      update();
    }

    input.addEventListener('keydown', (ev) => {
      if (ev.key !== 'Enter' || ev.isComposing) return;
      ev.preventDefault();
      this.submitted = true;
      const value = input.value;
      this.close();
      opts.onSubmit(value);
    });

    window.setTimeout(() => {
      input.focus();
      const [start, end] = opts.select || [input.value.length, input.value.length];
      input.setSelectionRange(start, end);
    }, 0);
  }

  override onClose(): void {
    this.contentEl.empty();
    if (!this.submitted && this.opts.onCancel) this.opts.onCancel();
  }
}
