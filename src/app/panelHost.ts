import { h } from './dom.ts';
import { LIMITS, normalizeSizes, type AppliedLayout, type Division, type Side, type TabName } from './layout.ts';
import { splitter } from './splitter.ts';

export interface PanelHooks {
  /** The width of a side's column in pixels now. */
  getWidth(side: Side): number;
  /** Set a column's width while it is dragged (`commit` false) or when the drag is done (`commit` true: save it). */
  setWidth(side: Side, px: number, commit: boolean): void;
  /** The heights (percent) of a column's divisions, while dragged or when done. */
  setSizes(side: Side, sizes: number[], commit: boolean): void;
  /** Put the sizes back to what the preset says. */
  resetSizes(): void;
}

interface Pane {
  name: string;
  tabs: TabName[];
  active: TabName;
  el: HTMLElement;
  strip: HTMLElement;
  body: HTMLElement;
}

interface Column {
  side: Side;
  el: HTMLElement;
  panes: Pane[];
  sig: string;
  edge: HTMLElement;
}

/**
 * The panels beside the preview: a left column and a right column, each a stack of divisions (named panels with their own tab
 * strip). Draggable bars resize each column and the divisions in it. The tab contents are built once by the app and only moved
 * between panes, so nothing inside them is rebuilt when the arrangement changes. On a phone everything is one panel (the sheet).
 */
export class PanelHost {
  readonly left: Column = this.makeColumn('left');
  readonly right: Column = this.makeColumn('right');
  /** The two column elements, left first. */
  get els(): HTMLElement[] {
    return [this.left.el, this.right.el];
  }
  private last: TabName = 'Media';
  private order: TabName[] = [];
  private mode: AppliedLayout['mode'] = 'side';
  private named = false;
  onShow?: (name: TabName, userTap: boolean) => void;

  constructor(private tabs: Record<TabName, HTMLElement>, private hooks: PanelHooks, private start: TabName = 'Media') {
    this.last = start;
  }

  private makeColumn(side: Side): Column {
    const el = h('aside', { class: `bt-side bt-shell side side-${side} collapsed`, 'data-side': side });
    let startW = 0;
    const edge = splitter({
      axis: 'x',
      label: `Resize the ${side} panel`,
      extraClass: 'splitter-edge',
      onStart: () => (startW = this.hooks.getWidth(side)),
      onDrag: (dx) => this.hooks.setWidth(side, this.clampW(startW + (side === 'left' ? dx : -dx)), false),
      onEnd: () => this.hooks.setWidth(side, this.hooks.getWidth(side), true),
      onReset: () => this.hooks.resetSizes(),
    });
    edge.dataset.side = side;
    return { side, el, panes: [], sig: '', edge };
  }

  private clampW(px: number): number {
    const max = Math.min(LIMITS.panelWidth[1], Math.max(LIMITS.panelWidth[0], window.innerWidth * 0.4));
    return Math.round(Math.min(max, Math.max(LIMITS.panelWidth[0], px)));
  }

  /** The tab shown last (the one a dock or a lit tab marks). */
  get current(): TabName {
    return this.last;
  }

  /** Every tab the layout shows, in order. */
  get shown(): TabName[] {
    return this.order;
  }

  /** Whether the sheet (phone layout) is open. */
  get sheetOpen(): boolean {
    return this.mode === 'sheet' && !this.right.el.classList.contains('collapsed');
  }

  /** Draw the arrangement the layout asks for. Cheap when nothing about the panes changed. */
  apply(l: AppliedLayout): void {
    this.mode = l.mode;
    this.named = l.left.length + l.right.length > 1;
    this.fill(this.left, l.left);
    this.fill(this.right, l.right);
    this.order = [...l.left, ...l.right].flatMap((d) => d.tabs);
    for (const c of [this.left, this.right]) c.el.dataset.named = this.named ? 'yes' : 'no';
    if (!this.order.includes(this.last)) this.show(this.order.includes(this.start) ? this.start : this.order[0]!);
    else this.show(this.last);
    // A side column with no division takes no room.
    this.left.el.hidden = l.left.length === 0;
    this.right.el.hidden = l.right.length === 0;
    this.left.edge.hidden = this.right.edge.hidden = l.mode === 'sheet';
  }

  /** Change the tab that opens first and that the panel falls back to. */
  setStart(tab: TabName): void {
    this.start = tab;
  }

  private fill(c: Column, divs: Division[]): void {
    const sig = JSON.stringify(divs.map((d) => [d.name, d.tabs]));
    if (sig !== c.sig) {
      c.sig = sig;
      this.build(c, divs);
    }
    divs.forEach((d, i) => c.panes[i] && (c.panes[i]!.el.style.flexBasis = `${d.size}%`));
  }

  private build(c: Column, divs: Division[]): void {
    const old = new Map(this.panes().flatMap((p) => p.tabs.map((t) => [t, p.active] as const)));
    c.panes = divs.map((d) => {
      const strip = h('div', { class: 'tabs', role: 'tablist' }, ...d.tabs.map((name) => h('button', { class: 'tab', role: 'tab', 'data-tab': name, onclick: () => this.show(name, true) }, name)));
      const body = h('div', { class: 'tab-body' });
      const el = h('div', { class: 'pane', 'data-pane': d.name }, h('div', { class: 'pane-name' }, d.name), strip, body);
      const keep = d.tabs.find((t) => old.get(t) === t);
      return { name: d.name, tabs: d.tabs, active: keep ?? d.tabs[0]!, el, strip, body };
    });
    const parts: HTMLElement[] = [];
    c.panes.forEach((p, i) => {
      parts.push(p.el);
      if (i < c.panes.length - 1) parts.push(this.paneSplitter(c, i));
    });
    c.el.replaceChildren(...parts, c.edge);
  }

  private panes(): Pane[] {
    return [...this.left.panes, ...this.right.panes];
  }

  private paneSplitter(c: Column, i: number): HTMLElement {
    let start: number[] = [];
    let total = 0;
    return splitter({
      axis: 'y',
      label: 'Resize the panels above and below',
      extraClass: 'splitter-pane',
      onStart: () => {
        const hs = c.panes.map((p) => p.el.offsetHeight);
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
        c.panes.forEach((p, k) => (p.el.style.flexBasis = `${sizes[k]}%`));
        this.hooks.setSizes(c.side, sizes, false);
      },
      onEnd: () => {
        const sum = c.panes.reduce((a, q) => a + q.el.offsetHeight, 0) || 1;
        this.hooks.setSizes(c.side, normalizeSizes(c.panes.map((p) => Math.round((p.el.offsetHeight / sum) * 100)), c.panes.length), true);
      },
      onReset: () => this.hooks.resetSizes(),
    });
  }

  /** Show a tab in the pane that holds it. On a phone (the sheet) tapping the open tab again closes the sheet. */
  show(name: TabName, userTap = false): void {
    const pane = this.panes().find((p) => p.tabs.includes(name));
    if (!pane) return;
    const sheet = this.mode === 'sheet';
    const el = this.right.el;
    if (userTap && sheet) {
      if (name === this.last && !el.classList.contains('collapsed')) el.classList.add('collapsed');
      else el.classList.remove('collapsed');
    } else if (userTap || !sheet) {
      // side columns are always open; a tap on the sheet's tab opens it
      if (!sheet) for (const c of [this.left, this.right]) c.el.classList.remove('collapsed');
      else el.classList.remove('collapsed');
    }
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

  /** Close the phone sheet (nothing happens on a side layout). */
  collapse(): void {
    if (this.mode === 'sheet') this.right.el.classList.add('collapsed');
  }
}
