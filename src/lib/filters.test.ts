import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NostrEvent } from '@hyprgate/types';
import { nip19 } from 'nostr-tools';
import {
  decodeNfeed,
  decodeNfilter,
  decodeNfilters,
} from '@sandwichfarm/encoded-entities';
import {
  KIND_FILTER_FEED,
  advToFilter,
  buildDeleteTemplate,
  buildEventTemplate,
  chooseType,
  createFeedBuilderStore,
  decodeEntity,
  emptyAdvFilter,
  encodeEntity,
  filterToAdv,
  isAdvFilterEmpty,
  isFilterEmpty,
  isValidName,
  parseEntityEvent,
  parseFilterJson,
  canRepresentAsBasic,
  preferredViewForFilters,
  pubkeysFromInputs,
  buildFilter,
  normalizeRelayInput,
  validateRelayInput,
  validateRelayInputs,
  validateFilterArray,
} from './filters';
import { relay, storage } from '@napplet/sdk';

vi.mock('@napplet/sdk', () => ({
  relay: {
    subscribe: vi.fn().mockReturnValue({ close: vi.fn() }),
    publish: vi.fn(),
  },
  storage: {
    getItem: vi.fn(),
    setItem: vi.fn(),
    removeItem: vi.fn(),
  },
}));

const PUBKEY_A = 'a'.repeat(64);
const PUBKEY_B = 'b'.repeat(64);

function makeEvent(overrides: Partial<NostrEvent>): NostrEvent {
  return {
    id: 'event-id',
    kind: KIND_FILTER_FEED,
    pubkey: PUBKEY_A,
    created_at: 1,
    tags: [],
    content: '',
    sig: 'sig',
    ...overrides,
  };
}

describe('isValidName', () => {
  it('accepts alphanumerics and symbols, rejects spaces and empty', () => {
    expect(isValidName('morning-reads')).toBe(true);
    expect(isValidName('my.feed_2024!')).toBe(true);
    expect(isValidName('a')).toBe(true);
    expect(isValidName('has space')).toBe(false);
    expect(isValidName('tab\tname')).toBe(false);
    expect(isValidName('')).toBe(false);
    expect(isValidName('   ')).toBe(false);
  });
});

describe('pubkeysFromInputs', () => {
  it('passes through 64-char hex, deduping', () => {
    expect(pubkeysFromInputs([PUBKEY_A, PUBKEY_A, PUBKEY_B])).toEqual({
      pubkeys: [PUBKEY_A, PUBKEY_B],
      invalid: [],
    });
  });

  it('converts npub and nprofile to hex pubkeys', () => {
    const npub = nip19.npubEncode(PUBKEY_A);
    const nprofile = nip19.nprofileEncode({ pubkey: PUBKEY_B, relays: ['wss://r.example'] });
    expect(pubkeysFromInputs([npub, nprofile])).toEqual({
      pubkeys: [PUBKEY_A, PUBKEY_B],
      invalid: [],
    });
  });

  it('collects unparseable inputs as invalid', () => {
    const result = pubkeysFromInputs(['not-a-key', 'note1xxx', '']);
    expect(result.pubkeys).toEqual([]);
    expect(result.invalid).toEqual(['not-a-key', 'note1xxx']);
  });
});

describe('buildFilter', () => {
  it('assembles only the non-empty fields', () => {
    expect(buildFilter({ kinds: [1], authors: [PUBKEY_A], hashtags: ['nostr', 'art'] })).toEqual({
      kinds: [1],
      authors: [PUBKEY_A],
      '#t': ['nostr', 'art'],
    });
  });

  it('omits empty arrays entirely', () => {
    expect(buildFilter({ kinds: [1], authors: [], hashtags: [] })).toEqual({ kinds: [1] });
  });

  it('never includes limit', () => {
    const filter = buildFilter({ kinds: [1], authors: [], hashtags: [] }) as Record<string, unknown>;
    expect('limit' in filter).toBe(false);
  });
});

