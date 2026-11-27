export type VimMode = 'normal' | 'insert' | 'visual';
export type CursorStyle = 'fill' | 'outline' | 'bar';

export interface VimMapping {
  mode: VimMode;
  lhs: string;
  rhs: string;
}

export interface VimoaseSettings {
  explorerKeys: boolean;
  explorerClickKeepsFocus: boolean;
  yankToClipboard: boolean;
  whichKeyDelay: number;
  sequenceTimeout: number;
  ambiguousTimeout: number;
  cursorEnabled: boolean;
  cursorColor: string;
  cursorStyle: CursorStyle;
  cursorStrength: number;
  /** Action id → keys, for actions whose keys differ from the defaults. */
  keymap: Record<string, string[]>;
  wrapAppend: boolean;
  vimMaps: VimMapping[];
}

export const DEFAULT_VIM_MAPS: readonly VimMapping[] = [
  { mode: 'insert', lhs: 'jk', rhs: '<Esc>' },
  { mode: 'normal', lhs: ';', rhs: ':' },
  // Move by visual (wrapped) lines instead of logical lines.
  { mode: 'normal', lhs: '$', rhs: 'g$' },
  { mode: 'normal', lhs: '0', rhs: 'g0' },
  { mode: 'normal', lhs: 'j', rhs: 'gj' },
  { mode: 'normal', lhs: 'k', rhs: 'gk' },
  { mode: 'normal', lhs: 'I', rhs: 'g0i' },
  { mode: 'visual', lhs: '$', rhs: 'g$' },
  { mode: 'visual', lhs: '0', rhs: 'g0' },
  { mode: 'visual', lhs: 'j', rhs: 'gj' },
  { mode: 'visual', lhs: 'k', rhs: 'gk' },
];

export const DEFAULT_SETTINGS: Readonly<VimoaseSettings> = {
  explorerKeys: true,
  explorerClickKeepsFocus: true,
  yankToClipboard: true,
  whichKeyDelay: 200,
  sequenceTimeout: 0,
  ambiguousTimeout: 400,
  cursorEnabled: true,
  cursorColor: '#7aa2f7',
  cursorStyle: 'fill',
  cursorStrength: 30,
  keymap: {},
  wrapAppend: true,
  vimMaps: [...DEFAULT_VIM_MAPS],
};

export const defaultVimMaps = (): VimMapping[] => DEFAULT_VIM_MAPS.map((m) => ({ ...m }));

/** Saved data (possibly from an older version) → complete settings. */
export function migrateSettings(saved: unknown): VimoaseSettings {
  const data: Record<string, unknown> = saved && typeof saved === 'object' ? { ...(saved as Record<string, unknown>) } : {};
  // Vimakase's "Clipboard keys" setting became "Yank to system clipboard".
  if (data.clipboardKeys === false && data.yankToClipboard === undefined) data.yankToClipboard = false;
  delete data.clipboardKeys;

  const settings = { ...DEFAULT_SETTINGS, ...data } as VimoaseSettings;
  settings.keymap = { ...((data.keymap as Record<string, string[]> | undefined) || {}) };
  // Fresh copies, so editing mappings never changes the defaults.
  settings.vimMaps = Array.isArray(data.vimMaps) ? (data.vimMaps as VimMapping[]) : defaultVimMaps();
  return settings;
}
