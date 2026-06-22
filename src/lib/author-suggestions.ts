import { cvm, relay, type McpToolResult, type NostrEvent } from '@napplet/sdk';
import { nip19 } from 'nostr-tools';
import type { TagSuggestion } from './tag-suggestions';

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
  return metadata?.display_name?.trim()
    || metadata?.displayName?.trim()
    || metadata?.name?.trim()
    || metadata?.nip05?.trim()
    || `${pubkey.slice(0, 8)}...`;
}

async function loadMetadata(pubkeys: string[]): Promise<Map<string, ProfileMetadata>> {
  if (pubkeys.length === 0) return new Map();
  const events = await relay.query(pubkeys.map((pubkey) => ({ kinds: [0], authors: [pubkey], limit: 1 }))) as NostrEvent[];
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
  if (pubkey) return [{ value: pubkey, label: displayName(pubkey, null), detail: pubkey.slice(0, 12) }];

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
    detail: `trust ${Math.round(candidate.trustScore)} · ${candidate.pubkey.slice(0, 10)}`,
  }));
}
