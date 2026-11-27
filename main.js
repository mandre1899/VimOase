'use strict';

/*
 * Vimoase, by mandre1899
 *
 * Neovim-style keys for Obsidian:
 *   - A configurable keymap engine (vim notation, which-key popup, per-context bindings).
 *   - Leader keys, window/tab keys, search pickers, folds, links, TODO navigation …
 *   - Clipboard keys in vim mode and yanks mirrored to the system clipboard.
 *   - NvimTree/neo-tree-style keys for the file explorer, with a visible, coloured cursor.
 *   - Real vim mappings (jk → <Esc>, ; → :) through Obsidian's vim API.
 *
 * Plain CommonJS, no build step. Parts rely on undocumented Obsidian internals (file
 * explorer tree, CodeMirror vim adapter, some command ids). Every such access is guarded.
 */

const obsidian = require('obsidian');
const {
  Plugin, PluginSettingTab, Setting, Modal, FuzzySuggestModal, Notice, TFile, TFolder,
  MarkdownView, Platform, normalizePath, debounce,
} = obsidian;

let EditorView = null;
try { EditorView = require('@codemirror/view').EditorView; } catch (_) { EditorView = null; }
let cmLanguage = null;
try { cmLanguage = require('@codemirror/language'); } catch (_) { cmLanguage = null; }

/* ================================================================== key notation */

const NAMED = {
  space: 'space', spc: 'space', leader: 'space',
  esc: 'escape', escape: 'escape',
  cr: 'enter', enter: 'enter', return: 'enter', ret: 'enter',
  bs: 'backspace', backspace: 'backspace',
  tab: 'tab',
  up: 'up', down: 'down', left: 'left', right: 'right',
  del: 'delete', delete: 'delete', home: 'home', end: 'end',
  pageup: 'pageup', pagedown: 'pagedown',
  lt: '<', gt: '>', bar: '|', bslash: '\\', localleader: '\\', minus: '-',
};
for (let i = 1; i <= 12; i++) NAMED['f' + i] = 'f' + i;

const EVENT_NAMED = {
  ' ': 'space', Escape: 'escape', Enter: 'enter', Backspace: 'backspace', Tab: 'tab',
  ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
  Delete: 'delete', Home: 'home', End: 'end', PageUp: 'pageup', PageDown: 'pagedown',
};
for (let i = 1; i <= 12; i++) EVENT_NAMED['F' + i] = 'f' + i;

const PRETTY = {
  space: 'Space', escape: 'Esc', enter: 'CR', backspace: 'BS', tab: 'Tab', up: 'Up', down: 'Down',
  left: 'Left', right: 'Right', delete: 'Del', home: 'Home', end: 'End', pageup: 'PageUp', pagedown: 'PageDown',
};

const MODIFIER_KEYS = new Set(['Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'Dead', 'Unidentified', 'Process', 'Fn', 'OS', 'Hyper', 'Super', 'AltGraph']);

function buildToken(m, base) {
  return (m.C ? 'C-' : '') + (m.A ? 'A-' : '') + (m.S ? 'S-' : '') + (m.D ? 'D-' : '') + base;
}

/* KeyboardEvent → canonical token, e.g. "j", "G", "space", "C-s", "S-tab". */
function eventToken(e) {
  const k = e.key;
  if (!k || MODIFIER_KEYS.has(k)) return null;
  const m = { C: e.ctrlKey, A: e.altKey, S: false, D: e.metaKey };
  const hasMod = m.C || m.A || m.D;
  if (EVENT_NAMED[k]) {
    m.S = e.shiftKey;
    return buildToken(m, EVENT_NAMED[k]);
  }
  if (k.length !== 1) return buildToken(m, '<' + k + '>');
  if (!hasMod) return k;
  let base;
  if (/^[a-zA-Z]$/.test(k)) base = k.toLowerCase();
  else if (/^Key[A-Z]$/.test(e.code || '')) base = e.code[3].toLowerCase();
  else if (/^Digit\d$/.test(e.code || '')) base = e.code[5];
  else base = k;
  if (/^[a-z0-9]$/.test(base)) m.S = e.shiftKey;
  return buildToken(m, base);
}

/* One key in vim-ish notation → canonical token (or null). */
function parseToken(raw) {
  let s = raw;
  if (s.length > 2 && s[0] === '<' && s[s.length - 1] === '>') s = s.slice(1, -1);
  if (s.length === 1) return s;
  const named = NAMED[s.toLowerCase()];
  if (named) return named;
  const match = /^((?:(?:c|ctrl|control|a|alt|m|meta|opt|option|s|shift|d|cmd|command|super)-)+)(.+)$/i.exec(s);
  if (!match) return null;
  const m = { C: false, A: false, S: false, D: false };
  for (const part of match[1].split('-').filter(Boolean)) {
    const p = part.toLowerCase();
    if (p === 'c' || p === 'ctrl' || p === 'control') m.C = true;
    else if (p === 'a' || p === 'alt' || p === 'm' || p === 'meta' || p === 'opt' || p === 'option') m.A = true;
    else if (p === 's' || p === 'shift') m.S = true;
    else m.D = true;
  }
  let base = match[2];
  if (base.length === 1) {
    if (/[A-Z]/.test(base)) { m.S = true; base = base.toLowerCase(); }
    const hasMod = m.C || m.A || m.D;
    if (!hasMod) return /[a-z]/.test(base) && m.S ? base.toUpperCase() : base;
    if (!/^[a-z0-9]$/.test(base)) m.S = false;
    return buildToken(m, base);
  }
  const nb = NAMED[base.toLowerCase()];
  if (!nb) return null;
  if (nb.length === 1) return parseToken(buildToken(m, nb));
  return buildToken(m, nb);
}

/* A key sequence: "<leader>ff", "gd", "<C-s>", "space f f", "S-Tab" … → tokens or null. */
function parseSeq(str) {
  const s = (str || '').trim();
  if (!s) return null;
  if (/\s/.test(s)) {
    const toks = s.split(/\s+/).map(parseToken);
    return toks.every(Boolean) ? toks : null;
  }
  if (s.length > 1) {
    const whole = parseToken(s);
    const bracketed = s[0] === '<' && s.indexOf('>') === s.length - 1;
    if (whole && (bracketed || s[0] !== '<')) return [whole];
  }
  const toks = [];
  let i = 0;
  while (i < s.length) {
    if (s[i] === '<') {
      const j = s.indexOf('>', i + 1);
      if (j > i + 1) {
        const tok = parseToken(s.slice(i, j + 1));
        if (tok) { toks.push(tok); i = j + 1; continue; }
      }
    }
    toks.push(s[i]);
    i++;
  }
  return toks.length ? toks : null;
}

function displayToken(tok) {
  if (tok === 'space') return 'SPC';
  if (tok.length === 1) return tok;
  const m = /^((?:[CASD]-)*)(.+)$/.exec(tok);
  const base = PRETTY[m[2]] || m[2];
  return '<' + m[1] + base + '>';
}

function displaySeq(toks) {
  return toks.map(displayToken).join(' ');
}

function vimKeyFor(tok) {
  if (tok.length === 1) return tok;
  if (tok === 'space') return '<Space>';
  const m = /^((?:[CASD]-)*)(.+)$/.exec(tok);
  const base = PRETTY[m[2]] || m[2];
  return '<' + m[1] + base + '>';
}

/* ================================================================== misc helpers */

function cmpPos(a, b) { return a.line - b.line || a.ch - b.ch; }
function orderRange(r) { return cmpPos(r.anchor, r.head) <= 0 ? [r.anchor, r.head] : [r.head, r.anchor]; }
function posAfterInsert(start, text) {
  const lines = text.split('\n');
  if (lines.length === 1) return { line: start.line, ch: start.ch + text.length };
  return { line: start.line + lines.length - 1, ch: lines[lines.length - 1].length };
}
function dirname(path) { const i = path.lastIndexOf('/'); return i < 0 ? '' : path.slice(0, i); }
function basename(path) { const i = path.lastIndexOf('/'); return i < 0 ? path : path.slice(i + 1); }
function hasExtension(name) { return /\.[^./\s]+$/.test(name) && !name.startsWith('.'); }
function joinPath(folderPath, rel) {
  if (!folderPath || folderPath === '/') return normalizePath(rel);
  return normalizePath(folderPath + '/' + rel);
}
function isEditable(el) { return !!el.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])'); }
function fakeKey(key) { return new KeyboardEvent('keydown', { key }); }
function vimApi() { const a = window.CodeMirrorAdapter; return (a && a.Vim) || null; }

/* Shift+A on a soft-wrapped line: append after the last word of the visual
 * row instead of at the end of the whole paragraph. Obsidian's g$ lands on
 * the row's trailing space, so g$a would put the cursor at the start of the
 * next row; this skips back over that space first. */
function appendAtDisplayLineEnd(cm) {
  const Vim = vimApi();
  cm.execCommand('goLineRight'); // last char of the visual row, or end of the line
  const pos = cm.getCursor();
  const text = cm.getLine(pos.line);
  let ch = text.length;
  if (pos.ch < text.length) {
    ch = pos.ch;
    while (ch > 0 && /\s/.test(text[ch])) ch--;
    ch += 1;
  }
  Vim.enterInsertMode(cm);
  cm.setCursor({ line: pos.line, ch });
}

const BLANK_EXCALIDRAW_JSON = JSON.stringify({
  type: 'excalidraw', version: 2, source: 'https://github.com/zsviczian/obsidian-excalidraw-plugin',
  elements: [], appState: { gridSize: null, viewBackgroundColor: '#ffffff' }, files: {},
}, null, '\t');
const BLANK_EXCALIDRAW_MD = '---\n\nexcalidraw-plugin: parsed\ntags: [excalidraw]\n\n---\n'
  + '==⚠  Switch to EXCALIDRAW VIEW in the MORE OPTIONS menu of this document. ⚠== You can decompress Drawing data with the command palette: \'Decompress current Excalidraw file\'. For more info check in plugin settings under \'Saving\'\n\n'
  + '# Excalidraw Data\n\n## Text Elements\n%%\n## Drawing\n```json\n' + BLANK_EXCALIDRAW_JSON + '\n```\n%%';
const SKIPPED_VIEW_TYPES = new Set(['canvas', 'excalidraw']);
const SKIPPED_VIEW_SELECTOR = '.workspace-leaf-content[data-type="canvas"], .workspace-leaf-content[data-type="excalidraw"]';
const TYPING_CONTEXTS = new Set(['insert', 'picker']);
const TODO_LINE = /\b(TODO|FIXME|FIX)\b|^\s*(?:[-*+]|\d+[.)])\s+\[ \]/;

const CONTEXTS = [
  ['normal', 'Normal'], ['visual', 'Visual'], ['insert', 'Insert'],
  ['other', 'Other views'], ['explorer', 'File explorer'], ['picker', 'Pickers'],
];
const CONTEXT_LABEL = Object.fromEntries(CONTEXTS);

const N = 'normal', V = 'visual', I = 'insert', O = 'other', E = 'explorer', P = 'picker';
const LEADER = [N, O, E];

const DEFAULT_SETTINGS = {
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
  vimMaps: [
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
  ],
};

/* ================================================================== trie */

function emptyNode() { return { children: new Map(), action: null, label: null }; }

/* ================================================================== modals */

class PromptModal extends Modal {
  constructor(app, opts) { super(app); this.opts = opts; this.submitted = false; }

  onOpen() {
    const { contentEl, opts } = this;
    this.titleEl.setText(opts.title);
    if (opts.desc) contentEl.createDiv({ cls: 'vmk-prompt-desc', text: opts.desc });
    const input = contentEl.createEl('input', { type: 'text', cls: 'vmk-prompt-input' });
    input.value = opts.value || '';
    input.placeholder = opts.placeholder || '';
    if (opts.render) {
      const extra = contentEl.createDiv({ cls: 'vmk-prompt-extra' });
      const update = () => opts.render(input.value, extra);
      input.addEventListener('input', update);
      update();
    }
    input.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' && !ev.isComposing) {
        ev.preventDefault();
        this.submitted = true;
        const value = input.value;
        this.close();
        opts.onSubmit(value);
      }
    });
    window.setTimeout(() => {
      input.focus();
      if (opts.select) input.setSelectionRange(opts.select[0], opts.select[1]);
      else input.setSelectionRange(input.value.length, input.value.length);
    }, 0);
  }

  onClose() {
    this.contentEl.empty();
    if (!this.submitted && this.opts.onCancel) this.opts.onCancel();
  }
}

class ConfirmModal extends Modal {
  constructor(app, opts) { super(app); this.opts = opts; this.confirmed = false; }

  onOpen() {
    const { contentEl, opts } = this;
    this.titleEl.setText(opts.title);
    contentEl.createDiv({ text: opts.message });
    contentEl.createDiv({ cls: 'vmk-confirm-hint', text: 'enter / y to confirm · esc / n to cancel' });
    const buttons = contentEl.createDiv({ cls: 'vmk-confirm-buttons' });
    buttons.createEl('button', { text: 'Cancel' }).addEventListener('click', () => this.close());
    buttons.createEl('button', { text: opts.confirmText || 'Delete', cls: 'mod-warning' })
      .addEventListener('click', () => this.confirm());
    const yes = () => { this.confirm(); return false; };
    const no = () => { this.close(); return false; };
    this.scope.register([], 'Enter', yes);
    this.scope.register([], 'y', yes);
    this.scope.register([], 'n', no);
  }

  confirm() { this.confirmed = true; this.close(); this.opts.onConfirm(); }

  onClose() {
    this.contentEl.empty();
    if (!this.confirmed && this.opts.onCancel) this.opts.onCancel();
  }
}

/* Folder browser for "Move to" / "Copy to". Lists only the subfolders of the folder being
 * browsed, plus "here" and "..". Breadcrumbs jump to any ancestor; the input filters the list
 * and also takes paths: "../", "/" (vault root), "a/b/" navigate as you type, and a path that
 * does not exist yet offers to create it (or to rename the item on the way).
 *
 * opts: { mode: 'move' | 'copy', file, start: TFolder, onSubmit({ kind: 'into' | 'exact', path }), onCancel } */
class FolderPickerModal extends Modal {
  constructor(app, opts) {
    super(app);
    this.opts = opts;
    this.submitted = false;
    this.folder = opts.start;
    this.rows = [];
    this.sel = 0;
  }

  get verb() { return this.opts.mode === 'move' ? 'Move' : 'Copy'; }

  onOpen() {
    const { contentEl, opts } = this;
    this.modalEl.addClass('vmk-fp-modal');
    this.titleEl.empty();

    // One prompt line: the browsed path (click a segment to jump there) followed by the input.
    const line = contentEl.createDiv({ cls: 'vmk-fp-line' });
    this.crumbsEl = line.createSpan({ cls: 'vmk-fp-crumbs' });
    this.input = line.createEl('input', {
      type: 'text',
      cls: 'vmk-fp-input',
      attr: { placeholder: this.verb.toLowerCase() + ' ' + opts.file.name + ' to…', spellcheck: 'false', autocomplete: 'off' },
    });
    this.input.addEventListener('input', () => this.onInput());
    this.input.addEventListener('keydown', (ev) => this.onKey(ev));
    line.addEventListener('click', (ev) => { if (ev.target === line) this.input.focus(); });

    this.listEl = contentEl.createDiv({ cls: 'vmk-fp-list' });
    contentEl.createDiv({ cls: 'vmk-fp-hint', text: '↵ ' + this.verb.toLowerCase() + '   ⇥ open   ⌫ up   ⇧↵ here' });

    this.render(true);
    window.setTimeout(() => this.input.focus(), 0);
  }

