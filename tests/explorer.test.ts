import { describe, expect, it } from 'vitest';
import type { WorkspaceLeaf } from 'obsidian';
import { resolveCreate, type CreateType } from '../src/explorer/create-types';
import { KeepFocusOnClick } from '../src/explorer/keep-focus';
import { UndoStack } from '../src/explorer/undo';
import type { ExplorerView } from '../src/obsidian-internals';
import { makeVault } from './helpers/vault';

const MB = 1024 * 1024;

describe('UndoStack', () => {
  it('caps the number of entries', () => {
    const undo = new UndoStack(3);
    for (let i = 0; i < 5; i++) undo.push('op ' + i, () => undefined);
    expect(undo.labels()).toEqual(['op 2', 'op 3', 'op 4']);
  });

  it('drops the oldest memory-holding entries over the memory limit, never the newest', () => {
    const undo = new UndoStack(100, 200 * MB);
    for (let i = 0; i < 6; i++) undo.push('delete ' + i, () => undefined, 45 * MB);
    undo.push('rename', () => undefined);
    expect(undo.labels()).toEqual(['delete 2', 'delete 3', 'delete 4', 'delete 5', 'rename']);
    expect(undo.bytes).toBe(180 * MB);

    const big = new UndoStack(100, 200 * MB);
    big.push('huge', () => undefined, 300 * MB);
    expect(big.size).toBe(1);
  });
});

describe('resolveCreate', () => {
  const types: CreateType[] = [
    { id: 'note', label: 'Note', keys: [], ext: '.md' },
    { id: 'folder', label: 'Folder', keys: ['/'], folder: true },
    { id: 'foldernote', label: 'Folder + folder note', keys: ['//'], folder: true, folderNote: true },
    { id: 'canvas', label: 'Canvas', keys: ['.canvas', '.cv'], ext: '.canvas' },
    { id: 'excalidraw', label: 'Excalidraw', keys: ['.excalidraw.md', '.excalidraw', '.ex'], ext: '.excalidraw.md' },
  ];
  const plan = (raw: string, folderOnly = false) => resolveCreate(raw, 'Notes', types, folderOnly, (p) => p + '/' + p.split('/').pop() + '.md');

  it.each([
    ['idea', 'note', 'Notes/idea.md'],
    ['idea.md', 'note', 'Notes/idea.md'],
    ['ideas/', 'folder', 'Notes/ideas'],
    ['board.cv', 'canvas', 'Notes/board.canvas'],
    ['sketch.ex', 'excalidraw', 'Notes/sketch.excalidraw.md'],
    ['sketch.excalidraw.md', 'excalidraw', 'Notes/sketch.excalidraw.md'],
    ['a/b/c', 'note', 'Notes/a/b/c.md'],
    ['data.json', 'other', 'Notes/data.json'],
  ])('%s → %s at %s', (raw, typeId, path) => {
    expect(plan(raw)).toMatchObject({ type: { id: typeId }, path });
  });

  it('adds the folder note for name//', () => {
    expect(plan('Topic//')).toMatchObject({ type: { id: 'foldernote' }, path: 'Notes/Topic', notePath: 'Notes/Topic/Topic.md' });
  });

  it('treats everything as a folder in folder-only mode', () => {
    expect(plan('a.cv', true)).toMatchObject({ type: { id: 'folder' }, path: 'Notes/a.cv' });
    expect(plan('  ')).toBeNull();
  });
});

describe('KeepFocusOnClick', () => {
  const vault = makeVault(['Notes/a.md', 'Notes/b.md']);
  const el = (zone: string) => ({ zone, closest: () => null, contains: (x: { zone?: string } | null) => !!x && x.zone === zone });

  function setup(enabled = true) {
    const row = { getAttribute: (k: string) => (k === 'data-path' ? 'Notes/a.md' : null) };
    const explorerEl = el('explorer');
    const explorer = { view: { containerEl: explorerEl } } as unknown as WorkspaceLeaf;
    const noteA = { view: { containerEl: el('a'), file: vault.file('Notes/a.md') } } as unknown as WorkspaceLeaf;
    const noteB = { view: { containerEl: el('b'), file: vault.file('Notes/b.md') } } as unknown as WorkspaceLeaf;
    const focused: string[] = [];
    const keep = new KeepFocusOnClick({
      enabled: () => enabled,
      explorerLeaf: () => explorer,
      getFile: (p) => vault.get(p),
      leaves: () => [explorer, noteA, noteB],
      focusExplorerOn: (p) => focused.push(p),
    });
    const view = { fileItems: {} } as unknown as ExplorerView;
    const click = (mods: Partial<MouseEvent> = {}) =>
      keep.onExplorerClick(view, {
        button: 0,
        shiftKey: false,
        ctrlKey: false,
        metaKey: false,
        altKey: false,
        target: { closest: (sel: string) => (sel === '.tree-item-self' ? row : null) },
        ...mods,
      } as unknown as MouseEvent);
    const focusInto = (leaf: WorkspaceLeaf) => keep.onFocusIn({ target: (leaf as unknown as { view: { containerEl: unknown } }).view.containerEl } as unknown as FocusEvent);
    return { keep, click, focusInto, focused, noteA, noteB };
  }

  it('sends focus back each time Obsidian focuses the clicked note, until the next input', () => {
    const { keep, click, focusInto, focused, noteA } = setup();
    click();
    focusInto(noteA);
    focusInto(noteA); // Obsidian focuses again after the note loads
    expect(focused).toEqual(['Notes/a.md', 'Notes/a.md']);
    keep.end(); // the user presses a key or the mouse
    focusInto(noteA);
    expect(focused).toHaveLength(2);
  });

  it('ignores focus moving into a different note', () => {
    const { click, focusInto, focused, noteB } = setup();
    click();
    focusInto(noteB);
    expect(focused).toEqual([]);
  });

  it('ignores modifier clicks and the setting being off', () => {
    const a = setup();
    a.click({ metaKey: true });
    a.focusInto(a.noteA);
    expect(a.focused).toEqual([]);
    const off = setup(false);
    off.click();
    off.focusInto(off.noteA);
    expect(off.focused).toEqual([]);
  });
});
