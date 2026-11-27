/* Running Obsidian commands, moving between panes and opening files. */
import { Notice, type TFile, type WorkspaceLeaf, type WorkspaceSidedock, type WorkspaceMobileDrawer } from 'obsidian';
import type VimoasePlugin from '../main';
import { appInternals } from '../obsidian-internals';
import { PromptModal } from '../ui/prompt-modal';
import { basename, hasExtension, joinPath } from '../util/paths';

/** How a picked file opens: in the main pane (null), a split, or a new tab. */
export type OpenMode = 'vertical' | 'horizontal' | 'tab' | null;
export type Direction = 'left' | 'right' | 'up' | 'down';

export interface CommandSpec {
  /** Command ids to try first, in order. */
  ids?: string[];
  /** Otherwise the first command of this plugin whose name matches. */
  plugin?: string;
  name?: RegExp;
  /** Shown when nothing matches: "needs <this>". */
  needs?: string;
}

type Sidebar = WorkspaceSidedock | WorkspaceMobileDrawer;

const FOCUS_COMMANDS: Record<Direction, string> = {
  left: 'editor:focus-left',
  right: 'editor:focus-right',
  up: 'editor:focus-top',
  down: 'editor:focus-bottom',
};

export class WorkspaceNav {
  constructor(private readonly plugin: VimoasePlugin) {}

  private get ws() {
    return this.plugin.app.workspace;
  }

  /** Runs a command. `needsMain` first moves focus from a sidebar into the main area. */
  cmd(id: string, needsMain = false): boolean {
    const commands = appInternals(this.plugin.app).commands;
    if (!commands || !commands.commands || !commands.commands[id]) {
      new Notice('Vimoase: command not available: ' + id);
      return false;
    }
    if (needsMain) {
      const active = this.ws.activeLeaf;
      if (!active || active.getRoot() !== this.ws.rootSplit) {
        const main = this.mainLeaf();
        if (main) this.ws.setActiveLeaf(main, { focus: true });
      }
    }
    return commands.executeCommandById(id);
  }

  /** Runs the first command that matches, for commands from other plugins whose ids vary. */
  cmdMatch(spec: CommandSpec): boolean {
    const commands = appInternals(this.plugin.app).commands?.commands || {};
    let id = (spec.ids || []).find((x) => commands[x]);
    if (!id && spec.plugin && spec.name) {
      const { plugin, name } = spec;
      id = Object.keys(commands).find((x) => x.startsWith(plugin + ':') && name.test(commands[x].name || ''));
    }
    if (!id) {
      new Notice('Vimoase: needs ' + (spec.needs || 'a plugin') + ' (no matching command)');
      return false;
    }
    return this.cmd(id);
  }

  globalSearch(query: string): void {
    const gs = appInternals(this.plugin.app).internalPlugins?.getPluginById?.('global-search');
    if (gs?.instance?.openGlobalSearch) gs.instance.openGlobalSearch(query);
    else this.cmd('global-search:open');
  }

  mainLeaf(): WorkspaceLeaf | null {
    return this.ws.getMostRecentLeaf(this.ws.rootSplit) || null;
  }

  focusEditor(): void {
    const leaf = this.mainLeaf();
    if (!leaf) return;
    this.ws.setActiveLeaf(leaf, { focus: true });
    const editor = (leaf.view as { editor?: { focus?(): void } }).editor;
    if (editor && typeof editor.focus === 'function') editor.focus();
  }

  sidebarOf(leaf: WorkspaceLeaf): Sidebar | null {
    const root = leaf.getRoot();
    return root === this.ws.leftSplit || root === this.ws.rightSplit ? (root as Sidebar) : null;
  }

  /** Ctrl-h/j/l: move between panes, and hop into / out of the sidebars like nvim's tree window. */
  focusDir(dir: Direction): void {
    const ws = this.ws;
    const active = ws.activeLeaf;
    const sidebar = active && this.sidebarOf(active);
    if (sidebar === ws.leftSplit && dir === 'right') return this.focusEditor();
    if (sidebar === ws.rightSplit && dir === 'left') return this.focusEditor();
    if (sidebar) return;

    const commands = appInternals(this.plugin.app).commands;
    if (commands?.commands[FOCUS_COMMANDS[dir]]) commands.executeCommandById(FOCUS_COMMANDS[dir]);
    if (ws.activeLeaf !== active) return;

    // Already at the edge: hop into the sidebar on that side.
    const split = dir === 'left' ? ws.leftSplit : dir === 'right' ? ws.rightSplit : null;
    if (!split || split.collapsed) return;
    const explorer = this.plugin.explorer.leaf();
    if (explorer && this.sidebarOf(explorer) === split && explorer.view.containerEl.isShown()) {
      void this.plugin.explorer.focusExplorer();
      return;
    }
    let target: WorkspaceLeaf | null = null;
    ws.iterateAllLeaves((leaf) => {
      if (!target && leaf.getRoot() === split && leaf.view && leaf.view.containerEl.isShown()) target = leaf;
    });
    if (target) ws.setActiveLeaf(target, { focus: true });
  }

  async openFile(file: TFile, mode: OpenMode = null): Promise<void> {
    const ws = this.ws;
    const main = this.mainLeaf();
    let leaf: WorkspaceLeaf;
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

  renameActiveNote(): void {
    const file = this.ws.getActiveFile();
    if (!file) {
      new Notice('No active note');
      return;
    }
    const ext = file.extension ? '.' + file.extension : '';
    new PromptModal(this.plugin.app, {
      title: 'Rename note',
      desc: file.path,
      value: file.basename,
      select: [0, file.basename.length],
      onSubmit: (value) =>
        this.plugin.files.wrap(async () => {
          let name = value.trim();
          if (!name || name === file.basename) return;
          if (!hasExtension(basename(name))) name += ext;
          await this.plugin.files.renameTo(file, joinPath(file.parent ? file.parent.path : '/', name));
        }),
    }).open();
  }
}
