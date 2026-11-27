/**
 * Narrows an event target to an Element. Uses duck typing instead of `instanceof Element`,
 * which fails for elements in Obsidian's pop-out windows (each window has its own classes).
 */
export function asElement(target: EventTarget | null): Element | null {
  return target && typeof (target as Element).closest === 'function' ? (target as Element) : null;
}

/** True when the element is (inside) something the user types into. */
export function isEditable(el: Element): boolean {
  return !!el.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])');
}

export function fakeKey(key: string): KeyboardEvent {
  return new KeyboardEvent('keydown', { key });
}

/* Key events the plugin dispatches itself, so its own keydown handler can ignore them. */
const synthetic = new WeakSet<Event>();

export function dispatchSyntheticKey(target: EventTarget, init: KeyboardEventInit): void {
  const ev = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  synthetic.add(ev);
  target.dispatchEvent(ev);
}

export function isSynthetic(ev: Event): boolean {
  return synthetic.has(ev);
}
