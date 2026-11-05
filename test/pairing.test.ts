import { describe, expect, it } from 'vitest';
import { deviceKey, forgetComputer, knownComputers, rememberComputer } from '../src/app/pairing.ts';
import { checkInbox, pullToken } from '../src/app/pull.ts';

const memory = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
};

describe('what a phone remembers after the first transfer', () => {
  it('makes one key and keeps it', () => {
    const s = memory();
    const k = deviceKey(s);
    expect(k).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(deviceKey(s)).toBe(k);
    rememberComputer('http://192.168.1.20:47903', 'Desktop', s);
    expect(deviceKey(s)).toBe(k);
  });

  it('remembers computers, the latest first, once each, and forgets on request', () => {
    const s = memory();
    rememberComputer('http://192.168.1.20:47903', 'Desktop', s, 1);
    rememberComputer('http://192.168.1.30:47903', 'Laptop', s, 2);
    rememberComputer('http://192.168.1.20:47903', 'Desktop (renamed)', s, 3);
    expect(knownComputers(s).map((c) => c.name)).toEqual(['Desktop (renamed)', 'Laptop']);
    forgetComputer('http://192.168.1.30:47903', s);
    expect(knownComputers(s).map((c) => c.base)).toEqual(['http://192.168.1.20:47903']);
  });

  it('ignores damaged or hand-edited storage', () => {
    const s = memory();
    s.setItem('turbocut.pairing', '{"key":"x","computers":[{"base":"javascript:alert(1)","name":"a"},{"base":"http://evil.example.com/x","name":"b"},{"base":"http://10.0.0.2:47903","name":"ok"}]}');
    expect(knownComputers(s).map((c) => c.name)).toEqual(['ok']);
    expect(deviceKey(s)).toMatch(/^[A-Za-z0-9_-]{22}$/);
    s.setItem('turbocut.pairing', 'not json');
    expect(knownComputers(s)).toEqual([]);
  });
});

describe('asking a remembered computer what is waiting', () => {
  const answer = (body: unknown, status = 200) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
  it('returns the shelf waiting, or null', async () => {
    const token = 'T'.repeat(22);
    const seen: { url: string; key: string | null }[] = [];
    const f = (async (url: string, init: RequestInit) => {
      seen.push({ url, key: new Headers(init.headers).get('X-Turbocut-Key') });
      return new Response(JSON.stringify({ token, from: { name: 'Desktop' }, summary: { project: 'Short' } }));
    }) as unknown as typeof fetch;
    expect(await checkInbox('http://10.0.0.2:47903', 'K'.repeat(22), { fetch: f })).toEqual({ token, from: 'Desktop', project: 'Short' });
    expect(seen).toEqual([{ url: 'http://10.0.0.2:47903/inbox', key: 'K'.repeat(22) }]);
    expect(await checkInbox('http://10.0.0.2:47903', 'K'.repeat(22), { fetch: answer({ none: true }) })).toBeNull();
    expect(await checkInbox('http://10.0.0.2:47903', 'K'.repeat(22), { fetch: answer({ token: '../x' }) })).toBeNull();
  });
  it('says the computer cannot be reached', async () => {
    const down = (async () => { throw new TypeError('network'); }) as unknown as typeof fetch;
    await expect(checkInbox('http://10.0.0.2:47903', 'K'.repeat(22), { fetch: down })).rejects.toThrow(/Could not reach 10\.0\.0\.2:47903/);
  });
  it('tells the computer who is asking when the transfer ends', async () => {
    const calls: { url: string; body?: string }[] = [];
    const f = (async (url: string, init?: RequestInit) => {
      calls.push({ url, body: init?.body as string | undefined });
      if (url.endsWith('/manifest')) return new Response(JSON.stringify({ from: { name: 'Desktop' }, items: [{ n: 0, kind: 'project', name: 'p', size: 2 }] }));
      if (url.includes('/part/')) return new Response('{}');
      return new Response('{}');
    }) as unknown as typeof fetch;
    const got = await pullToken('http://10.0.0.2:47903', 'T'.repeat(22), { fetch: f, identity: { key: 'K'.repeat(22), name: 'Pixel' } });
    expect(got.base).toBe('http://10.0.0.2:47903');
    expect(got.project).toBe('{}');
    expect(JSON.parse(calls.at(-1)!.body!)).toEqual({ key: 'K'.repeat(22), name: 'Pixel' });
    expect(calls.at(-1)!.url).toMatch(/\/done$/);
  });
});
