import { relay, type NostrEvent } from '@napplet/sdk';
import type { TagSuggestion } from './tag-suggestions';
import { normalizeRelayInput, validateRelayInput } from './filters';

const RELAY_DISCOVERY_KIND = 30166;

function relayUrlFromDiscovery(event: NostrEvent): string | null {
  if (event.kind !== RELAY_DISCOVERY_KIND) return null;
  const dTag = event.tags.find((tag) => tag[0] === 'd' && typeof tag[1] === 'string')?.[1];
  const relayTag = event.tags.find((tag) => tag[0] === 'r' && typeof tag[1] === 'string')?.[1];
  const url = dTag || relayTag;
  if (!url) return null;
  const normalized = normalizeRelayInput(url);
  return validateRelayInput(normalized).error ? null : normalized;
}

export async function searchRelaySuggestions(draft: string): Promise<TagSuggestion[]> {
  const query = normalizeRelayInput(draft).replace(/^wss?:\/\//i, '').toLowerCase();
  if (query.length < 2) return [];
  const results = await relay.query({ kinds: [RELAY_DISCOVERY_KIND], limit: 80 });
  const events = results.map((result) => result.event as NostrEvent);
  const seen = new Set<string>();
  const suggestions: TagSuggestion[] = [];
  for (const event of events) {
    const url = relayUrlFromDiscovery(event);
    if (!url || seen.has(url)) continue;
    if (!url.toLowerCase().includes(query)) continue;
    seen.add(url);
    suggestions.push({ value: url, label: url, detail: 'NIP-66' });
    if (suggestions.length >= 8) break;
  }
  return suggestions;
}
