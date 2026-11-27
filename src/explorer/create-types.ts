/*
 * What the explorer's `a` prompt can create, and how a typed name maps to one of them:
 * "name" → note, "name/" → folder, "name//" → folder + folder note, "name.cv" → canvas, …
 */
import type { App } from 'obsidian';
import { appInternals } from '../obsidian-internals';
import { basename, dirname, hasExtension, joinPath } from '../util/paths';

export interface CreateType {
  id: string;
  label: string;
  /** Suffixes typed at the end of the name that pick this type (case-insensitive). */
  keys: string[];
  example?: string;
  /** Extension the created file gets. */
  ext?: string;
  folder?: boolean;
  folderNote?: boolean;
  content?(): string | Promise<string>;
}

export interface CreatePlan {
  type: CreateType;
  path: string;
  /** For "name//": the folder note created inside the new folder. */
  notePath?: string;
}

const BLANK_EXCALIDRAW_JSON = JSON.stringify(
  {
    type: 'excalidraw',
    version: 2,
    source: 'https://github.com/zsviczian/obsidian-excalidraw-plugin',
    elements: [],
    appState: { gridSize: null, viewBackgroundColor: '#ffffff' },
    files: {},
  },
  null,
  '\t',
);

const BLANK_EXCALIDRAW_MD = [
  '---\n\nexcalidraw-plugin: parsed\ntags: [excalidraw]\n\n---\n',
  "==⚠  Switch to EXCALIDRAW VIEW in the MORE OPTIONS menu of this document. ⚠== You can decompress Drawing data with the command palette: 'Decompress current Excalidraw file'. For more info check in plugin settings under 'Saving'\n\n",
  '# Excalidraw Data\n\n## Text Elements\n%%\n## Drawing\n```json\n' + BLANK_EXCALIDRAW_JSON + '\n```\n%%',
].join('');

interface ExcalidrawPlugin {
  settings?: { compatibilityMode?: boolean };
  getBlankDrawing?(): Promise<unknown>;
}

interface SpacedRepetitionPlugin {
  settings?: { flashcardTags?: string[] };
  data?: { settings?: { flashcardTags?: string[] } };
}

interface FolderNotesPlugin {
  settings?: { folderNoteName?: string; folderNoteType?: string; storageLocation?: string };
}

/** The types available in this vault, depending on which plugins are enabled. */
export function createTypes(app: App): CreateType[] {
  const { plugins, internalPlugins } = appInternals(app);
  const enabled = (id: string) => !!plugins?.enabledPlugins?.has(id);
  const plugin = <T>(id: string) => plugins?.plugins?.[id] as T | undefined;
  const coreEnabled = (id: string) => {
    const p = internalPlugins?.getPluginById?.(id);
    return !p || p.enabled !== false;
  };

  const types: CreateType[] = [
    { id: 'note', label: 'Note', keys: [], example: 'name', ext: '.md', content: () => '' },
    { id: 'folder', label: 'Folder', keys: ['/'], example: 'name/', folder: true },
  ];

  if (enabled('folder-notes')) {
    types.push({ id: 'foldernote', label: 'Folder + folder note', keys: ['//'], example: 'name//', folder: true, folderNote: true });
  }
  if (coreEnabled('canvas')) {
    types.push({ id: 'canvas', label: 'Canvas', keys: ['.canvas', '.cv'], ext: '.canvas', content: () => '{"nodes":[],"edges":[]}' });
  }
  if (enabled('obsidian-excalidraw-plugin')) {
    const ex = plugin<ExcalidrawPlugin>('obsidian-excalidraw-plugin');
    const compat = !!ex?.settings?.compatibilityMode;
    types.push({
      id: 'excalidraw',
      label: 'Excalidraw drawing',
      keys: ['.excalidraw.md', '.excalidraw', '.exd', '.ex'],
      ext: compat ? '.excalidraw' : '.excalidraw.md',
      content: async () => {
        if (!compat && typeof ex?.getBlankDrawing === 'function') {
          try {
            const drawing = await ex.getBlankDrawing();
            if (typeof drawing === 'string') return drawing;
          } catch (e) {
            console.warn('vimoase: excalidraw template', e);
          }
        }
        return compat ? BLANK_EXCALIDRAW_JSON : BLANK_EXCALIDRAW_MD;
      },
    });
  }
  if (enabled('obsidian-spaced-repetition')) {
    const sr = plugin<SpacedRepetitionPlugin>('obsidian-spaced-repetition');
    const tags = sr?.data?.settings?.flashcardTags || sr?.settings?.flashcardTags;
    const tag = (Array.isArray(tags) && tags[0]) || '#flashcards';
    types.push({ id: 'flashcards', label: `Flashcards (${tag})`, keys: ['.flashcards', '.cards', '.fc'], ext: '.md', content: () => tag + '\n\n' });
  }
  if (coreEnabled('bases')) {
    types.push({ id: 'base', label: 'Base', keys: ['.base', '.db'], ext: '.base', content: () => 'views:\n  - type: table\n    name: Table\n' });
  }
  return types;
}

