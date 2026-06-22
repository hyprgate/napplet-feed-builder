<script lang="ts">
  import { identity, intentOpen } from '@napplet/sdk';
  import { nfeedToFeedPayload } from '@hyprgate/utils';
  import type { Filter } from 'nostr-tools';
  import {
    advToFilter,
    canRepresentAsBasic,
    createFeedBuilderStore,
    emptyAdvFilter,
    encodeEntity,
    filterToAdv,
    isValidName,
    pubkeysFromInputs,
    normalizeRelayInput,
    preferredViewForFilters,
    sanitizeFilter,
    isFilterEmpty,
    validateRelayInput,
    validateRelayInputs,
    validateFilterArray,
    type AdvFilter,
    type EntityType,
    type SavedEntity,
  } from './lib/filters';
  import FilterEditor, { type BasicBlock } from './components/FilterEditor.svelte';
  import AdvancedFilterEditor from './components/AdvancedFilterEditor.svelte';
  import TagInput from './components/TagInput.svelte';
  import { searchRelaySuggestions } from './lib/relay-suggestions';

  let version = $state(0);
  const store = createFeedBuilderStore(() => (version += 1));

  const snap = $derived.by(() => {
    version;
    const s = store.state;
    return {
      loading: s.loading,
      loaded: s.loaded,
      error: s.error,
      entities: s.entities,
      publishing: s.publishing,
    };
  });

  type View = 'basic' | 'advanced' | 'json';
  type Mode = 'filter' | 'feed';

  let view = $state<View>('basic');
  let mode = $state<Mode>('filter');
  let name = $state('');
  let nameTouched = $state(false);
  let relays = $state<string[]>([]);
  let blocks = $state<BasicBlock[]>([emptyBlock()]);
  let advFilters = $state<AdvFilter[]>([emptyAdvFilter()]);
  let jsonText = $state('[\n  {}\n]');
  let selectedAddress = $state<string | null>(null);
  let status = $state<string | null>(null);

  function emptyBlock(): BasicBlock {
    return { kinds: [], authors: [], hashtags: [] };
  }

  function blockToFilter(block: BasicBlock): Filter {
    return sanitizeFilter({
      kinds: block.kinds,
      authors: pubkeysFromInputs(block.authors).pubkeys,
      ['#t']: block.hashtags,
    } as Filter);
  }

  function filterToBlock(filter: Filter): BasicBlock {
    const f = filter as Filter & { ['#t']?: string[] };
    return {
      kinds: f.kinds ?? [],
      authors: f.authors ?? [],
      hashtags: f['#t'] ?? [],
    };
  }

  // The relay list applies for everything except a single Basic filter.
  const relaysVisible = $derived(view !== 'basic' || mode === 'feed');
  const basicAvailable = $derived(canRepresentAsBasic(currentFilters()));

  // Live JSON validation (only meaningful in the JSON view).
  const jsonValidation = $derived(view === 'json' ? validateFilterArray(jsonText) : null);

  // Resolve the current draft into filters + relays, or an error string.
  const built = $derived.by((): { filters: Filter[]; relays: string[]; error: string | null } => {
    const relayCheck = validateRelayInputs(relaysVisible ? relays : []);
    const effRelays = relayCheck.relays;
    if (relayCheck.invalid.length > 0) {
      return { filters: [], relays: effRelays, error: `Invalid relay URL: ${relayCheck.invalid[0]}` };
    }
    if (view === 'json') {
      const v = validateFilterArray(jsonText);
      if (!v.ok) {
        return { filters: [], relays: effRelays, error: v.errors[0] ?? 'Invalid filters' };
      }
      const filters = v.filters.filter((f) => !isFilterEmpty(f));
      if (filters.length === 0) return { filters, relays: effRelays, error: 'Add at least one filter constraint' };
      return { filters, relays: effRelays, error: null };
    }
    const invalidAuthors = invalidAuthorInputs();
    if (invalidAuthors.length > 0) {
      return { filters: [], relays: effRelays, error: `Invalid pubkey: ${invalidAuthors[0]}` };
    }
    const rawFilters = view === 'advanced'
      ? advFilters.map(advToFilter)
      : (mode === 'feed' ? blocks : blocks.slice(0, 1)).map(blockToFilter);
    const filters = rawFilters.map(sanitizeFilter).filter((f) => !isFilterEmpty(f));
    if (filters.length === 0) return { filters, relays: effRelays, error: 'Add at least one filter constraint' };
    return { filters, relays: effRelays, error: null };
  });

  const preview = $derived.by((): { type: EntityType; encoded: string } | null => {
    if (built.error || built.filters.length === 0) return null;
    try {
      return encodeEntity(built.filters, built.relays);
    } catch {
      return null;
    }
  });

  const nameValid = $derived(isValidName(name));
  const nameCollision = $derived(snap.entities.some((e) => e.identifier === name && e.address !== selectedAddress));
  const canSave = $derived(!snap.publishing && nameValid && !built.error && built.filters.length > 0);

  // Collect the active view's filters as plain NIP-01 filters, for converting
  // to another view. Lenient JSON parse so structure survives a switch.
  function currentFilters(): Filter[] {
    if (view === 'advanced') return advFilters.map(advToFilter);
    if (view === 'json') {
      try {
        const parsed = JSON.parse(jsonText);
        return Array.isArray(parsed) ? parsed.map((f) => sanitizeFilter(f as Filter)) : [];
      } catch {
        return [];
      }
    }
    return (mode === 'feed' ? blocks : blocks.slice(0, 1)).map(blockToFilter);
  }

  function invalidAuthorInputs(): string[] {
    if (view === 'advanced') {
      return advFilters.flatMap((filter) => pubkeysFromInputs(filter.authors).invalid);
    }
    if (view === 'basic') {
      const activeBlocks = mode === 'feed' ? blocks : blocks.slice(0, 1);
      return activeBlocks.flatMap((block) => pubkeysFromInputs(block.authors).invalid);
    }
    return [];
  }

  function loadFilters(filters: Filter[]): void {
    blocks = filters.length > 0 ? filters.map(filterToBlock) : [emptyBlock()];
    advFilters = filters.length > 0 ? filters.map(filterToAdv) : [emptyAdvFilter()];
    jsonText = JSON.stringify(filters, null, 2);
  }

  function switchView(next: View): void {
    if (next === view) return;
    const filters = currentFilters();
    if (next === 'basic') {
      if (!canRepresentAsBasic(filters)) {
        status = 'Basic view cannot represent these filters without dropping constraints';
        return;
      }
      blocks = filters.length > 0 ? filters.map(filterToBlock) : [emptyBlock()];
      mode = filters.length > 1 || relays.length > 0 ? 'feed' : 'filter';
    } else if (next === 'advanced') {
      advFilters = filters.length > 0 ? filters.map(filterToAdv) : [emptyAdvFilter()];
    } else {
      jsonText = JSON.stringify(filters, null, 2);
    }
    view = next;
  }

  function setMode(next: Mode): void {
    if (next === mode) return;
    mode = next;
    if (next === 'filter') relays = [];
    if (blocks.length === 0) blocks = [emptyBlock()];
  }

  function newEntity(): void {
    selectedAddress = null;
    name = '';
    nameTouched = false;
    mode = 'filter';
    relays = [];
    blocks = [emptyBlock()];
    advFilters = [emptyAdvFilter()];
    jsonText = '[\n  {}\n]';
    status = null;
  }

  function loadEntity(entity: SavedEntity): void {
    selectedAddress = entity.address;
    name = entity.identifier;
    nameTouched = true;
    relays = [...entity.relays];
    mode = entity.relays.length > 0 || entity.filters.length > 1 ? 'feed' : 'filter';
    loadFilters(entity.filters);
    view = preferredViewForFilters(entity.filters);
    status = null;
  }

  function addBlock(): void {
    blocks = [...blocks, emptyBlock()];
  }
  function removeBlock(index: number): void {
    blocks = blocks.filter((_, i) => i !== index);
    if (blocks.length === 0) blocks = [emptyBlock()];
  }
  function updateBlock(index: number, block: BasicBlock): void {
    blocks = blocks.map((b, i) => (i === index ? block : b));
  }

  function addAdvFilter(): void {
    advFilters = [...advFilters, emptyAdvFilter()];
  }
  function removeAdvFilter(index: number): void {
    advFilters = advFilters.filter((_, i) => i !== index);
    if (advFilters.length === 0) advFilters = [emptyAdvFilter()];
  }
  function updateAdvFilter(index: number, filter: AdvFilter): void {
    advFilters = advFilters.map((f, i) => (i === index ? filter : f));
  }

  async function save(): Promise<void> {
    status = null;
    try {
      const result = await store.save({ name, filters: built.filters, relays: built.relays });
      selectedAddress = result.address;
      nameTouched = true;
      status = `Saved “${name}”`;
    } catch (error) {
      status = error instanceof Error ? error.message : 'Save failed';
    }
  }

  async function del(entity: SavedEntity, e: MouseEvent): Promise<void> {
    e.stopPropagation();
    try {
      await store.remove(entity.address);
      if (selectedAddress === entity.address) newEntity();
      status = `Deleted “${entity.identifier}”`;
    } catch (error) {
      status = error instanceof Error ? error.message : 'Delete failed';
    }
  }

  /** Minimal shell handshake handle (shim-installed global). */
  function getShell(): { ready(): Promise<unknown>; supports(d: string, p?: string): boolean } | null {
    return (globalThis as unknown as {
      napplet?: { shell?: { ready(): Promise<unknown>; supports(d: string, p?: string): boolean } };
    }).napplet?.shell ?? null;
  }

  /**
   * Open a saved entity as a LIVE feed via the NAP-INTENT service (FEED-01).
   * Maps the entity to a FeedIntentPayload (nfeed → relay-pin, nfilter(s) →
   * outbox) through the shared adapter, then intentOpen('feed', payload) creates
   * a dedicated feed window. Gated behind shell.ready() + supports('intent')
   * (Phase 87 supports-gate) so it degrades gracefully when intent is absent.
   */
  async function openFeed(entity: SavedEntity, e: MouseEvent): Promise<void> {
    e.stopPropagation();
    const shell = getShell();
    try {
      await shell?.ready();
      if (!shell?.supports('intent')) {
        status = 'Opening feeds is not supported by this shell';
        return;
      }
      await intentOpen('feed', nfeedToFeedPayload(entity));
      status = `Opened “${entity.identifier}”`;
    } catch (error) {
      status = error instanceof Error ? error.message : 'Open feed failed';
    }
  }

  async function copyEncoded(): Promise<void> {
    if (!preview) return;
    try {
      await navigator.clipboard.writeText(preview.encoded);
      status = 'Copied to clipboard';
    } catch {
      status = 'Copy failed';
    }
  }

  $effect(() => {
    void (async () => {
      try {
        const pubkey = await identity.getPublicKey();
        store.init(pubkey);
      } catch (error) {
        status = error instanceof Error ? error.message : 'Could not load identity';
      }
    })();
    return () => store.destroy();
  });
