import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const { Transcoder, findFfmpeg, ffmpegArgs } = createRequire(import.meta.url)('../electron/transcode.cjs');

const ffmpeg: string | null = await findFfmpeg();
const hasX265 = !!ffmpeg && /libx265/.test(spawnSync(ffmpeg, ['-hide_banner', '-encoders'], { encoding: 'utf8' }).stdout) && /libx264/.test(spawnSync(ffmpeg, ['-hide_banner', '-encoders'], { encoding: 'utf8' }).stdout);

describe('converting a video the device cannot decode', () => {
  it('finds nothing when no program works, and says so', async () => {
    expect(await findFfmpeg(['/nonexistent/ffmpeg-for-test'])).toBeNull();
    const t = new Transcoder({ dir: mkdtempSync(join(tmpdir(), 'tcconv-')), ffmpeg: null });
    expect(await t.available()).toBe(false);
    const id = t.begin('a.mp4');
    await expect(t.run(id)).rejects.toThrow(/ffmpeg is not installed/);
  });

  it('writes H.264 with even sides, 8-bit 4:2:0 and the first sound', () => {
    const a = ffmpegArgs('in', 'out.mp4').join(' ');
    expect(a).toContain('libx264');
    expect(a).toContain('yuv420p');
    expect(a).toContain('trunc(iw/2)*2');
    expect(a).toContain('0:a:0?');
  });

  it.runIf(hasX265)('turns an HEVC clip into H.264 with its sound, in pieces like the page sends it', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tcconv-'));
    const src = join(dir, 'hevc.mp4');
    const made = spawnSync(ffmpeg!, ['-y', '-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=30:duration=1', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', '-c:v', 'libx265', '-tag:v', 'hvc1', '-pix_fmt', 'yuv420p10le', '-c:a', 'aac', '-shortest', src], { encoding: 'utf8' });
    expect(made.status, made.stderr).toBe(0);
    const t = new Transcoder({ dir: join(dir, 'work'), ffmpeg });
    const id = t.begin('../evil/My clip.mkv');
    const bytes = readFileSync(src);
    for (let i = 0; i < bytes.length; i += 5000) await t.write(id, bytes.subarray(i, i + 5000));
    const seen: number[] = [];
    const r = await t.run(id, (f: number) => seen.push(f));
    expect(r.name).toBe('My clip.mp4');
    expect(existsSync(join(dir, 'work', r.rel))).toBe(true);
    const probe = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_name,pix_fmt,width,height', '-of', 'csv=p=0', join(dir, 'work', r.rel)], { encoding: 'utf8' }).stdout.trim().split('\n');
    expect(probe).toContain('h264,320,180,yuv420p');
    expect(probe.some((l) => l.startsWith('aac'))).toBe(true);
    t.finish(id);
    expect(existsSync(join(dir, 'work', id))).toBe(false);
  }, 60_000);
});
