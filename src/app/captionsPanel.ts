import { dialogueToCues, parseAss, writeAss } from '../captions/ass.ts';
import { PresetError, entranceTags, exportPreset, importPreset, presetFromAss, styleByName } from '../captions/presets.ts';
import { groupWords, RemoteTranscriber, SHORTS_GROUPING, type Transcriber } from '../transcribe/provider.ts';
import { LocalTranscriber } from '../transcribe/local.ts';
import { renderPcm16k } from '../transcribe/pcm.ts';
import { h } from './dom.ts';
import { importFont } from './fonts.ts';
import { pickFiles, saveFile } from './platform.ts';
import type { Store } from './store.ts';

const SETTINGS = 'turbocut.transcribe';
const load = (): { mode: string; url: string; token: string; lang: string } => {
  try {
    return { mode: 'local', url: '', token: '', lang: '', ...JSON.parse(localStorage.getItem(SETTINGS) ?? '{}') };
  } catch {
    return { mode: 'local', url: '', token: '', lang: '' };
  }
};

export class CaptionsPanel {
  readonly el = h('div', { class: 'caps' });
  private list = h('div', { class: 'cue-list' });
  private abort: AbortController | null = null;

  constructor(private store: Store) {
    store.on('preset', () => this.build());
    store.on('project', () => this.renderCues());
    store.on('selection', () => this.renderCues());
    this.build();
  }

  private build(): void {
    const store = this.store;
    const presetSel = h('select', { class: 'input', 'aria-label': 'Caption preset' }, ...store.presets.map((p) => h('option', { value: p.name, selected: p.name === store.preset.name }, p.name)));
    presetSel.addEventListener('change', () => {
      const p = store.presets.find((x) => x.name === presetSel.value);
      if (p) store.setPreset(p);
    });

    const importPresetBtn = h('button', { class: 'btn', onclick: () => this.importPreset() }, 'Import preset');
    const exportPresetBtn = h('button', { class: 'btn', onclick: () => saveFile(exportPreset(store.preset), `${store.preset.name}.turbocut-preset.json`, 'application/json') }, 'Export preset');
    const fontBtn = h('button', { class: 'btn', onclick: () => this.importFont() }, 'Add font');
    const fontNote = h('p', { class: 'hint' }, `Style uses: ${[...new Set(store.preset.styles.map((s) => s.fontname))].join(', ')}. If a font is missing, add its file here and it is remembered on this device.`);

    // auto captions
    const s = load();
    const mode = h('select', { class: 'input' }, h('option', { value: 'local', selected: s.mode === 'local' }, 'On this device'), h('option', { value: 'remote', selected: s.mode === 'remote' }, 'Server on my network'));
    const url = h('input', { class: 'input', placeholder: 'http://192.168.1.20:8787', value: s.url, 'aria-label': 'Server address' });
    const token = h('input', { class: 'input', type: 'password', placeholder: 'Access token (optional)', value: s.token, 'aria-label': 'Server token' });
    const lang = h('input', { class: 'input', placeholder: 'Language (blank = detect)', value: s.lang, 'aria-label': 'Language' });
    const remoteBox = h('div', { class: 'stack' }, url, token);
    const sync = () => {
      remoteBox.style.display = mode.value === 'remote' ? '' : 'none';
      localStorage.setItem(SETTINGS, JSON.stringify({ mode: mode.value, url: url.value, token: token.value, lang: lang.value }));
    };
    for (const el of [mode, url, token, lang]) el.addEventListener('change', sync);
    sync();
    const progress = h('progress', { class: 'prog', max: 1, value: 0, style: { display: 'none' } });
    const go = h('button', { class: 'btn btn-accent' }, 'Generate captions');
    const cancel = h('button', { class: 'btn', style: { display: 'none' } }, 'Cancel');
    cancel.addEventListener('click', () => this.abort?.abort());
    go.addEventListener('click', async () => {
      sync();
      go.disabled = true;
      cancel.style.display = '';
      progress.style.display = '';
      progress.removeAttribute('value');
      this.abort = new AbortController();
      try {
        await this.generate(mode.value, url.value.trim(), token.value.trim() || undefined, lang.value.trim() || undefined, (label, f) => {
          store.say(label);
          if (f != null) progress.value = f;
          else progress.removeAttribute('value');
        });
      } catch (e) {
        store.say(e instanceof DOMException && e.name === 'AbortError' ? 'Cancelled.' : `Captions failed: ${e instanceof Error ? e.message : e}`);
      } finally {
        go.disabled = false;
        cancel.style.display = 'none';
        progress.style.display = 'none';
        this.abort = null;
      }
    });

    const assIn = h('button', { class: 'btn', onclick: () => this.importAssCues() }, 'Import .ass');
    const assOut = h('button', { class: 'btn', onclick: () => this.exportAss() }, 'Export .ass');
    const addCue = h('button', { class: 'btn', onclick: () => this.addCue() }, 'Add caption');
    const clear = h('button', { class: 'btn btn-ghost', onclick: () => store.edit((p) => (p.captions = [])) }, 'Clear');

    this.el.replaceChildren(
      h('div', { class: 'bt-panel-title' }, 'Style'),
      presetSel,
      h('div', { class: 'row' }, importPresetBtn, exportPresetBtn, fontBtn),
      fontNote,
      h('div', { class: 'bt-panel-title' }, 'Auto captions'),
      mode,
      remoteBox,
      lang,
      h('div', { class: 'row' }, go, cancel),
      progress,
      h('p', { class: 'hint' }, 'On this device downloads a speech model (about 80 MB) the first time, then works offline.'),
      h('div', { class: 'bt-panel-title' }, 'Captions'),
      h('div', { class: 'row' }, addCue, assIn, assOut, clear),
      this.list,
    );
    this.renderCues();
  }

