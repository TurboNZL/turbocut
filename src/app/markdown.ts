/**
 * A small, safe Markdown renderer for the bundled guides: headings, paragraphs, lists, tables, code, bold, italic,
 * inline code and links. Text is always inserted as text (never as HTML), links only keep http(s) and guide links.
 */
export interface MarkdownOptions {
  /** Called when a link points at another guide (`OTHER.md`). */
  onGuide?: (file: string) => void;
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, text?: string): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (text !== undefined) e.textContent = text;
  return e;
};

function inline(text: string, o: MarkdownOptions): Node[] {
  const out: Node[] = [];
  const re = /`([^`]+)`|\*\*([^*]+)\*\*|\*([^*]+)\*|\[([^\]]+)\]\(([^)\s]+)\)/g;
  let last = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > last) out.push(document.createTextNode(text.slice(last, m.index)));
    if (m[1] !== undefined) out.push(el('code', m[1]));
    else if (m[2] !== undefined) out.push(el('strong', m[2]));
    else if (m[3] !== undefined) out.push(el('em', m[3]));
    else {
      const label = m[4]!;
      const href = m[5]!;
      if (/^https?:\/\//i.test(href)) {
        const a = el('a', label);
        a.href = href;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        out.push(a);
      } else if (/^[A-Za-z0-9_-]+\.md$/.test(href) && o.onGuide) {
        const a = el('a', label);
        a.href = '#';
        a.addEventListener('click', (e) => {
          e.preventDefault();
          o.onGuide!(href);
        });
        out.push(a);
      } else out.push(document.createTextNode(label)); // anything else (javascript:, data:, ...) is plain text
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(document.createTextNode(text.slice(last)));
  return out;
}

const cells = (line: string) => line.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());

export function renderMarkdown(src: string, o: MarkdownOptions = {}): HTMLElement {
  const root = el('div');
  root.className = 'md';
  const lines = src.replace(/\r\n?/g, '\n').split('\n');
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (!line.trim()) { i++; continue; }
    const fence = /^```/.exec(line);
    if (fence) {
      const code: string[] = [];
      for (i++; i < lines.length && !/^```/.test(lines[i]!); i++) code.push(lines[i]!);
      i++;
      const pre = el('pre');
      pre.append(el('code', code.join('\n')));
      root.append(pre);
      continue;
    }
    const head = /^(#{1,4})\s+(.*)$/.exec(line);
    if (head) {
      const h = el(`h${Math.min(4, head[1]!.length + 1)}` as 'h2');
      h.append(...inline(head[2]!, o));
      root.append(h);
      i++;
      continue;
    }
    if (/^\|.*\|\s*$/.test(line) && /^\|?\s*:?-{2,}/.test(lines[i + 1] ?? '')) {
      const table = el('table');
      const thead = el('thead');
      const hr = el('tr');
      for (const c of cells(line)) { const th = el('th'); th.append(...inline(c, o)); hr.append(th); }
      thead.append(hr);
      table.append(thead);
      const body = el('tbody');
      for (i += 2; i < lines.length && /^\|.*\|\s*$/.test(lines[i]!); i++) {
        const tr = el('tr');
        for (const c of cells(lines[i]!)) { const td = el('td'); td.append(...inline(c, o)); tr.append(td); }
        body.append(tr);
      }
      table.append(body);
      const wrap = el('div');
      wrap.className = 'md-table';
      wrap.append(table);
      root.append(wrap);
      continue;
    }
    const bullet = /^\s*([-*]|\d+\.)\s+(.*)$/.exec(line);
    if (bullet) {
      const ordered = /\d/.test(bullet[1]!);
      const list = el(ordered ? 'ol' : 'ul');
      for (; i < lines.length; i++) {
        const m = /^\s*([-*]|\d+\.)\s+(.*)$/.exec(lines[i]!);
        if (!m || /\d/.test(m[1]!) !== ordered) break;
        const li = el('li');
        li.append(...inline(m[2]!, o));
        list.append(li);
      }
      root.append(list);
      continue;
    }
    const para: string[] = [];
    for (; i < lines.length && lines[i]!.trim() && !/^(#{1,4}\s|```|\s*([-*]|\d+\.)\s|\|.*\|\s*$)/.test(lines[i]!); i++) para.push(lines[i]!.trim());
    const p = el('p');
    p.append(...inline(para.join(' '), o));
    root.append(p);
  }
  return root;
}