</script>

<main>
  <aside class="rail">
    <header class="rail-head">
      <h1>Feeds &amp; Filters</h1>
      {#if snap.loading}<span class="muted">loading…</span>{/if}
    </header>
    <button type="button" class="new-btn" class:active={selectedAddress === null} onclick={newEntity}>＋ New</button>
    <div class="saved-list">
      {#if snap.entities.length === 0 && snap.loaded}
        <p class="empty">No saved filters yet. Build one and save it.</p>
      {/if}
      {#each snap.entities as entity (entity.address)}
        <div class="saved-item" class:active={selectedAddress === entity.address}>
          <button type="button" class="saved-open" onclick={() => loadEntity(entity)}>
            <span class="saved-main">
              <span class="saved-name" title={entity.identifier}>{entity.identifier}</span>
              <span class="badge badge-{entity.type}">{entity.type}</span>
            </span>
            <span class="saved-meta">
              {entity.filters.length} filter{entity.filters.length === 1 ? '' : 's'}{#if entity.relays.length} · {entity.relays.length} relay{entity.relays.length === 1 ? '' : 's'}{/if}
            </span>
          </button>
          <button type="button" class="saved-open-feed" aria-label={`Open ${entity.identifier} as feed`} title="Open as live feed" onclick={(e) => openFeed(entity, e)}>▶</button>
          <button type="button" class="saved-del" aria-label={`Delete ${entity.identifier}`} onclick={(e) => del(entity, e)}>✕</button>
        </div>
      {/each}
    </div>
  </aside>

  <section class="editor">
    <div class="toolbar">
      <div class="seg" role="tablist" aria-label="View">
        <button
          type="button"
          role="tab"
          class:active={view === 'basic'}
          disabled={!basicAvailable}
          aria-disabled={!basicAvailable}
          title={basicAvailable ? 'Basic view' : 'Advanced-only filters cannot be represented in Basic'}
          onclick={() => switchView('basic')}
        >Basic</button>
        <button type="button" role="tab" class:active={view === 'advanced'} onclick={() => switchView('advanced')}>Advanced</button>
        <button type="button" role="tab" class:active={view === 'json'} onclick={() => switchView('json')}>JSON</button>
      </div>
      {#if view === 'basic'}
        <div class="seg" role="tablist" aria-label="Kind of entity">
          <button type="button" role="tab" class:active={mode === 'filter'} onclick={() => setMode('filter')}>Single filter</button>
          <button type="button" role="tab" class:active={mode === 'feed'} onclick={() => setMode('feed')}>Feed / collection</button>
        </div>
      {/if}
      <div class="spacer"></div>
      {#if preview}
        <span class="type-indicator" title={preview.encoded}>
          will save as <strong>{preview.type}</strong>
        </span>
      {/if}
    </div>

    <div class="name-row">
      <label class="name-field">
        <span class="field-label">Name <span class="muted">(the d-tag — no spaces)</span></span>
        <input
          value={name}
          placeholder="morning-reads"
          spellcheck="false"
          autocapitalize="off"
          autocomplete="off"
          class:bad={nameTouched && !nameValid}
          oninput={(e) => { nameTouched = true; name = (e.currentTarget as HTMLInputElement).value; }}
        />
      </label>
      <div class="name-hints">
        {#if nameTouched && !nameValid}
          <span class="bad">No spaces; letters, digits and symbols only.</span>
        {:else if nameCollision}
          <span class="warn">A filter named “{name}” exists — saving replaces it.</span>
        {/if}
      </div>
    </div>

    <div class="body">
      {#if view === 'basic'}
        {#if mode === 'filter'}
          <FilterEditor block={blocks[0]} onchange={(b) => updateBlock(0, b)} />
        {:else}
          {#each blocks as block, i (i)}
            <div class="block-card">
              <FilterEditor
                {block}
                label={`Filter ${i + 1}`}
                onchange={(b) => updateBlock(i, b)}
                onremove={blocks.length > 1 ? () => removeBlock(i) : undefined}
              />
            </div>
          {/each}
          <button type="button" class="add-block" onclick={addBlock}>＋ Add filter</button>
        {/if}
      {:else if view === 'advanced'}
        {#each advFilters as filter, i (i)}
          <AdvancedFilterEditor
            {filter}
            label={`Filter #${i + 1}`}
            onchange={(f) => updateAdvFilter(i, f)}
            onremove={advFilters.length > 1 ? () => removeAdvFilter(i) : undefined}
          />
        {/each}
        <button type="button" class="add-block" onclick={addAdvFilter}>＋ Add filter</button>
      {:else}
        <div class="field">
          <span class="field-label">Filters (JSON array) <span class="muted">limit is ignored on save</span></span>
          <textarea
            bind:value={jsonText}
            spellcheck="false"
            autocapitalize="off"
            autocomplete="off"
            rows="14"
            class:bad={jsonValidation && !jsonValidation.ok}
          ></textarea>
          {#if jsonValidation && !jsonValidation.ok}
            <ul class="json-errors">
              {#each jsonValidation.errors as err (err)}<li>{err}</li>{/each}
            </ul>
          {/if}
        </div>
      {/if}

      {#if relaysVisible}
        <div class="field relays-field">
          <span class="field-label">Relays <span class="muted">(optional — adding any makes this an nfeed)</span></span>
          <TagInput
            values={relays}
            placeholder="wss://relay.example…"
            mono
            onchange={(next) => (relays = next.map(normalizeRelayInput).filter(Boolean))}
            transform={normalizeRelayInput}
            suggest={searchRelaySuggestions}
            onfocusdraft={(draft) => draft.trim() === '' ? 'wss://' : draft}
            onblurdraft={(draft) => draft.trim().toLowerCase() === 'wss://' ? '' : draft}
            invalid={(v) => validateRelayInput(v).error !== null}
          />
        </div>
      {/if}
    </div>

    <footer class="actions">
      <div class="status" aria-live="polite">
        {#if snap.error}<span class="bad">{snap.error}</span>
        {:else if built.error && (nameTouched || view !== 'basic')}<span class="muted">{built.error}</span>
        {:else if status}<span class:bad={status.toLowerCase().includes('fail')}>{status}</span>{/if}
      </div>
      {#if preview}
        <button type="button" class="preview-btn" onclick={copyEncoded} title="Copy encoded entity">
          {preview.encoded.slice(0, 14)}… ⧉
        </button>
      {/if}
      <button type="button" class="save" disabled={!canSave} onclick={save}>
        {#if snap.publishing}Saving…{:else if selectedAddress}Update{:else}Save{/if}
      </button>
    </footer>
  </section>
</main>

<style>
  :global(body) {
    margin: 0;
    background: var(--hg-bg-base, #050505);
    color: var(--hg-text-primary, #f2efe7);
    font: 13px/1.5 var(--hg-font-body, 'JetBrains Mono', ui-monospace, monospace);
  }

  main {
    display: grid;
    grid-template-columns: 240px 1fr;
    height: 100vh;
    box-sizing: border-box;
  }

  .rail {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 14px 12px;
    border-right: 1px solid var(--hg-border-muted, #242424);
    min-height: 0;
  }
  .rail-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
  }
  h1 {
    margin: 0;
    font-size: 14px;
    letter-spacing: 0.03em;
  }
  .new-btn {
    text-align: left;
    padding: 7px 10px;
    border: 1px dashed var(--hg-border, #303030);
    border-radius: 5px;
    background: var(--hg-surface, #101010);
    color: var(--hg-text-muted, #b8b1a4);
    cursor: pointer;
    font: inherit;
    font-size: 12px;
  }
  .new-btn:hover, .new-btn.active {
    border-style: solid;
    border-color: var(--hg-accent-green, #9be564);
    color: var(--hg-text-primary, #f2efe7);
  }
  .saved-list {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 5px;
  }
  .empty {
    color: var(--hg-text-muted, #b8b1a4);
    font-size: 11px;
    line-height: 1.5;
  }
  .saved-item {
    position: relative;
    border: 1px solid var(--hg-border-muted, #242424);
    border-radius: 5px;
    background: var(--hg-surface, #101010);
  }
  .saved-item:hover { border-color: var(--hg-border, #303030); }
  .saved-item.active { border-color: var(--hg-accent-cyan, #82d8f7); }
  .saved-open {
    display: grid;
    gap: 3px;
    width: 100%;
    text-align: left;
    padding: 7px 9px;
    border: none;
    background: none;
    color: var(--hg-text-primary, #f2efe7);
    cursor: pointer;
    font: inherit;
  }
  .saved-main {
    display: flex;
    align-items: center;
    gap: 6px;
    justify-content: space-between;
    padding-right: 16px;
  }
  .saved-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 12px;
  }
  .badge {
    flex-shrink: 0;
    padding: 1px 6px;
    border-radius: 8px;
    font-size: 9px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    background: var(--hg-bg-base, #050505);
    color: var(--hg-text-muted, #b8b1a4);
    border: 1px solid var(--hg-border-muted, #242424);
  }
  .badge-nfeed { color: var(--hg-accent-green, #9be564); border-color: var(--hg-accent-green, #9be564); }
  .badge-nfilters { color: var(--hg-accent-cyan, #82d8f7); border-color: var(--hg-accent-cyan, #82d8f7); }
  .saved-meta {
    color: var(--hg-text-muted, #b8b1a4);
    font-size: 10px;
  }
  .saved-del {
    position: absolute;
    top: 5px;
    right: 5px;
    padding: 2px 4px;
    border: none;
    background: none;
    color: var(--hg-text-muted, #b8b1a4);
    font: inherit;
    font-size: 10px;
    line-height: 1;
    cursor: pointer;
  }
  .saved-del:hover { color: var(--hg-accent-red, #ff6b6b); }
  .saved-open-feed {
    position: absolute;
    top: 5px;
    right: 22px;
    padding: 2px 4px;
    border: none;
    background: none;
    color: var(--hg-text-muted, #b8b1a4);
    font: inherit;
    font-size: 10px;
    line-height: 1;
    cursor: pointer;
  }
  .saved-open-feed:hover { color: var(--hg-accent-green, #9be564); }

  .editor {
    display: flex;
    flex-direction: column;
    min-height: 0;
    padding: 14px 16px;
    gap: 12px;
  }
  .toolbar {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
  }
  .spacer { flex: 1; }
  .seg {
    display: inline-flex;
    border: 1px solid var(--hg-border, #303030);
    border-radius: 6px;
    overflow: hidden;
  }
  .seg button {
    padding: 5px 11px;
    border: none;
    background: var(--hg-surface, #101010);
    color: var(--hg-text-muted, #b8b1a4);
    cursor: pointer;
    font: inherit;
    font-size: 11px;
  }
  .seg button + button { border-left: 1px solid var(--hg-border, #303030); }
  .seg button.active {
    background: var(--hg-accent-cyan, #82d8f7);
    color: var(--hg-bg-base, #050505);
  }
  .seg button:disabled {
    cursor: not-allowed;
    opacity: 0.45;
  }
  .type-indicator {
    font-size: 11px;
    color: var(--hg-text-muted, #b8b1a4);
  }
  .type-indicator strong { color: var(--hg-accent-green, #9be564); }

  .name-row {
    display: grid;
    gap: 4px;
  }
  .name-field { display: grid; gap: 4px; }
  .field-label {
    color: var(--hg-text-muted, #b8b1a4);
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .field-label .muted { text-transform: none; letter-spacing: 0; }
  .muted { color: var(--hg-text-muted, #b8b1a4); }
  input, textarea {
    width: 100%;
    box-sizing: border-box;
    border: 1px solid var(--hg-border, #303030);
    border-radius: 5px;
    background: var(--hg-surface, #101010);
    color: var(--hg-text-primary, #f2efe7);
    font: inherit;
    font-size: 12px;
    padding: 7px 9px;
  }
  input:focus, textarea:focus { outline: none; border-color: var(--hg-accent-cyan, #82d8f7); }
  input.bad { border-color: var(--hg-accent-red, #ff6b6b); }
  textarea { resize: vertical; line-height: 1.5; }
  textarea.bad { border-color: var(--hg-accent-red, #ff6b6b); }
  .json-errors {
    margin: 6px 0 0;
    padding-left: 18px;
    color: var(--hg-accent-red, #ff6b6b);
    font-size: 11px;
    line-height: 1.6;
  }
  .name-hints { font-size: 11px; min-height: 16px; }
  .bad { color: var(--hg-accent-red, #ff6b6b); }
  .warn { color: var(--hg-accent-amber, #d6ae68); }

  .body {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .block-card {
    padding: 12px;
    border: 1px solid var(--hg-border-muted, #242424);
    border-radius: 6px;
  }
  .field { display: grid; gap: 5px; }
  .add-block {
    align-self: flex-start;
    padding: 6px 12px;
    border: 1px dashed var(--hg-border, #303030);
    border-radius: 5px;
    background: var(--hg-surface, #101010);
    color: var(--hg-text-muted, #b8b1a4);
    cursor: pointer;
    font: inherit;
    font-size: 11px;
  }
  .add-block:hover { border-color: var(--hg-accent-cyan, #82d8f7); color: var(--hg-text-primary, #f2efe7); }
  .relays-field { padding-top: 4px; }

  .actions {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .status { flex: 1; font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .preview-btn {
    padding: 6px 10px;
    border: 1px solid var(--hg-border, #303030);
    border-radius: 5px;
    background: var(--hg-surface, #101010);
    color: var(--hg-text-muted, #b8b1a4);
    cursor: pointer;
    font: inherit;
    font-size: 11px;
  }
  .preview-btn:hover { border-color: var(--hg-accent-cyan, #82d8f7); color: var(--hg-text-primary, #f2efe7); }
  .save {
    height: 32px;
    padding: 0 20px;
    border: 1px solid var(--hg-accent-green, #9be564);
    border-radius: 5px;
    background: var(--hg-surface, #101010);
    color: var(--hg-accent-green, #9be564);
    cursor: pointer;
    font: inherit;
    font-size: 12px;
  }
  .save:hover:not(:disabled) { background: var(--hg-accent-green, #9be564); color: var(--hg-bg-base, #050505); }
  .save:disabled { opacity: 0.45; cursor: not-allowed; }
</style>
