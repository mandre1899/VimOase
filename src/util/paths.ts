import { normalizePath } from 'obsidian';

/** "a/b/c.md" → "a/b"; "c.md" → "". */
export function dirname(path: string): string {
  const i = path.lastIndexOf('/');
  return i < 0 ? '' : path.slice(0, i);
}

/** "a/b/c.md" → "c.md". */
export function basename(path: string): string {
  const i = path.lastIndexOf('/');
  return i < 0 ? path : path.slice(i + 1);
}

/** True for "note.md" or "a.tar.gz", false for "note", ".hidden" or "folder.". */
export function hasExtension(name: string): boolean {
  return /\.[^./\s]+$/.test(name) && !name.startsWith('.');
}

/** Joins a folder path ("/" or "" is the vault root) and a relative path. */
export function joinPath(folderPath: string, rel: string): string {
  if (!folderPath || folderPath === '/') return normalizePath(rel);
  return normalizePath(folderPath + '/' + rel);
}

/** 1536000 → "1.5 MB", 52428800 → "50 MB". */
export function formatMB(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  return mb.toFixed(mb < 10 ? 1 : 0) + ' MB';
}
