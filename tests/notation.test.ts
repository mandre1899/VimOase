import { describe, expect, it } from 'vitest';
import { displaySeq, eventToken, parseSeq, parseToken, scopeKeyToken, vimKeyFor } from '../src/keys/notation';

const key = (k: string, mods: Partial<KeyboardEvent> = {}) =>
  ({ key: k, code: '', ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...mods }) as KeyboardEvent;

describe('parseSeq', () => {
  it.each([
    ['<leader>ff', ['space', 'f', 'f']],
    ['gd', ['g', 'd']],
    ['<C-s>', ['C-s']],
    ['<S-Tab>', ['S-tab']],
    ['S-Tab', ['S-tab']],
    ['space f f', ['space', 'f', 'f']],
    [']t', [']', 't']],
    ['g?', ['g', '?']],
    ['<CR>', ['enter']],
    ['<Esc>', ['escape']],
    ['G', ['G']],
    ['<C-S-f>', ['C-S-f']],
    ['<C-F>', ['C-S-f']],
  ])('%s → %j', (input, expected) => {
    expect(parseSeq(input)).toEqual(expected);
  });

  it('rejects empty and unknown keys', () => {
    expect(parseSeq('')).toBeNull();
    expect(parseSeq('   ')).toBeNull();
    expect(parseSeq('space <nope>')).toBeNull();
  });
});

describe('parseToken', () => {
  it('normalises modifier names and order', () => {
    expect(parseToken('<ctrl-alt-x>')).toBe('C-A-x');
    expect(parseToken('<cmd-k>')).toBe('D-k');
    expect(parseToken('<leader>')).toBe('space');
  });
  it('keeps shift only where the character does not carry it', () => {
    expect(parseToken('<S-a>')).toBe('A');
    expect(parseToken('<C-S-1>')).toBe('C-S-1');
    expect(parseToken('<C-S-?>')).toBe('C-?');
  });
});

describe('eventToken', () => {
  it('maps plain and named keys', () => {
    expect(eventToken(key('j'))).toBe('j');
    expect(eventToken(key('G', { shiftKey: true }))).toBe('G');
    expect(eventToken(key(' '))).toBe('space');
    expect(eventToken(key('Tab', { shiftKey: true }))).toBe('S-tab');
  });
  it('uses the physical key when Alt changes the character', () => {
    expect(eventToken(key('∆', { altKey: true, code: 'KeyJ' }))).toBe('A-j');
  });
  it('ignores bare modifier keys', () => {
    expect(eventToken(key('Shift'))).toBeNull();
  });
  it('round-trips with parseSeq', () => {
    expect([eventToken(key('s', { ctrlKey: true }))]).toEqual(parseSeq('<C-s>'));
  });
});

describe('display', () => {
  it('shows tokens like Neovim', () => {
    expect(displaySeq(['space', 'f', 'f'])).toBe('SPC f f');
    expect(displaySeq(['C-s', 'S-tab'])).toBe('<C-s> <S-Tab>');
    expect(vimKeyFor('space')).toBe('<Space>');
    expect(vimKeyFor('escape')).toBe('<Esc>');
  });
});

describe('scopeKeyToken', () => {
  it('maps Obsidian scope keys, with Mod depending on the platform', () => {
    expect(scopeKeyToken({ key: 'Enter', modifiers: '' }, true)).toBe('enter');
    expect(scopeKeyToken({ key: 'a', modifiers: 'Mod' }, true)).toBe('D-a');
    expect(scopeKeyToken({ key: 'a', modifiers: 'Mod' }, false)).toBe('C-a');
    expect(scopeKeyToken({ key: 'g', modifiers: 'Shift' }, true)).toBe('G');
    expect(scopeKeyToken({ key: null }, true)).toBeNull();
  });
});
