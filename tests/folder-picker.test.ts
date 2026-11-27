import { describe, expect, it } from 'vitest';
import { buildRows, defaultSelection, resolvePath, rowTarget, type PickerRow } from '../src/ui/folder-picker/rows';
import { makeVault } from './helpers/vault';

const vault = makeVault([
  'Notes/a.md',
  'Notes/Sub/',
  'Notes/Daily/',
  'Projects/a.md',
  'Projects/2024/',
  'Archive/',
]);

const labels = (rows: PickerRow[]) => rows.map((r) => r.label + ('note' in r && r.note ? ` (${r.note})` : ''));

describe('resolvePath', () => {
  const notes = vault.folder('Notes');
  it.each([
    ['Sub', 'Notes/Sub'],
    ['../Projects', 'Projects'],
    ['/Archive/x', 'Archive/x'],
    ['..', ''],
    ['./Daily/', 'Notes/Daily'],
  ])('%s from Notes → %s', (typed, expected) => {
    expect(resolvePath(notes, typed)).toBe(expected);
  });
});

describe('buildRows', () => {
  const file = vault.file('Notes/a.md');

  it('lists only the browsed folder: here, .., then subfolders sorted', () => {
    const rows = buildRows({ item: file, mode: 'move', folder: vault.folder('Notes'), query: '', vault });
    expect(labels(rows)).toEqual(['move here (current)', '..', 'Daily', 'Sub']);
  });

  it('does not mark the item’s own folder as "name taken"', () => {
    const rows = buildRows({ item: file, mode: 'move', folder: vault.root, query: '', vault });
    const notes = rows.find((r) => r.label === 'Notes');
    expect(notes && 'note' in notes && notes.note).toBe('current');
    expect(notes && notes.kind === 'folder' && notes.warn).toBe(false);
    // Projects already has an a.md.
    const projects = rows.find((r) => r.label === 'Projects');
    expect(projects && projects.kind === 'folder' && projects.warn).toBe(true);
  });

  it('filters: prefix matches first, then contains, then letters in order', () => {
    const rows = buildRows({ item: file, mode: 'move', folder: vault.root, query: 'r', vault });
    expect(rows.filter((r) => r.kind === 'folder').map((r) => r.label)).toEqual(['Archive', 'Projects']);
    const fuzzy = buildRows({ item: file, mode: 'move', folder: vault.root, query: 'pjt', vault });
    expect(fuzzy.filter((r) => r.kind === 'folder').map((r) => r.label)).toEqual(['Projects']);
  });

  it('offers to create a typed path that does not exist', () => {
    const rows = buildRows({ item: file, mode: 'move', folder: vault.folder('Notes'), query: 'new', vault });
    expect(labels(rows)).toEqual(['+ Notes/new/ (new folder)', '→ Notes/new (rename)']);
    expect(rowTarget(rows[0])).toEqual({ kind: 'into', path: 'Notes/new' });
    expect(rowTarget(rows[1])).toEqual({ kind: 'exact', path: 'Notes/new' });
  });

  it('never lets a folder move into itself', () => {
    const notes = vault.folder('Notes');
    const atRoot = buildRows({ item: notes, mode: 'move', folder: vault.root, query: '', vault });
    expect(atRoot.find((r) => r.label === 'Notes')).toMatchObject({ disabled: true, note: 'this folder' });
    const inside = buildRows({ item: notes, mode: 'move', folder: notes, query: '', vault });
    expect(inside.filter((r) => r.kind !== 'up').every((r) => 'disabled' in r && r.disabled)).toBe(true);
  });
});

describe('defaultSelection', () => {
  const file = vault.file('Notes/a.md');

  it('skips "move here" when it would do nothing', () => {
    const rows = buildRows({ item: file, mode: 'move', folder: vault.folder('Notes'), query: '', vault });
    expect(rows[defaultSelection(rows, null, false)].label).toBe('Daily');
  });

  it('picks ".." in a folder with no subfolders', () => {
    const sub = vault.folder('Notes/Sub');
    const fileInSub = makeVault(['Notes/Sub/b.md']);
    const rows = buildRows({ item: fileInSub.file('Notes/Sub/b.md'), mode: 'move', folder: fileInSub.folder('Notes/Sub'), query: '', vault: fileInSub });
    expect(rows[defaultSelection(rows, null, false)].label).toBe('..');
    expect(sub).toBeTruthy();
  });

  it('selects the folder we came up from', () => {
    const rows = buildRows({ item: file, mode: 'move', folder: vault.root, query: '', vault });
    expect(rows[defaultSelection(rows, vault.folder('Notes'), false)].label).toBe('Notes');
  });

  it('selects the first match while filtering', () => {
    const rows = buildRows({ item: file, mode: 'move', folder: vault.root, query: 'pro', vault });
    expect(rows[defaultSelection(rows, null, true)].label).toBe('Projects');
  });
});
