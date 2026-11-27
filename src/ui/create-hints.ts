import type { CreatePlan, CreateType } from '../explorer/create-types';
import { basename } from '../util/paths';

export interface CreateHintsInput {
  plan: CreatePlan | null;
  exists: boolean;
  types: CreateType[];
  folderOnly: boolean;
}

/** The live preview under the `a` prompt: what will be created, and the type shortcuts. */
export function renderCreateHints(el: HTMLElement, { plan, exists, types, folderOnly }: CreateHintsInput): void {
  el.empty();
  const preview = el.createDiv({ cls: 'vmk-create-preview' });
  if (!plan) {
    preview.addClass('is-empty');
    preview.setText(folderOnly ? 'Type a folder name (a/b/c creates nested folders)' : 'Type a name, then optionally a shortcut from below');
  } else {
    preview.toggleClass('is-error', exists);
    preview.createSpan({ cls: 'vmk-create-arrow', text: '→ ' });
    preview.createSpan({ cls: 'vmk-create-path', text: plan.path + (plan.type.folder ? '/' : '') });
    if (plan.notePath) preview.createSpan({ cls: 'vmk-create-path', text: ' + ' + basename(plan.notePath) });
    preview.createSpan({ cls: 'vmk-create-kind', text: exists ? 'already exists' : plan.type.label });
  }
  if (folderOnly) return;

  const table = el.createDiv({ cls: 'vmk-create-types' });
  for (const t of types) {
    const row = table.createDiv({ cls: 'vmk-create-type' + (plan && plan.type.id === t.id ? ' is-active' : '') });
    const keys = row.createDiv({ cls: 'vmk-create-type-keys' });
    if (t.keys.length) for (const k of t.keys) keys.createEl('kbd', { text: k });
    else keys.createSpan({ cls: 'vmk-create-type-none', text: 'no suffix' });
    row.createDiv({ cls: 'vmk-create-type-label', text: t.label });
    row.createDiv({ cls: 'vmk-create-type-example', text: t.example || 'name' + t.keys[t.keys.length - 1] });
  }
  el.createDiv({
    cls: 'vmk-create-footnote',
    text: 'Any other extension (name.txt, name.json…) creates that file as-is. Use a/b/name to create inside new subfolders. Enter creates · Esc cancels.',
  });
}
