import { describe, expect, it } from 'vitest';
import { downloadProgress } from '../src/transcribe/downloadProgress.ts';

describe('downloadProgress', () => {
  it('adds the files of one model together instead of showing the last file reported', () => {
    const p = downloadProgress();
    expect(p({ status: 'progress', file: 'encoder', loaded: 50, total: 100 })).toBeCloseTo(0.5);
    expect(p({ status: 'progress', file: 'decoder', loaded: 10, total: 100 })).toBeCloseTo(0.5); // the true share fell to 0.3: the bar holds instead
    // the encoder jumping ahead does not make the bar swing back to the decoder's own percentage
    const a = p({ status: 'progress', file: 'encoder', loaded: 100, total: 100 })!;
    const b = p({ status: 'progress', file: 'decoder', loaded: 20, total: 100 })!;
    expect(b).toBeGreaterThanOrEqual(a);
    expect(a).toBeCloseTo(110 / 200);
  });
  it('never reads 100 % by itself, and never goes backwards when a file appears late', () => {
    const p = downloadProgress();
    const first = p({ status: 'progress', file: 'a', loaded: 100, total: 100 })!;
    expect(first).toBeLessThan(1); // a finished first file is not a finished model
    const later = p({ status: 'progress', file: 'b', loaded: 0, total: 100 })!;
    expect(later).toBeGreaterThanOrEqual(first); // the new file adds to the total, but the bar holds
    expect(p({ status: 'progress', file: 'b', loaded: 100, total: 100 })).toBeLessThan(1);
  });
  it('ignores events that carry no bytes', () => {
    const p = downloadProgress();
    expect(p({ status: 'initiate', file: 'a' })).toBeNull();
    expect(p({ status: 'progress', file: 'a', progress: 40 })).toBeNull();
  });
});
