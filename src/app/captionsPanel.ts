import { dialogueToCues, parseAss, writeAss } from '../captions/ass.ts';
import { entranceTags, styleByName } from '../captions/presets.ts';
import { groupWords, RemoteTranscriber, SHORTS_GROUPING, type Transcriber } from '../transcribe/provider.ts';
import { LocalTranscriber, MODELS, type Compute } from '../transcribe/local.ts';
import { cleanWords } from '../transcribe/post.ts';
import { projectDuration } from '../core/timeline.ts';
import { renderPcm16k } from '../transcribe/pcm.ts';
import { h } from './dom.ts';
import { importFont } from './fonts.ts';
import { pickFiles, saveFile } from './platform.ts';
import { exportPresetDialog, pickAndImportPreset } from './presetIO.ts';
import { openStyleEditor } from './styleEditor.ts';
import type { Store } from './store.ts';

export class CaptionsPanel {
  readonly el = h('div', { class: 'caps' });
  private list = h('div', { class: 'cue-list' });
  private abort: AbortController | null = null;
  /** Set by the app so the panel can open Settings on the Captions tab. */
  openEngineSettings?: () => void;
  private report = '';
  private reportBtn = h('button', { class: 'btn', style: { display: 'none' }, onclick: () => navigator.clipboard?.writeText(this.report).then(() => this.store.say('Captions report copied.')) }, 'Copy captions report');

  constructor(private store: Store) {
    store.on('preset', () => this.build());
    store.on('settings', () => this.build());
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

    const importPresetBtn = h('button', { class: 'btn', onclick: () => void pickAndImportPreset(store) }, 'Import style');
    const exportPresetBtn = h('button', { class: 'btn', onclick: () => void exportPresetDialog(store) }, 'Export style');
    const editBtn = h('button', { class: 'btn btn-accent', onclick: () => openStyleEditor(store) }, 'Edit styles…');
    const fontBtn = h('button', { class: 'btn', onclick: () => this.importFont() }, 'Add font');
    const fontNote = h('p', { class: 'hint' }, `Style uses: ${[...new Set(store.preset.styles.map((s) => s.fontname))].join(', ')}. If a font is missing, add its file here and it is remembered on this device.`);

    // Auto captions: the engine (device or server, model, processor, language) is chosen in Settings.
    const summary = h('p', { class: 'hint' });
    const describeEngine = () => {
      const t = this.store.settings.transcribe;
      const model = MODELS.find((m) => m.id === t.model)?.label ?? t.model;
      summary.textContent = t.mode === 'remote' ? `Engine: server ${t.url || '(not set)'}, ${t.lang || 'language detected'}.` : `Engine: this device, ${model}, ${t.lang || 'language detected'}.`;
    };
    describeEngine();
    const change = h('button', { class: 'btn btn-ghost', onclick: () => this.openEngineSettings?.() }, 'Change…');
    const progress = h('progress', { class: 'prog', max: 1, value: 0, style: { display: 'none' } });
    const go = h('button', { class: 'btn btn-accent' }, 'Generate captions');
    const cancel = h('button', { class: 'btn', style: { display: 'none' } }, 'Cancel');
    cancel.addEventListener('click', () => this.abort?.abort());
    go.addEventListener('click', async () => {
      go.disabled = true;
      cancel.style.display = '';
      progress.style.display = '';
      progress.removeAttribute('value');
      this.abort = new AbortController();
      try {
        const t = this.store.settings.transcribe;
        await this.generate(t.mode, t.url, t.token || undefined, t.lang || undefined, { model: t.model, compute: t.compute }, (label, f) => {
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
      h('div', { class: 'row' }, editBtn, importPresetBtn, exportPresetBtn, fontBtn),
      fontNote,
      h('div', { class: 'bt-panel-title' }, 'Auto captions'),
      summary,
      h('div', { class: 'row' }, go, cancel, change),
      progress,
      this.reportBtn,
      h('div', { class: 'bt-panel-title' }, 'Captions'),
      h('div', { class: 'row' }, addCue, assIn, assOut, clear),
      this.list,
    );
    this.renderCues();
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

  private async generate(
    mode: string,
    url: string,
    token: string | undefined,
    language: string | undefined,
    local: { model: string; compute: Compute },
    say: (label: string, f?: number) => void,
  ): Promise<void> {
    const { project: p, lib } = this.store;
    if (!p.tracks.some((t) => t.kind === 'audio' && t.clips.length)) throw new Error('Add a clip with audio first');
    let provider: Transcriber;
    let localProvider: LocalTranscriber | undefined;
    if (mode === 'remote') {
      if (!url) throw new Error('Enter the server address');
      provider = new RemoteTranscriber(url, token);
    } else {
      localProvider = new LocalTranscriber(local.model, local.compute);
      localProvider.onStatus = (s) => say(s.phase === 'download' ? `Downloading speech model… ${Math.round((s.progress ?? 0) * 100)}%` : 'Listening…', s.phase === 'download' ? s.progress : undefined);
      provider = localProvider;
    }
    say('Preparing audio…');
    const pcm = await renderPcm16k(p, lib, (f) => say('Preparing audio…', f));
    const seconds = projectDuration(p) / p.fps;
    say(mode === 'remote' ? 'Sending to server…' : 'Loading model…');
    const raw = await provider.transcribe(pcm, { language, signal: this.abort?.signal });
    const { words, report } = cleanWords(raw, { durationSec: seconds, pcm: pcm.samples });

    let peak = 0;
    for (let i = 0; i < pcm.samples.length; i += 16) peak = Math.max(peak, Math.abs(pcm.samples[i]!));
    const fmt = (ws: typeof raw) => ws.slice(0, 40).map((w) => `${w.start.toFixed(2)}-${w.end.toFixed(2)} ${w.text}`).join('\n  ');
    const info = localProvider?.lastInfo;
    this.report = [
      'TurboCut captions report',
      `Engine: ${mode === 'remote' ? `server ${url}` : 'this device'}`,
      info ? `Model: ${info.model}\nProcessor: ${info.device} (${info.dtype})\nLanguage: ${info.language}` : '',
      `Audio: ${seconds.toFixed(2)} s, peak level ${peak.toFixed(3)}`,
      `Words from the model: ${raw.length}; kept ${report.kept}; dropped: ${report.droppedPastEnd} after the end, ${report.droppedSilent} on silence, ${report.droppedRepeated} repeated, ${report.droppedEmpty} empty`,
      info ? `Model text: ${info.rawText}` : '',
      `First words as the model gave them:\n  ${fmt(raw)}`,
    ].filter(Boolean).join('\n');
    this.reportBtn.style.display = '';

    if (words.length === 0) throw new Error(raw.length ? 'Only invented text was found (nothing over real speech). Try another model or processor, then copy the captions report.' : 'No speech found');
    const totalFrames = projectDuration(p);
    const cues = groupWords(words, { fps: p.fps, ...SHORTS_GROUPING })
      .filter((c) => c.start < totalFrames)
      .map((c) => ({ ...c, end: Math.min(c.end, totalFrames) })); // never past the last frame
    this.store.edit((pr) => (pr.captions = cues));
    const dropped = raw.length - words.length;
    this.store.say(`Added ${cues.length} captions from ${words.length} words${dropped ? ` (${dropped} removed as invented)` : ''}.`);
  }
}
