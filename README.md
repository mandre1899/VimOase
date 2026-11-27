# Vimoase

By **mandre1899**

Neovim-style keyboard control for Obsidian, modelled on LazyVim.

Obsidian's built-in vim mode only covers the text inside a note. Vimoase makes the rest of the app work
by keyboard too: a <kbd>Space</kbd> leader key with a which-key popup, pane and tab movement, search
pickers, folds, link navigation, system-clipboard yanks, and a neo-tree-style file explorer you drive
with `h j k l`. You can use Obsidian the way you use Neovim, without reaching for the mouse.

A desktop-only plugin by mandre1899, written in TypeScript.

## What it does

- **Leader keys and which-key.** Press <kbd>Space</kbd> and a popup lists the keys that can follow,
  grouped like LazyVim (`<leader>f…` find, `<leader>gh…` git hunks, `<leader>x…` TODOs, …).
- **One keymap engine for every context.** Bindings use vim notation (`<C-s>`, `<leader>ff`, `gd`) and
  are set per context: normal, visual and insert mode, the file explorer, pickers, and other views.
  Every binding can be changed or removed in the settings.
- **A vim-style file explorer.** Move with `j`/`k`, open and close with `l`/`h`, and manage files
  without leaving the keyboard. A coloured cursor shows where you are.
- **System clipboard.** Yanks (`y`, `yy`, `yw` …) also go to the system clipboard. `Ctrl-c`, `Ctrl-x`
  and `Ctrl-v` work as expected in vim mode.
- **Real vim mappings.** `jk` leaves insert mode, `;` opens the `:` command line, and `j`/`k`/`0`/`$`
  move by wrapped lines. These go through Obsidian's vim API and can be edited.
- **Integrations.** Hooks into Obsidian Git, Linter, Omnisearch, Excalidraw, Folder Notes, Bases and
  the Flashcards plugin when they are installed.

## Key bindings (defaults)

<kbd>Space</kbd> is the leader. Press `<leader>wK` to see every binding, or `g?` in the explorer to see
the explorer keys.

### Everywhere

| Keys                        | Action                                                 |
| --------------------------- | ------------------------------------------------------ |
| `<leader>ff` / `<leader>fa` | Find files / all files including attachments           |
| `<leader>fw`                | Search text across the vault                           |
| `<leader>fb` / `<leader>fo` | Open tabs / recent files                               |
| `<leader>fh`, `<leader>ca`  | Command palette                                        |
| `<leader>e` / `<C-n>`       | Focus explorer (reveal current file) / toggle explorer |
| `<C-h>` `<C-j>` `<C-l>`     | Focus the pane left / below / right                    |
| `<Tab>` / `<S-Tab>`         | Next / previous tab                                    |
| `<leader>b` / `<leader>x`   | New tab / close tab                                    |
| `<leader>xt` / `<leader>xT` | Search open tasks / TODO, FIX, FIXME                   |
| `<leader>cs`                | Outline                                                |
| `<leader>th`                | Choose theme                                           |
| `<leader>wk`                | Search key bindings                                    |

### In a note (vim mode)

| Keys                     | Action                                                        |
| ------------------------ | ------------------------------------------------------------- |
| `gd` / `gr` / `K`        | Follow link / backlinks / preview link                        |
| `]t` / `[t`              | Next / previous TODO or open task                             |
| `za` `zo` `zc` `zR` `zM` | Folds                                                         |
| `<leader>/`              | Toggle comment                                                |
| `<leader>rn`             | Rename note                                                   |
| `<C-s>`                  | Save                                                          |
| `<C-c>` `<C-x>` `<C-v>`  | Copy, cut, paste with the system clipboard                    |
| `<C-q>`                  | Visual block                                                  |
| `]h` `[h` `<leader>gh…`  | Git hunks: next, previous, preview, stage, reset, blame, diff |

### File explorer

| Keys                   | Action                                                      |
| ---------------------- | ----------------------------------------------------------- |
| `j` / `k` / `gg` / `G` | Down / up / first / last                                    |
| `l` / `h`              | Open file or expand folder / collapse or go to parent       |
| `<CR>` `o` / `<Tab>`   | Open / preview (focus stays in the explorer)                |
| `s` / `S` / `t`        | Open in vertical split / horizontal split / new tab         |
| `a` / `A`              | Create a note, folder, canvas, drawing, … / create a folder |
| `r` / `d`              | Rename / delete                                             |
| `m`                    | Move to folder (see below)                                  |
| `c` `x` `p`            | Copy / cut / paste                                          |
| `y` / `Y` / `gy`       | Copy name / relative path / absolute path                   |
| `f`                    | Find and reveal a file                                      |
| `u`                    | Undo the last file operation                                |
| `z` / `R` / `q`        | Collapse all / reload tree / close explorer                 |
| `<Esc>`                | Back to the editor                                          |