  onClose() {
    this.contentEl.empty();
    if (!this.submitted && this.opts.onCancel) this.opts.onCancel();
  }

  /* ---------------------------------------------------------------- paths */

  root() { return this.app.vault.getRoot(); }
  pathOf(folder) { return folder.isRoot() ? '/' : folder.path; }

  /* Resolve a typed path against the browsed folder: "/x" is from the vault root, ".." and "." work. */
  resolvePath(q) {
    const parts = q.startsWith('/') || this.folder.isRoot() ? [] : this.folder.path.split('/');
    for (const seg of q.split('/')) {
      if (!seg || seg === '.') continue;
      if (seg === '..') parts.pop();
      else parts.push(seg);
    }
    return parts.join('/');
  }

  folderAt(path) {
    if (!path) return this.root();
    const f = this.app.vault.getAbstractFileByPath(normalizePath(path));
    return f instanceof TFolder ? f : null;
  }

  /* Can the item go into this folder? A folder cannot go into itself or its own subfolders. */
  blocked(folder) {
    const file = this.opts.file;
    if (!(file instanceof TFolder)) return false;
    return (this.pathOf(folder) + '/').startsWith(file.path + '/');
  }

  subfolders(folder) {
    return folder.children.filter((c) => c instanceof TFolder)
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
  }

  /* ---------------------------------------------------------------- navigation */

  navigate(folder) {
    if (!folder || folder === this.folder) return;
    const from = this.folder;
    this.folder = folder;
    this.input.value = '';
    this.render(true, from);
  }

  goUp() { if (!this.folder.isRoot()) this.navigate(this.folder.parent || this.root()); }

  openRow(row) {
    if (!row || row.disabled) return;
    if (row.kind === 'up') this.goUp();
    else if (row.kind === 'folder') this.navigate(row.folder);
  }

  onInput() {
    const q = this.input.value;
    const slash = q.lastIndexOf('/');
    if (slash >= 0) {
      const dir = this.folderAt(this.resolvePath(q.slice(0, slash + 1)));
      if (dir) {
        const from = this.folder;
        this.folder = dir;
        this.input.value = q.slice(slash + 1);
        return this.render(true, from);
      }
    }
    this.render(false);
  }

  /* ---------------------------------------------------------------- choosing */

  submit(target) {
    this.submitted = true;
    this.close();
    this.opts.onSubmit(target);
  }

  activate(row) {
    if (!row || row.disabled) return;
    if (row.kind === 'up') return this.goUp();
    if (row.kind === 'here' || row.kind === 'folder') return this.submit({ kind: 'into', path: this.pathOf(row.folder) });
    if (row.kind === 'newFolder') return this.submit({ kind: 'into', path: row.path });
    if (row.kind === 'rename') return this.submit({ kind: 'exact', path: row.path });
  }

  submitHere() { if (!this.blocked(this.folder)) this.submit({ kind: 'into', path: this.pathOf(this.folder) }); }

  moveSel(delta) {
    const n = this.rows.length;
    if (!n) return;
    let i = this.sel;
    for (let step = 0; step < n; step++) {
      i = (i + delta + n) % n;
      if (!this.rows[i].disabled) break;
    }
    this.setSel(i);
  }

  setSel(i) {
    this.sel = i;
    this.rows.forEach((r, j) => r.el && r.el.toggleClass('is-selected', j === i));
    const el = this.rows[i] && this.rows[i].el;
    if (el) el.scrollIntoView({ block: 'nearest' });
  }

  onKey(ev) {
    if (ev.isComposing) return;
    const input = this.input;
    const ctrl = ev.ctrlKey && !ev.metaKey && !ev.altKey;
    const atStart = input.selectionStart === 0 && input.selectionEnd === 0;
    const atEnd = input.selectionStart === input.value.length;
    const row = this.rows[this.sel];
    let handled = true;
    if (ev.key === 'ArrowDown' || (ctrl && (ev.key === 'n' || ev.key === 'j'))) this.moveSel(1);
    else if (ev.key === 'ArrowUp' || (ctrl && (ev.key === 'p' || ev.key === 'k'))) this.moveSel(-1);
    else if (ev.key === 'Enter') {
      if (ev.shiftKey || ev.metaKey || ev.ctrlKey) this.submitHere();
      else if (input.value.trim() === '..') this.goUp();
      else this.activate(row);
    } else if (ev.key === 'Tab') {
      if (ev.shiftKey) this.goUp();
      else this.openRow(row);
    } else if ((ev.key === 'ArrowRight' && atEnd && !ev.shiftKey) || (ctrl && ev.key === 'l')) {
      if (row && (row.kind === 'folder' || row.kind === 'up')) this.openRow(row);
      else handled = false;
    } else if ((ev.key === 'ArrowLeft' && atStart && !ev.shiftKey) || (ev.key === 'Backspace' && !input.value) || (ctrl && ev.key === 'h' && !input.value)) {
      this.goUp();
    } else handled = false;
    if (handled) { ev.preventDefault(); ev.stopPropagation(); }
  }

  /* ---------------------------------------------------------------- rendering */

  buildRows() {
    const { file, mode } = this.opts;
    const q = this.input.value;
    const trimmed = q.trim();
    const rows = [];
    const inPath = q.includes('/'); // a path whose folder part does not exist (onInput consumed the rest)
    const filter = inPath ? null : trimmed.toLowerCase();
    const sameParent = (f) => (file.parent || this.root()) === f;
    const taken = (f) => !!this.app.vault.getAbstractFileByPath(joinPath(this.pathOf(f), file.name));

    if (!trimmed) {
      const blocked = this.blocked(this.folder);
      rows.push({
        kind: 'here', folder: this.folder, disabled: blocked,
        label: this.verb.toLowerCase() + ' here',
        meta: blocked ? 'inside itself' : (mode === 'move' && sameParent(this.folder) ? 'current' : ''),
      });
      if (!this.folder.isRoot()) rows.push({ kind: 'up', label: '..' });
    }

    if (filter !== null) {
      const scored = [];
      for (const f of this.subfolders(this.folder)) {
        const name = f.name.toLowerCase();
        let score = -1;
        let hit = -1;
        if (!filter) score = 0;
        else if (name.startsWith(filter)) { score = 0; hit = 0; }
        else if ((hit = name.indexOf(filter)) >= 0) score = 1;
        else if (isSubsequence(filter, name)) score = 2;
        if (score >= 0) scored.push({ f, score, hit });
      }
      scored.sort((a, b) => a.score - b.score);
      for (const { f, hit } of scored) {
        const blocked = this.blocked(f);
        const kids = this.subfolders(f).length;
        rows.push({
          kind: 'folder', folder: f, disabled: blocked, label: f.name, hit, hitLen: filter.length, kids,
          meta: blocked ? (f === file ? 'this folder' : 'inside itself') : (mode === 'move' && sameParent(f) ? 'current' : (taken(f) ? 'name taken' : '')),
          warn: !blocked && taken(f),
        });
      }
    }

    if (trimmed && trimmed !== '.' && trimmed !== '..') {
      const target = this.resolvePath(trimmed);
      const exists = target && this.app.vault.getAbstractFileByPath(normalizePath(target));
      if (target && !exists) {
        const blocked = file instanceof TFolder && (target + '/').startsWith(file.path + '/');
        rows.push({ kind: 'newFolder', path: target, disabled: blocked, label: '+ ' + target + '/', meta: blocked ? 'inside itself' : 'new folder' });
        if (!trimmed.endsWith('/')) rows.push({ kind: 'rename', path: target, disabled: blocked, label: '→ ' + target, meta: 'rename' });
      }
    }
    return rows;
  }

  render(navigated, from) {
    this.renderCrumbs();
    this.rows = this.buildRows();
    this.listEl.empty();

    if (!this.rows.some((r) => r.kind === 'folder')) {
      const q = this.input.value.trim();
      const msg = q && !q.includes('/') ? 'no match' : (q ? '' : 'no subfolders');
      if (msg) this.listEl.createDiv({ cls: 'vmk-fp-empty', text: msg });
    }

    this.rows.forEach((row, i) => {
      const el = this.listEl.createDiv({ cls: 'vmk-fp-row vmk-fp-' + row.kind });
      row.el = el;
      if (row.disabled) el.addClass('is-disabled');
      const text = el.createSpan({ cls: 'vmk-fp-label' });
      if (row.kind === 'folder' && row.hit >= 0 && row.hitLen) {
        text.appendText(row.label.slice(0, row.hit));
        text.createEl('mark', { text: row.label.slice(row.hit, row.hit + row.hitLen) });
        text.appendText(row.label.slice(row.hit + row.hitLen));
      } else text.setText(row.label);
      if (row.kind === 'folder') text.createSpan({ cls: 'vmk-fp-slash', text: '/' });
      if (row.sub) el.createSpan({ cls: 'vmk-fp-sub', text: row.sub });
      if (row.meta) el.createSpan({ cls: 'vmk-fp-meta' + (row.warn ? ' is-warn' : ''), text: row.meta });
      if (row.kind === 'folder' && !row.disabled) {
        const open = el.createSpan({ cls: 'vmk-fp-open', text: '›', attr: { 'aria-label': 'Open folder' } });
        open.addEventListener('click', (ev) => { ev.stopPropagation(); this.openRow(row); this.input.focus(); });
      }
      el.addEventListener('mousemove', () => { if (!row.disabled && this.sel !== i) this.setSel(i); });
      el.addEventListener('click', () => { this.activate(row); if (!this.submitted) this.input.focus(); });
    });

    /* Default selection: where we came from after "..", else "here" unless it is a no-op, else the first folder. */
    let sel = -1;
    if (from) sel = this.rows.findIndex((r) => r.folder === from);
    if (sel < 0 && !navigated && this.input.value.trim()) sel = this.rows.findIndex((r) => !r.disabled);
    if (sel < 0) {
      const here = this.rows.findIndex((r) => r.kind === 'here' && !r.disabled && !r.meta);
      sel = here >= 0 ? here : this.rows.findIndex((r) => r.kind === 'folder' && !r.disabled);
      if (sel < 0) sel = this.rows.findIndex((r) => r.kind === 'up');
    }
    if (sel < 0) sel = this.rows.findIndex((r) => !r.disabled);
    this.setSel(Math.max(0, sel));
  }

  renderCrumbs() {
    const el = this.crumbsEl;
    el.empty();
    const chain = [];
    for (let f = this.folder; f; f = f.parent) { chain.unshift(f); if (f.isRoot()) break; }
    // Long paths: keep the root and the last two folders.
    const shown = chain.length > 4 ? [chain[0], null, ...chain.slice(-2)] : chain;
    for (const f of shown) {
      if (!f) { el.createSpan({ cls: 'vmk-fp-crumb is-gap', text: '…/' }); continue; }
      const c = el.createSpan({ cls: 'vmk-fp-crumb', text: (f.isRoot() ? '' : f.name) + '/' });
      if (f === this.folder) c.addClass('is-current');
      else c.addEventListener('click', () => { this.navigate(f); this.input.focus(); });
      if (f.isRoot()) c.setAttribute('aria-label', this.app.vault.getName());
    }
  }
}

function isSubsequence(needle, hay) {
  let j = 0;
  for (let i = 0; i < hay.length && j < needle.length; i++) if (hay[i] === needle[j]) j++;
  return j === needle.length;
}

/* Telescope-ish picker. Ctrl-n/p move, Ctrl-v/x/t open in split/tab (via the picker context). */
class PickerModal extends FuzzySuggestModal {
  constructor(plugin, opts) {
    super(plugin.app);
    this.plugin = plugin;
    this.opts = opts;
    this.openMode = null;
    this.setPlaceholder(opts.placeholder || 'Search…');
    if (opts.instructions) this.setInstructions(opts.instructions);
  }
  getItems() { return this.opts.items(); }
  getItemText(item) { return this.opts.text(item); }
  onChooseItem(item) { this.opts.onChoose(item, this.openMode); }
  onOpen() { super.onOpen(); this.plugin.activePicker = this; }
  onClose() { super.onClose(); if (this.plugin.activePicker === this) this.plugin.activePicker = null; }
}

class CheatsheetModal extends Modal {
  constructor(plugin, onlyContext) { super(plugin.app); this.plugin = plugin; this.onlyContext = onlyContext; }

  onOpen() {
    const { contentEl } = this;
    this.modalEl.addClass('vmk-cheatsheet-modal');
    this.titleEl.setText(this.onlyContext ? 'Keys: ' + CONTEXT_LABEL[this.onlyContext] : 'All key bindings');
    const search = contentEl.createEl('input', { type: 'search', cls: 'vmk-cheatsheet-search', attr: { placeholder: 'Filter…' } });
    const list = contentEl.createDiv({ cls: 'vmk-cheatsheet' });
    const render = () => {
      list.empty();
      const q = search.value.trim().toLowerCase();
      for (const [group, actions] of this.plugin.groupedActions()) {
        const rows = actions.filter((a) => {
          if (this.onlyContext && !a.contexts.includes(this.onlyContext)) return false;
          const keys = this.plugin.validSeqs(a.id);
          if (!keys.length) return false;
          if (!q) return true;
          return (a.label + ' ' + keys.map(displaySeq).join(' ')).toLowerCase().includes(q);
        });
        if (!rows.length) continue;
        list.createEl('h4', { text: group });
        const table = list.createDiv({ cls: 'vmk-cheatsheet-table' });
        for (const a of rows) {
          const row = table.createDiv({ cls: 'vmk-cheatsheet-row' });
          const keys = row.createDiv({ cls: 'vmk-cheatsheet-keys' });
          for (const s of this.plugin.validSeqs(a.id)) keys.createEl('kbd', { text: displaySeq(s) });
          row.createDiv({ cls: 'vmk-cheatsheet-label', text: a.label });
          row.createDiv({ cls: 'vmk-cheatsheet-ctx', text: a.contexts.map((c) => CONTEXT_LABEL[c]).join(', ') });
        }
      }
      if (!list.childElementCount) list.createDiv({ cls: 'vmk-cheatsheet-empty', text: 'No bindings' });
    };
    search.addEventListener('input', render);
    render();
    window.setTimeout(() => search.focus(), 0);
  }

  onClose() { this.contentEl.empty(); }
}

/* ================================================================== plugin */

