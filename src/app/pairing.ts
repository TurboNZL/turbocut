/**
 * What a phone (or any device that cannot be found on the network) remembers after its first transfer from a computer: a random key that
 * says who it is, and the computers it fetched from. The next time, the computer's address is known, so the phone asks that computer for what
 * is waiting instead of needing a link. The key never leaves the device except to the computers it has fetched from.
 */
const NAME = 'turbocut.pairing';
const MAX_COMPUTERS = 6;

export interface Computer {
  /** `http://192.168.1.20:47903` */
  base: string;
  name: string;
  /** Milliseconds since the last transfer from it. */
  at: number;
}
interface Saved {
  key: string;
  computers: Computer[];
}
type Store = Pick<Storage, 'getItem' | 'setItem'>;

const newKey = (): string => {
  const b = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

function read(s: Store): Saved {
  try {
    const v = JSON.parse(s.getItem(NAME) ?? 'null');
    const computers = Array.isArray(v?.computers) ? (v.computers as Computer[]).filter((c) => typeof c?.base === 'string' && /^http:\/\/[a-z0-9.-]+:\d{1,5}$/i.test(c.base)).map((c) => ({ base: c.base, name: String(c.name || 'Computer').slice(0, 60), at: Number(c.at) || 0 })) : [];
    return { key: typeof v?.key === 'string' && /^[A-Za-z0-9_-]{22,64}$/.test(v.key) ? v.key : '', computers };
  } catch {
    return { key: '', computers: [] };
  }
}

const write = (s: Store, v: Saved) => {
  try {
    s.setItem(NAME, JSON.stringify(v));
  } catch {
    /* storage blocked: the link still works, it just has to be pasted each time */
  }
};

const store = (): Store => localStorage;

/** This device's key, made on first use. */
export function deviceKey(s: Store = store()): string {
  const v = read(s);
  if (v.key) return v.key;
  v.key = newKey();
  write(s, v);
  return v.key;
}

/** The computers fetched from before, the latest first. */
export const knownComputers = (s: Store = store()): Computer[] => read(s).computers.sort((a, b) => b.at - a.at);

/** A transfer from this computer worked: remember where it is. */
export function rememberComputer(base: string, name: string, s: Store = store(), now = Date.now()): void {
  const v = read(s);
  v.computers = [{ base, name, at: now }, ...v.computers.filter((c) => c.base !== base)].slice(0, MAX_COMPUTERS);
  if (!v.key) v.key = newKey();
  write(s, v);
}

export function forgetComputer(base: string, s: Store = store()): void {
  const v = read(s);
  v.computers = v.computers.filter((c) => c.base !== base);
  write(s, v);
}
