import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cvm, identity, relay } from '@napplet/sdk';
import * as nip19 from 'nostr-tools/nip19';
import { resetFollowDirectoryForTest, searchAuthorSuggestions, searchFollowSuggestions } from './author-suggestions';
import { shortNpub } from './people';

vi.mock('@napplet/sdk', () => ({
  cvm: {
    callTool: vi.fn(),
  },
  identity: {
    getPublicKey: vi.fn(),
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
        event: {
          id: 'profile',
          kind: 0,
          pubkey: PUBKEY,
          created_at: 1,
          content: JSON.stringify({ display_name: 'Alice' }),
          tags: [],
          sig: 'sig',
        },
      },
    ]);

    await expect(searchAuthorSuggestions('@ali')).resolves.toEqual([
      { value: PUBKEY, label: 'Alice', detail: `trust 83 · ${shortNpub(PUBKEY)}` },
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
      { value: PUBKEY, label: shortNpub(PUBKEY) },
    ]);
    expect(cvm.callTool).not.toHaveBeenCalled();
  });

  it('finds people you follow by name without Relatr', async () => {
    resetFollowDirectoryForTest();
    const other = 'b'.repeat(64);
    vi.mocked(identity.getPublicKey).mockResolvedValue('c'.repeat(64));
    vi.mocked(relay.query).mockImplementation((async (filters: Array<{ kinds?: number[]; authors?: string[] }>) => {
      if (filters[0]?.kinds?.includes(3)) {
        return [{ event: { kind: 3, pubkey: 'c'.repeat(64), created_at: 1, content: '', tags: [['p', PUBKEY], ['p', other]] } }];
      }
      return filters.map((filter) => ({
        event: {
          kind: 0,
          pubkey: filter.authors?.[0],
          created_at: 1,
          content: JSON.stringify({ display_name: filter.authors?.[0] === PUBKEY ? 'Ines Okafor' : 'Tomás' }),
        },
      }));
    }) as never);

    await expect(searchFollowSuggestions('ines')).resolves.toEqual([
      { value: PUBKEY, label: 'Ines Okafor', detail: `you follow · ${shortNpub(PUBKEY)}` },
    ]);
    expect(cvm.callTool).not.toHaveBeenCalled();
  });
});