  private async importPreset(): Promise<void> {
    const [file] = await pickFiles('.json,.ass,application/json');
    if (!file) return;
    try {
      const text = await file.text();
      const preset = /\.ass$/i.test(file.name) ? presetFromAss(file.name.replace(/\.ass$/i, ''), text) : importPreset(text);
      this.store.setPreset(preset);
      this.store.say(`Preset "${preset.name}" imported (${preset.styles.length} styles).`);
    } catch (e) {
      this.store.say(e instanceof PresetError ? `Not a usable preset: ${e.message}` : `Could not read that file: ${e}`);
    }
  }

  private async importFont(): Promise<void> {
    const files = await pickFiles('.otf,.ttf,.woff,.woff2,font/*', true);
    for (const f of files) {
      try {
        const fams = await importFont(f);
        this.store.say(`Font added: ${fams.join(' / ')}`);
      } catch (e) {
        this.store.say(`Could not load ${f.name}: ${e}`);
      }
    }
    this.store.emit('preset'); // redraw captions with the new font
  }

  private async importAssCues(): Promise<void> {
    const [file] = await pickFiles('.ass,.ssa');
    if (!file) return;
    const ass = parseAss(await file.text());
    this.store.edit((p) => (p.captions = dialogueToCues(ass.dialogue, p.fps)));
    this.store.say(`Imported ${ass.dialogue.length} captions.`);
  }

  private async exportAss(): Promise<void> {
    const { project: p, preset } = this.store;
    const tags = entranceTags(preset.animation, p.fps);
    const text = writeAss({
      styles: preset.styles,
      playResX: p.width,
      playResY: p.height,
      cues: p.captions.map((c) => ({ start: c.start / p.fps, end: c.end / p.fps, style: styleByName(preset, c.style).name, text: c.text, tags: tags ? `\\an2${tags}` : undefined })),
    });
    await saveFile(text, `${p.name}.ass`, 'text/plain');
  }

  private addCue(): void {
    const { project: p, playhead } = this.store;
    const id = `cue_${Date.now().toString(36)}`;
    this.store.edit((pr) => {
      pr.captions.push({ id, start: playhead, end: playhead + Math.round(p.fps * 1.5), text: 'New caption', style: 'Default' });
      pr.captions.sort((a, b) => a.start - b.start);
    });
    this.store.selectedCue = id;
    this.store.emit('selection');
  }

  private renderCues(): void {
    const store = this.store;
    const { project: p, preset } = store;
    this.list.replaceChildren(
      ...p.captions.map((cue) => {
        const text = h('input', { class: 'input', value: cue.text, 'aria-label': 'Caption text' });
        text.addEventListener('change', () => store.edit(() => (cue.text = text.value)));
        const style = h('select', { class: 'input sm', 'aria-label': 'Caption style' }, ...preset.styles.map((s) => h('option', { value: s.name, selected: s.name === cue.style }, s.name.replace(/^Default ?-? ?/, '') || 'Default')));
        style.addEventListener('change', () => store.edit(() => (cue.style = style.value)));
        const del = h('button', { class: 'btn btn-ghost', 'aria-label': 'Delete caption', onclick: () => store.edit((pr) => (pr.captions = pr.captions.filter((c) => c.id !== cue.id))) }, '×');
        const time = h('button', { class: 'btn btn-ghost mono', title: 'Go to caption', onclick: () => store.seek(cue.start) }, `${(cue.start / p.fps).toFixed(1)}s`);
        return h('div', { class: `cue${cue.id === store.selectedCue ? ' sel' : ''}` }, time, text, style, del);
      }),
    );
    if (p.captions.length === 0) this.list.append(h('p', { class: 'hint' }, 'No captions yet. Generate them above, import an .ass file, or add one by hand.'));
  }

  private async generate(mode: string, url: string, token: string | undefined, language: string | undefined, say: (label: string, f?: number) => void): Promise<void> {
    const { project: p, lib } = this.store;
    if (!p.tracks.some((t) => t.kind === 'audio' && t.clips.length)) throw new Error('Add a clip with audio first');
    let provider: Transcriber;
    if (mode === 'remote') {
      if (!url) throw new Error('Enter the server address');
      provider = new RemoteTranscriber(url, token);
    } else {
      const local = new LocalTranscriber();
      local.onStatus = (s) => say(s.phase === 'download' ? `Downloading speech model… ${Math.round((s.progress ?? 0) * 100)}%` : 'Listening…', s.phase === 'download' ? s.progress : undefined);
      provider = local;
    }
    say('Preparing audio…');
    const pcm = await renderPcm16k(p, lib, (f) => say('Preparing audio…', f));
    say(mode === 'remote' ? 'Sending to server…' : 'Loading model…');
    const words = await provider.transcribe(pcm, { language, signal: this.abort?.signal });
    if (words.length === 0) throw new Error('No speech found');
    const cues = groupWords(words, { fps: p.fps, ...SHORTS_GROUPING });
    this.store.edit((pr) => (pr.captions = cues));
    this.store.say(`Added ${cues.length} captions from ${words.length} words.`);
  }
}