/** Where the Folder Notes plugin expects the note for a folder. */
export function folderNotePath(app: App, folderPath: string): string {
  const s = appInternals(app).plugins?.plugins?.['folder-notes'] as FolderNotesPlugin | undefined;
  const settings = s?.settings || {};
  const name = basename(folderPath);
  const noteName = String(settings.folderNoteName || '{{folder_name}}').replace(/\{\{folder_name\}\}/g, name);
  let ext = String(settings.folderNoteType || '.md');
  if (!ext.startsWith('.')) ext = '.' + ext;
  if (ext === '.excalidraw') ext = '.excalidraw.md';
  const dir = settings.storageLocation === 'parentFolder' ? dirname(folderPath) : folderPath;
  return joinPath(dir, noteName + ext);
}

/**
 * Parses what was typed in the `a` prompt, inside the folder `basePath`.
 * `notePathFor` gives the folder-note path for "name//".
 */
export function resolveCreate(
  raw: string,
  basePath: string,
  types: CreateType[],
  folderOnly: boolean,
  notePathFor: (folderPath: string) => string,
): CreatePlan | null {
  const typed = raw.trim();
  if (!typed) return null;
  const folderType = types.find((t) => t.id === 'folder');
  const noteType = types.find((t) => t.id === 'note');
  if (!folderType || !noteType) return null;
  const inBase = (rel: string) => joinPath(basePath, rel);
  const withoutSlashes = typed.replace(/\/+$/, '');

  if (folderOnly) return { type: folderType, path: inBase(withoutSlashes) };
  if (typed.endsWith('//')) {
    const folderNoteType = types.find((t) => t.folderNote);
    if (folderNoteType) {
      const path = inBase(withoutSlashes);
      return { type: folderNoteType, path, notePath: notePathFor(path) };
    }
  }
  if (typed.endsWith('/')) return { type: folderType, path: inBase(withoutSlashes) };

  // The longest matching suffix wins (".excalidraw.md" over ".md").
  const lower = typed.toLowerCase();
  let match: { type: CreateType; key: string } | null = null;
  for (const t of types) {
    for (const k of t.keys) {
      const isSuffix = k.startsWith('.') && lower.endsWith(k);
      const hasName = typed.length > k.length && typed[typed.length - k.length - 1] !== '/';
      if (!isSuffix || !hasName) continue;
      if (!match || k.length > match.key.length) match = { type: t, key: k };
    }
  }
  if (match) {
    const stem = typed.slice(0, typed.length - match.key.length);
    return { type: match.type, path: inBase(stem + (match.type.ext || '')) };
  }

  const path = inBase(typed);
  const name = basename(path);
  if (hasExtension(name)) {
    const ext = name.slice(name.lastIndexOf('.')).toLowerCase();
    if (ext === '.md') return { type: noteType, path };
    return { type: { id: 'other', label: ext.slice(1).toUpperCase() + ' file', keys: [], content: () => '' }, path };
  }
  return { type: noteType, path: path + '.md' };
}
