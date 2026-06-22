import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cvm, relay } from '@napplet/sdk';
import { nip19 } from 'nostr-tools';
import { searchAuthorSuggestions } from './author-suggestions';

vi.mock('@napplet/sdk', () => ({
  cvm: {
    callTool: vi.fn(),
  },
  relay: {
    query: vi.fn(),
  },
}));

const PUBKEY = 'a'.repeat(64);

describe('searchAuthorSuggestions', () => {
  beforeEach(() => {
    vi.mocked(cvm.callTool).mockReset();
    vi.mocked(relay.query).mockReset();
  });

  it('uses Relatr search_profiles and enriches results with profile metadata', async () => {
    vi.mocked(cvm.callTool).mockResolvedValue({
      content: [],
      structuredContent: {
        results: [{ pubkey: PUBKEY, trustScore: 83.4, rank: 1 }],
      },
    });
    vi.mocked(relay.query).mockResolvedValue([
      {
        id: 'profile',
        kind: 0,
        pubkey: PUBKEY,
        created_at: 1,
        content: JSON.stringify({ display_name: 'Alice' }),
        tags: [],
        sig: 'sig',
      },
    ]);

    await expect(searchAuthorSuggestions('@ali')).resolves.toEqual([
      { value: PUBKEY, label: 'Alice', detail: `trust 83 · ${PUBKEY.slice(0, 10)}` },
    ]);
    expect(cvm.callTool).toHaveBeenCalledWith(
      expect.objectContaining({ pubkey: expect.any(String) }),
      'search_profiles',
      { query: 'ali', limit: 8, extendToNostr: true },
      { initialize: true, timeoutMs: 30_000 },
    );
  });

  it('accepts direct npub input without requiring Relatr availability', async () => {
    const npub = nip19.npubEncode(PUBKEY);

    await expect(searchAuthorSuggestions(npub)).resolves.toEqual([
      { value: PUBKEY, label: `${PUBKEY.slice(0, 8)}...`, detail: PUBKEY.slice(0, 12) },
    ]);
    expect(cvm.callTool).not.toHaveBeenCalled();
  });
});