describe('Basic representability', () => {
  it('allows filters that Basic can round-trip without losing constraints', () => {
    expect(canRepresentAsBasic([
      { kinds: [1], authors: [PUBKEY_A], '#t': ['nostr'] },
      { kinds: [6], '#t': ['repost'] },
    ])).toBe(true);
  });

  it('rejects filters with Advanced-only fields or non-topic tag constraints', () => {
    expect(canRepresentAsBasic([{ kinds: [1], since: 100 }])).toBe(false);
    expect(canRepresentAsBasic([{ ids: ['a'.repeat(64)] }])).toBe(false);
    expect(canRepresentAsBasic([{ '#e': ['event-id'] }])).toBe(false);
    expect(canRepresentAsBasic([{ search: 'nostr' }])).toBe(false);
  });

  it('chooses Advanced for loaded filters that Basic cannot represent', () => {
    expect(preferredViewForFilters([{ kinds: [1], '#t': ['nostr'] }])).toBe('basic');
    expect(preferredViewForFilters([{ kinds: [1], since: 100 }])).toBe('advanced');
  });
});

describe('relay input normalization and validation', () => {
  it('prepends wss:// for bare relay hosts and dedupes normalized values', () => {
    expect(validateRelayInputs(['relay.example', 'wss://relay.example', ' ws://local.test '])).toEqual({
      relays: ['wss://relay.example', 'ws://local.test'],
      invalid: [],
    });
  });

  it('keeps blanks out and reports malformed relay URLs before save/open', () => {
    expect(normalizeRelayInput('')).toBe('');
    expect(validateRelayInput('wss://relay.example')).toEqual({ relay: 'wss://relay.example', error: null });
    expect(validateRelayInputs(['wss://', 'https://relay.example', 'not a relay'])).toEqual({
      relays: [],
      invalid: ['wss://', 'https://relay.example', 'wss://not a relay'],
    });
  });
});

describe('parseFilterJson', () => {
  it('parses a valid filter and strips limit', () => {
    expect(parseFilterJson('{"kinds":[1],"#t":["nostr"],"limit":50}')).toEqual({
      kinds: [1],
      '#t': ['nostr'],
    });
  });

  it('drops empty arrays', () => {
    expect(parseFilterJson('{"kinds":[1],"authors":[]}')).toEqual({ kinds: [1] });
  });

  it('throws on invalid JSON', () => {
    expect(() => parseFilterJson('{ not json')).toThrow();
  });

  it('throws on non-object / array', () => {
    expect(() => parseFilterJson('[1,2,3]')).toThrow();
    expect(() => parseFilterJson('"hello"')).toThrow();
  });
});

describe('advToFilter / filterToAdv', () => {
  it('advToFilter builds a NIP-01 filter, omitting empties and never adding limit', () => {
    expect(advToFilter({
      authors: [PUBKEY_A],
      ids: [],
      kinds: [1, 30023],
      tags: [{ name: 't', values: ['nostr'] }, { name: 'a', values: [] }],
      search: '',
      since: 1000,
      until: null,
    })).toEqual({ authors: [PUBKEY_A], kinds: [1, 30023], '#t': ['nostr'], since: 1000 });
  });

  it('strips a leading # from tag names', () => {
    expect(advToFilter({ ...emptyAdvFilter(), tags: [{ name: '#e', values: ['abc'] }] })).toEqual({
      '#e': ['abc'],
    });
  });

  it('filterToAdv extracts every field including tag groups', () => {
    expect(filterToAdv({
      kinds: [1],
      authors: [PUBKEY_A],
      '#t': ['nostr'],
      '#e': ['id1'],
      search: 'hello',
      since: 5,
      until: 9,
    })).toEqual({
      authors: [PUBKEY_A],
      ids: [],
      kinds: [1],
      tags: [{ name: 't', values: ['nostr'] }, { name: 'e', values: ['id1'] }],
      search: 'hello',
      since: 5,
      until: 9,
    });
  });

  it('round-trips a filter through adv form', () => {
    const f = { kinds: [1], authors: [PUBKEY_A], '#t': ['a', 'b'], since: 100 };
    expect(advToFilter(filterToAdv(f))).toEqual(f);
  });

  it('isAdvFilterEmpty reflects whether any constraint is set', () => {
    expect(isAdvFilterEmpty(emptyAdvFilter())).toBe(true);
    expect(isAdvFilterEmpty({ ...emptyAdvFilter(), kinds: [1] })).toBe(false);
    expect(isAdvFilterEmpty({ ...emptyAdvFilter(), since: 5 })).toBe(false);
  });
});

