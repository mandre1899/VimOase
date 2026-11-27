import type { TAbstractFile as Abstract, TFile as File, TFolder as Folder } from 'obsidian';
import { TFile, TFolder } from '../stubs/obsidian';

export interface FakeVault {
  root: Folder;
  get(path: string): Abstract | null;
  folder(path: string): Folder;
  file(path: string): File;
}

/**
 * Builds a vault from paths: "a/b/" is a folder, anything else a file; parents are created as
 * needed. Returns stub objects typed as Obsidian's classes.
 */
export function makeVault(paths: string[]): FakeVault {
  const root = new TFolder('/', null);
  const byPath = new Map<string, TFolder | TFile>([['/', root]]);

  const ensureFolder = (path: string): TFolder => {
    if (!path) return root;
    const existing = byPath.get(path);
    if (existing instanceof TFolder) return existing;
    const slash = path.lastIndexOf('/');
    const parent = ensureFolder(slash < 0 ? '' : path.slice(0, slash));
    const folder = new TFolder(path, parent);
    byPath.set(path, folder);
    return folder;
  };

  for (const p of paths) {
    if (p.endsWith('/')) {
      ensureFolder(p.slice(0, -1));
      continue;
    }
    const slash = p.lastIndexOf('/');
    const parent = ensureFolder(slash < 0 ? '' : p.slice(0, slash));
    byPath.set(p, new TFile(p, parent));
  }

  const get = (path: string) => (byPath.get(path) ?? null) as unknown as Abstract | null;
  return {
    root: root as unknown as Folder,
    get,
    folder: (path) => {
      const f = byPath.get(path);
      if (!(f instanceof TFolder)) throw new Error('no folder ' + path);
      return f as unknown as Folder;
    },
    file: (path) => {
      const f = byPath.get(path);
      if (!(f instanceof TFile)) throw new Error('no file ' + path);
      return f as unknown as File;
    },
  };
}
