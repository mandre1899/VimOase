/*
 * The keymap: every action with its default keys, the user's overrides, and one lookup tree
 * (trie) per context that the key engine walks one key at a time.
 */
import type { EditorCtx } from '../editor/vim';
import { parseSeq, type Token } from './notation';

export type ContextName = 'normal' | 'visual' | 'insert' | 'other' | 'explorer' | 'picker';

export const CONTEXTS: ReadonlyArray<readonly [ContextName, string]> = [
  ['normal', 'Normal'],
  ['visual', 'Visual'],
  ['insert', 'Insert'],
  ['other', 'Other views'],
  ['explorer', 'File explorer'],
  ['picker', 'Pickers'],
];

export const CONTEXT_LABEL = Object.fromEntries(CONTEXTS) as Record<ContextName, string>;

/** Contexts where plain keys are typed text, so only Ctrl/Alt/Cmd bindings apply. */
export const TYPING_CONTEXTS: ReadonlySet<ContextName> = new Set(['insert', 'picker']);

/** Where a key press happened. */
export interface KeyContext {
  name: ContextName;
  target: HTMLElement;
  ed?: EditorCtx;
}

export interface Action {
  group: string;
  id: string;
  label: string;
  contexts: ContextName[];
  /** Default keys in vim notation. */
  keys: string[];
  run(ctx: KeyContext): unknown;
  /** The binding only applies when this returns true; otherwise the key goes through. */
  when?(ctx: KeyContext): boolean;
  /** Run the action but let the key reach Obsidian / vim too. */
  passThrough?: boolean;
}

export interface TrieNode {
  children: Map<Token, TrieNode>;
  action: Action | null;
  /** Which-key group name ("+find") for nodes that only lead to longer sequences. */
  label: string | null;
}

export interface Conflict {
  ctx: ContextName;
  seq: Token[];
  a: Action;
  b: Action;
}

export type Tries = Record<ContextName, TrieNode>;

const emptyNode = (): TrieNode => ({ children: new Map(), action: null, label: null });

/** Which-key names for leader groups, keyed by the keys after <leader>. */
const GROUP_NAMES: Record<string, string> = {
  f: '+find', g: '+goto / git', 'g h': '+hunks', w: '+which-key', c: '+code', x: '+lists', r: '+rename',
  m: '+marks', t: '+theme', l: '+lint', z: '+fold', ']': '+next', '[': '+prev',
};

/** Builds one trie per context. When two actions share a sequence, the later one wins. */
export function buildTries(actions: Action[], seqsFor: (action: Action) => Token[][]): { tries: Tries; conflicts: Conflict[] } {
  const tries = Object.fromEntries(CONTEXTS.map(([ctx]) => [ctx, emptyNode()])) as Tries;
  const conflicts: Conflict[] = [];

  for (const action of actions) {
    for (const seq of seqsFor(action)) {
      for (const ctx of action.contexts) {
        let node = tries[ctx];
        seq.forEach((tok, i) => {
          let child = node.children.get(tok);
          if (!child) {
            child = emptyNode();
            node.children.set(tok, child);
          }
          if (i === seq.length - 1) {
            if (child.action && child.action !== action) conflicts.push({ ctx, seq, a: child.action, b: action });
            child.action = action;
          }
          node = child;
        });
      }
    }
  }

  const label = (node: TrieNode, path: Token[]): void => {
    for (const [tok, child] of node.children) {
      const p = path.concat(tok);
      if (child.children.size && !child.action) {
        const key = (p[0] === 'space' ? p.slice(1) : p).join(' ');
        child.label = p.length === 1 && tok === 'space' ? '+leader' : GROUP_NAMES[key] || '+more';
      }
      label(child, p);
    }
  };
  for (const ctx of Object.keys(tries) as ContextName[]) label(tries[ctx], []);

  return { tries, conflicts };
}

export class Keymap {
  readonly actions: Action[];
  private readonly byId: Map<string, Action>;
  tries!: Tries;
  conflicts: Conflict[] = [];

  /** `overrides` returns the user's keymap setting: action id → keys, replacing the defaults. */
  constructor(actions: Action[], private readonly overrides: () => Record<string, string[]>) {
    this.actions = actions;
    this.byId = new Map(actions.map((a) => [a.id, a]));
    this.rebuild();
  }

  action(id: string): Action | undefined {
    return this.byId.get(id);
  }

  keysFor(id: string): string[] {
    const custom = this.overrides()[id];
    if (Array.isArray(custom)) return custom;
    return this.byId.get(id)?.keys ?? [];
  }

  /** The action's keys that parse, as token sequences. */
  validSeqs(id: string): Token[][] {
    return this.keysFor(id).map(parseSeq).filter((s): s is Token[] => s !== null);
  }

  /** The keymap setting value for these keys: undefined when they equal the defaults. */
  overrideFor(id: string, keys: string[]): string[] | undefined {
    const defaults = this.byId.get(id)?.keys ?? [];
    const same = keys.length === defaults.length && keys.every((k, i) => k === defaults[i]);
    return same ? undefined : keys.slice();
  }

  groupedActions(): Map<string, Action[]> {
    const groups = new Map<string, Action[]>();
    for (const a of this.actions) {
      const list = groups.get(a.group) ?? [];
      list.push(a);
      groups.set(a.group, list);
    }
    return groups;
  }

  rebuild(): void {
    const { tries, conflicts } = buildTries(this.actions, (a) => this.validSeqs(a.id));
    this.tries = tries;
    this.conflicts = conflicts;
  }
}