describe('validateFilterArray', () => {
  it('accepts a valid array and returns sanitized filters (limit stripped)', () => {
    const r = validateFilterArray('[{"kinds":[1],"#t":["nostr"],"limit":50}]');
    expect(r.ok).toBe(true);
    expect(r.errors).toEqual([]);
    expect(r.filters).toEqual([{ kinds: [1], '#t': ['nostr'] }]);
  });

  it('rejects invalid JSON', () => {
    const r = validateFilterArray('[{bad');
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toMatch(/JSON/i);
  });

  it('rejects a non-array top level', () => {
    const r = validateFilterArray('{"kinds":[1]}');
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toMatch(/array/i);
  });

  it('flags bad author hex and unknown fields with the filter index', () => {
    const r = validateFilterArray('[{"authors":["xyz"],"foo":1}]');
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/filter 1/);
    expect(r.errors.join(' ')).toMatch(/authors/);
    expect(r.errors.join(' ')).toMatch(/foo/);
  });

  it('rejects non-integer kinds and string timestamps', () => {
    expect(validateFilterArray('[{"kinds":[1.5]}]').ok).toBe(false);
    expect(validateFilterArray('[{"since":"yesterday"}]').ok).toBe(false);
  });

  it('accepts arbitrary #tag arrays of strings', () => {
    expect(validateFilterArray('[{"#e":["abc"],"#custom":["x","y"]}]').ok).toBe(true);
  });
});

describe('isFilterEmpty', () => {
  it('is true for {} and for all-empty arrays', () => {
    expect(isFilterEmpty({})).toBe(true);
    expect(isFilterEmpty({ kinds: [], authors: [] })).toBe(true);
  });
  it('is false when any constraint is present', () => {
    expect(isFilterEmpty({ kinds: [1] })).toBe(false);
    expect(isFilterEmpty({ '#t': ['nostr'] })).toBe(false);
  });
});

describe('chooseType', () => {
  it('single filter, no relays -> nfilter', () => {
    expect(chooseType([{ kinds: [1] }], [])).toBe('nfilter');
  });
  it('many filters, no relays -> nfilters', () => {
    expect(chooseType([{ kinds: [1] }, { kinds: [6] }], [])).toBe('nfilters');
  });
  it('any relays -> nfeed', () => {
    expect(chooseType([{ kinds: [1] }], ['wss://r.example'])).toBe('nfeed');
    expect(chooseType([{ kinds: [1] }, { kinds: [6] }], ['wss://r.example'])).toBe('nfeed');
  });
});

describe('encodeEntity / round-trips through the package', () => {
  it('encodes a single filter as nfilter', () => {
    const { type, encoded } = encodeEntity([{ kinds: [1], '#t': ['nostr'] }], []);
    expect(type).toBe('nfilter');
    expect(encoded.startsWith('nfilter1')).toBe(true);
    expect(decodeNfilter(encoded)).toEqual({ kinds: [1], '#t': ['nostr'] });
  });

  it('encodes multiple filters as nfilters', () => {
    const filters = [{ kinds: [1] }, { kinds: [6], authors: [PUBKEY_A] }];
    const { type, encoded } = encodeEntity(filters, []);
    expect(type).toBe('nfilters');
    expect(encoded.startsWith('nfilters1')).toBe(true);
    expect(decodeNfilters(encoded)).toEqual(filters);
  });

  it('encodes filters + relays as nfeed', () => {
    const filters = [{ kinds: [1] }];
    const relays = ['wss://r.example'];
    const { type, encoded } = encodeEntity(filters, relays);
    expect(type).toBe('nfeed');
    expect(encoded.startsWith('nfeed1')).toBe(true);
    expect(decodeNfeed(encoded)).toEqual({ filters, relays });
  });
});

