/*
 * Types for the undocumented parts of Obsidian and CodeMirror that Vimoase uses.
 *
 * None of this is public API, so it can change in any Obsidian update. Every member is optional
 * or checked before use, and the rest of the code reaches these objects only through the
 * accessors at the bottom of this file.
 */
import type { App, TAbstractFile, View, WorkspaceLeaf } from 'obsidian';
import type { Pos, Range } from './util/positions';

/* ------------------------------------------------------------------ app */

export interface CommandRegistry {
  commands: Record<string, { name?: string }>;
  executeCommandById(id: string): boolean;
}

export interface InternalPlugin {
  enabled?: boolean;
  instance?: { openGlobalSearch?(query: string): void };
}

export interface CommunityPlugins {
  enabledPlugins?: Set<string>;
  plugins?: Record<string, unknown>;
}

export interface AppInternals {
  commands?: CommandRegistry;
  internalPlugins?: { getPluginById?(id: string): InternalPlugin | null };
  plugins?: CommunityPlugins;
}

export interface VaultConfig {
  getConfig?(key: string): unknown;
  setConfig?(key: string, value: unknown): void;
}

export interface VaultAdapterPaths {
  getFullPath?(path: string): string;
  basePath?: string;
}

/* ------------------------------------------------------------------ file explorer */

export interface FileItem {
  file: TAbstractFile;
  selfEl: HTMLElement;
  collapsed?: boolean;
  vChildren?: { children?: FileItem[]; _children?: FileItem[] };
  setCollapsed?(collapsed: boolean, animate: boolean): void;
  toggleCollapsed?(animate: boolean): void;
}

/** One key handler registered on an Obsidian Scope. */
export interface ScopeKey {
  key: string | null;
  modifiers?: string | null;
}

export interface ScopeInternals {
  keys: ScopeKey[];
  unregister?(handler: ScopeKey): void;
}

export interface ExplorerTree {
  focusedItem?: FileItem | null;
  setFocusedItem?(item: FileItem | null, scrollIntoView?: boolean): void;
  root?: FileItem;
  scope?: ScopeInternals;
  selectedDoms?: Set<FileItem>;
  activeDom?: FileItem | null;
  onKeyArrowDown?(e: KeyboardEvent): void;
  onKeyArrowUp?(e: KeyboardEvent): void;
  onKeyArrowLeft?(e: KeyboardEvent): void;
  onKeyArrowRight?(e: KeyboardEvent): void;
  setCollapseAll?(collapsed: boolean): void;
}

export interface ExplorerView {
  containerEl: HTMLElement;
  fileItems: Record<string, FileItem | undefined>;
  tree?: ExplorerTree;
  scope?: ScopeInternals | null;
  activeDom?: FileItem | null;
  requestSort?(): void;
  sort?(): void;
  revealInFolder?(file: TAbstractFile): void;
}

/* ------------------------------------------------------------------ CodeMirror vim */

export interface VimInputState {
  operator?: unknown;
  motion?: unknown;
  keyBuffer?: { length: number };
  prefixRepeat?: { length: number };
  motionRepeat?: { length: number };
  selectedCharacter?: unknown;
}

export interface VimState {
  insertMode?: boolean;
  visualMode?: boolean;
  visualLine?: boolean;
  visualBlock?: boolean;
  sel?: { anchor?: Pos; head?: Pos };
  inputState?: VimInputState;
}

/** The CodeMirror 5 style adapter that Obsidian's vim mode runs on. */
export interface CmAdapter {
  state: { vim?: VimState };
  getCursor(which?: 'head' | 'anchor'): Pos;
  setCursor(pos: Pos): void;
  getLine(line: number): string;
  lastLine(): number;
  somethingSelected(): boolean;
  listSelections(): Range[];
  getSelections(): string[];
  replaceRange(text: string, from: Pos, to?: Pos): void;
  replaceSelection(text: string): void;
  execCommand(name: string): void;
  operation?<T>(fn: () => T): T;
}

export interface RegisterController {
  pushText(registerName: string | null, operator: string, text: unknown, linewise?: boolean, ...rest: unknown[]): unknown;
}

export interface VimApi {
  handleKey(cm: CmAdapter, key: string): void;
  handleEx?(cm: CmAdapter, command: string): void;
  exitVisualMode(cm: CmAdapter): void;
  enterInsertMode(cm: CmAdapter): void;
  map?(lhs: string, rhs: string, mode: string): void;
  unmap?(lhs: string, mode: string): void;
  defineAction?(name: string, fn: (cm: CmAdapter) => void): void;
  mapCommand?(keys: string, type: string, name: string, args: object, extra: object): void;
  getRegisterController?(): RegisterController | null;
}

/* ------------------------------------------------------------------ fuzzy picker */

export interface SuggestChooser {
  values?: unknown[];
  selectedItem?: number;
  setSelectedItem?(index: number, event: Event | null): void;
  useSelectedItem?(event: KeyboardEvent): void;
}

/* ------------------------------------------------------------------ accessors */

export const appInternals = (app: App): AppInternals => app as unknown as AppInternals;
export const vaultConfig = (app: App): VaultConfig => app.vault as unknown as VaultConfig;
export const adapterPaths = (app: App): VaultAdapterPaths => app.vault.adapter as unknown as VaultAdapterPaths;
export const asExplorerView = (view: View): ExplorerView => view as unknown as ExplorerView;

/** The file shown by a leaf, if its view is a file view. */
export function leafFile(leaf: WorkspaceLeaf | null | undefined): TAbstractFile | null {
  const view = leaf && (leaf.view as View & { file?: TAbstractFile | null });
  return (view && view.file) || null;
}

export function vimApi(): VimApi | null {
  const adapter = (window as unknown as { CodeMirrorAdapter?: { Vim?: VimApi } }).CodeMirrorAdapter;
  return (adapter && adapter.Vim) || null;
}
