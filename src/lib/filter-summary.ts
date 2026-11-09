import type { Filter } from 'nostr-tools/filter';

const KIND_NAMES: Record<number, string> = {
  0: 'profiles',
  1: 'notes',
  6: 'reposts',
  7: 'reactions',
  1063: 'files',
  1311: 'live chat',
  9735: 'zaps',
  30023: 'articles',
};

function list(items: string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function people(pubkeys: string[], nameFor: (pubkey: string) => string): string {
  if (pubkeys.length <= 3) return list(pubkeys.map(nameFor));
  return `${pubkeys.slice(0, 2).map(nameFor).join(', ')} and ${pubkeys.length - 2} others`;
}

/** One filter in plain words: "Notes from Ines tagged #art". */
export function describeFilter(filter: Filter, nameFor: (pubkey: string) => string): string {
  const kinds = filter.kinds ?? [];
  const what = kinds.length === 0
    ? 'Everything'
    : capitalize(list(kinds.map((kind) => KIND_NAMES[kind] ?? `kind ${kind}`)));
  const parts = [what];
  if (filter.authors?.length) parts.push(`from ${people(filter.authors, nameFor)}`);
  const hashtags = (filter as Filter & { '#t'?: string[] })['#t'];
  if (hashtags?.length) parts.push(`tagged ${list(hashtags.map((tag) => `#${tag}`))}`);
  const otherTags = Object.keys(filter).filter((key) => key.startsWith('#') && key !== '#t');
  if (otherTags.length > 0) parts.push(`with ${list(otherTags)} tags`);
  return parts.join(' ');
}

export function describeFilters(filters: Filter[], nameFor: (pubkey: string) => string): string {
  if (filters.length === 0) return '';
  return filters.map((filter) => describeFilter(filter, nameFor)).join(', plus ');
}