describe('decodeEntity', () => {
  it('decodes nfilter to one filter, no relays', () => {
    const { encoded } = encodeEntity([{ kinds: [1] }], []);
    expect(decodeEntity(encoded)).toEqual({ type: 'nfilter', filters: [{ kinds: [1] }], relays: [] });
  });
  it('decodes nfilters', () => {
    const filters = [{ kinds: [1] }, { kinds: [6] }];
    const { encoded } = encodeEntity(filters, []);
    expect(decodeEntity(encoded)).toEqual({ type: 'nfilters', filters, relays: [] });
  });
  it('decodes nfeed', () => {
    const { encoded } = encodeEntity([{ kinds: [1] }], ['wss://r.example']);
    expect(decodeEntity(encoded)).toEqual({
      type: 'nfeed',
      filters: [{ kinds: [1] }],
      relays: ['wss://r.example'],
    });
  });
  it('throws on an unknown prefix', () => {
    expect(() => decodeEntity('npub1xxx')).toThrow();
  });
});

describe('buildEventTemplate', () => {
  it('builds a kind 39823 addressable event with d/title/t tags and encoded content', () => {
    const { encoded } = encodeEntity([{ kinds: [1] }], []);
    const template = buildEventTemplate('morning', 'nfilter', encoded);
    expect(template).toEqual({
      kind: KIND_FILTER_FEED,
      content: encoded,
      tags: [
        ['d', 'morning'],
        ['title', 'morning'],
        ['t', 'nfilter'],
      ],
    });
  });
});

describe('buildDeleteTemplate', () => {
  it('builds a NIP-09 kind 5 referencing the addressable coordinate', () => {
    expect(buildDeleteTemplate(`${KIND_FILTER_FEED}:${PUBKEY_A}:morning`)).toEqual({
      kind: 5,
      content: '',
      tags: [['a', `${KIND_FILTER_FEED}:${PUBKEY_A}:morning`]],
    });
  });
});

describe('parseEntityEvent', () => {
  it('parses a saved nfilter event', () => {
    const { encoded } = encodeEntity([{ kinds: [1], '#t': ['nostr'] }], []);
    const event = makeEvent({
      created_at: 42,
      content: encoded,
      tags: [['d', 'morning'], ['title', 'morning'], ['t', 'nfilter']],
    });
    expect(parseEntityEvent(event)).toEqual({
      identifier: 'morning',
      type: 'nfilter',
      encoded,
      filters: [{ kinds: [1], '#t': ['nostr'] }],
      relays: [],
      pubkey: PUBKEY_A,
      createdAt: 42,
      address: `${KIND_FILTER_FEED}:${PUBKEY_A}:morning`,
    });
  });

  it('parses a saved nfeed event with relays', () => {
    const { encoded } = encodeEntity([{ kinds: [1] }], ['wss://r.example']);
    const event = makeEvent({ content: encoded, tags: [['d', 'feed']] });
    const parsed = parseEntityEvent(event);
    expect(parsed?.type).toBe('nfeed');
    expect(parsed?.relays).toEqual(['wss://r.example']);
  });

  it('returns null when the d tag is missing', () => {
    const { encoded } = encodeEntity([{ kinds: [1] }], []);
    expect(parseEntityEvent(makeEvent({ content: encoded, tags: [] }))).toBeNull();
  });

  it('returns null when the content is not a known entity', () => {
    expect(parseEntityEvent(makeEvent({ content: 'garbage', tags: [['d', 'x']] }))).toBeNull();
  });
});

