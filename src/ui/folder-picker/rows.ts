/*
 * What the Move to / Copy to picker lists, without any DOM: resolving typed paths, matching
 * the filter, and building the rows with their labels and notes.
 */
import { TFolder, normalizePath, type TAbstractFile } from 'obsidian';
import { joinPath } from '../../util/paths';

export type PickerMode = 'move' | 'copy';

/** What the picker chose: move into a folder, or to an exact new path (move and rename). */
export interface PickerTarget {
  kind: 'into' | 'exact';
  path: string;
}

export type PickerRow =
  | { kind: 'here'; label: string; folder: TFolder; disabled: boolean; note: string }
  | { kind: 'up'; label: string }
  | { kind: 'folder'; label: string; folder: TFolder; disabled: boolean; note: string; warn: boolean; match: Match | null }
  | { kind: 'newFolder'; label: string; path: string; disabled: boolean; note: string }
  | { kind: 'rename'; label: string; path: string; disabled: boolean; note: string };

/** The part of a folder name that matched the filter, for highlighting. */
export interface Match {
  start: number;
  length: number;
}

/** The vault lookups the picker needs. */
export interface FolderLookup {
  root: TFolder;
  get(path: string): TAbstractFile | null;
}

export interface RowsInput {
  /** The file or folder being moved / copied. */
  item: TAbstractFile;
  mode: PickerMode;
  /** The folder being browsed. */
  folder: TFolder;
  /** What is typed in the input (after any folder part has been navigated into). */
  query: string;
  vault: FolderLookup;
}

const COLLATOR = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

export const folderPath = (folder: TFolder): string => (folder.isRoot() ? '/' : folder.path);

export const isDisabled = (row: PickerRow): boolean => row.kind !== 'up' && row.disabled;

export function subfolders(folder: TFolder): TFolder[] {
  return folder.children
    .filter((c): c is TFolder => c instanceof TFolder)
    .sort((a, b) => COLLATOR.compare(a.name, b.name));
}

/** Resolves a typed path against `from`: "/x" starts at the vault root, ".." and "." work. "" is the root. */
export function resolvePath(from: TFolder, typed: string): string {
  const parts = typed.startsWith('/') || from.isRoot() ? [] : from.path.split('/');
  for (const seg of typed.split('/')) {
    if (!seg || seg === '.') continue;
    if (seg === '..') parts.pop();
    else parts.push(seg);
  }
  return parts.join('/');
}

export function folderAt(vault: FolderLookup, path: string): TFolder | null {
  if (!path) return vault.root;
  const f = vault.get(normalizePath(path));
  return f instanceof TFolder ? f : null;
}

/** True when `item` is a folder and `path` is that folder or inside it, so it cannot go there. */
export function isInsideItself(item: TAbstractFile, path: string): boolean {
  return item instanceof TFolder && (path + '/').startsWith(item.path + '/');
}

/**
 * How well a folder name matches the filter: 0 starts with it, 1 contains it, 2 has its letters
 * in order; null for no match. `match` is the highlighted part (none for the letters-in-order case).
 */
export function matchFolderName(name: string, filter: string): { score: number; match: Match | null } | null {
  const n = name.toLowerCase();
  if (!filter) return { score: 0, match: null };
  if (n.startsWith(filter)) return { score: 0, match: { start: 0, length: filter.length } };
  const at = n.indexOf(filter);
  if (at >= 0) return { score: 1, match: { start: at, length: filter.length } };
  if (isSubsequence(filter, n)) return { score: 2, match: null };
  return null;
}

function isSubsequence(needle: string, hay: string): boolean {
  let j = 0;
  for (let i = 0; i < hay.length && j < needle.length; i++) if (hay[i] === needle[j]) j++;
  return j === needle.length;
}

export function buildRows({ item, mode, folder, query, vault }: RowsInput): PickerRow[] {
  const verb = mode === 'move' ? 'move' : 'copy';
  const typed = query.trim();
  const rows: PickerRow[] = [];
  const isCurrent = (f: TFolder) => mode === 'move' && (item.parent || vault.root) === f;
  // An item with the same name is already there.
  const nameTaken = (f: TFolder) => !!vault.get(joinPath(folderPath(f), item.name));

  // "move here" and "..", shown while nothing is typed.
  if (!typed) {
    const blocked = isInsideItself(item, folderPath(folder));
    const note = blocked ? 'inside itself' : isCurrent(folder) ? 'current' : '';
    rows.push({ kind: 'here', label: verb + ' here', folder, disabled: blocked, note });
    if (!folder.isRoot()) rows.push({ kind: 'up', label: '..' });
  }

  // Subfolders matching the filter. A "/" left in the query means its folder part doesn't exist.
  if (!query.includes('/')) {
    const filter = typed.toLowerCase();
    const matches = subfolders(folder)
      .map((f) => ({ f, m: matchFolderName(f.name, filter) }))
      .filter((x): x is { f: TFolder; m: { score: number; match: Match | null } } => x.m !== null)
      .sort((a, b) => a.m.score - b.m.score);
    for (const { f, m } of matches) {
      const blocked = isInsideItself(item, f.path);
      const taken = !blocked && nameTaken(f);
      let note = '';
      if (blocked) note = f === item ? 'this folder' : 'inside itself';
      else if (isCurrent(f)) note = 'current';
      else if (taken) note = 'name taken';
      rows.push({ kind: 'folder', label: f.name, folder: f, disabled: blocked, note, warn: taken, match: m.match });
    }
  }

  // A typed path that doesn't exist yet: create it, or move and rename.
  if (typed && typed !== '.' && typed !== '..') {
    const target = resolvePath(folder, typed);
    if (target && !vault.get(normalizePath(target))) {
      const blocked = isInsideItself(item, target);
      rows.push({ kind: 'newFolder', label: '+ ' + target + '/', path: target, disabled: blocked, note: blocked ? 'inside itself' : 'new folder' });
      if (!typed.endsWith('/')) rows.push({ kind: 'rename', label: '→ ' + target, path: target, disabled: blocked, note: 'rename' });
    }
  }
  return rows;
}

/**
 * Which row starts selected: the folder we just came up from, else the first row that matches
 * the filter, else "move here" unless it would do nothing, else the first folder, else "..".
 */
export function defaultSelection(rows: PickerRow[], cameFrom: TFolder | null, filtering: boolean): number {
  const find = (pred: (r: PickerRow) => boolean) => rows.findIndex(pred);
  const enabled = (r: PickerRow) => !isDisabled(r);

  let sel = cameFrom ? find((r) => r.kind === 'folder' && r.folder === cameFrom) : -1;
  if (sel < 0 && filtering) sel = find(enabled);
  if (sel < 0) sel = find((r) => r.kind === 'here' && !r.disabled && !r.note);
  if (sel < 0) sel = find((r) => r.kind === 'folder' && !r.disabled);
  if (sel < 0) sel = find((r) => r.kind === 'up');
  if (sel < 0) sel = find(enabled);
  return Math.max(0, sel);
}

/** What choosing a row does. */
export function rowTarget(row: PickerRow): PickerTarget | 'up' | null {
  if (isDisabled(row)) return null;
  switch (row.kind) {
    case 'up':
      return 'up';
    case 'here':
    case 'folder':
      return { kind: 'into', path: folderPath(row.folder) };
    case 'newFolder':
      return { kind: 'into', path: row.path };
    case 'rename':
      return { kind: 'exact', path: row.path };
  }
}
