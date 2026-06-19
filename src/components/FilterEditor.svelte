<script lang="ts">
  import TagInput from './TagInput.svelte';
  import { pubkeysFromInputs } from '../lib/filters';

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
  }

  let { block, onchange, onremove, label }: Props = $props();

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

  function toggleKind(kind: number): void {
    const kinds = block.kinds.includes(kind)
      ? block.kinds.filter((k) => k !== kind)
      : [...block.kinds, kind];
    onchange({ ...block, kinds });
  }

  function setKindsFromText(values: string[]): void {
    const kinds: number[] = [];
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
    <span class="field-label">Kinds</span>
    <div class="kind-palette">
      {#each COMMON_KINDS as k (k.kind)}
        <button
          type="button"
          class="kind-pill"
          class:active={block.kinds.includes(k.kind)}
          onclick={() => toggleKind(k.kind)}
        >{k.label}<span class="kn">{k.kind}</span></button>
      {/each}
    </div>
    <TagInput
      values={block.kinds.map(String)}
      placeholder="add kind numbers…"
      onchange={setKindsFromText}
      invalid={(v) => !Number.isInteger(Number(v))}
    />
  </div>

  <div class="field">
    <span class="field-label">
      Authors
      {#if authorCheck.pubkeys.length > 0}
        <span class="muted">{authorCheck.pubkeys.length} key{authorCheck.pubkeys.length === 1 ? '' : 's'}</span>
      {/if}
      {#if authorCheck.invalid.length > 0}
        <span class="bad">{authorCheck.invalid.length} unrecognized</span>
      {/if}
    </span>
    <TagInput
      values={block.authors}
      placeholder="npub / nprofile / hex pubkey…"
      mono
      onchange={(authors) => onchange({ ...block, authors })}
      invalid={(v) => pubkeysFromInputs([v]).pubkeys.length === 0}
    />
  </div>

  <div class="field">
    <span class="field-label">Hashtags</span>
    <TagInput
      values={block.hashtags}
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
  .kn {
    opacity: 0.6;
    font-size: 10px;
  }
  .kind-pill.active .kn {
    opacity: 0.8;
  }
</style>