describe('store', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(storage.getItem).mockResolvedValue(null);
    vi.mocked(storage.setItem).mockResolvedValue(undefined);
    vi.mocked(relay.subscribe).mockReturnValue({ close: vi.fn() });
  });

  it('subscribes to kind 39823 for the user and lists parsed entities newest-first', () => {
    let onEvent: ((result: { event: NostrEvent }) => void) | null = null;
    let onEose: (() => void) | null = null;
    vi.mocked(relay.subscribe).mockImplementation((_filters, ev, eose) => {
      onEvent = ev as (result: { event: NostrEvent }) => void;
      onEose = eose as () => void;
      return { close: vi.fn() };
    });

    const store = createFeedBuilderStore();
    store.init(PUBKEY_A);

    expect(relay.subscribe).toHaveBeenCalledWith(
      [{ kinds: [KIND_FILTER_FEED], authors: [PUBKEY_A] }],
      expect.any(Function),
      expect.any(Function),
    );

    const a = encodeEntity([{ kinds: [1] }], []).encoded;
    const b = encodeEntity([{ kinds: [30023] }], ['wss://r.example']).encoded;
    onEvent!({ event: makeEvent({ created_at: 10, content: a, tags: [['d', 'older']] }) });
    onEvent!({ event: makeEvent({ created_at: 20, content: b, tags: [['d', 'newer']] }) });
    onEose!();

    expect(store.state.loaded).toBe(true);
    expect(store.state.entities.map((e) => e.identifier)).toEqual(['newer', 'older']);
  });

  it('keeps only the newest event per identifier', () => {
    let onEvent: ((result: { event: NostrEvent }) => void) | null = null;
    vi.mocked(relay.subscribe).mockImplementation((_f, ev) => {
      onEvent = ev as (result: { event: NostrEvent }) => void;
      return { close: vi.fn() };
    });
    const store = createFeedBuilderStore();
    store.init(PUBKEY_A);

    const v1 = encodeEntity([{ kinds: [1] }], []).encoded;
    const v2 = encodeEntity([{ kinds: [1] }, { kinds: [6] }], []).encoded;
    onEvent!({ event: makeEvent({ created_at: 5, content: v1, tags: [['d', 'x']] }) });
    onEvent!({ event: makeEvent({ created_at: 9, content: v2, tags: [['d', 'x']] }) });

    expect(store.state.entities).toHaveLength(1);
    expect(store.state.entities[0]?.type).toBe('nfilters');
  });

  it('publishes a named filter as a kind 39823 event', async () => {
    vi.mocked(relay.publish).mockResolvedValue(makeEvent({ tags: [['d', 'morning']] }));
    const store = createFeedBuilderStore();
    store.init(PUBKEY_A);

    const result = await store.save({ name: 'morning', filters: [{ kinds: [1] }], relays: [] });

    const expectedEncoded = encodeEntity([{ kinds: [1] }], []).encoded;
    expect(relay.publish).toHaveBeenCalledWith(expect.objectContaining({
      kind: KIND_FILTER_FEED,
      content: expectedEncoded,
      tags: [['d', 'morning'], ['title', 'morning'], ['t', 'nfilter']],
    }));
    expect(result.address).toBe(`${KIND_FILTER_FEED}:${PUBKEY_A}:morning`);
    expect(store.state.entities.map((e) => e.identifier)).toContain('morning');
  });

  it('refuses to save an invalid name', async () => {
    const store = createFeedBuilderStore();
    store.init(PUBKEY_A);
    await expect(store.save({ name: 'bad name', filters: [{ kinds: [1] }], relays: [] })).rejects.toThrow();
  });

  it('refuses to save with no usable filter', async () => {
    const store = createFeedBuilderStore();
    store.init(PUBKEY_A);
    await expect(store.save({ name: 'empty', filters: [{}], relays: [] })).rejects.toThrow();
  });

  it('deletes an entity via kind 5 and drops it locally', async () => {
    let onEvent: ((result: { event: NostrEvent }) => void) | null = null;
    vi.mocked(relay.subscribe).mockImplementation((_f, ev) => {
      onEvent = ev as (result: { event: NostrEvent }) => void;
      return { close: vi.fn() };
    });
    vi.mocked(relay.publish).mockResolvedValue(makeEvent({ kind: 5 }));
    const store = createFeedBuilderStore();
    store.init(PUBKEY_A);
    const enc = encodeEntity([{ kinds: [1] }], []).encoded;
    onEvent!({ event: makeEvent({ created_at: 5, content: enc, tags: [['d', 'x']] }) });
    const address = `${KIND_FILTER_FEED}:${PUBKEY_A}:x`;

    await store.remove(address);

    expect(relay.publish).toHaveBeenCalledWith(expect.objectContaining({
      kind: 5,
      tags: [['a', address]],
    }));
    expect(store.state.entities).toHaveLength(0);
  });
});
