/*
 * Smoke test of the built main.js (run `npm run build` first): loads the bundle against the
 * obsidian stand-in, runs onload, and sends key presses through the real key engine.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeAll, describe, expect, it } from 'vitest';
import Module, { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as obsidianStub from './stubs/obsidian';
import { makeVault } from './helpers/vault';

const bundlePath = fileURLToPath(new URL('../main.js', import.meta.url));

function loadBundle(): any {
  const mod = Module as unknown as { _load: (request: string, ...rest: unknown[]) => unknown };
  const original = mod._load;
  mod._load = function (request: string, ...rest: unknown[]) {
    if (request === 'obsidian') return obsidianStub;
    if (request.startsWith('@codemirror/')) throw new Error('not available in tests');
    return original.call(this, request, ...rest);
  };
  try {
    const require = createRequire(import.meta.url);
    delete require.cache[bundlePath];
    const exported = require(bundlePath);
    return exported.default ?? exported;
  } finally {
    mod._load = original;
  }
}

const classList = () => ({ addClass() {}, removeClass() {}, style: { setProperty() {}, removeProperty() {} } });

beforeAll(() => {
  const g = globalThis as any;
  g.window = g;
  g.document = { body: classList(), querySelector: () => null };
  g.activeDocument = g.document;
  g.KeyboardEvent ??= class KeyboardEvent {
    constructor(public type: string, init: Record<string, unknown> = {}) {
      Object.assign(this, init);
    }
  };
});

describe.runIf(existsSync(bundlePath))('built main.js', () => {
  function setup() {
    const vault = makeVault(['Notes/a.md', 'Notes/Sub/', 'Projects/']);
    const file = vault.file('Notes/a.md');
    const onKeyArrowDown: KeyboardEvent[] = [];
    const explorerEl = { contains: (x: any) => !!x && x.inExplorer === true };
    const item = { file, selfEl: classList() };
    const explorerView = {
      containerEl: explorerEl,
      fileItems: { 'Notes/a.md': item },
      tree: { focusedItem: item, setFocusedItem() {}, onKeyArrowDown: (e: KeyboardEvent) => onKeyArrowDown.push(e) },
    };
    const explorerLeaf = { view: explorerView, getRoot: () => null };
    const app = {
      vault: { getRoot: () => vault.root, getAbstractFileByPath: (p: string) => vault.get(p), getName: () => 'Vault' },
      workspace: {
        activeLeaf: explorerLeaf,
        getLeavesOfType: (t: string) => (t === 'file-explorer' ? [explorerLeaf] : []),
        iterateAllLeaves: (cb: (l: unknown) => void) => cb(explorerLeaf),
        onLayoutReady: () => {},
        on: () => ({}),
        getActiveFile: () => null,
      },
    };
    const Plugin = loadBundle();
    const plugin = new Plugin(app, { id: 'vimoase' });
    return { plugin, onKeyArrowDown };
  }

  const press = (plugin: any, key: string) => {
    const handler = plugin.domEvents.find((d: any) => d.type === 'keydown').handler;
    const doc = { querySelector: () => null };
    const target = { inExplorer: true, ownerDocument: doc, closest: () => null };
    let prevented = false;
    handler({ key, code: '', target, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, isComposing: false,
      preventDefault: () => (prevented = true), stopImmediatePropagation: () => {} });
    return prevented;
  };

  it('loads and wires up without errors', async () => {
    const { plugin } = setup();
    await plugin.onload();
    expect(plugin.keymap.actions.length).toBeGreaterThan(80);
    expect(plugin.keymap.conflicts).toEqual([]);
    expect(plugin.domEvents.map((d: any) => d.type)).toEqual(expect.arrayContaining(['keydown', 'mousedown', 'focusin', 'click']));
  });

  it('m in the explorer opens the Move to folder picker for the item under the cursor', async () => {
    const { plugin } = setup();
    await plugin.onload();
    obsidianStub.openedModals.length = 0;
    expect(press(plugin, 'm')).toBe(true);
    const modal = obsidianStub.openedModals[obsidianStub.openedModals.length - 1] as any;
    expect(modal?.constructor.name).toBe('FolderPickerModal');
    expect(modal.opts.item.path).toBe('Notes/a.md');
    expect(modal.opts.start.path).toBe('Notes');
  });

  it('j in the explorer moves the tree cursor', async () => {
    const { plugin, onKeyArrowDown } = setup();
    await plugin.onload();
    press(plugin, 'j');
    expect(onKeyArrowDown).toHaveLength(1);
  });
});
