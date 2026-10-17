import { h } from './dom.ts';
import { icon, type IconName } from './icons.ts';
import type { TabName } from './layout.ts';

const ICON: Record<TabName, IconName> = { Clip: 'sliders', Media: 'video', Captions: 'captions', Project: 'file', Settings: 'settings' };

/**
 * The bottom dock (the layout TurboKeep calls "Bottom dock"): the panel tabs as icon-and-label buttons along the bottom edge.
 * It wears the themes' bar hooks (`bt-tabbar`, `bt-tab`, `bt-shell`), so every look draws it its own way (Liquid Glass floats
 * it as a pill with a lit shape that glides to the chosen tab: `bt-ind` and the `--ind-*` variables, the same recipe as TurboKeep's
 * `useIndicator`). The slot around it keeps its height, because a look may float the bar over the page.
 */
export class Dock {
  readonly el = h('div', { class: 'dock', hidden: true });
  private nav = h('nav', { class: 'bt-tabbar bt-shell dock-nav', 'aria-label': 'Panels' });
  private ind = h('span', { class: 'bt-ind', 'aria-hidden': 'true' });
  private sig = '';
  private ro: ResizeObserver;

  constructor(private pick: (t: TabName) => void) {
    this.el.append(this.nav);
    this.ro = new ResizeObserver(() => (this.place(), this.measure()));
    this.ro.observe(this.nav);
    window.addEventListener('resize', () => this.measure());
  }

  /** Show the dock with these tabs, the given one lit. `on` false hides it. */
  render(on: boolean, tabs: TabName[], active: TabName): void {
    this.el.hidden = !on;
    document.documentElement.classList.toggle('has-dock', on);
    if (!on) return;
    const sig = tabs.join();
    if (sig !== this.sig) {
      this.sig = sig;
      this.nav.replaceChildren(this.ind, ...tabs.map((t) => h('button', { class: 'bt-tab', type: 'button', 'data-tab': t, onclick: () => this.pick(t) }, icon(ICON[t], 20), h('span', {}, t))));
      this.nav.removeAttribute('data-ind-ready');
      requestAnimationFrame(() => this.nav.setAttribute('data-ind-ready', '')); // the first placement does not glide
    }
    for (const b of this.nav.querySelectorAll<HTMLElement>('.bt-tab')) {
      if (b.dataset.tab === active) b.setAttribute('aria-current', 'page');
      else b.removeAttribute('aria-current');
    }
    this.place();
    this.measure();
  }

  private place(): void {
    const a = this.nav.querySelector<HTMLElement>('[aria-current="page"]');
    this.nav.style.setProperty('--ind-o', a ? '1' : '0');
    if (!a) return;
    this.nav.style.setProperty('--ind-x', `${a.offsetLeft}px`);
    this.nav.style.setProperty('--ind-y', `${a.offsetTop}px`);
    this.nav.style.setProperty('--ind-w', `${a.offsetWidth}px`);
    this.nav.style.setProperty('--ind-h', `${a.offsetHeight}px`);
  }

  /** Keep the slot as tall as the bar, plus the gap a look that floats the bar leaves around it. */
  private measure(): void {
    if (this.el.hidden) return;
    const floating = getComputedStyle(this.nav).position === 'fixed';
    const h = this.nav.offsetHeight + (floating ? 24 : 0);
    this.el.style.height = `${h}px`;
    document.documentElement.style.setProperty('--dock-h', `${h}px`);
  }
}
