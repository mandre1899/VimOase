# Changelog

## 0.2.0 — 2026-11-27

### Changed

- **Renamed to Vimoase.** The plugin id is now `vimoase` (was `vimakase-selfcoded`) and the plugin
  folder is `.obsidian/plugins/vimoase/`. Re-enable it under Community plugins if Obsidian lost track
  of it after the rename.
- **Author is now mandre1899.**
- **"Move to" and "Copy to" in the file explorer are now a folder browser** instead of a plain text box:
  - It starts in the item's own folder and lists only that folder's subfolders, plus **Move here** and `..`.
  - Breadcrumbs and an ↑ button jump to any parent folder.
  - Typing filters the list. Paths work too: `../` goes up, `/` jumps to the vault root, and `a/b/`
    opens nested folders.
  - A path that doesn't exist yet offers **New folder** (create it and move in) or **Move as**
    (move and rename).
  - Keys: `↑`/`↓` or `Ctrl-n`/`Ctrl-p`/`Ctrl-j`/`Ctrl-k` to select, `Enter` to move, `Tab`/`→`/`Ctrl-l` to
    open a folder, `Backspace`/`←`/`Shift-Tab` to go up, `Shift-Enter` to move into the folder you're
    viewing.
  - When you move a folder, the folder itself and its subfolders are disabled. Targets that already
    contain an item with the same name are marked *name taken*.
- The bindings are now labelled "Move to folder" and "Copy to folder".
- **Copy to folder** gives the copy a free name (`name 1`, …) when the target already has an item with
  that name, instead of failing.

### Added

- **Keep focus in explorer after clicking a file** (new setting, on by default). A plain click on a
  file still opens it, but keyboard focus returns to the explorer with the cursor on that file, so `m`,
  `r`, `d` and the other explorer keys act on it straight away. Clicking into the note within about a
  second, or a Cmd/Ctrl/Shift/Alt-click, leaves focus where Obsidian put it.
- A README that explains the plugin's purpose, default keys and settings.

### Fixed

- `m` (and Copy to folder) did nothing unless the j/k cursor was on an item. It now falls back to the
  clicked or highlighted item, then to the open file, and shows a notice when there's nothing to act on
  or when the item is the vault root.
- Deleting (`d`) a large folder no longer reads every file into memory first. The undo copy is skipped
  for anything over 50 MB: the delete prompt says so and where the files will go (system trash, the
  vault's `.trash` folder, or permanently, following Obsidian's "Deleted files" setting). Undo copies
  together are capped at 200 MB, and the oldest are dropped first.

## 0.1.0

- First version, released as Vimakase (self-coded).