**Move to folder (`m`)** opens a folder browser that starts in the item's own folder and lists only
its subfolders. Use `↑`/`↓` to pick a folder and <kbd>Enter</kbd> to move there. <kbd>Tab</kbd> or `→`
opens a folder, and <kbd>Backspace</kbd> or `←` goes up. <kbd>Shift</kbd>+<kbd>Enter</kbd> moves into
the folder you are viewing. You can also type a path: `../` goes up, `/` jumps to the vault root,
`a/b/` opens nested folders, and a path that doesn't exist yet offers to create it or rename on the
way. "Copy to folder" works the same way and has no default key.

Clicking a file in the explorer opens it but keeps keyboard focus in the explorer, so `m`, `r`, `d`
and the rest act on the file you clicked. Click into the note, or press `l` / <kbd>Enter</kbd>, to
edit it.

## Settings

Under **Settings → Community plugins → Vimoase**:

- Turn the explorer keys on or off, and choose whether a file click keeps focus in the explorer.
- Turn yank-to-system-clipboard on or off.
- Set the which-key popup delay, the timeout for ambiguous keys (like Neovim's `timeoutlen`), and the
  timeout for unfinished key sequences.
- Change the explorer cursor's colour, style (fill, outline or bar) and strength.
- Edit every key binding. Leave a field empty to unbind it.
- Edit the vim mappings (`jk → <Esc>` and so on).

## Requirements and notes

- Desktop only, Obsidian 1.8.7 or later.
- Editor bindings need Obsidian's vim mode (**Settings → Editor → Vim key bindings**). Explorer and
  other-view keys work without it.
- In insert mode and pickers, only bindings that start with Ctrl, Alt or Cmd are active, so typing is
  never blocked.
- Some features use undocumented Obsidian internals (the explorer tree, the CodeMirror vim adapter,
  some command ids). Every such access is guarded, but an Obsidian update could break one of them.

## Installation

Simply clone the repo in your vault's `.obsidian/plugins` folder, or download the latest release and unzip it there. Then enable the plugin in **Settings → Community plugins**.

```bash
git clone git@github.com:mandre1899/VimOase.git

```

## Development

The source is TypeScript in `src/`, bundled by esbuild into the `main.js` that Obsidian loads.
`main.js` is committed, so cloning the repo gives a working plugin; rebuild it after changing `src/`.

```bash
npm install
```

| Command | What it does |
|---|---|
| `npm run dev` | Rebuild `main.js` on every change (reload the plugin in Obsidian to see it) |
| `npm run build` | Type-check, then build `main.js` |
| `npm run check` | Type check, lint and tests: run before committing |
| `npm test` | Unit tests, plus a smoke test of the built `main.js` |

```text
src/
  main.ts                 plugin entry: creates the parts below and wires up events
  settings.ts             settings, defaults, and migrating older saved settings
  settings-tab.ts         the settings page
  obsidian-internals.ts   types for the undocumented Obsidian / CodeMirror APIs used
  keys/
    notation.ts           key notation: "<leader>ff", "<C-s>" ⇄ key events
    keymap.ts             actions, user overrides, and the per-context key tries
    actions.ts            every action with its label, contexts and default keys
    engine.ts             the keydown handler: contexts, sequences, which-key timing
  editor/
    vim.ts                finding the editor, yank-to-clipboard, vim mappings
    clipboard.ts          Ctrl-A / C / X / V in vim mode
    commands.ts           other editor actions (folds, TODO jumps, link preview, …)
  explorer/
    explorer.ts           finding / focusing the explorer, its cursor and own keys
    navigation.ts         j k h l gg G … and opening files
    keep-focus.ts         keep focus in the explorer after clicking a file
    file-ops.ts           create, rename, delete, move / copy, cut / paste, undo
    create-types.ts       what the `a` prompt can create
    undo.ts               the undo stack and its memory limits
  workspace/
    navigation.ts         commands, panes, opening files
    pickers.ts            file / tab / binding pickers and Ctrl-n/p/v/x/t in pickers
  ui/
    folder-picker/        the Move to folder browser (rows.ts has its logic, modal.ts the UI)
    prompt-modal.ts, confirm-modal.ts, cheatsheet-modal.ts, which-key.ts, create-hints.ts
  util/                   paths, cursor positions, DOM and error helpers
tests/                    vitest tests; tests/stubs/obsidian.ts stands in for the obsidian module
```

## Credits

Vimoase is inspired by [Vimakase](https://github.com/jelenv/obsidian-vimakase) by
[jelenv](https://github.com/jelenv) (MIT license). Vimakase came up with the idea of a LazyVim-style
setup for Obsidian: space leader keys with a which-key popup, vim clipboard keys, and a neo-tree-style
file explorer. Vimoase is a separate implementation of that idea with its own
additions.

Vimakase in turn credits [LazyVim](https://github.com/LazyVim/LazyVim),
[neo-tree.nvim](https://github.com/nvim-neo-tree/neo-tree.nvim) and
[Sidebar Keyboard Navigation](https://github.com/denvolok/obsidian-sidebar-keyboard-navigation).
