import { AUTO_LAYOUT, cleanLayout, findLayout, uniqueLayoutName, type Layout } from './layout.ts';
import type { Store } from './store.ts';

/** The layout in force (a built-in preset or one of the person's own). */
export const activeLayout = (store: Store): Layout => findLayout(store.settings.layout, store.settings.layouts);

export const isCustomLayout = (store: Store, l: Layout = activeLayout(store)): boolean => store.settings.layouts.includes(l);

/**
 * Change the active layout. A built-in preset is never edited: the first change makes a copy of it for the person
 * ("My layout", or "<preset> (edited)") and switches to the copy, so the presets stay as they were and nothing has to
 * be "duplicated" first. A layout of their own is changed in place (the controls on the Layout page hold the same object).
 * Returns the layout that now holds the change.
 */
export function editLayout(store: Store, patch: Partial<Layout>): Layout {
  const active = activeLayout(store);
  if (isCustomLayout(store, active)) {
    const next = cleanLayout({ ...active, ...patch }, active);
    if (!next) return active;
    const clash = next.name !== active.name && [...store.settings.layouts].some((l) => l !== active && l.name === next.name);
    if (clash) next.name = active.name;
    store.updateSettings((s) => {
      Object.assign(active, next);
      s.layout = active.name;
    });
    return active;
  }
  const name = uniqueLayoutName(active.name === AUTO_LAYOUT ? 'My layout' : `${active.name} (edited)`, store.settings.layouts);
  const copy = cleanLayout({ ...structuredClone(active), ...patch, name }, active)!;
  store.updateSettings((s) => {
    s.layouts.push(copy);
    s.layout = copy.name;
  });
  store.say(`Saved as your own layout "${copy.name}"; the preset itself is unchanged.`);
  return copy;
}
