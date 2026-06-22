import type { NostrEvent } from '@hyprgate/types';
import { relay, type Subscription } from '@napplet/sdk';
import { nip19, type Filter } from 'nostr-tools';
import { encodeNfeed, encodeNfilter, encodeNfilters } from '@sandwichfarm/encoded-entities';
// Anti-drift (FEED-04 / Plan 89-01): the PURE kind-39823 decode helpers live in
// ONE place — @hyprgate/utils — so the shell chrome and this builder decode 39823
// identically and can never drift. The SDK-coupled store + all encode/CRUD authoring
// below stay local in the napp. The names below were previously defined here; they
// are now re-exported so every consumer import site (filters.test.ts, App.svelte,
// AdvancedFilterEditor.svelte, FilterEditor.svelte) keeps resolving unchanged.
import { chooseType, parseEntityEvent, KIND_FILTER_FEED } from '@hyprgate/utils';
import type { EntityType, SavedEntity } from '@hyprgate/utils';

export { chooseType, decodeEntity, parseEntityEvent, KIND_FILTER_FEED } from '@hyprgate/utils';
export type { EntityType, SavedEntity } from '@hyprgate/utils';

/** NIP-09 deletion request kind. */
export const KIND_DELETION = 5 as const;

/** A minimal event template (the SDK / store add `created_at` + signature). */
export interface EntityTemplate {
  kind: number;
  content: string;
  tags: string[][];
}

/**
 * A valid entity name (the `d` tag): non-empty, no whitespace, printable ASCII.
 * Letters, digits, and symbols are all allowed — only spaces are rejected.
 */
export function isValidName(name: string): boolean {
  return /^[\x21-\x7e]+$/.test(name);
}

/**
 * Convert author inputs (hex pubkey, `npub`, or `nprofile`) to hex pubkeys,
 * de-duplicated. Empty inputs are skipped; anything unparseable is reported in
 * `invalid` so the UI can flag it.
 */
export function pubkeysFromInputs(inputs: string[]): { pubkeys: string[]; invalid: string[] } {
  const pubkeys: string[] = [];
  const invalid: string[] = [];
  const seen = new Set<string>();

  for (const raw of inputs) {
    const value = raw.trim();
    if (!value) continue;

    let hex: string | null = null;
    if (/^[0-9a-f]{64}$/i.test(value)) {
      hex = value.toLowerCase();
    } else {
      try {
        const decoded = nip19.decode(value);
        if (decoded.type === 'npub') hex = decoded.data;
        else if (decoded.type === 'nprofile') hex = decoded.data.pubkey;
      } catch {
        hex = null;
      }
    }

    if (!hex) {
      invalid.push(value);
      continue;
    }
    if (!seen.has(hex)) {
      seen.add(hex);
      pubkeys.push(hex);
    }
  }

  return { pubkeys, invalid };
}

export interface BasicFilterInput {
  kinds?: number[];
  authors?: string[];
  hashtags?: string[];
}

/** Assemble a NIP-01 filter from the basic builder, omitting empty fields and `limit`. */
export function buildFilter(input: BasicFilterInput): Filter {
  const filter: Record<string, unknown> = {};
  if (input.kinds && input.kinds.length > 0) filter.kinds = input.kinds;
  if (input.authors && input.authors.length > 0) filter.authors = input.authors;
  if (input.hashtags && input.hashtags.length > 0) filter['#t'] = input.hashtags;
  return filter as Filter;
}

const BASIC_FILTER_KEYS = new Set(['kinds', 'authors', '#t']);

export type FeedBuilderView = 'basic' | 'advanced';

/** Whether Basic mode can round-trip this filter without dropping constraints. */
export function canRepresentFilterAsBasic(filter: Filter): boolean {
  const clean = sanitizeFilter(filter) as Record<string, unknown>;
  return Object.entries(clean).every(([key, value]) => {
    if (!BASIC_FILTER_KEYS.has(key)) return false;
    if (key === 'kinds') return Array.isArray(value) && value.every((v) => Number.isInteger(v) && (v as number) >= 0);
    if (key === 'authors') return Array.isArray(value) && value.every((v) => typeof v === 'string' && /^[0-9a-f]{64}$/i.test(v));
    return Array.isArray(value) && value.every((v) => typeof v === 'string');
  });
}

/** Whether a filter set can stay editable in Basic mode without lossy conversion. */
export function canRepresentAsBasic(filters: Filter[]): boolean {
  return filters.every(canRepresentFilterAsBasic);
}

/** View to select when loading saved filters. */
export function preferredViewForFilters(filters: Filter[]): FeedBuilderView {
  return canRepresentAsBasic(filters) ? 'basic' : 'advanced';
}

