// Turning a video this device cannot decode (HEVC on most Linux computers, ProRes, ...) into H.264 so the editor can show it.
//
//  Chromium decodes HEVC only through the graphics driver (VA-API on Linux, Media Foundation on Windows) and has no software decoder for it,
//  so a computer without a suitable driver shows a black picture. The desktop shell therefore keeps a copy converted by ffmpeg when the
//  page asks for one: the page writes the file in pieces, `run` converts it, and the page reads the result back over app://.
//  ffmpeg comes from the `.deb` (a dependency), or from the PATH on Windows and in the AppImage; without it the page says how to get it.
//  Nothing here touches the original file.
const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const CANDIDATES = process.platform === 'win32'
  ? ['ffmpeg.exe', 'C:\\ffmpeg\\bin\\ffmpeg.exe', 'C:\\Program Files\\ffmpeg\\bin\\ffmpeg.exe']
  : ['ffmpeg', '/usr/bin/ffmpeg', '/usr/local/bin/ffmpeg', '/opt/homebrew/bin/ffmpeg', '/snap/bin/ffmpeg'];

const works = (bin) =>
  new Promise((resolve) => {
    try {
      const p = spawn(bin, ['-version'], { stdio: 'ignore', windowsHide: true });
      const t = setTimeout(() => (p.kill(), resolve(false)), 5000);
      p.on('error', () => (clearTimeout(t), resolve(false)));
      p.on('exit', (code) => (clearTimeout(t), resolve(code === 0)));
    } catch {
      resolve(false);
    }
  });

/** The ffmpeg program to use, or null: `TURBOCUT_FFMPEG` first, then the PATH and the usual places. */
async function findFfmpeg(candidates = [process.env.TURBOCUT_FFMPEG, ...CANDIDATES].filter(Boolean)) {
  for (const c of candidates) if (await works(c)) return c;
  return null;
}

/** ffmpeg arguments: the first picture and the first sound, even sides (x264 needs them), 8-bit 4:2:0 so every device can play it. */
function ffmpegArgs(input, output) {
  return ['-y', '-hide_banner', '-nostdin', '-i', input, '-map', '0:v:0', '-map', '0:a:0?', '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', '-progress', 'pipe:1', '-nostats', output];
}

const clock = (h, m, s) => Number(h) * 3600 + Number(m) * 60 + Number(s);

class Transcoder {
  /** @param {{ dir: string, ffmpeg?: string | null }} o  `dir`: where the copies live (emptied at start and quit). */
  constructor(o) {
    this.dir = o.dir;
    this.ffmpeg = o.ffmpeg;
    this.jobs = new Map();
  }

  /** The ffmpeg program, looked up once. */
  async available() {
    if (this.ffmpeg === undefined) this.ffmpeg = await findFfmpeg();
    return !!this.ffmpeg;
  }

  sweep() {
    fs.rmSync(this.dir, { recursive: true, force: true });
  }

  /** Start a job. The returned id is used for the other calls. */
  begin(name) {
    const id = crypto.randomBytes(8).toString('hex');
    const dir = path.join(this.dir, id);
    fs.mkdirSync(dir, { recursive: true });
    const input = path.join(dir, 'in');
    this.jobs.set(id, { dir, input, out: fs.createWriteStream(input), name: path.basename(String(name || 'video')), proc: null, cancelled: false });
    return id;
  }

  write(id, chunk) {
    const j = this.jobs.get(id);
    if (!j) return Promise.reject(new Error('That conversion is over.'));
    return new Promise((resolve, reject) => j.out.write(chunk, (e) => (e ? reject(e) : resolve())));
  }

  /** Convert what was written. Resolves `{ rel }` (the path of the result under `dir`, with forward slashes); rejects with a sentence. */
  async run(id, onProgress = () => {}) {
    const j = this.jobs.get(id);
    if (!j) throw new Error('That conversion is over.');
    if (!(await this.available())) throw new Error('ffmpeg is not installed.');
    await new Promise((resolve, reject) => (j.out.once('error', reject), j.out.end(resolve)));
    const base = j.name.replace(/\.[^.]*$/, '') || 'video';
    const output = path.join(j.dir, 'out.mp4');
    await new Promise((resolve, reject) => {
      let total = 0;
      let err = '';
      const p = spawn(this.ffmpeg, ffmpegArgs(j.input, output), { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
      j.proc = p;
      p.stderr.on('data', (c) => {
        err = (err + c).slice(-4000);
        const m = /Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/.exec(String(c));
        if (m && !total) total = clock(m[1], m[2], m[3]);
      });
      p.stdout.on('data', (c) => {
        const m = /out_time_us=(\d+)/.exec(String(c));
        if (m && total) onProgress(Math.min(1, Number(m[1]) / 1e6 / total));
      });
      p.on('error', () => reject(new Error('ffmpeg could not be started.')));
      p.on('exit', (code) => {
        if (j.cancelled) return reject(Object.assign(new Error('Cancelled'), { cancelled: true }));
        if (code === 0) return resolve();
        const last = err.trim().split('\n').pop() || `exit code ${code}`;
        reject(new Error(`ffmpeg could not convert it: ${last}`));
      });
    });
    fs.rmSync(j.input, { force: true });
    return { rel: `${id}/out.mp4`, name: `${base}.mp4` };
  }

  cancel(id) {
    const j = this.jobs.get(id);
    if (!j) return;
    j.cancelled = true;
    j.proc?.kill();
    this.finish(id);
  }

  /** Forget a job and delete its files. */
  finish(id) {
    const j = this.jobs.get(id);
    if (!j) return;
    this.jobs.delete(id);
    j.out.destroy();
    fs.rmSync(j.dir, { recursive: true, force: true });
  }
}

const defaultDir = () => path.join(os.tmpdir(), 'turbocut-converted');

module.exports = { Transcoder, findFfmpeg, ffmpegArgs, defaultDir };
