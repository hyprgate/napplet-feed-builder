<script lang="ts">
  import TagInput from './TagInput.svelte';
  import { pubkeysFromInputs, type AdvFilter } from '../lib/filters';
  import { searchAuthorSuggestions } from '../lib/author-suggestions';

  interface Props {
    filter: AdvFilter;
    onchange: (filter: AdvFilter) => void;
    onremove?: () => void;
    label: string;
  }

  let { filter, onchange, onremove, label }: Props = $props();

  const HEX64 = /^[0-9a-f]{64}$/i;

  function update(patch: Partial<AdvFilter>): void {
    onchange({ ...filter, ...patch });
  }

  function setKinds(values: string[]): void {
    const kinds: number[] = [];
    for (const v of values) {
      const n = Number(v);
      if (Number.isInteger(n) && n >= 0 && !kinds.includes(n)) kinds.push(n);
    }
    update({ kinds });
  }

  // Reconcile the tag-name list with the existing tag groups, preserving values.
  function setTagNames(names: string[]): void {
    const seen = new Set<string>();
    const tags = names
      .map((raw) => raw.replace(/^#/, ''))
      .filter((name) => name && !seen.has(name) && seen.add(name))
      .map((name) => filter.tags.find((t) => t.name === name) ?? { name, values: [] });
    update({ tags });
  }

  function setTagValues(name: string, values: string[]): void {
    update({ tags: filter.tags.map((t) => (t.name === name ? { ...t, values } : t)) });
  }

  function setTimestamp(field: 'since' | 'until', raw: string): void {
    const trimmed = raw.trim();
    if (trimmed === '') return update({ [field]: null } as Partial<AdvFilter>);
    const n = Number(trimmed);
    if (Number.isInteger(n) && n >= 0) update({ [field]: n } as Partial<AdvFilter>);
  }

  const authorCheck = $derived(pubkeysFromInputs(filter.authors));
</script>

<div class="adv-filter">
  <div class="block-head">
    <span class="block-title">{label}</span>
    {#if onremove}
      <button type="button" class="remove" aria-label={`Remove ${label}`} onclick={onremove}>✕</button>
    {/if}
  </div>

  <div class="section">
    <span class="section-label">
      Authors
      {#if authorCheck.invalid.length > 0}<span class="bad">{authorCheck.invalid.length} invalid</span>{/if}
    </span>
    <TagInput
      values={filter.authors}
      placeholder="pubkey (hex) — npub / nprofile also accepted"
      mono
      onchange={(authors) => update({ authors })}
      transform={(v) => pubkeysFromInputs([v]).pubkeys[0] ?? v}
      suggest={searchAuthorSuggestions}
      invalid={(v) => !HEX64.test(v)}
    />
  </div>

  <div class="section">
    <span class="section-label">IDs</span>
    <TagInput
      values={filter.ids}
      placeholder="event id (in hex format)"
      mono
      onchange={(ids) => update({ ids })}
      invalid={(v) => !HEX64.test(v)}
    />
  </div>

  <div class="section">
    <span class="section-label">Kinds</span>
    <TagInput
      values={filter.kinds.map(String)}
      placeholder="event kind (e.g. 0, 1, 9735)"
      onchange={setKinds}
      invalid={(v) => !Number.isInteger(Number(v))}
    />
  </div>

  <div class="section tags">
    <span class="section-label">Tags</span>
    <div class="sub">
      <span class="sub-label">Tag names</span>
      <TagInput
        values={filter.tags.map((t) => `#${t.name}`)}
        placeholder="tag name per NIP-01 (e, p, a, t, r, …)"
        onchange={setTagNames}
        transform={(v) => `#${v.replace(/^#/, '')}`}
      />
    </div>
    {#each filter.tags as tag (tag.name)}
      <div class="sub">
        <span class="sub-label">Values for <code>#{tag.name}</code></span>
        <TagInput
          values={tag.values}
          placeholder={`value for #${tag.name}`}
          mono
          onchange={(values) => setTagValues(tag.name, values)}
        />
      </div>
    {/each}
  </div>

  <div class="section">
    <span class="section-label">Search</span>
    <input
      class="text"
      value={filter.search}
      placeholder="full-text search string (NIP-50)"
      spellcheck="false"
      oninput={(e) => update({ search: (e.currentTarget as HTMLInputElement).value })}
    />
  </div>

  <div class="row">
    <div class="section">
      <span class="section-label">Since</span>
      <input
        class="text"
        type="number"
        min="0"
        value={filter.since ?? ''}
        placeholder="unix seconds"
        oninput={(e) => setTimestamp('since', (e.currentTarget as HTMLInputElement).value)}
      />
    </div>
    <div class="section">
      <span class="section-label">Until</span>
      <input
        class="text"
        type="number"
        min="0"
        value={filter.until ?? ''}
        placeholder="unix seconds"
        oninput={(e) => setTimestamp('until', (e.currentTarget as HTMLInputElement).value)}
      />
    </div>
  </div>
</div>

<style>
  .adv-filter {
    display: grid;
    gap: 12px;
    padding: 12px;
    border: 1px solid var(--hg-border, #303030);
    border-radius: 6px;
    background: var(--hg-surface, #101010);
  }
  .block-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .block-title {
    color: var(--hg-accent-cyan, #82d8f7);
    font-size: 12px;
    font-weight: 600;
  }
  .remove {
    border: none;
    background: none;
    color: var(--hg-text-muted, #b8b1a4);
    cursor: pointer;
    font: inherit;
    font-size: 12px;
  }
  .remove:hover { color: var(--hg-accent-red, #ff6b6b); }
  .section { display: grid; gap: 5px; }
  .section-label {
    display: flex;
    align-items: baseline;
    gap: 8px;
    color: var(--hg-text-muted, #b8b1a4);
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .bad { color: var(--hg-accent-red, #ff6b6b); text-transform: none; letter-spacing: 0; }
  .tags {
    gap: 10px;
    padding: 10px;
    border: 1px solid var(--hg-border-muted, #242424);
    border-radius: 5px;
  }
  .sub { display: grid; gap: 4px; }
  .sub-label {
    color: var(--hg-text-muted, #b8b1a4);
    font-size: 10px;
  }
  .sub-label code {
    color: var(--hg-accent-cyan, #82d8f7);
    font-family: var(--hg-font-body, ui-monospace, monospace);
  }
  .row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
  }
  .text {
    width: 100%;
    box-sizing: border-box;
    height: 30px;
    padding: 0 9px;
    border: 1px solid var(--hg-border, #303030);
    border-radius: 5px;
    background: var(--hg-surface, #101010);
    color: var(--hg-text-primary, #f2efe7);
    font: inherit;
    font-size: 12px;
  }
  .text:focus { outline: none; border-color: var(--hg-accent-cyan, #82d8f7); }
</style>