export interface RelayValidationResult {
  relay: string;
  error: string | null;
}

/** Normalize user relay entry: bare hostnames become wss:// hosts; blanks vanish. */
export function normalizeRelayInput(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return '';
  if (/^wss?:\/\//i.test(trimmed)) {
    return trimmed.replace(/^ws:\/\//i, 'ws://').replace(/^wss:\/\//i, 'wss://');
  }
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) return trimmed;
  return `wss://${trimmed}`;
}

export function validateRelayInput(input: string): RelayValidationResult {
  const relayUrl = normalizeRelayInput(input);
  if (!relayUrl) return { relay: '', error: null };
  try {
    const parsed = new URL(relayUrl);
    if (parsed.protocol !== 'ws:' && parsed.protocol !== 'wss:') {
      return { relay: relayUrl, error: 'Relay URL must use ws:// or wss://' };
    }
    if (!parsed.hostname || /\s/.test(relayUrl)) {
      return { relay: relayUrl, error: 'Relay URL must include a host' };
    }
    return { relay: relayUrl, error: null };
  } catch {
    return { relay: relayUrl, error: 'Relay URL is invalid' };
  }
}

export function validateRelayInputs(inputs: string[]): { relays: string[]; invalid: string[] } {
  const relays: string[] = [];
  const invalid: string[] = [];
  const seen = new Set<string>();
  for (const input of inputs) {
    const result = validateRelayInput(input);
    if (!result.relay) continue;
    if (result.error) {
      invalid.push(result.relay);
      continue;
    }
    if (!seen.has(result.relay)) {
      seen.add(result.relay);
      relays.push(result.relay);
    }
  }
  return { relays, invalid };
}

/** Drop `limit` and empty arrays from a filter. */
export function sanitizeFilter(filter: Filter): Filter {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(filter)) {
    if (key === 'limit') continue;
    if (Array.isArray(value) && value.length === 0) continue;
    out[key] = value;
  }
  return out as Filter;
}

/** Parse and sanitize a raw JSON filter (Advanced mode). Throws on garbage. */
export function parseFilterJson(text: string): Filter {
  const parsed = JSON.parse(text);
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('A filter must be a JSON object');
  }
  return sanitizeFilter(parsed as Filter);
}

/** Whether a filter carries no usable constraint (so it should not be saved). */
export function isFilterEmpty(filter: Filter): boolean {
  return Object.keys(sanitizeFilter(filter)).length === 0;
}

/** One tag constraint in the structured (Advanced) editor, e.g. `#a` -> values. */
export interface FilterTag {
  name: string;
  values: string[];
}

/**
 * The structured form of a NIP-01 filter used by the Advanced editor — every
 * field is always present so the UI can bind to it directly. `limit` is
 * deliberately absent (the runtime owns paging).
 */
export interface AdvFilter {
  authors: string[];
  ids: string[];
  kinds: number[];
  tags: FilterTag[];
  search: string;
  since: number | null;
  until: number | null;
}

/** A blank structured filter. */
export function emptyAdvFilter(): AdvFilter {
  return { authors: [], ids: [], kinds: [], tags: [], search: '', since: null, until: null };
}