class VimoasePlugin extends Plugin {
  async onload() {
    await this.loadSettings();

    this.seq = null;
    this.popupEl = null;
    this.popupTimer = null;
    this.seqTimer = null;
    this.ambTimer = null;
    this.selectAll = null;
    this.lastLinewise = null;
    this.explorerClip = null;
    this.undoStack = [];
    this.patchedRegisters = null;
    this.disabledScope = null;
    this.patchedTree = null;
    this.cursorEl = null;
    this.appliedVimMaps = [];
    this.activePicker = null;

    this.actions = this.defineActions();
    this.actionById = new Map(this.actions.map((a) => [a.id, a]));
    this.rebuildTries();

    this.requestSave = debounce(() => this.saveData(this.settings), 400, true);
    this.requestVimMaps = debounce(() => this.applyVimMaps(), 400, true);

    this.onKeyDown = this.onKeyDown.bind(this);
    this.registerDomEvent(window, 'keydown', this.onKeyDown, { capture: true });
    this.registerEvent(this.app.workspace.on('window-open', (_w, win) => {
      this.registerDomEvent(win, 'keydown', this.onKeyDown, { capture: true });
    }));
    this.keepFocus = null;
    // Any mouse press outside the explorer means the user wants focus there: stop reclaiming it.
    this.registerDomEvent(document, 'mousedown', (e) => {
      const view = this.explorerView();
      if (this.keepFocus && (!view || !e.target || !view.containerEl.contains(e.target))) this.keepFocus = null;
    }, { capture: true });
    this.registerDomEvent(document, 'click', (e) => {
      const view = this.explorerView();
      if (!view || !e.target || !view.containerEl.contains(e.target)) return;
      window.setTimeout(() => this.updateCursor(), 0);
      this.onExplorerFileClick(view, e);
    }, { capture: true });

    this.app.workspace.onLayoutReady(() => {
      this.ensureYankPatch();
      this.syncExplorer();
      this.applyVimMaps();
    });
    this.registerEvent(this.app.workspace.on('layout-change', () => this.syncExplorer()));
    this.registerEvent(this.app.workspace.on('active-leaf-change', (leaf) => {
      this.updateCursor();
      this.reclaimExplorerFocus(leaf);
    }));

    this.applyCursorStyle();
    this.addSettingTab(new VimoaseSettingTab(this.app, this));
  }

  onunload() {
    this.cancelSeq(false);
    this.restoreExplorerScope();
    this.unpatchTree();
    this.removeYankPatch();
    this.removeVimMaps();
    this.removeCursorStyle();
  }

  async loadSettings() {
    const data = (await this.loadData()) || {};
    if (data.clipboardKeys === false && data.yankToClipboard === undefined) data.yankToClipboard = false;
    delete data.clipboardKeys;
    this.settings = Object.assign({}, DEFAULT_SETTINGS, data);
    this.settings.keymap = Object.assign({}, data.keymap || {});
    if (!Array.isArray(this.settings.vimMaps)) this.settings.vimMaps = DEFAULT_SETTINGS.vimMaps.map((m) => ({ ...m }));
  }

  settingsChanged() {
    this.requestSave();
    this.syncExplorer();
    if (this.settings.yankToClipboard) this.ensureYankPatch();
    else this.removeYankPatch();
    this.applyCursorStyle();
    this.updateCursor();
  }

  /* ================================================================ actions */

  defineActions() {
    const c = (id, main) => () => this.cmd(id, main);
    const ex = (fn) => () => { const v = this.explorerView(); if (v) return fn(v); };
    const ed = (fn) => (ctx) => { if (ctx && ctx.ed) return fn(ctx.ed, ctx); };
    const hasAdapter = (ctx) => !!(ctx && ctx.ed && ctx.ed.adapter && ctx.ed.vim);
    const hasSelection = (ctx) => hasAdapter(ctx) && (ctx.ed.vim.visualMode || ctx.ed.adapter.somethingSelected());
    const git = (re) => () => this.cmdMatch({ plugin: 'obsidian-git', name: re, needs: 'Obsidian Git' });

    const list = [];
    const add = (group, id, label, contexts, keys, run, extra) => list.push(Object.assign({ group, id, label, contexts, keys, run }, extra || {}));

    // ---- Editing and UI
    let g = 'Editing and UI';
    add(g, 'save', 'Save current file', [N, I, V, O], ['<C-s>'], c('editor:save-file'));
    add(g, 'copyFile', 'Copy whole note to clipboard', [N], ['<C-c>'], ed((e) => this.copyWholeFile(e)));
    add(g, 'nohl', 'Clear search highlighting (Esc still reaches vim)', [N], ['<Esc>'], ed((e) => this.noHighlight(e)), { passThrough: true });
    add(g, 'toggleComment', 'Toggle comment on line / selection', [N, V], ['<leader>/'], (ctx) => this.toggleComment(ctx));
    add(g, 'lineNumbers', 'Toggle line numbers', LEADER, ['<leader>n'], () => this.toggleLineNumbers());
    add(g, 'cheatsheet', 'Show all key bindings', LEADER, ['<leader>wK'], () => new CheatsheetModal(this).open());
    add(g, 'queryKeys', 'Search key bindings', LEADER, ['<leader>wk'], () => this.pickBinding());
    add(g, 'format', 'Format note (Linter plugin)', [N, V], ['<leader>lf', '<leader>fm'],
      () => this.cmdMatch({ ids: ['obsidian-linter:lint-file'], plugin: 'obsidian-linter', name: /lint (the )?(current )?file/i, needs: 'Linter' }));
    add(g, 'theme', 'Choose theme', LEADER, ['<leader>th'], c('theme:switch'));

    // ---- Windows, tabs and files
    g = 'Windows, tabs and files';
    add(g, 'focusLeft', 'Focus pane left', [N, O, E], ['<C-h>'], () => this.focusDir('left'));
    add(g, 'focusDown', 'Focus pane below', [N, O, E], ['<C-j>'], () => this.focusDir('down'));
    add(g, 'focusRight', 'Focus pane right', [N, O, E], ['<C-l>'], () => this.focusDir('right'));
    add(g, 'focusUp', 'Focus pane above', [N, O, E], [], () => this.focusDir('up'));
    add(g, 'nextTab', 'Next tab', [N, O], ['<Tab>'], c('workspace:next-tab'));
    add(g, 'prevTab', 'Previous tab', [N, O], ['<S-Tab>'], c('workspace:previous-tab'));
    add(g, 'newTab', 'New empty tab (new buffer)', LEADER, ['<leader>b'], c('workspace:new-tab', true));
    add(g, 'closeTab', 'Close current tab', LEADER, ['<leader>x'], c('workspace:close', true));
    add(g, 'closeOthers', 'Close other tabs', LEADER, [], c('workspace:close-others', true));
    add(g, 'splitRight', 'Split right', LEADER, [], c('workspace:split-vertical', true));
    add(g, 'splitDown', 'Split down', LEADER, [], c('workspace:split-horizontal', true));
    add(g, 'newNote', 'New note', LEADER, [], c('file-explorer:new-file'));
    add(g, 'toggleExplorer', 'Toggle file explorer', [N, O, E], ['<C-n>'], () => this.toggleExplorer());
    add(g, 'focusExplorer', 'Focus file explorer (reveal current file)', LEADER, ['<leader>e'], () => this.revealInExplorer());
    add(g, 'renameNote', 'Rename current note', [N, O], ['<leader>rn'], () => this.renameActiveNote());

    // ---- Search and discovery
    g = 'Search and discovery';
    add(g, 'findFiles', 'Find files (quick switcher)', LEADER, ['<leader>ff'], c('switcher:open'));
    add(g, 'findAll', 'Find all files (incl. attachments)', LEADER, ['<leader>fa'], () => this.pickAllFiles());
    add(g, 'grep', 'Search text across the vault', LEADER, ['<leader>fw'], c('global-search:open'));
    add(g, 'buffers', 'List open tabs', LEADER, ['<leader>fb'], () => this.pickTabs());
    add(g, 'recent', 'Recently opened files', LEADER, ['<leader>fo'], () => this.pickRecent());
    add(g, 'searchNote', 'Search in current note', [N], ['<leader>fz'], c('editor:open-search'));
    add(g, 'help', 'Help / command palette', LEADER, ['<leader>fh'], c('command-palette:open'));
    add(g, 'codeActions', 'Actions (command palette)', [N, V, O], ['<leader>ca'], c('command-palette:open'));
    add(g, 'marks', 'Bookmarks', LEADER, ['<leader>ma'], c('bookmarks:open'));
    add(g, 'omnisearch', 'Omnisearch', LEADER, [], () => this.cmdMatch({ ids: ['omnisearch:show-modal'], needs: 'Omnisearch' }));
    add(g, 'todosAll', 'Search all TODOs / open tasks', LEADER, ['<leader>xt'], () => this.globalSearch('/\\b(TODO|FIXME|FIX|HACK|NOTE|PERF|WARN)\\b|- \\[ \\]/'));
    add(g, 'todosFix', 'Search TODO / FIX / FIXME', LEADER, ['<leader>xT'], () => this.globalSearch('/\\b(TODO|FIXME|FIX)\\b/'));

    // ---- Navigation
    g = 'Navigation and links';
    add(g, 'followLink', 'Follow link under cursor', [N], ['gd'], c('editor:follow-link'));
    add(g, 'followLinkTab', 'Follow link in new tab', [N], [], c('editor:open-link-in-new-leaf'));
    add(g, 'backlinks', 'Show backlinks', [N, O], ['gr'], () => this.cmdMatch({ ids: ['backlink:open'], needs: 'Backlinks core plugin' }));
    add(g, 'hover', 'Preview link under cursor', [N], ['K'], ed((e) => this.hoverLink(e)));
    add(g, 'outline', 'Outline (symbols)', LEADER, ['<leader>cs'], c('outline:open'));
    add(g, 'nextTodo', 'Next TODO / open task', [N], [']t'], ed((e) => this.jumpTodo(e, 1)));
    add(g, 'prevTodo', 'Previous TODO / open task', [N], ['[t'], ed((e) => this.jumpTodo(e, -1)));

    // ---- Folds
    g = 'Folds';
    add(g, 'foldToggle', 'Toggle fold', [N], ['za'], c('editor:toggle-fold'));
    add(g, 'foldOpen', 'Open fold', [N], ['zo'], ed((e) => this.fold(e, false)));
    add(g, 'foldClose', 'Close fold', [N], ['zc'], ed((e) => this.fold(e, true)));
    add(g, 'unfoldAll', 'Open all folds', [N], ['zR'], c('editor:unfold-all'));
    add(g, 'foldAll', 'Close all folds', [N], ['zM'], c('editor:fold-all'));

    // ---- Insert mode
    g = 'Insert mode';
    add(g, 'insLeft', 'Move left', [I], ['<C-h>'], ed((e) => this.insMove(e, 'left')), { when: hasAdapter });
    add(g, 'insDown', 'Move down', [I], ['<C-j>'], ed((e) => this.insMove(e, 'down')), { when: hasAdapter });
    add(g, 'insUp', 'Move up', [I], [], ed((e) => this.insMove(e, 'up')), { when: hasAdapter });
    add(g, 'insRight', 'Move right', [I], ['<C-l>'], ed((e) => this.insMove(e, 'right')), { when: hasAdapter });
    add(g, 'insLineStart', 'Beginning of line', [I], ['<C-b>'], ed((e) => this.insMove(e, 'home')), { when: hasAdapter });

    // ---- Clipboard
    g = 'Clipboard (vim mode)';
    add(g, 'selectAll', 'Select whole note (Esc returns)', [N, V, I], [], ed((e) => this.doSelectAll(e)), { when: hasAdapter });
    add(g, 'copySel', 'Copy selection (insert: only with a selection)', [V, I], ['<C-c>'], ed((e) => this.doCopy(e, false)), { when: hasSelection });
    add(g, 'cutSel', 'Cut selection (insert: only with a selection)', [V, I], ['<C-x>'], ed((e) => this.doCopy(e, true)), { when: hasSelection });
    add(g, 'copyLine', 'Copy line or selection', [N], [], ed((e) => this.doCopy(e, false)), { when: hasAdapter });
    add(g, 'paste', 'Paste system clipboard', [N, V, I], ['<C-v>'], ed((e) => this.doPaste(e)), { when: hasAdapter });
    add(g, 'visualBlock', 'Visual block', [N, V], ['<C-q>'], ed((e) => this.visualBlock(e)), { when: hasAdapter });

    // ---- Git (Obsidian Git plugin)
    g = 'Git (Obsidian Git plugin)';
    add(g, 'gitView', 'Source control view', LEADER, [], git(/source control|open git view/i));
    add(g, 'gitCommits', 'Commit history', LEADER, ['<leader>cm'], git(/history/i));
    add(g, 'nextHunk', 'Next hunk', [N], [']h'], git(/next hunk/i));
    add(g, 'prevHunk', 'Previous hunk', [N], ['[h'], git(/prev(ious)? hunk/i));
    add(g, 'previewHunk', 'Preview hunk', [N], ['<leader>ghp'], git(/preview hunk/i));
    add(g, 'blame', 'Blame', [N], ['<leader>ghb'], git(/blame/i));
    add(g, 'diffFile', 'Diff current file', [N], ['<leader>ghd'], git(/diff view|open diff/i));
    add(g, 'stageHunk', 'Stage hunk', [N, V], ['<leader>ghs'], git(/stage hunk/i));
    add(g, 'resetHunk', 'Reset hunk', [N, V], ['<leader>ghr'], git(/reset hunk/i));

    // ---- File explorer
    g = 'File explorer';
    add(g, 'exDown', 'Down', [E], ['j'], ex((v) => this.exDown(v)));
    add(g, 'exUp', 'Up', [E], ['k'], ex((v) => this.exUp(v)));
    add(g, 'exLeft', 'Close folder / go to parent', [E], ['h', '<BS>'], ex((v) => this.exLeft(v)));
    add(g, 'exRight', 'Open file / expand folder', [E], ['l'], ex((v) => this.exRight(v)));
    add(g, 'exOpen', 'Open file / toggle folder', [E], ['<CR>', 'o'], ex((v) => this.exEnter(v)));
    add(g, 'exPreview', 'Preview file (keep focus here)', [E], ['<Tab>'], ex((v) => this.exPreview(v)));
    add(g, 'exVsplit', 'Open in vertical split', [E], ['<C-v>', 's'], ex((v) => this.exOpenFocused(v, 'vertical')));
    add(g, 'exHsplit', 'Open in horizontal split', [E], ['<C-x>', 'S'], ex((v) => this.exOpenFocused(v, 'horizontal')));
    add(g, 'exTab', 'Open in new tab', [E], ['<C-t>', 't'], ex((v) => this.exOpenFocused(v, 'tab')));
    add(g, 'exFirst', 'First item', [E], ['gg'], ex((v) => this.exEdge(v, false)));
    add(g, 'exLast', 'Last item', [E], ['G'], ex((v) => this.exEdge(v, true)));
    add(g, 'exParent', 'Go to parent folder', [E], ['P'], ex((v) => this.exParent(v)));
    add(g, 'exCollapseAll', 'Collapse all folders', [E], ['z'], ex((v) => this.exCollapseAll(v)));
    add(g, 'exAdd', 'Create note, folder/, canvas, drawing, flashcards, base…', [E], ['a'], ex((v) => this.exAdd(v, false)));
    add(g, 'exAddFolder', 'Create folder', [E], ['A'], ex((v) => this.exAdd(v, true)));
    add(g, 'exRename', 'Rename', [E], ['r'], ex((v) => this.exRename(v)));
    add(g, 'exDelete', 'Delete', [E], ['d'], ex((v) => this.exDelete(v)));
    add(g, 'exCopy', 'Copy', [E], ['c'], ex((v) => this.exClip(v, 'copy')));
    add(g, 'exCut', 'Cut', [E], ['x'], ex((v) => this.exClip(v, 'cut')));
    add(g, 'exPaste', 'Paste', [E], ['p'], ex((v) => this.exPaste(v)));
    add(g, 'exMove', 'Move to folder', [E], ['m'], ex((v) => this.exMoveOrCopy(v, 'move')));
    add(g, 'exCopyTo', 'Copy to folder', [E], [], ex((v) => this.exMoveOrCopy(v, 'copy')));
    add(g, 'exYankName', 'Copy name', [E], ['y'], ex((v) => this.exYankPath(v, 'name')));
    add(g, 'exYankRel', 'Copy relative path', [E], ['Y'], ex((v) => this.exYankPath(v, 'relative')));
    add(g, 'exYankAbs', 'Copy absolute path', [E], ['gy'], ex((v) => this.exYankPath(v, 'absolute')));
    add(g, 'exFilter', 'Find and reveal a file', [E], ['f'], () => this.pickReveal());
    add(g, 'exReload', 'Reload tree', [E], ['R'], ex((v) => this.exReload(v)));
    add(g, 'exUndo', 'Undo last file operation', [E], ['u'], () => this.exUndo());
    add(g, 'exHelp', 'Show explorer keys', [E], ['g?'], () => new CheatsheetModal(this, E).open());
    add(g, 'exClose', 'Close explorer', [E], ['q'], () => this.closeExplorer());
    add(g, 'exEscape', 'Back to editor', [E], ['<Esc>'], () => this.focusEditor());

    // ---- Pickers
    g = 'Pickers (quick switcher, command palette, …)';
    add(g, 'pkNext', 'Next result', [P], ['<C-n>'], (ctx) => this.pickerKey(ctx, 'down'));
    add(g, 'pkPrev', 'Previous result', [P], ['<C-p>'], (ctx) => this.pickerKey(ctx, 'up'));
    add(g, 'pkVsplit', 'Open in vertical split', [P], ['<C-v>'], (ctx) => this.pickerKey(ctx, 'vertical'));
    add(g, 'pkHsplit', 'Open in horizontal split (Vimoase pickers)', [P], ['<C-x>'], (ctx) => this.pickerKey(ctx, 'horizontal'));
    add(g, 'pkTab', 'Open in new tab', [P], ['<C-t>'], (ctx) => this.pickerKey(ctx, 'tab'));

    return list;
  }

