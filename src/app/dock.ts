import { h } from './dom.ts';
import { icon, type IconName } from './icons.ts';

/** The three places the dock goes to. */
export type View = 'home' | 'edit' | 'settings';
const VIEWS: { id: View; label: string; icon: IconName }[] = [
  { id: 'home', label: 'Home', icon: 'home' },
  { id: 'edit', label: 'Edit', icon: 'split' },
  { id: 'settings', label: 'Settings', icon: 'settings' },
];

/**
 * The bottom dock (the layout TurboKeep calls "Bottom dock"): Home, Edit and Settings as icon-and-label buttons along the bottom edge.
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

  constructor(private pick: (v: View) => void) {
    this.el.append(this.nav);
    this.ro = new ResizeObserver(() => requestAnimationFrame(() => (this.place(), this.measure())));
    this.ro.observe(this.nav);
    window.addEventListener('resize', () => this.measure());
  }

  /** Show the dock with the given view lit. `on` false hides it. */
  render(on: boolean, active: View): void {
    this.el.hidden = !on;
    document.documentElement.classList.toggle('has-dock', on);
    if (!on) {
      document.documentElement.style.removeProperty('--dock-h');
      return;
    }
    const sig = 'v';
    if (sig !== this.sig) {
      this.sig = sig;
      this.nav.replaceChildren(this.ind, ...VIEWS.map((v) => h('button', { class: 'bt-tab', type: 'button', 'data-tab': v.label, onclick: () => this.pick(v.id) }, icon(v.icon, 20), h('span', {}, v.label))));
      this.nav.removeAttribute('data-ind-ready');
      requestAnimationFrame(() => this.nav.setAttribute('data-ind-ready', '')); // the first placement does not glide
    }
    for (const b of this.nav.querySelectorAll<HTMLElement>('.bt-tab')) {
      if (b.dataset.tab === VIEWS.find((v) => v.id === active)!.label) b.setAttribute('aria-current', 'page');
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
