import { cvm, identity, relay, type McpToolResult, type NostrEvent } from '@napplet/sdk';
import * as nip19 from 'nostr-tools/nip19';
import type { TagSuggestion } from './tag-suggestions';
import { profileName, shortNpub } from './people';

const RELATR_SERVER = {
  pubkey: '750682303c9f0ddad75941b49edc9d46e3ed306b9ee3335338a21a3e404c5fa3',
  relays: [
    'wss://relay.contextvm.org',
    'wss://relay2.contextvm.org',
    'wss://relay.primal.net',
  ],
};

const RELATR_OPTIONS = { initialize: true, timeoutMs: 30_000 } as const;

interface RelatrCandidate {
  pubkey: string;
  trustScore: number;
  rank: number;
}

interface ProfileMetadata {
  name?: string;
  display_name?: string;
  displayName?: string;
  nip05?: string;
}

interface RelatrResult extends McpToolResult {
  structuredContent?: unknown;
}

function directPubkey(raw: string): string | null {
  const query = raw.trim().replace(/^@/, '').replace(/^nostr:/i, '');
  if (/^[0-9a-f]{64}$/i.test(query)) return query.toLowerCase();
  if (!/^(npub|nprofile)1/i.test(query)) return null;
  try {
    const decoded = nip19.decode(query);
    if (decoded.type === 'npub') return decoded.data;
    if (decoded.type === 'nprofile') return decoded.data.pubkey;
  } catch {
    return null;
  }
  return null;
}

function isCandidate(value: unknown): value is RelatrCandidate {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<RelatrCandidate>;
  return typeof candidate.pubkey === 'string'
    && typeof candidate.trustScore === 'number'
    && typeof candidate.rank === 'number';
}

function extractCandidates(result: RelatrResult): RelatrCandidate[] {
  const structured = result.structuredContent;
  if (structured && typeof structured === 'object') {
    const results = (structured as { results?: unknown }).results;
    if (Array.isArray(results)) return results.filter(isCandidate);
  }
  for (const block of result.content ?? []) {
    if (block.type !== 'text' || typeof block.text !== 'string') continue;
    try {
      const parsed = JSON.parse(block.text) as { results?: unknown };
      if (Array.isArray(parsed.results)) return parsed.results.filter(isCandidate);
    } catch {
      // Continue scanning content blocks.
    }
  }
  return [];
}

function parseMetadata(event: NostrEvent): ProfileMetadata | null {
  if (event.kind !== 0) return null;
  try {
    const parsed = JSON.parse(event.content) as unknown;
    return parsed && typeof parsed === 'object' ? parsed as ProfileMetadata : null;
  } catch {
    return null;
  }
}

function displayName(pubkey: string, metadata: ProfileMetadata | null | undefined): string {
  return profileName(metadata) ?? shortNpub(pubkey);
}

async function loadMetadata(pubkeys: string[]): Promise<Map<string, ProfileMetadata>> {
  if (pubkeys.length === 0) return new Map();
  const results = await relay.query(pubkeys.map((pubkey) => ({ kinds: [0], authors: [pubkey], limit: 1 })));
  const events = results.map((result) => result.event as NostrEvent);
  const metadata = new Map<string, ProfileMetadata>();
  for (const event of events) {
    const parsed = parseMetadata(event);
    if (parsed) metadata.set(event.pubkey, parsed);
  }
  return metadata;
}

export async function searchAuthorSuggestions(draft: string): Promise<TagSuggestion[]> {
  const query = draft.trim().replace(/^@/, '');
  if (query.length < 2) return [];

  const pubkey = directPubkey(query);
  if (pubkey) return [{ value: pubkey, label: displayName(pubkey, null) }];

  const result = await cvm.callTool(
    RELATR_SERVER,
    'search_profiles',
    { query, limit: 8, extendToNostr: true },
    RELATR_OPTIONS,
  ) as RelatrResult;
  const candidates = extractCandidates(result).slice(0, 8);
  const metadata = await loadMetadata(candidates.map((candidate) => candidate.pubkey)).catch(() => new Map());
  return candidates.map((candidate) => ({
    value: candidate.pubkey,
    label: displayName(candidate.pubkey, metadata.get(candidate.pubkey)),
    detail: `trust ${Math.round(candidate.trustScore)} · ${shortNpub(candidate.pubkey)}`,
  }));
}

let followDirectory: Promise<Array<{ pubkey: string; metadata: ProfileMetadata }>> | null = null;

async function loadFollowDirectory(): Promise<Array<{ pubkey: string; metadata: ProfileMetadata }>> {
  const self = await identity.getPublicKey();
  const lists = await relay.query([{ kinds: [3], authors: [self] }]);
  const newest = lists
    .map((result) => result.event as NostrEvent)
    .reduce<NostrEvent | null>((best, event) => (!best || event.created_at > best.created_at ? event : best), null);
  const follows = [...new Set((newest?.tags ?? []).filter((tag) => tag[0] === 'p' && tag[1]).map((tag) => tag[1] as string))];
  const metadata = await loadMetadata(follows);
  return follows.flatMap((pubkey) => {
    const entry = metadata.get(pubkey);
    return entry ? [{ pubkey, metadata: entry }] : [];
  });
}

/**
 * People you already follow, matched by name. These come straight from relays, so
 * they show up at once and still work when the Relatr search isn't reachable.
 */
export async function searchFollowSuggestions(draft: string): Promise<TagSuggestion[]> {
  const query = draft.trim().replace(/^@/, '').toLowerCase();
  if (query.length < 2 || directPubkey(query)) return [];
  followDirectory ??= loadFollowDirectory().catch((error) => {
    followDirectory = null;
    throw error;
  });
  const directory = await followDirectory;
  return directory
    .filter(({ metadata }) => [metadata.display_name, metadata.displayName, metadata.name, metadata.nip05]
      .some((value) => typeof value === 'string' && value.toLowerCase().includes(query)))
    .map(({ pubkey, metadata }) => ({ value: pubkey, label: displayName(pubkey, metadata), detail: `you follow · ${shortNpub(pubkey)}` }));
}

export function resetFollowDirectoryForTest(): void {
  followDirectory = null;
}
