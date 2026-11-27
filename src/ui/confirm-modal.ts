import { Modal, type App } from 'obsidian';

export interface ConfirmOptions {
  title: string;
  message: string;
  confirmText?: string;
  onConfirm(): void;
  onCancel?(): void;
}

/** A yes / no question. Enter or y confirms, Esc or n cancels. */
export class ConfirmModal extends Modal {
  private confirmed = false;

  constructor(app: App, private readonly opts: ConfirmOptions) {
    super(app);
  }

  override onOpen(): void {
    const { contentEl, opts } = this;
    this.titleEl.setText(opts.title);
    contentEl.createDiv({ text: opts.message });
    contentEl.createDiv({ cls: 'vmk-confirm-hint', text: 'enter / y to confirm · esc / n to cancel' });

    const buttons = contentEl.createDiv({ cls: 'vmk-confirm-buttons' });
    buttons.createEl('button', { text: 'Cancel' }).addEventListener('click', () => this.close());
    buttons
      .createEl('button', { text: opts.confirmText || 'Delete', cls: 'mod-warning' })
      .addEventListener('click', () => this.confirm());

    const yes = () => {
      this.confirm();
      return false;
    };
    const no = () => {
      this.close();
      return false;
    };
    this.scope.register([], 'Enter', yes);
    this.scope.register([], 'y', yes);
    this.scope.register([], 'n', no);
  }

  private confirm(): void {
    this.confirmed = true;
    this.close();
    this.opts.onConfirm();
  }

  override onClose(): void {
    this.contentEl.empty();
    if (!this.confirmed && this.opts.onCancel) this.opts.onCancel();
  }
}
