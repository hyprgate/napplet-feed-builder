<script lang="ts">
  import TagInput from './TagInput.svelte';
  import { pubkeysFromInputs } from '../lib/filters';
  import { searchAuthorSuggestions, searchFollowSuggestions } from '../lib/author-suggestions';

  export interface BasicBlock {
    kinds: number[];
    authors: string[];
    hashtags: string[];
  }

  interface Props {
    block: BasicBlock;
    onchange: (block: BasicBlock) => void;
    onremove?: () => void;
    label?: string;
    nameFor?: (pubkey: string) => string;
    onopenprofile?: (pubkey: string) => void;
  }

  let { block, onchange, onremove, label, nameFor, onopenprofile }: Props = $props();

  // A small, curated palette of common kinds for one-tap selection.
  const COMMON_KINDS: { kind: number; label: string }[] = [
    { kind: 1, label: 'Notes' },
    { kind: 6, label: 'Reposts' },
    { kind: 7, label: 'Reactions' },
    { kind: 0, label: 'Profiles' },
    { kind: 30023, label: 'Articles' },
    { kind: 1063, label: 'Files' },
    { kind: 9735, label: 'Zaps' },
    { kind: 1311, label: 'Live chat' },
  ];

  const authorCheck = $derived(pubkeysFromInputs(block.authors));
  const commonKinds = new Set(COMMON_KINDS.map((k) => k.kind));
  // Common kinds are the buttons above; this field only holds the others.
  const otherKinds = $derived(block.kinds.filter((kind) => !commonKinds.has(kind)).map(String));

  function authorPubkey(value: string): string | null {
    return pubkeysFromInputs([value]).pubkeys[0] ?? null;
  }

  function toggleKind(kind: number): void {
    const kinds = block.kinds.includes(kind)
      ? block.kinds.filter((k) => k !== kind)
      : [...block.kinds, kind];
    onchange({ ...block, kinds });
  }

  function setKindsFromText(values: string[]): void {
    const kinds = block.kinds.filter((kind) => commonKinds.has(kind));
    for (const v of values) {
      const n = Number(v);
      if (Number.isInteger(n) && n >= 0 && !kinds.includes(n)) kinds.push(n);
    }
    onchange({ ...block, kinds });
  }
</script>

<div class="filter-editor">
  {#if label}
    <div class="block-head">
      <span class="block-label">{label}</span>
      {#if onremove}
        <button type="button" class="remove" onclick={onremove}>remove</button>
      {/if}
    </div>
  {/if}

  <div class="field">
    <span class="field-label">Show</span>
    <div class="kind-palette">
      {#each COMMON_KINDS as k (k.kind)}
        <button
          type="button"
          class="kind-pill"
          class:active={block.kinds.includes(k.kind)}
          aria-pressed={block.kinds.includes(k.kind)}
          title={`Event kind ${k.kind}`}
          onclick={() => toggleKind(k.kind)}
        >{k.label}</button>
      {/each}
    </div>
    <TagInput
      values={otherKinds}
      label="Other event kinds, by number"
      placeholder="Other kinds, by number…"
      onchange={setKindsFromText}
      invalid={(v) => !Number.isInteger(Number(v))}
    />
  </div>

  <div class="field">
    <span class="field-label">
      Authors
      {#if authorCheck.invalid.length > 0}
        <span class="bad">{authorCheck.invalid.length} not recognized</span>
      {/if}
    </span>
    <TagInput
      values={block.authors}
      label="Authors"
      placeholder="Search by name, or paste an npub…"
      onchange={(authors) => onchange({ ...block, authors })}
      suggest={searchAuthorSuggestions}
      suggestNow={searchFollowSuggestions}
      chipLabel={(value) => { const pubkey = authorPubkey(value); return pubkey && nameFor ? nameFor(pubkey) : value; }}
      onchipopen={onopenprofile ? (value) => { const pubkey = authorPubkey(value); if (pubkey) onopenprofile(pubkey); } : undefined}
      invalid={(v) => pubkeysFromInputs([v]).pubkeys.length === 0}
    />
  </div>

  <div class="field">
    <span class="field-label">Hashtags</span>
    <TagInput
      values={block.hashtags}
      label="Hashtags"
      placeholder="nostr, art, …"
      onchange={(hashtags) => onchange({ ...block, hashtags })}
      transform={(v) => v.replace(/^#/, '').toLowerCase()}
    />
  </div>
</div>

<style>
  .filter-editor {
    display: grid;
    gap: 10px;
  }
  .block-head {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .block-label {
    font-size: 11px;
    color: var(--hg-text-muted, #b8b1a4);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .remove {
    border: none;
    background: none;
    color: var(--hg-text-muted, #b8b1a4);
    cursor: pointer;
    font: inherit;
    font-size: 11px;
  }
  .remove:hover {
    color: var(--hg-accent-red, #ff6b6b);
  }
  .field {
    display: grid;
    gap: 5px;
  }
  .field-label {
    display: flex;
    align-items: baseline;
    gap: 8px;
    color: var(--hg-text-muted, #b8b1a4);
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .muted {
    color: var(--hg-accent-green, #9be564);
    text-transform: none;
    letter-spacing: 0;
  }
  .bad {
    color: var(--hg-accent-red, #ff6b6b);
    text-transform: none;
    letter-spacing: 0;
  }
  .kind-palette {
    display: flex;
    flex-wrap: wrap;
    gap: 5px;
  }
  .kind-pill {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 3px 8px;
    border: 1px solid var(--hg-border, #303030);
    border-radius: 12px;
    background: var(--hg-surface, #101010);
    color: var(--hg-text-muted, #b8b1a4);
    cursor: pointer;
    font: inherit;
    font-size: 11px;
  }
  .kind-pill:hover {
    border-color: var(--hg-accent-cyan, #82d8f7);
  }
  .kind-pill.active {
    border-color: var(--hg-accent-cyan, #82d8f7);
    background: var(--hg-accent-cyan, #82d8f7);
    color: var(--hg-bg-base, #050505);
  }
  .kind-pill:focus-visible {
    outline: 2px solid var(--hg-accent-focus, var(--hg-accent-primary, #82d8f7));
    outline-offset: 1px;
  }
</style>
