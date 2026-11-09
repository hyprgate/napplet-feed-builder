import { beforeEach, describe, expect, it, vi } from 'vitest';
import { relay } from '@napplet/sdk';
import { relativeTime, watchMatches, type MatchPreviewState } from './match-preview';

vi.mock('@napplet/sdk', () => ({ relay: { subscribe: vi.fn() } }));

const event = (id: string, created_at: number) => ({ id, pubkey: 'a', kind: 1, created_at, content: id, tags: [], sig: 's' });

describe('watchMatches', () => {
  beforeEach(() => vi.mocked(relay.subscribe).mockReset());

  it('counts every match without asking relays for a limit, and shows the newest few', () => {
    let onEvent: ((result: unknown) => void) | undefined;
    let onEose: (() => void) | undefined;
    vi.mocked(relay.subscribe).mockImplementation(((_filters: unknown, ev: (r: unknown) => void, eose: () => void) => {
      onEvent = ev;
      onEose = eose;
      return { close: vi.fn() };
    }) as never);
    const updates: MatchPreviewState[] = [];

    watchMatches([{ kinds: [1] }], (state) => updates.push(state));
    expect(vi.mocked(relay.subscribe).mock.calls[0]?.[0]).toEqual([{ kinds: [1] }]);

    for (let i = 0; i < 7; i += 1) onEvent?.({ event: event(`e${i}`, i) });
    onEvent?.({ event: event('e6', 6) });
    onEose?.();

    const last = updates[updates.length - 1]!;
    expect(last.count).toBe(7);
    expect(last.settled).toBe(true);
    expect(last.latest.map((e) => e.id)).toEqual(['e6', 'e5', 'e4', 'e3', 'e2']);
  });
});

describe('relativeTime', () => {
  it('reads as elapsed time', () => {
    expect(relativeTime(990, 1000)).toBe('just now');
    expect(relativeTime(1000 - 600, 1000)).toBe('10m ago');
    expect(relativeTime(1000 - 7200, 1000)).toBe('2h ago');
    expect(relativeTime(0, 200000)).toBe('2d ago');
  });
});