  groupedActions() {
    const groups = new Map();
    for (const a of this.actions) {
      if (!groups.has(a.group)) groups.set(a.group, []);
      groups.get(a.group).push(a);
    }
    return groups;
  }

  keysFor(id) {
    const custom = this.settings.keymap[id];
    if (Array.isArray(custom)) return custom;
    return this.actionById.get(id).keys;
  }

  setKeys(id, keys) {
    const defaults = this.actionById.get(id).keys;
    const same = keys.length === defaults.length && keys.every((k, i) => k === defaults[i]);
    if (same) delete this.settings.keymap[id];
    else this.settings.keymap[id] = keys.slice();
    this.rebuildTries();
    this.settingsChanged();
  }

  validSeqs(id) {
    return this.keysFor(id).map(parseSeq).filter(Boolean);
  }

  rebuildTries() {
    const tries = {};
    for (const [ctx] of CONTEXTS) tries[ctx] = emptyNode();
    const conflicts = [];
    for (const a of this.actions) {
      for (const seq of this.validSeqs(a.id)) {
        for (const ctx of a.contexts) {
          let node = tries[ctx];
          seq.forEach((tok, i) => {
            let child = node.children.get(tok);
            if (!child) { child = emptyNode(); node.children.set(tok, child); }
            if (i === seq.length - 1) {
              if (child.action && child.action !== a) conflicts.push({ ctx, seq, a: child.action, b: a });
              child.action = a;
            }
            node = child;
          });
        }
      }
    }
    const groupNames = { f: '+find', g: '+goto / git', 'g h': '+hunks', w: '+which-key', c: '+code', x: '+lists', r: '+rename', m: '+marks', t: '+theme', l: '+lint', z: '+fold', ']': '+next', '[': '+prev' };
    for (const ctx of Object.keys(tries)) {
      const label = (node, path) => {
        for (const [tok, child] of node.children) {
          const p = path.concat(tok);
          if (child.children.size && !child.action) {
            const key = (p[0] === 'space' ? p.slice(1) : p).join(' ');
            child.label = p.length === 1 && tok === 'space' ? '+leader' : (groupNames[key] || '+more');
          }
          label(child, p);
        }
      };
      label(tries[ctx], []);
    }
    this.tries = tries;
    this.conflicts = conflicts;
  }

  /* ================================================================ key engine */

  onKeyDown(e) {
    if (e.__vmk) return;
    const target = e.target;
    if (!target || typeof target.closest !== 'function') return;
    if (e.isComposing) return;
    const token = eventToken(e);
    if (token === null) return;

    if (this.seq) {
      this.consume(e);
      this.feed(token);
      return;
    }

    const ctx = this.resolveContext(target);
    if (!ctx) return;

    if (ctx.ed && ctx.ed.vim) {
      this.ensureYankPatch();
      if (this.selectAll) {
        if (this.selectAll.adapter !== ctx.ed.adapter || !ctx.ed.vim.visualMode) this.selectAll = null;
        else if (token === 'escape') {
          this.consume(e);
          this.restoreSelectAll(ctx.ed);
          return;
        }
      }
    }

    if (TYPING_CONTEXTS.has(ctx.name) && !(e.ctrlKey || e.altKey || e.metaKey)) return;

    const child = this.tries[ctx.name].children.get(token);
    if (!child) return;
    if (!child.children.size) {
      if (child.action.when && !child.action.when(ctx)) return;
      if (!child.action.passThrough) this.consume(e);
      this.runAction(child.action, ctx);
      return;
    }
    this.consume(e);
    this.seq = { ctx, path: [token], node: child, popupShown: false };
    this.popupTimer = window.setTimeout(() => {
      if (!this.seq) return;
      this.seq.popupShown = true;
      this.renderPopup();
    }, Math.max(0, Number(this.settings.whichKeyDelay) || 0));
    this.onSeqNode();
  }

  resolveContext(target) {
    if (target.closest('.prompt')) return { name: 'picker', target };
    const doc = target.ownerDocument || document;
    if (doc.querySelector('.modal-container, .menu')) return null;
    const ed = this.getEditorCtx(target);
    if (ed) {
      if (target.closest(SKIPPED_VIEW_SELECTOR)) return null;
      if (!ed.vim || ed.vim.insertMode) return { name: 'insert', target, ed };
      if (!this.isVimInputIdle(ed.vim)) return null;
      return { name: ed.vim.visualMode ? 'visual' : 'normal', target, ed };
    }
    if (isEditable(target)) return null;
    if (this.settings.explorerKeys && this.isExplorerFocus(target)) return { name: 'explorer', target };
    if (target.closest(SKIPPED_VIEW_SELECTOR)) return null;
    const active = this.app.workspace.activeLeaf;
    const type = active && active.view && active.view.getViewType();
    if (type && SKIPPED_VIEW_TYPES.has(type)) return null;
    return { name: 'other', target };
  }

  consume(e) {
    e.preventDefault();
    e.stopImmediatePropagation();
  }

  onSeqNode() {
    const seq = this.seq;
    window.clearTimeout(this.ambTimer);
    window.clearTimeout(this.seqTimer);
    if (seq.node.action) {
      this.ambTimer = window.setTimeout(() => {
        if (this.seq !== seq) return;
        this.cancelSeq(false);
        this.runAction(seq.node.action, seq.ctx);
      }, Math.max(0, Number(this.settings.ambiguousTimeout) || 0));
    }
    const timeout = Number(this.settings.sequenceTimeout) || 0;
    if (timeout > 0) {
      this.seqTimer = window.setTimeout(() => {
        if (this.seq !== seq) return;
        this.cancelSeq(false);
        this.replay(seq.ctx, seq.path);
      }, timeout);
    }
    if (seq.popupShown) this.renderPopup();
  }

  feed(token) {
    const seq = this.seq;
    if (token === 'escape') return this.cancelSeq(false);
    if (token === 'backspace') {
      seq.path.pop();
      if (!seq.path.length) return this.cancelSeq(false);
      let node = this.tries[seq.ctx.name];
      for (const k of seq.path) node = node.children.get(k);
      seq.node = node;
      this.onSeqNode();
      return;
    }
    const child = seq.node.children.get(token);
    if (child) {
      if (!child.children.size) {
        this.cancelSeq(false);
        if (!child.action.when || child.action.when(seq.ctx)) this.runAction(child.action, seq.ctx);
        return;
      }
      seq.node = child;
      seq.path.push(token);
      this.onSeqNode();
      return;
    }
    this.cancelSeq(false);
    if (seq.node.action) {
      this.runAction(seq.node.action, seq.ctx);
      return;
    }
    this.replay(seq.ctx, seq.path.concat(token));
  }

  /* Keys that did not form a binding go back to vim, so gg, zz, ]] … keep working. */
  replay(ctx, tokens) {
    if (!ctx || !ctx.ed || !ctx.ed.vim || (ctx.name !== 'normal' && ctx.name !== 'visual')) return;
    const Vim = vimApi();
    if (!Vim) return;
    try {
      for (const t of tokens) Vim.handleKey(ctx.ed.adapter, vimKeyFor(t));
    } catch (err) {
      console.error('[vimoase] replay', err);
    }
  }

  cancelSeq() {
    this.seq = null;
    window.clearTimeout(this.popupTimer);
    window.clearTimeout(this.seqTimer);
    window.clearTimeout(this.ambTimer);
    if (this.popupEl) { this.popupEl.remove(); this.popupEl = null; }
  }

  renderPopup() {
    const seq = this.seq;
    if (!seq) return;
    if (!this.popupEl) this.popupEl = activeDocument.body.createDiv({ cls: 'vmk-whichkey' });
    const el = this.popupEl;
    el.empty();
    const title = displaySeq(seq.path) + (seq.node.action ? '  → ' + seq.node.action.label : seq.node.label ? '  ' + seq.node.label : '');
    el.createDiv({ cls: 'vmk-whichkey-title', text: title });
    const grid = el.createDiv({ cls: 'vmk-whichkey-grid' });
    const entries = [...seq.node.children.entries()].sort(([a, na], [b, nb]) => {
      const ga = na.children.size ? 1 : 0;
      const gb = nb.children.size ? 1 : 0;
      return ga - gb || a.toLowerCase().localeCompare(b.toLowerCase()) || a.localeCompare(b);
    });
    for (const [key, node] of entries) {
      const isGroup = node.children.size > 0;
      const row = grid.createDiv({ cls: 'vmk-whichkey-row' + (isGroup ? ' is-group' : '') });
      row.createSpan({ cls: 'vmk-whichkey-key', text: displayToken(key) });
      row.createSpan({ cls: 'vmk-whichkey-arrow', text: '→' });
      row.createSpan({ cls: 'vmk-whichkey-label', text: isGroup ? (node.label || '+more') : node.action.label });
    }
  }

  runAction(action, ctx) {
    try {
      const r = action.run(ctx);
      if (r && typeof r.catch === 'function') r.catch((err) => this.fail(err));
    } catch (err) {
      this.fail(err);
    }
    if (ctx && ctx.name === 'explorer') window.setTimeout(() => this.updateCursor(), 0);
  }

  fail(err) {
    console.error('[vimoase]', err);
    new Notice('Vimoase: ' + (err && err.message ? err.message : String(err)));
  }

  /* ================================================================ editor / vim */

  getEditorCtx(target) {
    const cmEl = target.closest('.cm-editor');
    if (!cmEl) return null;
    let view = null;
    if (EditorView && typeof EditorView.findFromDOM === 'function') view = EditorView.findFromDOM(cmEl);
    if (!view) {
      const ed = this.app.workspace.activeEditor && this.app.workspace.activeEditor.editor;
      if (ed && ed.cm && ed.cm.dom === cmEl) view = ed.cm;
    }
    if (!view || !view.contentDOM || !view.contentDOM.contains(target)) return null;
    const adapter = view.cm || null;
    const vim = (adapter && adapter.state && adapter.state.vim) || null;
    return { view, adapter, vim };
  }

  isVimInputIdle(vim) {
    const s = vim.inputState;
    if (!s) return true;
    const len = (x) => (x ? x.length || 0 : 0);
    return !s.operator && !s.motion && len(s.keyBuffer) === 0 && len(s.prefixRepeat) === 0 && len(s.motionRepeat) === 0 && !s.selectedCharacter;
  }

  obsidianEditor() {
    const ae = this.app.workspace.activeEditor;
    return (ae && ae.editor) || null;
  }

  copyWholeFile(ed) {
    const text = ed.view.state.doc.toString();
    this.writeClipboard(text, false);
    new Notice('Copied whole note');
  }

  noHighlight(ed) {
    const Vim = vimApi();
    if (!Vim || !ed.adapter || typeof Vim.handleEx !== 'function') return;
    try { Vim.handleEx(ed.adapter, 'nohlsearch'); } catch (_) { /* no search active */ }
  }

  toggleComment(ctx) {
    this.cmd('editor:toggle-comments');
    const Vim = vimApi();
    if (ctx && ctx.name === 'visual' && ctx.ed && ctx.ed.vim && ctx.ed.vim.visualMode && Vim) Vim.exitVisualMode(ctx.ed.adapter);
  }

  toggleLineNumbers() {
    const vault = this.app.vault;
    if (typeof vault.getConfig !== 'function' || typeof vault.setConfig !== 'function') {
      new Notice('Vimoase: cannot change line numbers in this Obsidian version');
      return;
    }
    const next = !vault.getConfig('showLineNumber');
    vault.setConfig('showLineNumber', next);
    new Notice('Line numbers ' + (next ? 'on' : 'off'));
  }

  insMove(ed, dir) {
    const a = ed.adapter;
    const cur = a.getCursor();
    let { line, ch } = cur;
    if (dir === 'left') {
      if (ch > 0) ch--;
      else if (line > 0) { line--; ch = a.getLine(line).length; }
    } else if (dir === 'right') {
      if (ch < a.getLine(line).length) ch++;
      else if (line < a.lastLine()) { line++; ch = 0; }
    } else if (dir === 'down') {
      if (line < a.lastLine()) { line++; ch = Math.min(ch, a.getLine(line).length); }
    } else if (dir === 'up') {
      if (line > 0) { line--; ch = Math.min(ch, a.getLine(line).length); }
    } else if (dir === 'home') {
      const text = a.getLine(line);
      const first = text.search(/\S/);
      ch = first < 0 ? text.length : first;
    }
    a.setCursor({ line, ch });
  }

  jumpTodo(ed, dir) {
    const a = ed.adapter;
    if (!a) return;
    const count = a.lastLine() + 1;
    const start = a.getCursor().line;
    for (let i = 1; i <= count; i++) {
      const line = (start + dir * i + count * 2) % count;
      const text = a.getLine(line);
      if (TODO_LINE.test(text)) {
        const m = text.match(/\b(TODO|FIXME|FIX)\b|\[ \]/);
        const ch = m ? m.index : 0;
        const editor = this.obsidianEditor();
        if (editor) {
          editor.setCursor({ line, ch });
          editor.scrollIntoView({ from: { line, ch }, to: { line, ch } }, true);
        } else {
          a.setCursor({ line, ch });
        }
        return;
      }
    }
    new Notice('No TODOs in this note');
  }

