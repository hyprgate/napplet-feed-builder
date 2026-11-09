import { relay, type Subscription } from '@napplet/sdk';
import * as nip19 from 'nostr-tools/nip19';

interface ProfileNames {
  display_name?: unknown;
  displayName?: unknown;
  name?: unknown;
  nip05?: unknown;
}

const HEX_PUBKEY = /^[0-9a-f]{64}$/;

export function shortNpub(pubkey: string): string {
  if (!HEX_PUBKEY.test(pubkey)) return pubkey;
  const npub = nip19.npubEncode(pubkey);
  return `${npub.slice(0, 12)}...${npub.slice(-6)}`;
}

export function profileName(profile: ProfileNames | null | undefined): string | null {
  for (const candidate of [profile?.display_name, profile?.displayName, profile?.name, profile?.nip05]) {
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
  }
  return null;
}

export interface PeopleDirectory {
  nameFor(pubkey: string): string;
  watch(pubkeys: string[]): void;
  destroy(): void;
}

/** Live kind-0 names for the people on screen, falling back to a short npub. */
export function createPeopleDirectory(onUpdate: () => void): PeopleDirectory {
  const names = new Map<string, { name: string; createdAt: number }>();
  const watched = new Set<string>();
  const subscriptions: Subscription[] = [];

  return {
    nameFor: (pubkey) => names.get(pubkey)?.name ?? shortNpub(pubkey),
    watch(pubkeys) {
      const fresh = [...new Set(pubkeys)].filter((pubkey) => HEX_PUBKEY.test(pubkey) && !watched.has(pubkey));
      if (fresh.length === 0) return;
      for (const pubkey of fresh) watched.add(pubkey);
      subscriptions.push(relay.subscribe(
        { kinds: [0], authors: fresh },
        (result) => {
          const event = result.event;
          const known = names.get(event.pubkey);
          if (known && known.createdAt >= event.created_at) return;
          try {
            const name = profileName(JSON.parse(event.content) as ProfileNames);
            if (!name) return;
            names.set(event.pubkey, { name, createdAt: event.created_at });
            onUpdate();
          } catch {
            // Malformed metadata keeps the npub.
          }
        },
        () => {},
      ));
    },
    destroy() {
      for (const subscription of subscriptions) subscription.close();
      subscriptions.length = 0;
    },
  };
}
