declare const __APP_VERSION__: string;

/** TurboCut versions are Year.Month.Update, for example 2026.10.3. CI picks the update number. */
export const APP_VERSION: string = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0';

/** Numeric parts of a version string, ignoring a leading "v". Missing or bad parts count as 0. */
export function parseVersion(v: string): [number, number, number] {
  const m = /^v?(\d+)\.(\d+)\.(\d+)/.exec(v.trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : [0, 0, 0];
}

/** Negative if a is older than b, zero if equal, positive if newer. */
export function compareVersions(a: string, b: string): number {
  const x = parseVersion(a);
  const y = parseVersion(b);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i]! - y[i]!;
  return 0;
}

export const isCalVer = (v: string) => /^v?\d{4}\.\d{1,2}\.\d+$/.test(v.trim());
