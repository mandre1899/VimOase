import { Notice } from 'obsidian';

/** Logs the error and shows it as a notice. */
export function reportError(err: unknown): void {
  console.error('[vimoase]', err);
  const message = err instanceof Error && err.message ? err.message : String(err);
  new Notice('Vimoase: ' + message);
}
