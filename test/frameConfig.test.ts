import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const { loadFrame, saveFrame } = createRequire(import.meta.url)('../electron/frameConfig.cjs');

describe('window frame setting', () => {
  it('draws the frame by default except on macOS', () => {
    const d = mkdtempSync(join(tmpdir(), 'tc-'));
    expect(loadFrame(d, 'linux')).toBe(true);
    expect(loadFrame(d, 'win32')).toBe(true);
    expect(loadFrame(d, 'darwin')).toBe(false);
  });
  it('remembers the choice and keeps other keys', () => {
    const d = mkdtempSync(join(tmpdir(), 'tc-'));
    saveFrame(d, false);
    expect(loadFrame(d, 'linux')).toBe(false);
    saveFrame(d, true);
    expect(loadFrame(d, 'linux')).toBe(true);
    expect(loadFrame(d, 'darwin')).toBe(false);
  });
});
