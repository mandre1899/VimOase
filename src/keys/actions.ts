/*
 * Every action Vimoase can bind: its group and label (shown in which-key, the cheatsheet and
 * the settings), the contexts it works in, and its default keys.
 */
import type VimoasePlugin from '../main';
import type { VimEditor } from '../editor/clipboard';
import type { EditorCtx } from '../editor/vim';
import type { ExplorerView } from '../obsidian-internals';
import { CheatsheetModal } from '../ui/cheatsheet-modal';
import type { Action, ContextName, KeyContext } from './keymap';

const N: ContextName = 'normal';
const V: ContextName = 'visual';
const I: ContextName = 'insert';
const O: ContextName = 'other';
const E: ContextName = 'explorer';
const P: ContextName = 'picker';
/** Leader keys work in the editor, other views and the explorer. */
const LEADER = [N, O, E];

const hasVim = (ctx: KeyContext): boolean => !!(ctx.ed?.adapter && ctx.ed.vim);
const hasSelection = (ctx: KeyContext): boolean =>
  hasVim(ctx) && !!(ctx.ed?.vim?.visualMode || ctx.ed?.adapter?.somethingSelected());

export function defineActions(p: VimoasePlugin): Action[] {
  const list: Action[] = [];
  let group = '';
  const add = (id: string, label: string, contexts: ContextName[], keys: string[], run: Action['run'], extra: Partial<Action> = {}) =>
    list.push({ group, id, label, contexts, keys, run, ...extra });

  // Wrappers for the common shapes of action.
  const cmd = (id: string, needsMain = false) => () => p.workspaceNav.cmd(id, needsMain);
  const git = (name: RegExp) => () => p.workspaceNav.cmdMatch({ plugin: 'obsidian-git', name, needs: 'Obsidian Git' });
  const inExplorer = (fn: (view: ExplorerView) => unknown) => () => {
    const view = p.explorer.view();
    if (view) return fn(view);
  };
  const inEditor = (fn: (ed: EditorCtx, ctx: KeyContext) => unknown) => (ctx: KeyContext) => {
    if (ctx.ed) return fn(ctx.ed, ctx);
  };
  /** For actions with `when: hasVim`, so the adapter and vim state are there. */
  const inVim = (fn: (ed: VimEditor) => unknown) => (ctx: KeyContext) => {
    const ed = ctx.ed;
    if (ed?.adapter && ed.vim) return fn({ ...ed, adapter: ed.adapter, vim: ed.vim });
  };

  group = 'Editing and UI';
  add('save', 'Save current file', [N, I, V, O], ['<C-s>'], cmd('editor:save-file'));
  add('copyFile', 'Copy whole note to clipboard', [N], ['<C-c>'], inEditor((e) => p.editorCommands.copyWholeFile(e)));
  add('nohl', 'Clear search highlighting (Esc still reaches vim)', [N], ['<Esc>'], inEditor((e) => p.editorCommands.noHighlight(e)), { passThrough: true });
  add('toggleComment', 'Toggle comment on line / selection', [N, V], ['<leader>/'], (ctx) => p.editorCommands.toggleComment(ctx));
  add('lineNumbers', 'Toggle line numbers', LEADER, ['<leader>n'], () => p.editorCommands.toggleLineNumbers());
  add('cheatsheet', 'Show all key bindings', LEADER, ['<leader>wK'], () => new CheatsheetModal(p).open());
  add('queryKeys', 'Search key bindings', LEADER, ['<leader>wk'], () => p.pickers.bindings());
  add('format', 'Format note (Linter plugin)', [N, V], ['<leader>lf', '<leader>fm'], () =>
    p.workspaceNav.cmdMatch({ ids: ['obsidian-linter:lint-file'], plugin: 'obsidian-linter', name: /lint (the )?(current )?file/i, needs: 'Linter' }));
  add('theme', 'Choose theme', LEADER, ['<leader>th'], cmd('theme:switch'));

  group = 'Windows, tabs and files';
  add('focusLeft', 'Focus pane left', [N, O, E], ['<C-h>'], () => p.workspaceNav.focusDir('left'));
  add('focusDown', 'Focus pane below', [N, O, E], ['<C-j>'], () => p.workspaceNav.focusDir('down'));
  add('focusRight', 'Focus pane right', [N, O, E], ['<C-l>'], () => p.workspaceNav.focusDir('right'));
  add('focusUp', 'Focus pane above', [N, O, E], [], () => p.workspaceNav.focusDir('up'));
  add('nextTab', 'Next tab', [N, O], ['<Tab>'], cmd('workspace:next-tab'));
  add('prevTab', 'Previous tab', [N, O], ['<S-Tab>'], cmd('workspace:previous-tab'));
  add('newTab', 'New empty tab (new buffer)', LEADER, ['<leader>b'], cmd('workspace:new-tab', true));
  add('closeTab', 'Close current tab', LEADER, ['<leader>x'], cmd('workspace:close', true));
  add('closeOthers', 'Close other tabs', LEADER, [], cmd('workspace:close-others', true));
  add('splitRight', 'Split right', LEADER, [], cmd('workspace:split-vertical', true));
  add('splitDown', 'Split down', LEADER, [], cmd('workspace:split-horizontal', true));
  add('newNote', 'New note', LEADER, [], cmd('file-explorer:new-file'));
  add('toggleExplorer', 'Toggle file explorer', [N, O, E], ['<C-n>'], () => p.explorer.toggleExplorer());
  add('focusExplorer', 'Focus file explorer (reveal current file)', LEADER, ['<leader>e'], () => p.explorer.revealInExplorer());
  add('renameNote', 'Rename current note', [N, O], ['<leader>rn'], () => p.workspaceNav.renameActiveNote());

  group = 'Search and discovery';
  add('findFiles', 'Find files (quick switcher)', LEADER, ['<leader>ff'], cmd('switcher:open'));
  add('findAll', 'Find all files (incl. attachments)', LEADER, ['<leader>fa'], () => p.pickers.allFiles());
  add('grep', 'Search text across the vault', LEADER, ['<leader>fw'], cmd('global-search:open'));
  add('buffers', 'List open tabs', LEADER, ['<leader>fb'], () => p.pickers.tabs());
  add('recent', 'Recently opened files', LEADER, ['<leader>fo'], () => p.pickers.recent());
  add('searchNote', 'Search in current note', [N], ['<leader>fz'], cmd('editor:open-search'));
  add('help', 'Help / command palette', LEADER, ['<leader>fh'], cmd('command-palette:open'));
  add('codeActions', 'Actions (command palette)', [N, V, O], ['<leader>ca'], cmd('command-palette:open'));
  add('marks', 'Bookmarks', LEADER, ['<leader>ma'], cmd('bookmarks:open'));
  add('omnisearch', 'Omnisearch', LEADER, [], () => p.workspaceNav.cmdMatch({ ids: ['omnisearch:show-modal'], needs: 'Omnisearch' }));
  add('todosAll', 'Search all TODOs / open tasks', LEADER, ['<leader>xt'], () =>
    p.workspaceNav.globalSearch('/\\b(TODO|FIXME|FIX|HACK|NOTE|PERF|WARN)\\b|- \\[ \\]/'));
  add('todosFix', 'Search TODO / FIX / FIXME', LEADER, ['<leader>xT'], () => p.workspaceNav.globalSearch('/\\b(TODO|FIXME|FIX)\\b/'));

  group = 'Navigation and links';
  add('followLink', 'Follow link under cursor', [N], ['gd'], cmd('editor:follow-link'));
  add('followLinkTab', 'Follow link in new tab', [N], [], cmd('editor:open-link-in-new-leaf'));
  add('backlinks', 'Show backlinks', [N, O], ['gr'], () => p.workspaceNav.cmdMatch({ ids: ['backlink:open'], needs: 'Backlinks core plugin' }));
  add('hover', 'Preview link under cursor', [N], ['K'], inEditor((e) => p.editorCommands.hoverLink(e)));
  add('outline', 'Outline (symbols)', LEADER, ['<leader>cs'], cmd('outline:open'));
  add('nextTodo', 'Next TODO / open task', [N], [']t'], inEditor((e) => p.editorCommands.jumpTodo(e, 1)));
  add('prevTodo', 'Previous TODO / open task', [N], ['[t'], inEditor((e) => p.editorCommands.jumpTodo(e, -1)));

  group = 'Folds';
  add('foldToggle', 'Toggle fold', [N], ['za'], cmd('editor:toggle-fold'));
  add('foldOpen', 'Open fold', [N], ['zo'], inEditor((e) => p.editorCommands.fold(e, false)));
  add('foldClose', 'Close fold', [N], ['zc'], inEditor((e) => p.editorCommands.fold(e, true)));
  add('unfoldAll', 'Open all folds', [N], ['zR'], cmd('editor:unfold-all'));
  add('foldAll', 'Close all folds', [N], ['zM'], cmd('editor:fold-all'));

  group = 'Insert mode';
  const vimOnly = { when: hasVim };
  add('insLeft', 'Move left', [I], ['<C-h>'], inVim((e) => p.editorCommands.insMove(e, 'left')), vimOnly);
  add('insDown', 'Move down', [I], ['<C-j>'], inVim((e) => p.editorCommands.insMove(e, 'down')), vimOnly);
  add('insUp', 'Move up', [I], [], inVim((e) => p.editorCommands.insMove(e, 'up')), vimOnly);
  add('insRight', 'Move right', [I], ['<C-l>'], inVim((e) => p.editorCommands.insMove(e, 'right')), vimOnly);
  add('insLineStart', 'Beginning of line', [I], ['<C-b>'], inVim((e) => p.editorCommands.insMove(e, 'home')), vimOnly);

  group = 'Clipboard (vim mode)';
  add('selectAll', 'Select whole note (Esc returns)', [N, V, I], [], inVim((e) => p.clipboard.doSelectAll(e)), vimOnly);
  add('copySel', 'Copy selection (insert: only with a selection)', [V, I], ['<C-c>'], inVim((e) => p.clipboard.doCopy(e, false)), { when: hasSelection });
  add('cutSel', 'Cut selection (insert: only with a selection)', [V, I], ['<C-x>'], inVim((e) => p.clipboard.doCopy(e, true)), { when: hasSelection });
  add('copyLine', 'Copy line or selection', [N], [], inVim((e) => p.clipboard.doCopy(e, false)), vimOnly);
  add('paste', 'Paste system clipboard', [N, V, I], ['<C-v>'], inVim((e) => p.clipboard.doPaste(e)), vimOnly);
  add('visualBlock', 'Visual block', [N, V], ['<C-q>'], inVim((e) => p.editorCommands.visualBlock(e)), vimOnly);

  group = 'Git (Obsidian Git plugin)';
  add('gitView', 'Source control view', LEADER, [], git(/source control|open git view/i));
  add('gitCommits', 'Commit history', LEADER, ['<leader>cm'], git(/history/i));
  add('nextHunk', 'Next hunk', [N], [']h'], git(/next hunk/i));
  add('prevHunk', 'Previous hunk', [N], ['[h'], git(/prev(ious)? hunk/i));
  add('previewHunk', 'Preview hunk', [N], ['<leader>ghp'], git(/preview hunk/i));
  add('blame', 'Blame', [N], ['<leader>ghb'], git(/blame/i));
  add('diffFile', 'Diff current file', [N], ['<leader>ghd'], git(/diff view|open diff/i));
  add('stageHunk', 'Stage hunk', [N, V], ['<leader>ghs'], git(/stage hunk/i));
  add('resetHunk', 'Reset hunk', [N, V], ['<leader>ghr'], git(/reset hunk/i));

  group = 'File explorer';
  const nav = p.explorerNav;
  const files = p.files;
  add('exDown', 'Down', [E], ['j'], inExplorer((v) => nav.down(v)));
  add('exUp', 'Up', [E], ['k'], inExplorer((v) => nav.up(v)));
  add('exLeft', 'Close folder / go to parent', [E], ['h', '<BS>'], inExplorer((v) => nav.left(v)));
  add('exRight', 'Open file / expand folder', [E], ['l'], inExplorer((v) => nav.right(v)));
  add('exOpen', 'Open file / toggle folder', [E], ['<CR>', 'o'], inExplorer((v) => nav.enter(v)));
  add('exPreview', 'Preview file (keep focus here)', [E], ['<Tab>'], inExplorer((v) => nav.preview(v)));
  add('exVsplit', 'Open in vertical split', [E], ['<C-v>', 's'], inExplorer((v) => nav.openFocused(v, 'vertical')));
  add('exHsplit', 'Open in horizontal split', [E], ['<C-x>', 'S'], inExplorer((v) => nav.openFocused(v, 'horizontal')));
  add('exTab', 'Open in new tab', [E], ['<C-t>', 't'], inExplorer((v) => nav.openFocused(v, 'tab')));
  add('exFirst', 'First item', [E], ['gg'], inExplorer((v) => nav.edge(v, false)));
  add('exLast', 'Last item', [E], ['G'], inExplorer((v) => nav.edge(v, true)));
  add('exParent', 'Go to parent folder', [E], ['P'], inExplorer((v) => nav.parent(v)));
  add('exCollapseAll', 'Collapse all folders', [E], ['z'], inExplorer((v) => nav.collapseAll(v)));
  add('exAdd', 'Create note, folder/, canvas, drawing, flashcards, base…', [E], ['a'], inExplorer((v) => files.add(v, false)));
  add('exAddFolder', 'Create folder', [E], ['A'], inExplorer((v) => files.add(v, true)));
  add('exRename', 'Rename', [E], ['r'], inExplorer((v) => files.rename(v)));
  add('exDelete', 'Delete', [E], ['d'], inExplorer((v) => files.delete(v)));
  add('exCopy', 'Copy', [E], ['c'], inExplorer((v) => files.setClip(v, 'copy')));
  add('exCut', 'Cut', [E], ['x'], inExplorer((v) => files.setClip(v, 'cut')));
  add('exPaste', 'Paste', [E], ['p'], inExplorer((v) => files.paste(v)));
  add('exMove', 'Move to folder', [E], ['m'], inExplorer((v) => files.moveOrCopy(v, 'move')));
  add('exCopyTo', 'Copy to folder', [E], [], inExplorer((v) => files.moveOrCopy(v, 'copy')));
  add('exYankName', 'Copy name', [E], ['y'], inExplorer((v) => nav.yankPath(v, 'name')));
  add('exYankRel', 'Copy relative path', [E], ['Y'], inExplorer((v) => nav.yankPath(v, 'relative')));
  add('exYankAbs', 'Copy absolute path', [E], ['gy'], inExplorer((v) => nav.yankPath(v, 'absolute')));
  add('exFilter', 'Find and reveal a file', [E], ['f'], () => p.pickers.reveal());
  add('exReload', 'Reload tree', [E], ['R'], inExplorer((v) => nav.reload(v)));
  add('exUndo', 'Undo last file operation', [E], ['u'], () => files.undoLast());
  add('exHelp', 'Show explorer keys', [E], ['g?'], () => new CheatsheetModal(p, E).open());
  add('exClose', 'Close explorer', [E], ['q'], () => p.explorer.closeExplorer());
  add('exEscape', 'Back to editor', [E], ['<Esc>'], () => p.workspaceNav.focusEditor());

  group = 'Pickers (quick switcher, command palette, …)';
  add('pkNext', 'Next result', [P], ['<C-n>'], (ctx) => p.pickers.key(ctx, 'down'));
  add('pkPrev', 'Previous result', [P], ['<C-p>'], (ctx) => p.pickers.key(ctx, 'up'));
  add('pkVsplit', 'Open in vertical split', [P], ['<C-v>'], (ctx) => p.pickers.key(ctx, 'vertical'));
  add('pkHsplit', 'Open in horizontal split (Vimoase pickers)', [P], ['<C-x>'], (ctx) => p.pickers.key(ctx, 'horizontal'));
  add('pkTab', 'Open in new tab', [P], ['<C-t>'], (ctx) => p.pickers.key(ctx, 'tab'));

  return list;
}