/** Collapse a structured filter into a NIP-01 filter, omitting empties and `limit`. */
export function advToFilter(adv: AdvFilter): Filter {
  const filter: Record<string, unknown> = {};
  if (adv.ids.length > 0) filter.ids = adv.ids;
  if (adv.authors.length > 0) filter.authors = adv.authors;
  if (adv.kinds.length > 0) filter.kinds = adv.kinds;
  for (const tag of adv.tags) {
    const name = tag.name.replace(/^#/, '');
    if (name && tag.values.length > 0) filter[`#${name}`] = tag.values;
  }
  if (adv.search.trim()) filter.search = adv.search;
  if (adv.since !== null) filter.since = adv.since;
  if (adv.until !== null) filter.until = adv.until;
  return filter as Filter;
}

/** Expand a NIP-01 filter into the structured form for editing. */
export function filterToAdv(filter: Filter): AdvFilter {
  const f = filter as Filter & Record<string, unknown>;
  const tags: FilterTag[] = [];
  for (const [key, value] of Object.entries(f)) {
    if (key.startsWith('#') && Array.isArray(value)) {
      tags.push({ name: key.slice(1), values: value as string[] });
    }
  }
  return {
    authors: f.authors ?? [],
    ids: f.ids ?? [],
    kinds: f.kinds ?? [],
    tags,
    search: typeof f.search === 'string' ? f.search : '',
    since: typeof f.since === 'number' ? f.since : null,
    until: typeof f.until === 'number' ? f.until : null,
  };
}

/** Whether a structured filter carries no usable constraint. */
export function isAdvFilterEmpty(adv: AdvFilter): boolean {
  return isFilterEmpty(advToFilter(adv));
}

export interface FilterArrayValidation {
  ok: boolean;
  errors: string[];
  filters: Filter[];
}

/**
 * Validate a raw JSON string as an array of NIP-01 filters, returning precise
 * per-field errors. Hand-written (no JSON-schema dependency) to keep the bundle
 * small. On success, returns the sanitized filters (`limit` and empty arrays
 * dropped); on failure, `filters` is empty.
 */
export function validateFilterArray(text: string): FilterArrayValidation {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    return { ok: false, errors: [`Invalid JSON: ${(e as Error).message}`], filters: [] };
  }
  if (!Array.isArray(parsed)) {
    return { ok: false, errors: ['Top level must be an array of filter objects'], filters: [] };
  }

  const errors: string[] = [];
  const filters: Filter[] = [];
  const isHex64 = (v: unknown): boolean => typeof v === 'string' && /^[0-9a-f]{64}$/i.test(v);

  parsed.forEach((item, i) => {
    const at = `filter ${i + 1}`;
    if (item === null || typeof item !== 'object' || Array.isArray(item)) {
      errors.push(`${at}: must be a JSON object`);
      return;
    }
    for (const [key, value] of Object.entries(item as Record<string, unknown>)) {
      if (key === 'ids' || key === 'authors') {
        if (!Array.isArray(value) || !value.every(isHex64)) {
          errors.push(`${at}: "${key}" must be an array of 64-character hex strings`);
        }
      } else if (key === 'kinds') {
        if (!Array.isArray(value) || !value.every((v) => Number.isInteger(v) && (v as number) >= 0)) {
          errors.push(`${at}: "kinds" must be an array of non-negative integers`);
        }
      } else if (key === 'since' || key === 'until' || key === 'limit') {
        if (!Number.isInteger(value) || (value as number) < 0) {
          errors.push(`${at}: "${key}" must be a non-negative integer`);
        }
      } else if (key === 'search') {
        if (typeof value !== 'string') errors.push(`${at}: "search" must be a string`);
      } else if (key.startsWith('#')) {
        if (!Array.isArray(value) || !value.every((v) => typeof v === 'string')) {
          errors.push(`${at}: "${key}" must be an array of strings`);
        }
      } else {
        errors.push(`${at}: unknown field "${key}"`);
      }
    }
    filters.push(sanitizeFilter(item as Filter));
  });

  if (errors.length > 0) return { ok: false, errors, filters: [] };
  return { ok: true, errors: [], filters };
}

/** Encode filters (+ relays) as the appropriate bech32 entity. */
export function encodeEntity(filters: Filter[], relays: string[]): { type: EntityType; encoded: string } {
  const type = chooseType(filters, relays);
  switch (type) {
    case 'nfilter':
      return { type, encoded: encodeNfilter(filters[0]) };
    case 'nfilters':
      return { type, encoded: encodeNfilters(filters) };
    case 'nfeed':
      return { type, encoded: encodeNfeed({ filters, relays }) };
  }
}

/** Build the kind 39823 event template for a saved entity. */
export function buildEventTemplate(name: string, type: EntityType, encoded: string): EntityTemplate {
  return {
    kind: KIND_FILTER_FEED,
    content: encoded,
    tags: [
      ['d', name],
      ['title', name],
      ['t', type],
    ],
  };
}

/** Build a NIP-09 deletion template for an addressable coordinate. */
export function buildDeleteTemplate(address: string): EntityTemplate {
  return { kind: KIND_DELETION, content: '', tags: [['a', address]] };
}

export interface SaveInput {
  name: string;
  filters: Filter[];
  relays: string[];
}

export interface SaveResult {
  address: string;
  event: NostrEvent;
}

export interface FeedBuilderState {
  loading: boolean;
  loaded: boolean;
  error: string | null;
  pubkey: string | null;
  entities: SavedEntity[];
  publishing: boolean;
  lastSavedAddress: string | null;
}

export interface FeedBuilderStore {
  state: FeedBuilderState;
  init(pubkey: string): void;
  save(input: SaveInput): Promise<SaveResult>;
  remove(address: string): Promise<void>;
  destroy(): void;
}

interface FeedBuilderContext {
  state: FeedBuilderState;
  events: Map<string, NostrEvent>;
  subscriptions: Set<Subscription>;
  notify(): void;
}

function recompute(ctx: FeedBuilderContext): void {
  ctx.state.entities = [...ctx.events.values()]
    .map(parseEntityEvent)
    .filter((e): e is SavedEntity => e !== null)
    .sort((a, b) => b.createdAt - a.createdAt || a.identifier.localeCompare(b.identifier));
  ctx.notify();
}

