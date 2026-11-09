import { describe, expect, it } from 'vitest';
import { describeFilter, describeFilters } from './filter-summary';

const names: Record<string, string> = { a: 'Ines', b: 'Tomás', c: 'Hana', d: 'Wren' };
const nameFor = (pubkey: string) => names[pubkey] ?? pubkey;

describe('describeFilter', () => {
  it('says what, who and which tags in plain words', () => {
    expect(describeFilter({ kinds: [1], authors: ['a'], '#t': ['art'] }, nameFor)).toBe('Notes from Ines tagged #art');
    expect(describeFilter({ kinds: [1, 30023] }, nameFor)).toBe('Notes and articles');
    expect(describeFilter({ authors: ['a', 'b'] }, nameFor)).toBe('Everything from Ines and Tomás');
  });

  it('summarizes long author lists and unknown kinds', () => {
    expect(describeFilter({ authors: ['a', 'b', 'c', 'd'] }, nameFor)).toBe('Everything from Ines, Tomás and 2 others');
    expect(describeFilter({ kinds: [34235] }, nameFor)).toBe('Kind 34235');
  });

  it('joins several filters', () => {
    expect(describeFilters([{ kinds: [1] }, { kinds: [7] }], nameFor)).toBe('Notes, plus Reactions');
    expect(describeFilters([], nameFor)).toBe('');
  });
});
