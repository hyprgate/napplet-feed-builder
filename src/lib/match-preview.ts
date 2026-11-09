import { relay, type Subscription } from '@napplet/sdk';
import type { Filter } from 'nostr-tools/filter';

export interface MatchPreviewEvent {
  id: string;
  pubkey: string;
  kind: number;
  created_at: number;
  content: string;
}

export interface MatchPreviewState {
  count: number;
  /** Newest few, for display. The stream itself isn't limited. */
  latest: MatchPreviewEvent[];
  settled: boolean;
}

const SHOWN = 5;

/** Streams what a draft filter matches, so the outcome is visible before saving. */
export function watchMatches(filters: Filter[], onUpdate: (state: MatchPreviewState) => void): Subscription {
  const seen = new Set<string>();
  let latest: MatchPreviewEvent[] = [];
  let settled = false;
  const emit = () => onUpdate({ count: seen.size, latest, settled });

  return relay.subscribe(
    filters,
    (result) => {
      const event = result.event as MatchPreviewEvent;
      if (seen.has(event.id)) return;
      seen.add(event.id);
      latest = [...latest, event].sort((a, b) => b.created_at - a.created_at).slice(0, SHOWN);
      emit();
    },
    () => {
      settled = true;
      emit();
    },
  );
}

export function relativeTime(createdAt: number, now = Date.now() / 1000): string {
  const seconds = Math.max(0, Math.floor(now - createdAt));
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
