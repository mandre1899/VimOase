/** Undo for explorer file operations (u). */

/** Deletes keep an in-memory copy so u can restore them; nothing bigger than this is copied. */
export const UNDO_SNAPSHOT_LIMIT = 50 * 1024 * 1024;
/** All in-memory copies together; the oldest are dropped first. */
export const UNDO_MEMORY_LIMIT = 200 * 1024 * 1024;
export const UNDO_MAX_ENTRIES = 100;

export interface UndoEntry {
  label: string;
  run(): unknown;
  /** Memory held by this entry (a deleted file's contents), 0 for most. */
  bytes: number;
}

export class UndoStack {
  private entries: UndoEntry[] = [];

  constructor(private readonly maxEntries = UNDO_MAX_ENTRIES, private readonly memoryLimit = UNDO_MEMORY_LIMIT) {}

  get size(): number {
    return this.entries.length;
  }

  get bytes(): number {
    return this.entries.reduce((n, e) => n + e.bytes, 0);
  }

  labels(): string[] {
    return this.entries.map((e) => e.label);
  }

  push(label: string, run: () => unknown, bytes = 0): void {
    this.entries.push({ label, run, bytes });
    if (this.entries.length > this.maxEntries) this.entries.shift();

    // Over the memory limit: drop the oldest entries that hold memory, never the newest.
    let total = this.bytes;
    while (total > this.memoryLimit) {
      const i = this.entries.findIndex((e) => e.bytes > 0);
      if (i < 0 || i === this.entries.length - 1) break;
      total -= this.entries[i].bytes;
      this.entries.splice(i, 1);
    }
  }

  pop(): UndoEntry | undefined {
    return this.entries.pop();
  }
}
