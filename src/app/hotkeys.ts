/**
 * Keyboard shortcuts as data: every action has an id, a label and default key combos; the person can add, remove
 * and reset combos and the result is saved in the settings. A combo is text like "Ctrl+Shift+Z", "Space", "[".
 */

export interface HotkeyAction {
  id: string;
  label: string;
  group: string;
  keys: string[];
  run: (e: KeyboardEvent) => void;
}

const MODIFIER_KEYS = new Set(['Control', 'Shift', 'Alt', 'Meta', 'AltGraph', 'CapsLock']);

/** The combo a key event stands for, or '' while only modifier keys are held. */
export function comboFromEvent(e: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>): string {
  if (MODIFIER_KEYS.has(e.key) || !e.key) return '';
  let key = e.key === ' ' ? 'Space' : e.key;
  if (key.length === 1) key = key.toUpperCase();
  const isSymbol = key.length === 1 && !/[A-Z0-9]/.test(key);
  const mods: string[] = [];
  if (e.ctrlKey || e.metaKey) mods.push('Ctrl');
  if (e.altKey) mods.push('Alt');
  // Shift is part of a symbol already ("?" is Shift+/), so it only counts with letters, digits and named keys.
  if (e.shiftKey && !isSymbol) mods.push('Shift');
  return [...mods, key].join('+');
}

/** Human-readable version of a combo ("Ctrl+Shift+Z" stays, "ArrowLeft" becomes "←"). */
export function prettyCombo(combo: string): string {
  const map: Record<string, string> = { ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓', Space: 'Space', Backspace: '⌫', Delete: 'Del' };
  return combo.split('+').map((p) => map[p] ?? p).join('+');
}

export class Hotkeys {
  private actions = new Map<string, HotkeyAction>();

  constructor(
    private overrides: () => Record<string, string[]>,
    private saveOverrides: (o: Record<string, string[]>) => void,
  ) {}

  register(actions: HotkeyAction[]): void {
    for (const a of actions) this.actions.set(a.id, a);
  }

  list(): HotkeyAction[] {
    return [...this.actions.values()];
  }

  /** The combos in force for an action: the person's own, or the defaults. */
  keysFor(id: string): string[] {
    const own = this.overrides()[id];
    return own ?? this.actions.get(id)?.keys ?? [];
  }

  isCustom(id: string): boolean {
    return id in this.overrides();
  }

  /** Which other action already uses this combo, if any. */
  conflict(combo: string, exceptId?: string): HotkeyAction | undefined {
    return this.list().find((a) => a.id !== exceptId && this.keysFor(a.id).includes(combo));
  }

  setKeys(id: string, keys: string[]): void {
    this.saveOverrides({ ...this.overrides(), [id]: [...new Set(keys)] });
  }

  /** Add a combo to an action; if another action had it, take it away from that one. Returns the action it was taken from. */
  addKey(id: string, combo: string): HotkeyAction | undefined {
    const taken = this.conflict(combo, id);
    if (taken) this.setKeys(taken.id, this.keysFor(taken.id).filter((k) => k !== combo));
    this.setKeys(id, [...this.keysFor(id), combo]);
    return taken;
  }

  removeKey(id: string, combo: string): void {
    this.setKeys(id, this.keysFor(id).filter((k) => k !== combo));
  }

  reset(id: string): void {
    const o = { ...this.overrides() };
    delete o[id];
    this.saveOverrides(o);
  }

  resetAll(): void {
    this.saveOverrides({});
  }

  /** Run the action bound to this key event. Returns whether one ran. */
  handle(e: KeyboardEvent): boolean {
    const combo = comboFromEvent(e);
    if (!combo) return false;
    const hit = this.list().find((a) => this.keysFor(a.id).includes(combo));
    if (!hit) return false;
    hit.run(e);
    return true;
  }
}