function rememberEvent(ctx: FeedBuilderContext, event: NostrEvent): void {
  const parsed = parseEntityEvent(event);
  if (!parsed) return;
  const existing = ctx.events.get(parsed.address);
  if (!existing || event.created_at >= existing.created_at) {
    ctx.events.set(parsed.address, event);
  }
}

function closeSubscriptions(ctx: FeedBuilderContext): void {
  for (const sub of ctx.subscriptions) sub.close();
  ctx.subscriptions.clear();
}

function init(ctx: FeedBuilderContext, pubkey: string): void {
  if (ctx.state.pubkey === pubkey) return;
  ctx.state.pubkey = pubkey;
  ctx.events.clear();
  closeSubscriptions(ctx);
  ctx.state.loading = true;
  ctx.state.loaded = false;
  ctx.state.error = null;
  ctx.state.entities = [];
  ctx.notify();

  try {
    const sub = relay.subscribe(
      [{ kinds: [KIND_FILTER_FEED], authors: [pubkey] }],
      (event: NostrEvent) => {
        rememberEvent(ctx, event);
        recompute(ctx);
      },
      () => {
        ctx.state.loading = false;
        ctx.state.loaded = true;
        recompute(ctx);
      },
    );
    ctx.subscriptions.add(sub);
  } catch (error) {
    ctx.state.loading = false;
    ctx.state.loaded = true;
    ctx.state.error = error instanceof Error ? error.message : 'Failed to load saved filters';
    ctx.notify();
  }
}

async function save(ctx: FeedBuilderContext, input: SaveInput): Promise<SaveResult> {
  if (!ctx.state.pubkey) throw new Error('You must be signed in to save');
  if (!isValidName(input.name)) {
    throw new Error('Name must be non-empty with no spaces (letters, digits, and symbols are fine)');
  }
  const filters = input.filters.map(sanitizeFilter).filter((f) => !isFilterEmpty(f));
  if (filters.length === 0) throw new Error('Add at least one filter constraint before saving');
  const relayCheck = validateRelayInputs(input.relays);
  if (relayCheck.invalid.length > 0) {
    throw new Error(`Invalid relay URL: ${relayCheck.invalid[0]}`);
  }
  const relays = relayCheck.relays;

  const { type, encoded } = encodeEntity(filters, relays);
  const template = buildEventTemplate(input.name, type, encoded);

  ctx.state.publishing = true;
  ctx.state.error = null;
  ctx.notify();
  try {
    const createdAt = Math.floor(Date.now() / 1000);
    const published = (await relay.publish({ ...template, created_at: createdAt })) as NostrEvent;
    const pubkey = published?.pubkey || ctx.state.pubkey;
    const stored: NostrEvent = {
      id: published?.id ?? '',
      sig: published?.sig ?? '',
      kind: KIND_FILTER_FEED,
      pubkey,
      created_at: createdAt,
      content: encoded,
      tags: template.tags,
    };
    rememberEvent(ctx, stored);
    const address = `${KIND_FILTER_FEED}:${pubkey}:${input.name}`;
    ctx.state.lastSavedAddress = address;
    recompute(ctx);
    return { address, event: stored };
  } catch (error) {
    ctx.state.error = error instanceof Error ? error.message : 'Failed to save';
    ctx.notify();
    throw error;
  } finally {
    ctx.state.publishing = false;
    ctx.notify();
  }
}

async function remove(ctx: FeedBuilderContext, address: string): Promise<void> {
  ctx.state.error = null;
  try {
    await relay.publish({ ...buildDeleteTemplate(address), created_at: Math.floor(Date.now() / 1000) });
    ctx.events.delete(address);
    recompute(ctx);
  } catch (error) {
    ctx.state.error = error instanceof Error ? error.message : 'Failed to delete';
    ctx.notify();
    throw error;
  }
}

export function createFeedBuilderStore(onUpdate?: () => void): FeedBuilderStore {
  const ctx: FeedBuilderContext = {
    state: {
      loading: false,
      loaded: false,
      error: null,
      pubkey: null,
      entities: [],
      publishing: false,
      lastSavedAddress: null,
    },
    events: new Map<string, NostrEvent>(),
    subscriptions: new Set<Subscription>(),
    notify: () => onUpdate?.(),
  };

  return {
    state: ctx.state,
    init: (pubkey) => init(ctx, pubkey),
    save: (input) => save(ctx, input),
    remove: (address) => remove(ctx, address),
    destroy: () => closeSubscriptions(ctx),
  };
}
