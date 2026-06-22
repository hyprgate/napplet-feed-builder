<script lang="ts">
  import type { TagSuggestion } from '../lib/tag-suggestions';

  // A generic chip input. Commit a value with Enter or comma; remove with the
  // chip's ✕ or Backspace on an empty field. Duplicates are ignored.
  interface Props {
    values: string[];
    placeholder?: string;
    onchange: (values: string[]) => void;
    /** Optional cleanup applied to each committed value (e.g. strip a leading #). */
    transform?: (raw: string) => string;
    /** Optional draft value update when the input receives focus. */
    onfocusdraft?: (draft: string) => string;
    /** Optional draft cleanup before blur commits. */
    onblurdraft?: (draft: string) => string;
    /** Optional async autosuggest provider for the current draft. */
    suggest?: (draft: string) => Promise<TagSuggestion[]>;
    /** Optional per-chip validity flag — invalid chips get an error style. */
    invalid?: (value: string) => boolean;
    /** Render chips in a monospace/truncated style (for keys, relays). */
    mono?: boolean;
  }

  let { values, placeholder, onchange, transform, onfocusdraft, onblurdraft, suggest, invalid, mono = false }: Props = $props();
  let draft = $state('');
  let suggestions = $state<TagSuggestion[]>([]);
  let activeSuggestion = $state(0);
  let suggestSeq = 0;

  $effect(() => {
    const provider = suggest;
    const query = draft;
    if (!provider || query.trim().length < 2) {
      suggestions = [];
      activeSuggestion = 0;
      return;
    }
    const token = ++suggestSeq;
    const timer = setTimeout(() => {
      void provider(query).then((next) => {
        if (token !== suggestSeq) return;
        suggestions = next.slice(0, 8);
        activeSuggestion = 0;
      }).catch(() => {
        if (token !== suggestSeq) return;
        suggestions = [];
      });
    }, 180);
    return () => clearTimeout(timer);
  });

  function addValues(parts: string[]): void {
    const next = [...values];
    for (const p of parts) if (p && !next.includes(p)) next.push(p);
    onchange(next);
  }

  function commit(): void {
    const parts = draft
      .split(',')
      .map((p) => (transform ? transform(p.trim()) : p.trim()))
      .filter(Boolean);
    if (parts.length === 0) return;
    addValues(parts);
    draft = '';
    suggestions = [];
  }

  function chooseSuggestion(suggestion: TagSuggestion): void {
    const value = transform ? transform(suggestion.value) : suggestion.value;
    addValues([value]);
    draft = '';
    suggestions = [];
  }

  function remove(value: string): void {
    onchange(values.filter((v) => v !== value));
  }

  function onkeydown(e: KeyboardEvent): void {
    if (suggestions.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        activeSuggestion = (activeSuggestion + 1) % suggestions.length;
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        activeSuggestion = (activeSuggestion - 1 + suggestions.length) % suggestions.length;
        return;
      }
      if ((e.key === 'Enter' || e.key === 'Tab') && suggestions[activeSuggestion]) {
        e.preventDefault();
        chooseSuggestion(suggestions[activeSuggestion]);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        suggestions = [];
        return;
      }
    }
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      commit();
    } else if (e.key === 'Backspace' && draft === '' && values.length > 0) {
      remove(values[values.length - 1]);
    }
  }

  function onfocus(): void {
    if (onfocusdraft) draft = onfocusdraft(draft);
  }

  function onblur(): void {
    if (onblurdraft) draft = onblurdraft(draft);
    commit();
  }
</script>

<div class="taginput" class:mono>
  {#each values as value (value)}
    <span class="chip" class:invalid={invalid?.(value)}>
      <span class="chip-text" title={value}>{value}</span>
      <button type="button" class="chip-x" aria-label={`Remove ${value}`} onclick={() => remove(value)}>✕</button>
    </span>
  {/each}
  <input
    bind:value={draft}
    {placeholder}
    {onkeydown}
    {onfocus}
    {onblur}
    spellcheck="false"
    autocapitalize="off"
    autocomplete="off"
  />
  {#if suggestions.length > 0}
    <div class="suggestions" role="listbox">
      {#each suggestions as suggestion, i (suggestion.value)}
        <button
          type="button"
          role="option"
          aria-selected={i === activeSuggestion}
          class:active={i === activeSuggestion}
          onmousedown={(event) => event.preventDefault()}
          onclick={() => chooseSuggestion(suggestion)}
        >
          <span class="suggest-label">{suggestion.label}</span>
          {#if suggestion.detail}<span class="suggest-detail">{suggestion.detail}</span>{/if}
        </button>
      {/each}
    </div>
  {/if}
</div>

<style>
  .taginput {
    position: relative;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 5px;
    min-height: 30px;
    padding: 4px 6px;
    border: 1px solid var(--hg-border, #303030);
    border-radius: 5px;
    background: var(--hg-surface, #101010);
  }
  .taginput:focus-within {
    border-color: var(--hg-accent-cyan, #82d8f7);
  }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    max-width: 220px;
    padding: 2px 4px 2px 8px;
    border-radius: 10px;
    background: var(--hg-bg-base, #050505);
    border: 1px solid var(--hg-border-muted, #242424);
    font-size: 11px;
    color: var(--hg-text-primary, #f2efe7);
  }
  .mono .chip-text {
    font-family: var(--hg-font-body, ui-monospace, monospace);
  }
  .chip-text {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .chip.invalid {
    border-color: var(--hg-accent-red, #ff6b6b);
    color: var(--hg-accent-red, #ff6b6b);
  }
  .chip-x {
    border: none;
    background: none;
    color: var(--hg-text-muted, #b8b1a4);
    cursor: pointer;
    font-size: 10px;
    line-height: 1;
    padding: 2px;
  }
  .chip-x:hover {
    color: var(--hg-accent-red, #ff6b6b);
  }
  input {
    flex: 1;
    min-width: 80px;
    border: none;
    background: none;
    outline: none;
    color: var(--hg-text-primary, #f2efe7);
    font: inherit;
    font-size: 12px;
    padding: 2px;
  }
  .suggestions {
    position: absolute;
    z-index: 20;
    top: calc(100% + 4px);
    left: 0;
    right: 0;
    display: grid;
    gap: 2px;
    padding: 4px;
    border: 1px solid var(--hg-border, #303030);
    border-radius: 5px;
    background: var(--hg-surface, #101010);
    box-shadow: 0 8px 20px rgba(0, 0, 0, 0.32);
  }
  .suggestions button {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 8px;
    align-items: center;
    padding: 5px 7px;
    border: none;
    border-radius: 4px;
    background: transparent;
    color: var(--hg-text-primary, #f2efe7);
    cursor: pointer;
    font: inherit;
    font-size: 11px;
    text-align: left;
  }
  .suggestions button:hover,
  .suggestions button.active {
    background: var(--hg-bg-base, #050505);
  }
  .suggest-label,
  .suggest-detail {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .suggest-detail {
    color: var(--hg-text-muted, #b8b1a4);
    font-size: 10px;
  }
</style>
