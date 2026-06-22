import { beforeEach, describe, expect, it, vi } from 'vitest';
import { relay } from '@napplet/sdk';
import { searchRelaySuggestions } from './relay-suggestions';

vi.mock('@napplet/sdk', () => ({
  relay: {
    query: vi.fn(),
  },
}));

describe('searchRelaySuggestions', () => {
  beforeEach(() => {
    vi.mocked(relay.query).mockReset();
  });

  it('reads NIP-66 kind 30166 relay discovery events and matches normalized URLs', async () => {
    vi.mocked(relay.query).mockResolvedValue([
      {
        id: 'relay-a',
        kind: 30166,
        pubkey: 'a'.repeat(64),
        created_at: 1,
        content: '',
        tags: [['d', 'wss://relay.example']],
        sig: 'sig',
      },
      {
        id: 'relay-b',
        kind: 30166,
        pubkey: 'b'.repeat(64),
        created_at: 1,
        content: '',
        tags: [['d', 'wss://other.example']],
        sig: 'sig',
      },
    ]);

    await expect(searchRelaySuggestions('relay')).resolves.toEqual([
      { value: 'wss://relay.example', label: 'wss://relay.example', detail: 'NIP-66' },
    ]);
    expect(relay.query).toHaveBeenCalledWith({ kinds: [30166], limit: 80 });
  });

  it('ignores malformed discovered relay URLs', async () => {
    vi.mocked(relay.query).mockResolvedValue([
      {
        id: 'bad',
        kind: 30166,
        pubkey: 'a'.repeat(64),
        created_at: 1,
        content: '',
        tags: [['d', 'https://relay.example']],
        sig: 'sig',
      },
    ]);

    await expect(searchRelaySuggestions('relay')).resolves.toEqual([]);
  });
});
