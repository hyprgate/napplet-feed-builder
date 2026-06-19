<script lang="ts">
  // A generic chip input. Commit a value with Enter or comma; remove with the
  // chip's ✕ or Backspace on an empty field. Duplicates are ignored.
  interface Props {
    values: string[];
    placeholder?: string;
    onchange: (values: string[]) => void;
    /** Optional cleanup applied to each committed value (e.g. strip a leading #). */
    transform?: (raw: string) => string;
    /** Optional per-chip validity flag — invalid chips get an error style. */
    invalid?: (value: string) => boolean;
    /** Render chips in a monospace/truncated style (for keys, relays). */
    mono?: boolean;
  }

  let { values, placeholder, onchange, transform, invalid, mono = false }: Props = $props();
  let draft = $state('');

  function commit(): void {
    const parts = draft
      .split(',')
      .map((p) => (transform ? transform(p.trim()) : p.trim()))
      .filter(Boolean);
    if (parts.length === 0) return;
    const next = [...values];
    for (const p of parts) if (!next.includes(p)) next.push(p);
    onchange(next);
    draft = '';
  }

  function remove(value: string): void {
    onchange(values.filter((v) => v !== value));
  }

  function onkeydown(e: KeyboardEvent): void {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      commit();
    } else if (e.key === 'Backspace' && draft === '' && values.length > 0) {
      remove(values[values.length - 1]);
    }
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
    onblur={commit}
    spellcheck="false"
    autocapitalize="off"
    autocomplete="off"
  />
</div>

<style>
  .taginput {
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
</style>
