import { describe, expect, it } from 'vitest';
import { TODO_LINE, findLinkAt } from '../src/editor/commands';
import { DEFAULT_SETTINGS, migrateSettings } from '../src/settings';
import { basename, dirname, formatMB, hasExtension, joinPath } from '../src/util/paths';
import { orderRange, posAfterInsert } from '../src/util/positions';

describe('paths', () => {
  it('splits and joins', () => {
    expect(dirname('a/b/c.md')).toBe('a/b');
    expect(dirname('c.md')).toBe('');
    expect(basename('a/b/c.md')).toBe('c.md');
    expect(joinPath('/', 'x.md')).toBe('x.md');
    expect(joinPath('a/', '/b')).toBe('a/b');
  });
  it('recognises extensions', () => {
    expect(hasExtension('note.md')).toBe(true);
    expect(hasExtension('note')).toBe(false);
    expect(hasExtension('.hidden')).toBe(false);
  });
  it('formats sizes', () => {
    expect(formatMB(1.5 * 1024 * 1024)).toBe('1.5 MB');
    expect(formatMB(1600 * 1024 * 1024)).toBe('1600 MB');
  });
});

describe('positions', () => {
  it('orders ranges and moves past inserted text', () => {
    expect(orderRange({ anchor: { line: 2, ch: 0 }, head: { line: 1, ch: 4 } })).toEqual([{ line: 1, ch: 4 }, { line: 2, ch: 0 }]);
    expect(posAfterInsert({ line: 3, ch: 2 }, 'ab')).toEqual({ line: 3, ch: 4 });
    expect(posAfterInsert({ line: 3, ch: 2 }, 'a\nbc')).toEqual({ line: 4, ch: 2 });
  });
});

describe('findLinkAt', () => {
  const line = 'See [[Target|alias]] and [docs](Some%20Note.md) or [web](https://example.com).';
  it('finds wikilinks, markdown links and external URLs under the cursor', () => {
    expect(findLinkAt(line, 6)).toBe('Target');
    expect(findLinkAt(line, 27)).toBe('Some Note.md');
    expect(findLinkAt(line, 55)).toEqual({ external: 'https://example.com' });
    expect(findLinkAt(line, 1)).toBeNull();
  });
});

describe('TODO_LINE', () => {
  it.each([
    ['TODO: call', true],
    ['- [ ] open task', true],
    ['1. [ ] numbered task', true],
    ['- [x] done task', false],
    ['todo in lower case', false],
  ])('%s → %s', (text, expected) => {
    expect(TODO_LINE.test(text)).toBe(expected);
  });
});

describe('migrateSettings', () => {
  it('fills in defaults', () => {
    expect(migrateSettings(null)).toMatchObject({ explorerKeys: true, whichKeyDelay: 200 });
  });
  it('carries over the old Vimakase clipboardKeys setting', () => {
    const s = migrateSettings({ clipboardKeys: false });
    expect(s.yankToClipboard).toBe(false);
    expect('clipboardKeys' in s).toBe(false);
  });
  it('never shares the default vim mappings', () => {
    const s = migrateSettings({});
    s.vimMaps.push({ mode: 'normal', lhs: 'x', rhs: 'y' });
    s.vimMaps[0].lhs = 'changed';
    expect(DEFAULT_SETTINGS.vimMaps).toHaveLength(11);
    expect(migrateSettings({}).vimMaps[0].lhs).toBe('jk');
  });
});
