import { h } from './dom.ts';
import { LIMITS, normalizeSizes, type AppliedLayout, type TabName } from './layout.ts';
import { splitter } from './splitter.ts';

export interface PanelHooks {
  /** The panel width in pixels now. */
  getWidth(): number;
  /** Set the panel width while it is dragged (`commit` false) or when the drag is done (`commit` true: save it). */
  setWidth(px: number, commit: boolean): void;
  /** The panes' heights in percent, while dragged or when done. */
  setPaneSizes(sizes: number[], commit: boolean): void;
  /** Put the sizes back to what the preset says. */
  resetSizes(): void;
}

interface Pane {
  tabs: TabName[];
  active: TabName;
  el: HTMLElement;
  strip: HTMLElement;
  body: HTMLElement;
}

/**
 * The side panel: one to three panes stacked top to bottom, each with its own tab strip (or, in the dock layout, none: the
 * dock along the bottom of the window shows the tabs). Draggable bars resize the panel and the panes. The tab contents are
 * built once by the app and only moved between panes, so nothing inside them is rebuilt when the arrangement changes.
 */
export class PanelHost {
  readonly el = h('aside', { class: 'bt-side bt-shell side collapsed' });
  private panes: Pane[] = [];
  private sig = '';
  private last: TabName = 'Clip';
  private order: TabName[] = [];
  private edge: HTMLElement;
  private panel: AppliedLayout['panel'] = 'right';
  onShow?: (name: TabName, userTap: boolean) => void;

  constructor(private tabs: Record<TabName, HTMLElement>, private hooks: PanelHooks) {
    let startW = 0;
    this.edge = splitter({
      axis: 'x',
      label: 'Resize the panel',
      extraClass: 'splitter-edge',
      onStart: () => (startW = this.hooks.getWidth()),
      onDrag: (dx) => this.hooks.setWidth(this.clampW(startW + (this.panel === 'left' ? dx : -dx)), false),
      onEnd: () => this.hooks.setWidth(this.hooks.getWidth(), true),
      onReset: () => this.hooks.resetSizes(),
    });
  }

  private clampW(px: number): number {
    const max = Math.min(LIMITS.panelWidth[1], Math.max(LIMITS.panelWidth[0], window.innerWidth * 0.6));
    return Math.round(Math.min(max, Math.max(LIMITS.panelWidth[0], px)));
  }

  /** The tab shown last (the one the dock highlights). */
  get current(): TabName {
    return this.last;
  }

  /** Every tab the layout shows, in order. */
  get shown(): TabName[] {
    return this.order;
  }

  /** Draw the arrangement the layout asks for. Cheap when nothing about the panes changed. */
  apply(l: AppliedLayout): void {
    this.panel = l.panel;
    this.el.dataset.dock = l.dock ? 'on' : 'off';
    const sig = JSON.stringify([l.panes, l.dock]);
    if (sig !== this.sig) {
      this.sig = sig;
      this.build(l);
    }
    l.paneSizes.forEach((p, i) => this.panes[i] && (this.panes[i]!.el.style.flexBasis = `${p}%`));
    this.order = l.panes.flat();
    if (!this.order.includes(this.last)) this.show(this.order[0]!);
    else this.show(this.last);
    this.edge.hidden = l.panel === 'sheet';
    this.edge.dataset.side = l.panel;
  }

  private build(l: AppliedLayout): void {
    const old = new Map(this.panes.flatMap((p) => p.tabs.map((t) => [t, p.active] as const)));
    this.panes = l.panes.map((tabs) => {
      const strip = h('div', { class: 'tabs', role: 'tablist' }, ...tabs.map((name) => h('button', { class: 'tab', role: 'tab', 'data-tab': name, onclick: () => this.show(name, true) }, name)));
      const body = h('div', { class: 'tab-body' });
      const el = h('div', { class: 'pane' }, strip, body);
      const keep = tabs.find((t) => old.get(t) === t);
      return { tabs, active: keep ?? tabs[0]!, el, strip, body };
    });
    const parts: HTMLElement[] = [];
    this.panes.forEach((p, i) => {
      parts.push(p.el);
      if (i < this.panes.length - 1) parts.push(this.paneSplitter(i));
    });
    this.el.replaceChildren(...parts, this.edge);
  }

  private paneSplitter(i: number): HTMLElement {
    let start: number[] = [];
    let total = 0;
    return splitter({
      axis: 'y',
      label: 'Resize the panels above and below',
      extraClass: 'splitter-pane',
      onStart: () => {
        const hs = this.panes.map((p) => p.el.offsetHeight);
        total = hs.reduce((a, b) => a + b, 0) || 1;
        start = hs.map((x) => (x / total) * 100);
      },
      onDrag: (dy) => {
        const d = (dy / total) * 100;
        const min = LIMITS.paneSize[0];
        const next = [...start];
        const pair = start[i]! + start[i + 1]!;
        next[i] = Math.min(pair - min, Math.max(min, start[i]! + d));
        next[i + 1] = pair - next[i]!;
        const sizes = normalizeSizes(next.map((x) => Math.round(x)), next.length);
        this.panes.forEach((p, k) => (p.el.style.flexBasis = `${sizes[k]}%`));
        this.hooks.setPaneSizes(sizes, false);
      },
      onEnd: () => this.hooks.setPaneSizes(this.panes.map((p) => Math.round((p.el.offsetHeight / (this.panes.reduce((a, q) => a + q.el.offsetHeight, 0) || 1)) * 100)), true),
      onReset: () => this.hooks.resetSizes(),
    });
  }

  /** Show a tab in the pane that holds it. On a narrow screen (the sheet) tapping the open tab again closes the sheet. */
  show(name: TabName, userTap = false): void {
    const pane = this.panes.find((p) => p.tabs.includes(name));
    if (!pane) return;
    const sheet = this.panel === 'sheet';
    if (userTap && sheet) {
      if (name === this.last && !this.el.classList.contains('collapsed')) this.el.classList.add('collapsed');
      else this.el.classList.remove('collapsed');
    } else if (userTap) this.el.classList.remove('collapsed');
    const from = pane.tabs.indexOf(pane.active);
    pane.active = name;
    this.last = name;
    for (const b of pane.strip.children) (b as HTMLElement).setAttribute('aria-selected', String((b as HTMLElement).dataset.tab === name));
    const content = this.tabs[name];
    if (pane.body.firstChild !== content) pane.body.replaceChildren(content); // putting the same panel back would restart whatever animation its look gives a new element
    if (userTap && from !== pane.tabs.indexOf(name)) {
      // the page slides in from the side the tab sits on (further along: from the right), the motion TurboKeep uses between its pages
      const cls = pane.tabs.indexOf(name) > from ? 'tk-page-fwd' : 'tk-page-back';
      content.classList.remove('tk-page-fwd', 'tk-page-back');
      void content.offsetWidth;
      content.classList.add(cls);
    }
    this.onShow?.(name, userTap);
  }
}