  fold(ed, close) {
    if (cmLanguage) {
      const fn = close ? cmLanguage.foldCode : cmLanguage.unfoldCode;
      if (typeof fn === 'function' && fn(ed.view)) return;
    }
    this.cmd('editor:toggle-fold');
  }

  findLinkAt(text, ch) {
    const wiki = /!?\[\[([^\]]+?)\]\]/g;
    let m;
    while ((m = wiki.exec(text))) {
      if (ch >= m.index && ch < m.index + m[0].length) return m[1].split('|')[0].trim();
    }
    const md = /!?\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
    while ((m = md.exec(text))) {
      if (ch >= m.index && ch < m.index + m[0].length) {
        let link = m[1];
        try { link = decodeURIComponent(link); } catch (_) { /* keep raw */ }
        if (/^[a-z][a-z0-9+.-]*:/i.test(link)) return { external: link };
        return link;
      }
    }
    return null;
  }

  hoverLink(ed) {
    const a = ed.adapter;
    if (!a) return;
    const cur = a.getCursor();
    const link = this.findLinkAt(a.getLine(cur.line), cur.ch);
    if (!link) return new Notice('No link under cursor');
    if (typeof link === 'object') return new Notice(link.external);
    const mdView = this.app.workspace.getActiveViewOfType(MarkdownView);
    const file = this.app.workspace.getActiveFile();
    const pos = ed.view.state.selection.main.head;
    let el = null;
    try {
      const dom = ed.view.domAtPos(pos);
      el = dom.node.nodeType === 3 ? dom.node.parentElement : dom.node;
    } catch (_) { el = ed.view.contentDOM; }
    const coords = ed.view.coordsAtPos(pos) || { left: 0, top: 0 };
    const event = new MouseEvent('mouseover', { ctrlKey: true, metaKey: true, clientX: coords.left, clientY: coords.top });
    this.app.workspace.trigger('hover-link', {
      event, source: 'editor', hoverParent: mdView || ed.view, targetEl: el, linktext: link, sourcePath: file ? file.path : '',
    });
  }

  visualBlock(ed) {
    const Vim = vimApi();
    if (!Vim) return;
    if (ed.vim.visualMode && ed.vim.visualBlock) Vim.exitVisualMode(ed.adapter);
    else Vim.handleKey(ed.adapter, '<C-v>');
  }

  keepScroll(view, top) {
    const restore = () => { view.scrollDOM.scrollTop = top; };
    restore();
    window.requestAnimationFrame(() => { restore(); window.requestAnimationFrame(restore); });
  }

  doSelectAll(ed) {
    const Vim = vimApi();
    const { view, adapter, vim } = ed;
    if (!Vim) return;
    if (!this.selectAll || this.selectAll.adapter !== adapter) {
      this.selectAll = { adapter, cursor: adapter.getCursor('head'), scrollTop: view.scrollDOM.scrollTop };
    }
    const top = this.selectAll.scrollTop;
    if (vim.insertMode) Vim.handleKey(adapter, '<Esc>');
    if (vim.visualMode) Vim.exitVisualMode(adapter);
    adapter.setCursor({ line: 0, ch: 0 });
    Vim.handleKey(adapter, 'V');
    Vim.handleKey(adapter, 'G');
    this.keepScroll(view, top);
  }

  restoreSelectAll(ed) {
    const Vim = vimApi();
    const { view, adapter, vim } = ed;
    const saved = this.selectAll;
    this.selectAll = null;
    if (!saved) return;
    if (Vim && vim.visualMode) Vim.exitVisualMode(adapter);
    const line = Math.min(saved.cursor.line, adapter.lastLine());
    const ch = Math.min(saved.cursor.ch, Math.max(0, adapter.getLine(line).length - 1));
    adapter.setCursor({ line, ch });
    this.keepScroll(view, saved.scrollTop);
  }

  clipTarget(adapter, vim) {
    if (vim.visualMode && vim.visualLine) {
      const sel = vim.sel || {};
      const a = sel.anchor || adapter.getCursor('anchor');
      const h = sel.head || adapter.getCursor('head');
      const from = Math.min(a.line, h.line);
      const to = Math.max(a.line, h.line);
      const lines = [];
      for (let i = from; i <= to; i++) lines.push(adapter.getLine(i));
      return { kind: 'lines', from, to, text: lines.join('\n') + '\n' };
    }
    if (vim.visualMode || adapter.somethingSelected()) {
      return { kind: 'ranges', ranges: adapter.listSelections(), text: adapter.getSelections().join('\n') };
    }
    const line = adapter.getCursor().line;
    return { kind: 'lines', from: line, to: line, text: adapter.getLine(line) + '\n' };
  }

  withOp(adapter, fn) {
    return typeof adapter.operation === 'function' ? adapter.operation(fn) : fn();
  }

  deleteTarget(adapter, t) {
    this.withOp(adapter, () => {
      if (t.kind === 'lines') {
        const last = adapter.lastLine();
        let from = { line: t.from, ch: 0 };
        let to;
        if (t.to < last) to = { line: t.to + 1, ch: 0 };
        else {
          to = { line: t.to, ch: adapter.getLine(t.to).length };
          if (t.from > 0) from = { line: t.from - 1, ch: adapter.getLine(t.from - 1).length };
        }
        adapter.replaceRange('', from, to);
        adapter.setCursor({ line: Math.min(t.from, adapter.lastLine()), ch: 0 });
        return;
      }
      const ranges = t.ranges.map(orderRange).sort((x, y) => cmpPos(y[0], x[0]));
      for (const [s, e] of ranges) adapter.replaceRange('', s, e);
      if (ranges.length) adapter.setCursor(ranges[ranges.length - 1][0]);
    });
  }

  writeClipboard(text, linewise) {
    this.lastLinewise = linewise ? text : null;
    navigator.clipboard.writeText(text).catch((err) => this.fail(err));
  }

  doCopy(ed, cut) {
    const Vim = vimApi();
    const { adapter, vim } = ed;
    const t = this.clipTarget(adapter, vim);
    this.writeClipboard(t.text, t.kind === 'lines');
    if (cut) {
      this.selectAll = null;
      if (vim.visualMode && Vim) Vim.exitVisualMode(adapter);
      this.deleteTarget(adapter, t);
      return;
    }
    if (this.selectAll && this.selectAll.adapter === adapter) {
      this.restoreSelectAll(ed);
    } else if (vim.visualMode && Vim) {
      Vim.exitVisualMode(adapter);
      if (t.kind === 'lines') adapter.setCursor({ line: t.from, ch: 0 });
      else if (t.ranges.length) adapter.setCursor(orderRange(t.ranges[0])[0]);
    }
  }

  async doPaste(ed) {
    const Vim = vimApi();
    const { adapter, vim } = ed;
    let text;
    try { text = await navigator.clipboard.readText(); } catch (err) { return this.fail(err); }
    if (!text) return;
    const linewise = text.endsWith('\n');

    if (vim.visualMode || (!vim.insertMode && adapter.somethingSelected())) {
      const t = this.clipTarget(adapter, vim);
      this.selectAll = null;
      if (vim.visualMode && Vim) Vim.exitVisualMode(adapter);
      this.withOp(adapter, () => {
        if (t.kind === 'lines') {
          const body = linewise ? text.slice(0, -1) : text;
          adapter.replaceRange(body, { line: t.from, ch: 0 }, { line: t.to, ch: adapter.getLine(t.to).length });
          adapter.setCursor({ line: t.from, ch: 0 });
        } else {
          const ranges = t.ranges.map(orderRange).sort((x, y) => cmpPos(y[0], x[0]));
          for (const [s, e] of ranges) adapter.replaceRange(text, s, e);
        }
      });
      return;
    }
    if (vim.insertMode) { adapter.replaceSelection(text); return; }
    const cur = adapter.getCursor();
    this.withOp(adapter, () => {
      if (linewise) {
        adapter.replaceRange(text, { line: cur.line, ch: 0 });
        adapter.setCursor({ line: cur.line, ch: 0 });
      } else {
        adapter.replaceRange(text, cur);
        const end = posAfterInsert(cur, text);
        adapter.setCursor({ line: end.line, ch: Math.max(0, end.ch - 1) });
      }
    });
  }

  ensureYankPatch() {
    if (!this.settings.yankToClipboard) return;
    const Vim = vimApi();
    if (!Vim || typeof Vim.getRegisterController !== 'function') return;
    const rc = Vim.getRegisterController();
    if (!rc || typeof rc.pushText !== 'function') return;
    if (this.patchedRegisters && this.patchedRegisters.rc === rc) return;
    this.removeYankPatch();
    const original = rc.pushText;
    const plugin = this;
    rc.pushText = function (registerName, operator, text, linewise) {
      const result = original.apply(this, arguments);
      try {
        if (operator === 'yank' && (!registerName || registerName === '"') && typeof text === 'string') {
          plugin.writeClipboard(linewise && !text.endsWith('\n') ? text + '\n' : text, !!linewise);
        }
      } catch (err) { console.error('[vimoase]', err); }
      return result;
    };
    this.patchedRegisters = { rc, original };
  }

  removeYankPatch() {
    const p = this.patchedRegisters;
    if (!p) return;
    p.rc.pushText = p.original;
    this.patchedRegisters = null;
  }

  /* Real vim mappings (jk → <Esc>, ; → :) through Obsidian's vim API. */
  applyVimMaps() {
    const Vim = vimApi();
    this.removeVimMaps();
    if (!Vim || typeof Vim.map !== 'function') return;
    for (const m of this.settings.vimMaps) {
      const lhs = (m.lhs || '').trim();
      const rhs = (m.rhs || '').trim();
      if (!lhs || !rhs) continue;
      try {
        Vim.map(lhs, rhs, m.mode || 'normal');
        this.appliedVimMaps.push({ lhs, mode: m.mode || 'normal' });
      } catch (err) {
        console.error('[vimoase] vim map', m, err);
      }
    }
    if (this.settings.wrapAppend && typeof Vim.defineAction === 'function' && typeof Vim.mapCommand === 'function') {
      try {
        Vim.defineAction('vmkAppendDisplayLine', appendAtDisplayLineEnd);
        Vim.mapCommand('A', 'action', 'vmkAppendDisplayLine', {}, { context: 'normal' });
        this.appliedVimMaps.push({ lhs: 'A', mode: 'normal' });
      } catch (err) {
        console.error('[vimoase] wrap append', err);
      }
    }
  }

  removeVimMaps() {
    const Vim = vimApi();
    if (Vim && typeof Vim.unmap === 'function') {
      for (const m of this.appliedVimMaps) {
        try { Vim.unmap(m.lhs, m.mode); } catch (_) { /* already gone */ }
      }
    }
    this.appliedVimMaps = [];
  }

  /* ================================================================ workspace */

  cmd(id, needsMain) {
    const commands = this.app.commands;
    if (!commands || !commands.commands || !commands.commands[id]) {
      new Notice('Vimoase: command not available: ' + id);
      return false;
    }
    if (needsMain) {
      const ws = this.app.workspace;
      const active = ws.activeLeaf;
      if (!active || active.getRoot() !== ws.rootSplit) {
        const main = this.mainLeaf();
        if (main) ws.setActiveLeaf(main, { focus: true });
      }
    }
    return commands.executeCommandById(id);
  }

  cmdMatch(spec) {
    const commands = (this.app.commands && this.app.commands.commands) || {};
    let id = (spec.ids || []).find((x) => commands[x]);
    if (!id && spec.plugin && spec.name) {
      id = Object.keys(commands).find((x) => x.startsWith(spec.plugin + ':') && spec.name.test(commands[x].name || ''));
    }
    if (!id) {
      new Notice('Vimoase: needs ' + (spec.needs || 'a plugin') + ' (no matching command)');
      return false;
    }
    return this.cmd(id);
  }

  globalSearch(query) {
    const ip = this.app.internalPlugins;
    const gs = ip && typeof ip.getPluginById === 'function' && ip.getPluginById('global-search');
    if (gs && gs.instance && typeof gs.instance.openGlobalSearch === 'function') gs.instance.openGlobalSearch(query);
    else this.cmd('global-search:open');
  }

  mainLeaf() {
    const ws = this.app.workspace;
    return ws.getMostRecentLeaf(ws.rootSplit) || null;
  }

  focusEditor() {
    const leaf = this.mainLeaf();
    if (!leaf) return;
    this.app.workspace.setActiveLeaf(leaf, { focus: true });
    const editor = leaf.view && leaf.view.editor;
    if (editor && typeof editor.focus === 'function') editor.focus();
  }

  focusDir(dir) {
    const ws = this.app.workspace;
    const active = ws.activeLeaf;
    const sidebar = active && this.sidebarOf(active);
    if (sidebar === ws.leftSplit && dir === 'right') return this.focusEditor();
    if (sidebar === ws.rightSplit && dir === 'left') return this.focusEditor();
    if (sidebar) return;
    const id = { left: 'editor:focus-left', right: 'editor:focus-right', up: 'editor:focus-top', down: 'editor:focus-bottom' }[dir];
    const commands = this.app.commands.commands;
    if (commands[id]) this.app.commands.executeCommandById(id);
    if (ws.activeLeaf !== active) return;
    // Already at the edge: hop into the sidebar, like a tree window in nvim.
    const split = dir === 'left' ? ws.leftSplit : dir === 'right' ? ws.rightSplit : null;
    if (!split || split.collapsed) return;
    const explorer = this.explorerLeaf();
    if (explorer && this.sidebarOf(explorer) === split && explorer.view.containerEl.isShown()) {
      this.focusExplorer();
      return;
    }
    let target = null;
    ws.iterateAllLeaves((leaf) => {
      if (!target && leaf.getRoot() === split && leaf.view && leaf.view.containerEl.isShown()) target = leaf;
    });
    if (target) ws.setActiveLeaf(target, { focus: true });
  }

  explorerLeaf() { return this.app.workspace.getLeavesOfType('file-explorer')[0] || null; }
  explorerView() { const l = this.explorerLeaf(); return (l && l.view) || null; }

  /* A plain click on a file opens it and Obsidian moves focus to the editor. Bring focus back
   * to the explorer (cursor on the clicked file) so explorer keys like m / r / d keep working.
   * Click into the note, or press Enter / l, to edit it. */
  onExplorerFileClick(view, e) {
    this.keepFocus = null;
    if (!this.settings.explorerKeys || !this.settings.explorerClickKeepsFocus) return;
    if (e.button !== 0 || e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return;
    const self = e.target.closest('.tree-item-self');
    if (!self || e.target.closest('input, textarea, [contenteditable="true"]')) return;
    const items = view.fileItems || {};
    const path = self.getAttribute('data-path') || Object.keys(items).find((p) => items[p] && items[p].selfEl === self);
    const file = path && this.get(path);
    if (!(file instanceof TFile)) return;
    this.keepFocus = { path, until: Date.now() + 800 };
    window.setTimeout(() => this.reclaimExplorerFocus(null, true), 120);
  }

  reclaimExplorerFocus(leaf, fromTimer) {
    const pending = this.keepFocus;
    if (!pending) return;
    if (Date.now() > pending.until) { this.keepFocus = null; return; }
    const explorer = this.explorerLeaf();
    if (!explorer) { this.keepFocus = null; return; }
    const ws = this.app.workspace;
    const doc = explorer.view.containerEl.ownerDocument || document;
    const focusInExplorer = explorer.view.containerEl.contains(doc.activeElement);
    if (!fromTimer && (!leaf || leaf === explorer)) return;
    if (fromTimer && ws.activeLeaf === explorer && focusInExplorer) {
      this.keepFocus = null;
      this.focusItemByPath(explorer.view, pending.path);
      return;
    }
    if (!fromTimer) this.keepFocus = null;
    ws.setActiveLeaf(explorer, { focus: true });
    this.focusItemByPath(explorer.view, pending.path);
  }

  focusItemByPath(view, path) {
    const item = view.fileItems && view.fileItems[path];
    if (item) this.setFocus(view, item);
    const el = view.containerEl.querySelector('.nav-files-container') || view.containerEl;
    if (el && typeof el.focus === 'function' && !el.contains(el.ownerDocument.activeElement)) el.focus({ preventScroll: true });
  }

  isExplorerFocus(target) {
    const leaf = this.explorerLeaf();
    if (!leaf || !leaf.view) return false;
    if (leaf.view.containerEl.contains(target)) return true;
    const doc = target.ownerDocument || document;
    return this.app.workspace.activeLeaf === leaf && target === doc.body;
  }

  sidebarOf(leaf) {
    const ws = this.app.workspace;
    const root = leaf.getRoot();
    return root === ws.leftSplit || root === ws.rightSplit ? root : null;
  }

  async focusExplorer() {
    let leaf = this.explorerLeaf();
    if (!leaf) {
      this.cmd('file-explorer:open');
      leaf = this.explorerLeaf();
      if (!leaf) return;
    }
    const ws = this.app.workspace;
    const sidebar = this.sidebarOf(leaf);
    if (sidebar && sidebar.collapsed) sidebar.expand();
    await ws.revealLeaf(leaf);
    ws.setActiveLeaf(leaf, { focus: true });
    this.syncExplorer();
    this.updateCursor();
  }

  async revealInExplorer() {
    const file = this.app.workspace.getActiveFile();
    await this.focusExplorer();
    const view = this.explorerView();
    if (view && file) this.revealFile(view, file);
  }

  async toggleExplorer() {
    const leaf = this.explorerLeaf();
    if (leaf) {
      const sidebar = this.sidebarOf(leaf);
      const shown = (!sidebar || !sidebar.collapsed) && leaf.view.containerEl.isShown();
      if (shown) { this.closeExplorer(); return; }
    }
    await this.revealInExplorer();
  }

  closeExplorer() {
    const leaf = this.explorerLeaf();
    const sidebar = leaf && this.sidebarOf(leaf);
    if (sidebar) sidebar.collapse();
    this.focusEditor();
  }

  renameActiveNote() {
    const file = this.app.workspace.getActiveFile();
    if (!file) return new Notice('No active note');
    const ext = file.extension ? '.' + file.extension : '';
    new PromptModal(this.app, {
      title: 'Rename note',
      desc: file.path,
      value: file.basename,
      select: [0, file.basename.length],
      onSubmit: (value) => this.wrap(async () => {
        let name = value.trim();
        if (!name || name === file.basename) return;
        if (!hasExtension(basename(name))) name += ext;
        await this.renameTo(file, joinPath(file.parent ? file.parent.path : '/', name));
      }),
    }).open();
  }

  /* ================================================================ pickers */

  openPicker(opts) { new PickerModal(this, opts).open(); }

  pickAllFiles() {
    this.openPicker({
      placeholder: 'Find all files…',
      items: () => this.app.vault.getFiles(),
      text: (f) => f.path,
      onChoose: (f, mode) => this.openFile(f, mode),
    });
  }

  pickRecent() {
    this.openPicker({
      placeholder: 'Recent files…',
      items: () => this.app.workspace.getLastOpenFiles().map((p) => this.get(p)).filter((f) => f instanceof TFile),
      text: (f) => f.path,
      onChoose: (f, mode) => this.openFile(f, mode),
    });
  }

  pickTabs() {
    this.openPicker({
      placeholder: 'Open tabs…',
      items: () => {
        const leaves = [];
        this.app.workspace.iterateRootLeaves((leaf) => leaves.push(leaf));
        return leaves;
      },
      text: (leaf) => {
        const file = leaf.view && leaf.view.file;
        return file ? file.path : leaf.getDisplayText();
      },
      onChoose: (leaf, mode) => {
        const file = leaf.view && leaf.view.file;
        if (mode && file) return this.openFile(file, mode);
        this.app.workspace.setActiveLeaf(leaf, { focus: true });
      },
    });
  }

  pickReveal() {
    this.openPicker({
      placeholder: 'Reveal in file explorer…',
      items: () => this.app.vault.getAllLoadedFiles().filter((f) => !(f instanceof TFolder && f.isRoot())),
      text: (f) => (f instanceof TFolder ? f.path + '/' : f.path),
      onChoose: async (f) => {
        await this.focusExplorer();
        const view = this.explorerView();
        if (view) this.revealFile(view, f);
      },
    });
  }

  pickBinding() {
    const items = [];
    for (const a of this.actions) for (const s of this.validSeqs(a.id)) items.push({ a, s });
    this.openPicker({
      placeholder: 'Search key bindings…',
      items: () => items,
      text: (it) => displaySeq(it.s) + '   ' + it.a.label + '   (' + it.a.contexts.map((c) => CONTEXT_LABEL[c]).join(', ') + ')',
      onChoose: (it) => new Notice(displaySeq(it.s) + ' → ' + it.a.label),
    });
  }

  pickerKey(ctx, what) {
    const prompt = ctx.target.closest('.prompt');
    const input = (prompt && prompt.querySelector('input')) || ctx.target;
    const mod = Platform.isMacOS ? { metaKey: true } : { ctrlKey: true };
    const send = (key, mods) => {
      const ev = new KeyboardEvent('keydown', Object.assign({ key, code: key, bubbles: true, cancelable: true }, mods || {}));
      ev.__vmk = true;
      input.dispatchEvent(ev);
    };
    const picker = this.activePicker;
    if (what === 'down' || what === 'up') {
      const chooser = picker && picker.chooser;
      if (chooser && typeof chooser.setSelectedItem === 'function' && typeof chooser.selectedItem === 'number') {
        const len = Array.isArray(chooser.values) ? chooser.values.length : 0;
        if (len) chooser.setSelectedItem((chooser.selectedItem + (what === 'down' ? 1 : -1) + len) % len, null);
        return;
      }
      send(what === 'down' ? 'ArrowDown' : 'ArrowUp');
      return;
    }
    if (picker) {
      picker.openMode = what;
      const chooser = picker.chooser;
      if (chooser && typeof chooser.useSelectedItem === 'function') chooser.useSelectedItem(new KeyboardEvent('keydown', { key: 'Enter' }));
      else send('Enter');
      return;
    }
    if (what === 'tab') send('Enter', mod);
    else if (what === 'vertical') send('Enter', Object.assign({ altKey: true }, mod));
    else new Notice('Horizontal split is only available in Vimoase pickers');
  }

  /* ================================================================ explorer: scope, cursor */

  syncExplorer() {
    this.syncExplorerScope();
    this.patchTree();
    this.updateCursor();
  }

  scopeKeyToken(k) {
    if (!k || !k.key) return null;
    const m = { C: false, A: false, S: false, D: false };
    for (const mod of String(k.modifiers || '').split(',').filter(Boolean)) {
      if (mod === 'Mod') { if (Platform.isMacOS) m.D = true; else m.C = true; }
      else if (mod === 'Ctrl') m.C = true;
      else if (mod === 'Alt') m.A = true;
      else if (mod === 'Shift') m.S = true;
      else if (mod === 'Meta') m.D = true;
    }
    if (EVENT_NAMED[k.key]) return buildToken(m, EVENT_NAMED[k.key]);
    if (k.key.length === 1) {
      if (!(m.C || m.A || m.D)) return m.S ? k.key.toUpperCase() : k.key.toLowerCase();
      return buildToken(m, k.key.toLowerCase());
    }
    return null;
  }

  /* Obsidian's explorer handles some keys itself (space, enter …); turn off the ones we bind. */
  syncExplorerScope() {
    const view = this.explorerView();
    const scope = view && ((view.tree && view.tree.scope) || view.scope);
    this.restoreExplorerScope();
    if (!this.settings.explorerKeys || !scope || !Array.isArray(scope.keys)) return;
    const ours = new Set(this.tries.explorer.children.keys());
    const removed = scope.keys.filter((k) => ours.has(this.scopeKeyToken(k)));
    for (const k of removed) {
      if (typeof scope.unregister === 'function') scope.unregister(k);
      else scope.keys.remove(k);
    }
    this.disabledScope = { scope, removed };
  }

  restoreExplorerScope() {
    const d = this.disabledScope;
    if (!d) return;
    for (const k of d.removed) if (!d.scope.keys.includes(k)) d.scope.keys.push(k);
    this.disabledScope = null;
  }

  patchTree() {
    const view = this.explorerView();
    const tree = view && view.tree;
    if (!tree || typeof tree.setFocusedItem !== 'function') return;
    if (this.patchedTree && this.patchedTree.tree === tree) return;
    this.unpatchTree();
    const original = tree.setFocusedItem;
    const plugin = this;
    tree.setFocusedItem = function () {
      const r = original.apply(this, arguments);
      plugin.updateCursor();
      return r;
    };
    this.patchedTree = { tree, original };
  }

  unpatchTree() {
    const p = this.patchedTree;
    if (!p) return;
    p.tree.setFocusedItem = p.original;
    this.patchedTree = null;
    if (this.cursorEl) { this.cursorEl.removeClass('vmk-cursor'); this.cursorEl = null; }
  }

  updateCursor() {
    const view = this.explorerView();
    const item = view && this.focusedItem(view);
    const el = (this.settings.cursorEnabled && item && item.selfEl) || null;
    if (this.cursorEl && this.cursorEl !== el) this.cursorEl.removeClass('vmk-cursor');
    if (el) el.addClass('vmk-cursor');
    this.cursorEl = el;
  }

  applyCursorStyle() {
    const body = document.body;
    body.style.setProperty('--vmk-cursor-color', this.settings.cursorColor || DEFAULT_SETTINGS.cursorColor);
    body.style.setProperty('--vmk-cursor-strength', Math.max(5, Math.min(100, Number(this.settings.cursorStrength) || 30)) + '%');
    body.removeClass('vmk-cursor-fill', 'vmk-cursor-outline', 'vmk-cursor-bar');
    body.addClass('vmk-cursor-' + (this.settings.cursorStyle || 'fill'));
  }

  removeCursorStyle() {
    const body = document.body;
    body.style.removeProperty('--vmk-cursor-color');
    body.style.removeProperty('--vmk-cursor-strength');
    body.removeClass('vmk-cursor-fill', 'vmk-cursor-outline', 'vmk-cursor-bar');
  }

  /* ================================================================ explorer: navigation */

  focusedItem(view) { return (view.tree && view.tree.focusedItem) || null; }
  focusedFile(view) { const i = this.focusedItem(view); return (i && i.file) || null; }

  /* The item an explorer command acts on: the keyboard cursor, else the item highlighted by a
   * mouse click (selection / active row), else the file open in the editor. */
  targetFile(view) {
    const focused = this.focusedFile(view);
    if (focused) return focused;
    const tree = view.tree || {};
    const fromDom = (d) => (d && d.file) || null;
    const sel = tree.selectedDoms;
    if (sel && typeof sel.size === 'number' && sel.size === 1) {
      const f = fromDom(sel.values().next().value);
      if (f) return f;
    }
    const active = fromDom(tree.activeDom) || fromDom(view.activeDom);
    if (active) return active;
    return this.app.workspace.getActiveFile() || null;
  }

  setFocus(view, item) {
    if (!item) return;
    if (view.tree && typeof view.tree.setFocusedItem === 'function') view.tree.setFocusedItem(item, true);
    this.updateCursor();
  }

  itemChildren(item) {
    const vc = item && item.vChildren;
    const arr = vc && (vc.children || vc._children);
    return Array.isArray(arr) ? arr : null;
  }

  visibleItems(view) {
    const out = [];
    const root = (view.tree && view.tree.root) || (view.fileItems && view.fileItems['/']);
    if (root && this.itemChildren(root)) {
      const walk = (item) => {
        for (const child of this.itemChildren(item) || []) {
          out.push(child);
          if (child.file instanceof TFolder && !child.collapsed) walk(child);
        }
      };
      walk(root);
      return out;
    }
    const items = view.fileItems || {};
    const walk = (folder) => {
      const kids = [...folder.children].sort((a, b) => {
        const fa = a instanceof TFolder ? 0 : 1;
        const fb = b instanceof TFolder ? 0 : 1;
        return fa - fb || a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
      });
      for (const f of kids) {
        const item = items[f.path];
        if (!item) continue;
        out.push(item);
        if (f instanceof TFolder && !item.collapsed) walk(f);
      }
    };
    walk(this.app.vault.getRoot());
    return out;
  }

  step(view, delta) {
    const list = this.visibleItems(view);
    if (!list.length) return;
    const cur = this.focusedItem(view);
    let i = list.indexOf(cur);
    if (i < 0) i = delta > 0 ? 0 : list.length - 1;
    else i = Math.max(0, Math.min(list.length - 1, i + delta));
    this.setFocus(view, list[i]);
  }

  exDown(view) {
    const t = view.tree;
    if (t && typeof t.onKeyArrowDown === 'function') t.onKeyArrowDown(fakeKey('ArrowDown'));
    else this.step(view, 1);
  }

  exUp(view) {
    const t = view.tree;
    if (t && typeof t.onKeyArrowUp === 'function') t.onKeyArrowUp(fakeKey('ArrowUp'));
    else this.step(view, -1);
  }

  exEdge(view, last) {
    const list = this.visibleItems(view);
    if (list.length) this.setFocus(view, last ? list[list.length - 1] : list[0]);
  }

  setCollapsed(view, item, collapsed) {
    if (typeof item.setCollapsed === 'function') item.setCollapsed(collapsed, true);
    else if (item.collapsed !== collapsed && typeof item.toggleCollapsed === 'function') item.toggleCollapsed(true);
    else if (view.tree) {
      const fn = collapsed ? view.tree.onKeyArrowLeft : view.tree.onKeyArrowRight;
      if (typeof fn === 'function') fn.call(view.tree, fakeKey(collapsed ? 'ArrowLeft' : 'ArrowRight'));
    }
  }

  exLeft(view) {
    const item = this.focusedItem(view);
    if (!item) return this.exDown(view);
    if (item.file instanceof TFolder && !item.collapsed) { this.setCollapsed(view, item, true); return; }
    this.exParent(view);
  }

  exParent(view) {
    const item = this.focusedItem(view);
    const parent = item && item.file && item.file.parent;
    if (parent && !parent.isRoot()) this.setFocus(view, view.fileItems[parent.path]);
  }

  exRight(view) {
    const item = this.focusedItem(view);
    if (!item) return this.exDown(view);
    if (item.file instanceof TFile) return this.openFile(item.file);
    if (item.collapsed) { this.setCollapsed(view, item, false); return; }
    const kids = this.itemChildren(item);
    if (kids && kids.length) this.setFocus(view, kids[0]);
  }

  exEnter(view) {
    const item = this.focusedItem(view);
    if (!item) return;
    if (item.file instanceof TFile) return this.openFile(item.file);
    this.setCollapsed(view, item, !item.collapsed);
  }

  async exPreview(view) {
    const file = this.focusedFile(view);
    if (!(file instanceof TFile)) return;
    const ws = this.app.workspace;
    const leaf = this.mainLeaf() || ws.getLeaf('tab');
    await leaf.openFile(file, { active: false });
    const explorer = this.explorerLeaf();
    if (explorer) ws.setActiveLeaf(explorer, { focus: true });
    this.updateCursor();
  }

  exCollapseAll(view) {
    const focused = this.focusedFile(view);
    if (view.tree && typeof view.tree.setCollapseAll === 'function') view.tree.setCollapseAll(true);
    else {
      for (const item of Object.values(view.fileItems || {})) {
        if (item.file instanceof TFolder && !item.file.isRoot() && !item.collapsed) this.setCollapsed(view, item, true);
      }
    }
    if (focused) {
      let top = focused;
      while (top.parent && !top.parent.isRoot()) top = top.parent;
      this.setFocus(view, view.fileItems[top.path]);
    }
  }

  exReload(view) {
    if (typeof view.requestSort === 'function') view.requestSort();
    else if (typeof view.sort === 'function') view.sort();
    new Notice('File explorer refreshed');
  }

  exYankPath(view, kind) {
    const file = this.focusedFile(view);
    if (!file) return;
    let text = file.path;
    if (kind === 'name') text = file.name;
    else if (kind === 'absolute') {
      const adapter = this.app.vault.adapter;
      if (typeof adapter.getFullPath === 'function') text = adapter.getFullPath(file.path);
      else if (adapter.basePath) text = adapter.basePath + '/' + file.path;
    }
    this.writeClipboard(text, false);
    new Notice('Copied: ' + text);
  }

  async openFile(file, mode) {
    const ws = this.app.workspace;
    const main = this.mainLeaf();
    let leaf;
    if (mode === 'vertical' || mode === 'horizontal') {
      leaf = main ? ws.createLeafBySplit(main, mode) : ws.getLeaf('split', mode);
    } else if (mode === 'tab' || (main && main.getViewState().pinned)) {
      if (main) ws.setActiveLeaf(main, { focus: false });
      leaf = ws.getLeaf('tab');
    } else {
      leaf = main || ws.getLeaf('tab');
    }
    await leaf.openFile(file, { active: true });
    ws.setActiveLeaf(leaf, { focus: true });
  }

  exOpenFocused(view, mode) {
    const file = this.focusedFile(view);
    if (file instanceof TFile) return this.openFile(file, mode);
  }

  revealFile(view, file) {
    window.setTimeout(() => {
      if (typeof view.revealInFolder === 'function') view.revealInFolder(file);
      const item = view.fileItems && view.fileItems[file.path];
      if (item) this.setFocus(view, item);
    }, 50);
  }

  refocus(view, file) {
    this.focusExplorer().then(() => { if (file) this.revealFile(view, file); });
  }

  /* ================================================================ explorer: file operations */

  targetFolder(view) {
    const f = this.focusedFile(view);
    if (!f) return this.app.vault.getRoot();
    if (f instanceof TFolder) return f;
    return f.parent || this.app.vault.getRoot();
  }

  get(path) { return this.app.vault.getAbstractFileByPath(normalizePath(path)); }

  async ensureFolder(path, created) {
    if (!path || path === '/') return this.app.vault.getRoot();
    let cur = '';
    for (const part of normalizePath(path).split('/')) {
      cur = cur ? cur + '/' + part : part;
      const existing = this.get(cur);
      if (existing instanceof TFile) throw new Error('"' + cur + '" is a file');
      if (!existing) {
        await this.app.vault.createFolder(cur);
        if (created) created.push(cur);
      }
    }
    return this.get(path);
  }

  uniquePath(folderPath, name) {
    const isFile = hasExtension(name);
    const dot = name.lastIndexOf('.');
    const base = isFile ? name.slice(0, dot) : name;
    const ext = isFile ? name.slice(dot) : '';
    let candidate = joinPath(folderPath, name);
    let n = 1;
    while (this.get(candidate)) { candidate = joinPath(folderPath, base + ' ' + n + ext); n++; }
    return candidate;
  }

  pushUndo(label, run) {
    this.undoStack.push({ label, run });
    if (this.undoStack.length > 100) this.undoStack.shift();
  }

  async trash(file) {
    if (this.app.fileManager && typeof this.app.fileManager.trashFile === 'function') await this.app.fileManager.trashFile(file);
    else await this.app.vault.trash(file, true);
  }

  async trashPaths(paths) {
    for (const p of [...paths].reverse()) {
      const f = this.get(p);
      if (!f) continue;
      if (f instanceof TFolder && f.children.length) continue;
      await this.trash(f);
    }
  }

  /* File types the `a` prompt can create. `keys` are typed at the end of the name (case-insensitive). */
  createTypes() {
    const plugins = this.app.plugins;
    const enabled = (id) => !!(plugins && plugins.enabledPlugins && plugins.enabledPlugins.has(id));
    const plugin = (id) => plugins && plugins.plugins && plugins.plugins[id];
    const core = (id) => {
      const ip = this.app.internalPlugins;
      const p = ip && typeof ip.getPluginById === 'function' && ip.getPluginById(id);
      return !p || p.enabled !== false;
    };
    const types = [
      { id: 'note', label: 'Note', keys: [], example: 'name', ext: '.md', content: () => '' },
      { id: 'folder', label: 'Folder', keys: ['/'], example: 'name/', folder: true },
    ];
    if (enabled('folder-notes')) {
      types.push({ id: 'foldernote', label: 'Folder + folder note', keys: ['//'], example: 'name//', folder: true, folderNote: true });
    }
    if (core('canvas')) {
      types.push({ id: 'canvas', label: 'Canvas', keys: ['.canvas', '.cv'], ext: '.canvas', content: () => '{"nodes":[],"edges":[]}' });
    }
    if (enabled('obsidian-excalidraw-plugin')) {
      const ex = plugin('obsidian-excalidraw-plugin');
      const s = (ex && ex.settings) || {};
      const ext = s.compatibilityMode ? '.excalidraw' : '.excalidraw.md';
      types.push({
        id: 'excalidraw', label: 'Excalidraw drawing', keys: ['.excalidraw.md', '.excalidraw', '.exd', '.ex'], ext,
        content: async () => {
          if (!s.compatibilityMode && ex && typeof ex.getBlankDrawing === 'function') {
            try { const d = await ex.getBlankDrawing(); if (typeof d === 'string') return d; } catch (e) { console.warn('vimoase: excalidraw template', e); }
          }
          return s.compatibilityMode ? BLANK_EXCALIDRAW_JSON : BLANK_EXCALIDRAW_MD;
        },
      });
    }
    if (enabled('obsidian-spaced-repetition')) {
      const sr = plugin('obsidian-spaced-repetition');
      const st = (sr && ((sr.data && sr.data.settings) || sr.settings)) || {};
      const tag = (Array.isArray(st.flashcardTags) && st.flashcardTags[0]) || '#flashcards';
      types.push({ id: 'flashcards', label: 'Flashcards (' + tag + ')', keys: ['.flashcards', '.cards', '.fc'], ext: '.md', content: () => tag + '\n\n' });
    }
    if (core('bases')) {
      types.push({ id: 'base', label: 'Base', keys: ['.base', '.db'], ext: '.base', content: () => 'views:\n  - type: table\n    name: Table\n' });
    }
    return types;
  }

  /* Parse what was typed in the `a` prompt into { type, path, notePath } or null. */
  resolveCreate(raw, base, types, folderOnly) {
    raw = raw.trim();
    if (!raw) return null;
    const folderType = types.find((t) => t.id === 'folder');
    const noteType = types.find((t) => t.id === 'note');
    if (folderOnly) return { type: folderType, path: joinPath(base.path, raw.replace(/\/+$/, '')) };
    if (raw.endsWith('//')) {
      const fn = types.find((t) => t.folderNote);
      if (fn) {
        const path = joinPath(base.path, raw.replace(/\/+$/, ''));
        return { type: fn, path, notePath: this.folderNotePath(path) };
      }
    }
    if (raw.endsWith('/')) return { type: folderType, path: joinPath(base.path, raw.replace(/\/+$/, '')) };
    const lower = raw.toLowerCase();
    let match = null;
    for (const t of types) {
      for (const k of t.keys) {
        if (!k.startsWith('.') || !lower.endsWith(k) || raw.length === k.length || raw[raw.length - k.length - 1] === '/') continue;
        if (!match || k.length > match.key.length) match = { type: t, key: k };
      }
    }
    if (match) {
      const stem = raw.slice(0, raw.length - match.key.length);
      return { type: match.type, path: joinPath(base.path, stem + match.type.ext) };
    }
    const path = joinPath(base.path, raw);
    if (hasExtension(basename(path))) {
      const ext = basename(path).slice(basename(path).lastIndexOf('.')).toLowerCase();
      return { type: ext === '.md' ? noteType : { id: 'other', label: ext.slice(1).toUpperCase() + ' file', content: () => '' }, path };
    }
    return { type: noteType, path: path + '.md' };
  }

  folderNotePath(folderPath) {
    const fn = this.app.plugins.plugins['folder-notes'];
    const s = (fn && fn.settings) || {};
    const name = basename(folderPath);
    const noteName = String(s.folderNoteName || '{{folder_name}}').replace(/\{\{folder_name\}\}/g, name);
    let ext = String(s.folderNoteType || '.md');
    if (!ext.startsWith('.')) ext = '.' + ext;
    if (ext === '.excalidraw') ext = '.excalidraw.md';
    const dir = s.storageLocation === 'parentFolder' ? dirname(folderPath) : folderPath;
    return joinPath(dir, noteName + ext);
  }

  renderCreateHints(el, value, base, types, folderOnly) {
    el.empty();
    const r = this.resolveCreate(value, base, types, folderOnly);
    const preview = el.createDiv({ cls: 'vmk-create-preview' });
    if (!r) {
      preview.addClass('is-empty');
      preview.setText(folderOnly ? 'Type a folder name (a/b/c creates nested folders)' : 'Type a name, then optionally a shortcut from below');
    } else {
      const exists = this.get(r.path);
      preview.toggleClass('is-error', !!exists);
      preview.createSpan({ cls: 'vmk-create-arrow', text: '→ ' });
      preview.createSpan({ cls: 'vmk-create-path', text: r.path + (r.type.folder ? '/' : '') });
      if (r.notePath) preview.createSpan({ cls: 'vmk-create-path', text: ' + ' + basename(r.notePath) });
      preview.createSpan({ cls: 'vmk-create-kind', text: exists ? 'already exists' : r.type.label });
    }
    if (folderOnly) return;
    const table = el.createDiv({ cls: 'vmk-create-types' });
    for (const t of types) {
      const row = table.createDiv({ cls: 'vmk-create-type' + (r && r.type.id === t.id ? ' is-active' : '') });
      const keys = row.createDiv({ cls: 'vmk-create-type-keys' });
      if (t.keys.length) for (const k of t.keys) keys.createEl('kbd', { text: k });
      else keys.createSpan({ cls: 'vmk-create-type-none', text: 'no suffix' });
      row.createDiv({ cls: 'vmk-create-type-label', text: t.label });
      row.createDiv({ cls: 'vmk-create-type-example', text: t.example || 'name' + t.keys[t.keys.length - 1] });
    }
    el.createDiv({ cls: 'vmk-create-footnote', text: 'Any other extension (name.txt, name.json…) creates that file as-is. Use a/b/name to create inside new subfolders. Enter creates · Esc cancels.' });
  }

  exAdd(view, folderOnly) {
    const base = this.targetFolder(view);
    const where = base.isRoot() ? '/' : base.path + '/';
    const types = this.createTypes();
    new PromptModal(this.app, {
      title: folderOnly ? 'Create folder' : 'Create',
      desc: 'in ' + where,
      placeholder: folderOnly ? 'folder or a/b/folder' : 'name, name/, name.cv, name.ex, name.fc …',
      render: (value, el) => this.renderCreateHints(el, value, base, types, folderOnly),
      onCancel: () => this.refocus(view),
      onSubmit: (value) => this.wrap(async () => {
        const r = this.resolveCreate(value, base, types, folderOnly);
        if (!r) return this.refocus(view);
        const full = r.path;
        if (this.get(full)) throw new Error('"' + full + '" already exists');
        if (r.notePath && this.get(r.notePath)) throw new Error('"' + r.notePath + '" already exists');
        const created = [];
        let result;
        if (r.type.folder) {
          result = await this.ensureFolder(full, created);
          if (r.notePath) {
            await this.ensureFolder(dirname(r.notePath), created);
            const note = await this.app.vault.create(r.notePath, '');
            created.push(note.path);
          }
        } else {
          await this.ensureFolder(dirname(full), created);
          const content = r.type.content ? await r.type.content() : '';
          result = await this.app.vault.create(full, content);
          created.push(result.path);
        }
        this.pushUndo('create ' + full, () => this.trashPaths(created));
        this.refocus(view, result);
      }, view),
    }).open();
  }

  async snapshot(f) {
    if (f instanceof TFile) return { kind: 'file', path: f.path, data: await this.app.vault.readBinary(f) };
    const children = [];
    for (const c of f.children) children.push(await this.snapshot(c));
    return { kind: 'folder', path: f.path, children };
  }

  async restoreSnapshot(s) {
    if (s.kind === 'folder') {
      await this.ensureFolder(s.path);
      for (const c of s.children) await this.restoreSnapshot(c);
      return;
    }
    await this.ensureFolder(dirname(s.path));
    if (!this.get(s.path)) await this.app.vault.createBinary(s.path, s.data);
  }

  exDelete(view) {
    const file = this.focusedFile(view);
    if (!file || (file instanceof TFolder && file.isRoot())) return;
    let message = 'Delete "' + file.path + '"?';
    if (file instanceof TFolder) {
      let count = 0;
      obsidian.Vault.recurseChildren(file, () => count++);
      message = 'Delete folder "' + file.path + '" and its ' + (count - 1) + ' item(s)?';
    }
    new ConfirmModal(this.app, {
      title: 'Delete',
      message,
      onCancel: () => this.refocus(view),
      onConfirm: () => this.wrap(async () => {
        const idx = this.visibleItems(view).indexOf(view.fileItems[file.path]);
        const snap = await this.snapshot(file);
        await this.trash(file);
        this.pushUndo('delete ' + snap.path, () => this.restoreSnapshot(snap));
        await this.focusExplorer();
        const remaining = this.visibleItems(view);
        if (remaining.length) this.setFocus(view, remaining[Math.max(0, Math.min(idx, remaining.length - 1))]);
      }, view),
    }).open();
  }

  async renameTo(file, newPath) {
    if (newPath === file.path) return file;
    if (this.get(newPath)) throw new Error('"' + newPath + '" already exists');
    await this.ensureFolder(dirname(newPath));
    await this.app.fileManager.renameFile(file, newPath);
    return this.get(newPath);
  }

  exRename(view) {
    const file = this.focusedFile(view);
    if (!file || (file instanceof TFolder && file.isRoot())) return;
    const name = file.name;
    const selEnd = file instanceof TFile && file.extension ? name.length - file.extension.length - 1 : name.length;
    new PromptModal(this.app, {
      title: 'Rename',
      desc: file.path,
      value: name,
      select: [0, selEnd],
      onCancel: () => this.refocus(view, file),
      onSubmit: (value) => this.wrap(async () => {
        let newName = value.trim();
        if (!newName || newName === name) return this.refocus(view, file);
        if (file instanceof TFile && !hasExtension(basename(newName)) && file.extension) newName += '.' + file.extension;
        const oldPath = file.path;
        const result = await this.renameTo(file, joinPath(file.parent ? file.parent.path : '/', newName));
        const newPath = result.path;
        this.pushUndo('rename ' + oldPath, async () => { const f = this.get(newPath); if (f) await this.renameTo(f, oldPath); });
        this.refocus(view, result);
      }, view),
    }).open();
  }

  resolveDest(value, file) {
    const raw = value.trim();
    if (!raw) return null;
    const asFolder = this.get(raw.replace(/\/+$/, ''));
    if (raw.endsWith('/') || asFolder instanceof TFolder) return joinPath(raw.replace(/\/+$/, '') || '/', file.name);
    let dest = normalizePath(raw);
    if (file instanceof TFile && file.extension && !hasExtension(basename(dest))) dest += '.' + file.extension;
    return dest;
  }

  async copyEntry(file, dest, created) {
    if (this.get(dest)) throw new Error('"' + dest + '" already exists');
    await this.ensureFolder(dirname(dest), created);
    if (file instanceof TFile) {
      await this.app.vault.copy(file, dest);
      created.push(dest);
      return;
    }
    await this.ensureFolder(dest, created);
    for (const child of file.children) await this.copyEntry(child, joinPath(dest, child.name), created);
  }

  exMoveOrCopy(view, mode) {
    const file = this.targetFile(view);
    if (!file) return new Notice('Nothing to ' + mode + ': put the cursor on a file or folder');
    if (file instanceof TFolder && file.isRoot()) return new Notice('The vault root cannot be ' + (mode === 'move' ? 'moved' : 'copied'));
    const item = view.fileItems && view.fileItems[file.path];
    if (item && item !== this.focusedItem(view)) this.setFocus(view, item);
    new FolderPickerModal(this.app, {
      mode,
      file,
      start: file.parent || this.app.vault.getRoot(),
      onCancel: () => this.refocus(view, file),
      onSubmit: (target) => this.wrap(async () => {
        let dest = target.kind === 'into' ? joinPath(target.path, file.name) : this.resolveDest(target.path, file);
        if (!dest) return this.refocus(view, file);
        if (dest === file.path || (mode === 'copy' && this.get(dest))) {
          if (mode === 'move') return this.refocus(view, file);
          dest = this.uniquePath(dirname(dest) || '/', basename(dest));
        }
        if (file instanceof TFolder && (dest + '/').startsWith(file.path + '/')) throw new Error('Cannot ' + mode + ' a folder into itself');
        if (mode === 'move') {
          const oldPath = file.path;
          const result = await this.renameTo(file, dest);
          this.pushUndo('move ' + oldPath, async () => { const f = this.get(dest); if (f) await this.renameTo(f, oldPath); });
          this.refocus(view, result);
        } else {
          const created = [];
          await this.copyEntry(file, dest, created);
          this.pushUndo('copy to ' + dest, () => this.trashPaths(created));
          this.refocus(view, this.get(dest));
        }
      }, view),
    }).open();
  }

  exClip(view, mode) {
    const file = this.focusedFile(view);
    if (!file || (file instanceof TFolder && file.isRoot())) return;
    this.explorerClip = { mode, path: file.path };
    new Notice((mode === 'cut' ? 'Cut: ' : 'Copied: ') + file.path);
  }

  async exPaste(view) {
    const clip = this.explorerClip;
    if (!clip) return new Notice('Nothing to paste');
    const src = this.get(clip.path);
    if (!src) { this.explorerClip = null; return new Notice('"' + clip.path + '" no longer exists'); }
    const target = this.targetFolder(view);
    const targetPath = target.isRoot() ? '/' : target.path;
    if (src instanceof TFolder && (targetPath + '/').startsWith(src.path + '/')) return new Notice('Cannot paste a folder into itself');
    await this.wrap(async () => {
      if (clip.mode === 'cut') {
        const oldPath = src.path;
        let dest = joinPath(targetPath, src.name);
        if (dest === oldPath) return;
        if (this.get(dest)) dest = this.uniquePath(targetPath, src.name);
        const result = await this.renameTo(src, dest);
        this.explorerClip = null;
        this.pushUndo('move ' + oldPath, async () => { const f = this.get(dest); if (f) await this.renameTo(f, oldPath); });
        this.refocus(view, result);
      } else {
        const dest = this.uniquePath(targetPath, src.name);
        const created = [];
        await this.copyEntry(src, dest, created);
        this.pushUndo('paste ' + dest, () => this.trashPaths(created));
        this.refocus(view, this.get(dest));
      }
    }, view);
  }

  async exUndo() {
    const entry = this.undoStack.pop();
    if (!entry) return new Notice('Nothing to undo');
    const view = this.explorerView();
    await this.wrap(async () => {
      await entry.run();
      new Notice('Undid ' + entry.label);
      if (view) this.refocus(view);
    }, view);
  }

  async wrap(fn, view) {
    try { await fn(); } catch (err) { this.fail(err); if (view) this.refocus(view); }
  }
}

