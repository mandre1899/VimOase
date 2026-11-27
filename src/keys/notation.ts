/*
 * Key notation: turning key events and vim-style strings ("<leader>ff", "<C-s>", "gd") into
 * canonical tokens, and back into text for display.
 *
 * A token is one key: a single character ("j", "G", "?"), a named key ("space", "enter",
 * "f5"), or either with modifiers in the fixed order C- A- S- D- ("C-s", "S-tab", "C-S-f").
 * Shift only appears in a token where it is not already part of the character.
 */
import type { ScopeKey } from '../obsidian-internals';

export type Token = string;

interface Mods {
  C: boolean;
  A: boolean;
  S: boolean;
  D: boolean;
}

const noMods = (): Mods => ({ C: false, A: false, S: false, D: false });

/** Names accepted in notation ("<Esc>", "<CR>" …) → token. */
const NAMED: Record<string, string> = {
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

/** KeyboardEvent.key values → token. */
export const EVENT_NAMED: Record<string, string> = {
  ' ': 'space', Escape: 'escape', Enter: 'enter', Backspace: 'backspace', Tab: 'tab',
  ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
  Delete: 'delete', Home: 'home', End: 'end', PageUp: 'pageup', PageDown: 'pagedown',
};
for (let i = 1; i <= 12; i++) EVENT_NAMED['F' + i] = 'f' + i;

/** Token names → how they are shown. */
const PRETTY: Record<string, string> = {
  space: 'Space', escape: 'Esc', enter: 'CR', backspace: 'BS', tab: 'Tab', up: 'Up', down: 'Down',
  left: 'Left', right: 'Right', delete: 'Del', home: 'Home', end: 'End', pageup: 'PageUp', pagedown: 'PageDown',
};

const MODIFIER_KEYS = new Set([
  'Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'Dead', 'Unidentified', 'Process', 'Fn', 'OS', 'Hyper', 'Super', 'AltGraph',
]);

const MODIFIER_PREFIX = /^((?:(?:c|ctrl|control|a|alt|m|meta|opt|option|s|shift|d|cmd|command|super)-)+)(.+)$/i;

export function buildToken(m: Mods, base: string): Token {
  return (m.C ? 'C-' : '') + (m.A ? 'A-' : '') + (m.S ? 'S-' : '') + (m.D ? 'D-' : '') + base;
}

const hasCommandMod = (m: Mods): boolean => m.C || m.A || m.D;

/** KeyboardEvent → token, e.g. "j", "G", "space", "C-s", "S-tab". Null for bare modifier keys. */
export function eventToken(e: Pick<KeyboardEvent, 'key' | 'code' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey'>): Token | null {
  const k = e.key;
  if (!k || MODIFIER_KEYS.has(k)) return null;
  const m: Mods = { C: e.ctrlKey, A: e.altKey, S: false, D: e.metaKey };
  if (EVENT_NAMED[k]) {
    m.S = e.shiftKey;
    return buildToken(m, EVENT_NAMED[k]);
  }
  if (k.length !== 1) return buildToken(m, '<' + k + '>');
  if (!hasCommandMod(m)) return k;

  // With Ctrl/Alt/Cmd the character can be altered (Alt+j → ∆), so prefer the physical key.
  const code = e.code || '';
  let base: string;
  if (/^[a-zA-Z]$/.test(k)) base = k.toLowerCase();
  else if (/^Key[A-Z]$/.test(code)) base = code[3].toLowerCase();
  else if (/^Digit\d$/.test(code)) base = code[5];
  else base = k;
  if (/^[a-z0-9]$/.test(base)) m.S = e.shiftKey;
  return buildToken(m, base);
}

/** One key in vim-style notation ("j", "<C-s>", "S-Tab", "<leader>") → token, or null. */
export function parseToken(raw: string): Token | null {
  let s = raw;
  if (s.length > 2 && s[0] === '<' && s[s.length - 1] === '>') s = s.slice(1, -1);
  if (s.length === 1) return s;
  const named = NAMED[s.toLowerCase()];
  if (named) return named;

  const match = MODIFIER_PREFIX.exec(s);
  if (!match) return null;
  const m = noMods();
  for (const part of match[1].split('-').filter(Boolean)) {
    const p = part.toLowerCase();
    if (p === 'c' || p === 'ctrl' || p === 'control') m.C = true;
    else if (p === 'a' || p === 'alt' || p === 'm' || p === 'meta' || p === 'opt' || p === 'option') m.A = true;
    else if (p === 's' || p === 'shift') m.S = true;
    else m.D = true;
  }

  let base = match[2];
  if (base.length === 1) {
    if (/[A-Z]/.test(base)) {
      m.S = true;
      base = base.toLowerCase();
    }
    if (!hasCommandMod(m)) return /[a-z]/.test(base) && m.S ? base.toUpperCase() : base;
    if (!/^[a-z0-9]$/.test(base)) m.S = false;
    return buildToken(m, base);
  }
  const namedBase = NAMED[base.toLowerCase()];
  if (!namedBase) return null;
  if (namedBase.length === 1) return parseToken(buildToken(m, namedBase));
  return buildToken(m, namedBase);
}

/** A key sequence ("<leader>ff", "gd", "<C-s>", "space f f", "S-Tab") → tokens, or null. */
export function parseSeq(str: string | null | undefined): Token[] | null {
  const s = (str || '').trim();
  if (!s) return null;

  // Space-separated form: every part is one key.
  if (/\s/.test(s)) {
    const toks = s.split(/\s+/).map(parseToken);
    return toks.every((t): t is Token => t !== null) ? toks : null;
  }

  // A single named key without brackets ("S-Tab", "esc") or one bracketed key ("<C-s>").
  if (s.length > 1) {
    const whole = parseToken(s);
    const bracketed = s[0] === '<' && s.indexOf('>') === s.length - 1;
    if (whole && (bracketed || s[0] !== '<')) return [whole];
  }

  // Otherwise a run of characters with optional <…> keys inside: "<leader>ff", "]t", "g?".
  const toks: Token[] = [];
  let i = 0;
  while (i < s.length) {
    if (s[i] === '<') {
      const j = s.indexOf('>', i + 1);
      if (j > i + 1) {
        const tok = parseToken(s.slice(i, j + 1));
        if (tok) {
          toks.push(tok);
          i = j + 1;
          continue;
        }
      }
    }
    toks.push(s[i]);
    i++;
  }
  return toks.length ? toks : null;
}

function bracketed(tok: Token): string {
  const m = /^((?:[CASD]-)*)(.+)$/.exec(tok);
  const mods = m ? m[1] : '';
  const base = m ? m[2] : tok;
  return '<' + mods + (PRETTY[base] || base) + '>';
}

/** Token → how the which-key popup and settings show it ("SPC", "<C-s>", "j"). */
export function displayToken(tok: Token): string {
  if (tok === 'space') return 'SPC';
  if (tok.length === 1) return tok;
  return bracketed(tok);
}

export function displaySeq(toks: Token[]): string {
  return toks.map(displayToken).join(' ');
}

/** Token → the key name CodeMirror's vim expects in handleKey ("<Space>", "<C-s>", "j"). */
export function vimKeyFor(tok: Token): string {
  if (tok.length === 1) return tok;
  if (tok === 'space') return '<Space>';
  return bracketed(tok);
}

/** An Obsidian Scope key handler → token, so the explorer's own keys can be matched to ours. */
export function scopeKeyToken(k: ScopeKey | null | undefined, isMacOS: boolean): Token | null {
  if (!k || !k.key) return null;
  const m = noMods();
  for (const mod of String(k.modifiers || '').split(',').filter(Boolean)) {
    if (mod === 'Mod') {
      if (isMacOS) m.D = true;
      else m.C = true;
    } else if (mod === 'Ctrl') m.C = true;
    else if (mod === 'Alt') m.A = true;
    else if (mod === 'Shift') m.S = true;
    else if (mod === 'Meta') m.D = true;
  }
  if (EVENT_NAMED[k.key]) return buildToken(m, EVENT_NAMED[k.key]);
  if (k.key.length === 1) {
    if (!hasCommandMod(m)) return m.S ? k.key.toUpperCase() : k.key.toLowerCase();
    return buildToken(m, k.key.toLowerCase());
  }
  return null;
}
