import { describe, expect, it } from 'vitest';
import { Keymap, type Action, type ContextName } from '../src/keys/keymap';

const action = (id: string, keys: string[], contexts: ContextName[] = ['normal']): Action => ({
  group: 'Test',
  id,
  label: id,
  contexts,
  keys,
  run: () => undefined,
});

describe('Keymap', () => {
  const actions = [
    action('findFiles', ['<leader>ff']),
    action('findAll', ['<leader>fa']),
    action('close', ['<leader>x']),
    action('todos', ['<leader>xt']),
    action('explorerDown', ['j'], ['explorer']),
  ];

  it('builds one trie per context', () => {
    const km = new Keymap(actions, () => ({}));
    const leader = km.tries.normal.children.get('space');
    expect(leader?.label).toBe('+leader');
    expect(leader?.children.get('f')?.label).toBe('+find');
    expect(leader?.children.get('f')?.children.get('f')?.action?.id).toBe('findFiles');
    expect(km.tries.explorer.children.get('j')?.action?.id).toBe('explorerDown');
    expect(km.tries.normal.children.has('j')).toBe(false);
  });

  it('keeps a binding that is also a prefix (ambiguous key)', () => {
    const km = new Keymap(actions, () => ({}));
    const x = km.tries.normal.children.get('space')?.children.get('x');
    expect(x?.action?.id).toBe('close');
    expect(x?.children.get('t')?.action?.id).toBe('todos');
  });

  it('applies overrides and reports conflicts', () => {
    const overrides: Record<string, string[]> = { findAll: ['<leader>ff'] };
    const km = new Keymap(actions, () => overrides);
    expect(km.keysFor('findAll')).toEqual(['<leader>ff']);
    expect(km.conflicts).toHaveLength(1);
    expect(km.conflicts[0].b.id).toBe('findAll');
  });

  it('only stores overrides that differ from the defaults', () => {
    const km = new Keymap(actions, () => ({}));
    expect(km.overrideFor('findFiles', ['<leader>ff'])).toBeUndefined();
    expect(km.overrideFor('findFiles', ['<leader>p'])).toEqual(['<leader>p']);
  });

  it('skips keys that do not parse', () => {
    const km = new Keymap(actions, () => ({ findFiles: ['', '<leader>ff'] }));
    expect(km.validSeqs('findFiles')).toEqual([['space', 'f', 'f']]);
  });
});