/* ================================================================== settings */

class VimoaseSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
    this.filter = '';
  }

  display() {
    const { containerEl } = this;
    const scroll = containerEl.scrollTop;
    containerEl.empty();
    containerEl.addClass('vmk-settings');
    const plugin = this.plugin;
    const s = plugin.settings;
    const changed = () => plugin.settingsChanged();
    const num = (key) => (t) => t.setValue(String(s[key])).onChange((v) => {
      const n = Number(v);
      if (Number.isFinite(n) && n >= 0) { s[key] = n; changed(); }
    });

    if (typeof this.app.vault.getConfig === 'function' && !this.app.vault.getConfig('vimMode')) {
      containerEl.createEl('p', {
        cls: 'vmk-warning',
        text: 'Vim key bindings are off (Settings → Editor → Vim key bindings). Normal / visual / insert bindings and vim mappings need vim mode; explorer and other-view keys work without it.',
      });
    }

    new Setting(containerEl).setName('General').setHeading();
    new Setting(containerEl).setName('File explorer keys').setDesc('Use the explorer bindings below while the file explorer is focused.')
      .addToggle((t) => t.setValue(s.explorerKeys).onChange((v) => { s.explorerKeys = v; changed(); }));
    new Setting(containerEl).setName('Keep focus in explorer after clicking a file').setDesc('Clicking a file still opens it, but keys stay in the file explorer (m, r, d … act on the clicked file). Click into the note or press Enter / l to edit it.')
      .addToggle((t) => t.setValue(s.explorerClickKeepsFocus).onChange((v) => { s.explorerClickKeepsFocus = v; changed(); }));
    new Setting(containerEl).setName('Yank to system clipboard').setDesc('y, yy, yw … into the unnamed register also go to the system clipboard. Deletes stay in vim registers.')
      .addToggle((t) => t.setValue(s.yankToClipboard).onChange((v) => { s.yankToClipboard = v; changed(); }));
    new Setting(containerEl).setName('Which-key popup delay').setDesc('Milliseconds before the popup with the next possible keys appears.').addText(num('whichKeyDelay'));
    new Setting(containerEl).setName('Ambiguous key timeout').setDesc('When a binding is also the start of longer ones (e.g. <leader>x and <leader>xt), run it after this many milliseconds. Like Neovim\'s timeoutlen.').addText(num('ambiguousTimeout'));
    new Setting(containerEl).setName('Key sequence timeout').setDesc('Milliseconds before an unfinished sequence is cancelled (keys go back to vim). 0 waits forever.').addText(num('sequenceTimeout'));

    new Setting(containerEl).setName('File explorer cursor').setHeading();
    new Setting(containerEl).setName('Show cursor').setDesc('Highlight the item that h / j / k / l moves.')
      .addToggle((t) => t.setValue(s.cursorEnabled).onChange((v) => { s.cursorEnabled = v; changed(); }));
    new Setting(containerEl).setName('Cursor color')
      .addColorPicker((cp) => cp.setValue(s.cursorColor).onChange((v) => { s.cursorColor = v; changed(); }))
      .addExtraButton((b) => b.setIcon('rotate-ccw').setTooltip('Reset').onClick(() => { s.cursorColor = DEFAULT_SETTINGS.cursorColor; changed(); this.display(); }));
    new Setting(containerEl).setName('Cursor style')
      .addDropdown((d) => d.addOptions({ fill: 'Filled row', outline: 'Outline', bar: 'Left bar' }).setValue(s.cursorStyle)
        .onChange((v) => { s.cursorStyle = v; changed(); }));
    new Setting(containerEl).setName('Fill strength').setDesc('How strong the filled row is (filled style only).')
      .addSlider((sl) => sl.setLimits(5, 100, 5).setValue(s.cursorStrength).setDynamicTooltip()
        .onChange((v) => { s.cursorStrength = v; changed(); }));

    new Setting(containerEl).setName('Vim mappings').setHeading()
      .setDesc('Passed to Obsidian\'s vim (like :map in a vimrc). Good for insert-mode sequences such as jk.');
    new Setting(containerEl).setName('Shift+A appends at the end of the visual row')
      .setDesc('On soft-wrapped paragraphs, A types after the last word of the row you see instead of at the end of the paragraph.')
      .addToggle((t) => t.setValue(s.wrapAppend).onChange((v) => { s.wrapAppend = v; changed(); plugin.applyVimMaps(); }));
    s.vimMaps.forEach((m, i) => {
      new Setting(containerEl).setClass('vmk-vimmap')
        .addDropdown((d) => d.addOptions({ normal: 'normal', insert: 'insert', visual: 'visual' }).setValue(m.mode || 'normal')
          .onChange((v) => { m.mode = v; changed(); plugin.requestVimMaps(); }))
        .addText((t) => t.setPlaceholder('lhs, e.g. jk').setValue(m.lhs || '').onChange((v) => { m.lhs = v; changed(); plugin.requestVimMaps(); }))
        .addText((t) => t.setPlaceholder('rhs, e.g. <Esc>').setValue(m.rhs || '').onChange((v) => { m.rhs = v; changed(); plugin.requestVimMaps(); }))
        .addExtraButton((b) => b.setIcon('trash').setTooltip('Remove').onClick(() => {
          s.vimMaps.splice(i, 1); changed(); plugin.applyVimMaps(); this.display();
        }));
    });
    new Setting(containerEl)
      .addButton((b) => b.setButtonText('Add mapping').onClick(() => { s.vimMaps.push({ mode: 'normal', lhs: '', rhs: '' }); changed(); this.display(); }))
      .addButton((b) => b.setButtonText('Reset mappings').onClick(() => {
        s.vimMaps = DEFAULT_SETTINGS.vimMaps.map((m) => ({ ...m })); changed(); plugin.applyVimMaps(); this.display();
      }));

    new Setting(containerEl).setName('Key bindings').setHeading();
    const help = containerEl.createDiv({ cls: 'vmk-help' });
    help.createEl('p', { text: 'Vim notation: <leader>ff, gd, ]t, <C-s>, <S-Tab>, <CR>, <Esc>, <BS>, <Tab>. Or with spaces: "space f f", "C-s". <leader> is Space. C = Ctrl, A/M = Alt, S = Shift, D = Cmd.' });
    help.createEl('p', { text: 'Insert mode and pickers only take bindings that start with Ctrl, Alt or Cmd, so typing is never blocked. Leave a field empty to unbind.' });

    if (plugin.conflicts.length) {
      const box = containerEl.createDiv({ cls: 'vmk-warning' });
      box.createEl('strong', { text: 'Conflicts (the later one wins):' });
      const ul = box.createEl('ul');
      for (const c of plugin.conflicts) {
        ul.createEl('li', { text: displaySeq(c.seq) + ' in ' + CONTEXT_LABEL[c.ctx] + ': "' + c.a.label + '" vs "' + c.b.label + '"' });
      }
    }

    new Setting(containerEl).setName('Filter').addSearch((sr) => sr.setPlaceholder('Filter by name or key…').setValue(this.filter)
      .onChange((v) => { this.filter = v; renderList(); }))
      .addButton((b) => b.setButtonText('Reset all keys').setWarning().onClick(() => {
        s.keymap = {}; plugin.rebuildTries(); changed(); this.display();
      }));

    const listEl = containerEl.createDiv();
    const renderList = () => {
      listEl.empty();
      const q = this.filter.trim().toLowerCase();
      for (const [group, actions] of plugin.groupedActions()) {
        const shown = actions.filter((a) => !q || (a.label + ' ' + plugin.keysFor(a.id).join(' ') + ' ' + group).toLowerCase().includes(q));
        if (!shown.length) continue;
        new Setting(listEl).setName(group).setHeading();
        for (const a of shown) this.renderAction(listEl, a, renderList);
      }
    };
    renderList();
    containerEl.scrollTop = scroll;
  }

  renderAction(parent, a, rerender) {
    const plugin = this.plugin;
    const keys = plugin.keysFor(a.id).slice();
    const custom = Array.isArray(plugin.settings.keymap[a.id]);
    const setting = new Setting(parent).setClass('vmk-binding')
      .setName(a.label + (custom ? ' •' : ''))
      .setDesc(a.contexts.map((c) => CONTEXT_LABEL[c]).join(' · ') + (a.keys.length ? '   default: ' + a.keys.join(', ') : '   default: none'));
    const save = () => plugin.setKeys(a.id, keys);
    keys.forEach((k, i) => {
      setting.addText((t) => {
        t.setPlaceholder('<leader>…').setValue(k);
        t.inputEl.addClass('vmk-key-input');
        const validate = (v) => t.inputEl.toggleClass('vmk-invalid', !!v.trim() && !parseSeq(v));
        validate(k);
        t.onChange((v) => { keys[i] = v; validate(v); save(); });
      });
    });
    setting.addExtraButton((b) => b.setIcon('plus').setTooltip('Add key').onClick(() => { keys.push(''); plugin.setKeys(a.id, keys); rerender(); }));
    if (keys.length) {
      setting.addExtraButton((b) => b.setIcon('minus').setTooltip('Remove last key').onClick(() => { keys.pop(); plugin.setKeys(a.id, keys); rerender(); }));
    }
    if (custom) {
      setting.addExtraButton((b) => b.setIcon('rotate-ccw').setTooltip('Reset to default').onClick(() => {
        delete plugin.settings.keymap[a.id]; plugin.rebuildTries(); plugin.settingsChanged(); rerender();
      }));
    }
  }

  hide() {
    super.hide();
    this.plugin.syncExplorer();
  }
}

module.exports = VimoasePlugin;
module.exports._test = { parseSeq, parseToken, eventToken, displaySeq };
