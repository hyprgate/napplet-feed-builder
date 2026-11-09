<script lang="ts">
  import { identity, intent } from '@napplet/sdk';
  import { parseIntentResult } from '@hyprgate/types';
  import { invokeNappletIntent, createFeedIntentRequest, createProfileIntentRequest, nfeedToFeedPayload, pubkeyColorStyle } from '@hyprgate/utils';
  import type { Filter } from 'nostr-tools/filter';
  import { npubEncode } from 'nostr-tools/nip19';
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
  import { describeFilters } from './lib/filter-summary';
  import { relativeTime, watchMatches, type MatchPreviewState } from './lib/match-preview';
  import { createPeopleDirectory } from './lib/people';

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
  let statusIsError = $state(false);
  let confirmingDelete = $state<string | null>(null);
  let matches = $state<MatchPreviewState | null>(null);

  let peopleVersion = $state(0);
  const peopleDirectory = createPeopleDirectory(() => (peopleVersion += 1));

  function nameFor(pubkey: string): string {
    peopleVersion;
    return peopleDirectory.nameFor(pubkey);
  }

  function openProfile(pubkey: string): void {
    const request = createProfileIntentRequest({ pubkey });
    if (request) void invokeNappletIntent(request).catch(() => {});
  }

  function friendlyError(error: unknown, fallback: string): string {
    const reason = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
    if (/read.?only/i.test(reason)) {
      return "This session is read-only, so it can't sign. Sign in with a key or a signer to save.";
    }
    return reason || fallback;
  }

  function setStatus(message: string | null, isError = false): void {
    status = message;
    statusIsError = isError;
  }

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
      if (filters.length === 0) return { filters, relays: effRelays, error: 'Choose at least one thing to show, an author or a hashtag.' };
      return { filters, relays: effRelays, error: null };
    }
    const invalidAuthors = invalidAuthorInputs();
    if (invalidAuthors.length > 0) {
      return { filters: [], relays: effRelays, error: `"${invalidAuthors[0]}" isn't a key we recognize. Pick a person from the list, or paste an npub.` };
    }
    const rawFilters = view === 'advanced'
      ? advFilters.map(advToFilter)
      : (mode === 'feed' ? blocks : blocks.slice(0, 1)).map(blockToFilter);
    const filters = rawFilters.map(sanitizeFilter).filter((f) => !isFilterEmpty(f));
    if (filters.length === 0) return { filters, relays: effRelays, error: 'Choose at least one thing to show, an author or a hashtag.' };
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
  const saveBlocker = $derived(
    snap.publishing ? null
    : built.error ? built.error
    : !name.trim() ? 'Give it a name to save it.'
    : !nameValid ? 'Names use letters, digits and symbols, with no spaces.'
    : null,
  );
  const summary = $derived(built.error ? '' : describeFilters(built.filters, nameFor));
  const selectedEntity = $derived(snap.entities.find((entity) => entity.address === selectedAddress) ?? null);
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
        setStatus('Basic view would drop some of these filters. Stay in Advanced or JSON to keep them.');
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
    setStatus(null);
    store.clearError();
  }

  function loadEntity(entity: SavedEntity): void {
    selectedAddress = entity.address;
    name = entity.identifier;
    nameTouched = true;
    relays = [...entity.relays];
    mode = entity.relays.length > 0 || entity.filters.length > 1 ? 'feed' : 'filter';
    loadFilters(entity.filters);
    view = preferredViewForFilters(entity.filters);
    setStatus(null);
    store.clearError();
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
    setStatus(null);
    try {
      const result = await store.save({ name, filters: built.filters, relays: built.relays });
      selectedAddress = result.address;
      nameTouched = true;
      setStatus(`Saved “${name}”`);
    } catch (error) {
      // Shown here, so the store's copy of it doesn't linger across other drafts.
      store.clearError();
      setStatus(friendlyError(error, "Couldn't save this."), true);
    }
  }

  async function del(entity: SavedEntity, e: MouseEvent): Promise<void> {
    e.stopPropagation();
    // Deleting publishes a kind-5 request that can't be taken back, so it takes two steps.
    if (confirmingDelete !== entity.address) {
      confirmingDelete = entity.address;
      return;
    }
    confirmingDelete = null;
    try {
      await store.remove(entity.address);
      if (selectedAddress === entity.address) newEntity();
      setStatus(`Deleted “${entity.identifier}”`);
    } catch (error) {
      store.clearError();
      setStatus(friendlyError(error, "Couldn't delete this."), true);
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
   * outbox) through the shared adapter, then a canonical feed request creates
   * a dedicated feed window. Gated behind shell.ready() + supports('intent')
   * (Phase 87 supports-gate) so it degrades gracefully when intent is absent.
   */
  async function openFeed(entity: SavedEntity, e: Event): Promise<void> {
    e.stopPropagation();
    const shell = getShell();
    try {
      await shell?.ready();
      if (!shell?.supports('intent')) {
        setStatus('Opening feeds is not supported here.', true);
        return;
      }
      const request = createFeedIntentRequest(nfeedToFeedPayload(entity));
      if (!request) {
        setStatus("This one can't be opened as a feed.", true);
        return;
      }
      const result = parseIntentResult(await invokeNappletIntent(request));
      if (!result || result.archetype !== request.archetype || result.action !== (request.action ?? 'open') || !result.ok) {
        setStatus('Opening feeds is not supported here.', true);
        return;
      }
      setStatus(`Opening “${entity.identifier}”`);
    } catch (error) {
      setStatus(friendlyError(error, "Couldn't open this feed."), true);
    }
  }

  async function copyEncoded(): Promise<void> {
    if (!preview) return;
    try {
      await navigator.clipboard.writeText(preview.encoded);
      setStatus('Copied');
    } catch {
      setStatus("Couldn't copy.", true);
    }
  }

  $effect(() => {
    void (async () => {
      try {
        const pubkey = await identity.getPublicKey();
        store.init(pubkey);
      } catch (error) {
        setStatus(friendlyError(error, "Couldn't load your identity."), true);
      }
    })();
    return () => {
      store.destroy();
      peopleDirectory.destroy();
    };
  });

  // Names for everyone on screen: saved rows, draft authors and preview matches.
  $effect(() => {
    const pubkeys = [
      ...snap.entities.flatMap((entity) => entity.filters.flatMap((filter) => filter.authors ?? [])),
      ...built.filters.flatMap((filter) => filter.authors ?? []),
      ...blocks.flatMap((block) => pubkeysFromInputs(block.authors).pubkeys),
      ...advFilters.flatMap((filter) => pubkeysFromInputs(filter.authors).pubkeys),
      ...(matches?.latest.map((event) => event.pubkey) ?? []),
    ];
    peopleDirectory.watch(pubkeys);
  });

  const filtersKey = $derived(built.error ? '' : JSON.stringify(built.filters));
  $effect(() => {
    const key = filtersKey;
    matches = null;
    if (!key) return;
    const filters = JSON.parse(key) as Filter[];
    let subscription: { close(): void } | null = null;
    // Wait for typing to pause, so each keystroke doesn't open a subscription.
    const timer = setTimeout(() => {
      matches = { count: 0, latest: [], settled: false };
      subscription = watchMatches(filters, (next) => { matches = next; });
    }, 400);
    return () => {
      clearTimeout(timer);
      subscription?.close();
    };
  });
</script>

<main>
  <aside class="rail">
    <header class="rail-head">
      <h1>Feeds &amp; Filters</h1>
      {#if snap.loading}<span class="muted">Loading...</span>{/if}
    </header>
    <button type="button" class="new-btn" class:active={selectedAddress === null} onclick={newEntity}>＋ New</button>
    <div class="saved-list">
      {#if snap.entities.length === 0 && snap.loaded}
        <p class="empty">Nothing saved yet. What you save shows up here, ready to open as a timeline.</p>
      {/if}
      {#each snap.entities as entity (entity.address)}
        <div class="saved-item" class:active={selectedAddress === entity.address}>
          <button type="button" class="saved-open" onclick={() => loadEntity(entity)}>
            <span class="saved-main">
              <span class="saved-name" title={entity.identifier}>{entity.identifier}</span>
            </span>
            <span class="saved-meta">
              {describeFilters(entity.filters, nameFor)}{entity.relays.length ? ` · ${entity.relays.length} ${entity.relays.length === 1 ? 'relay' : 'relays'}` : ''}
            </span>
          </button>
          <div class="saved-actions">
            <button type="button" class="saved-action" aria-label={`Open ${entity.identifier} as feed`} title="Open as a timeline" onclick={(e) => openFeed(entity, e)}>Open</button>
            <button
              type="button"
              class="saved-action danger"
              class:armed={confirmingDelete === entity.address}
              aria-label={confirmingDelete === entity.address ? `Confirm deleting ${entity.identifier}` : `Delete ${entity.identifier}`}
              onclick={(e) => del(entity, e)}
              onblur={() => { if (confirmingDelete === entity.address) confirmingDelete = null; }}
            >{confirmingDelete === entity.address ? 'Really delete?' : 'Delete'}</button>
          </div>
        </div>
      {/each}
    </div>
  </aside>

  <section class="editor">
    <p class="intro">Choose what to show and who from. Save it and it's ready to open as a timeline.</p>

    <div class="toolbar">
      <div class="seg" role="group" aria-label="Editor">
        <button
          type="button"
          class:active={view === 'basic'}
          aria-pressed={view === 'basic'}
          disabled={!basicAvailable}
          title={basicAvailable ? 'Choose from common options' : 'These filters need Advanced or JSON'}
          onclick={() => switchView('basic')}
        >Basic</button>
        <button type="button" class:active={view === 'advanced'} aria-pressed={view === 'advanced'} onclick={() => switchView('advanced')}>Advanced</button>
        <button type="button" class:active={view === 'json'} aria-pressed={view === 'json'} onclick={() => switchView('json')}>JSON</button>
      </div>
      {#if view === 'basic'}
        <div class="seg" role="group" aria-label="How many filters">
          <button type="button" class:active={mode === 'filter'} aria-pressed={mode === 'filter'} title="One filter" onclick={() => setMode('filter')}>One filter</button>
          <button type="button" class:active={mode === 'feed'} aria-pressed={mode === 'feed'} title="Combine several filters, and optionally pin relays" onclick={() => setMode('feed')}>Several, or pinned relays</button>
        </div>
      {/if}
    </div>

    <div class="name-row">
      <label class="name-field">
        <span class="field-label">Name</span>
        <input
          value={name}
          placeholder="morning-reads"
          spellcheck="false"
          autocapitalize="off"
          autocomplete="off"
          class:bad={nameTouched && !nameValid}
          oninput={(e) => { nameTouched = true; name = (e.currentTarget as HTMLInputElement).value.replace(/\s+/g, '-'); }}
        />
      </label>
      <div class="name-hints">
        {#if nameTouched && !nameValid}
          <span class="bad">Letters, digits and symbols only.</span>
        {:else if nameCollision}
          <span class="warn">You already have “{name}”. Saving replaces it.</span>
        {/if}
      </div>
    </div>

    <div class="workbench">
    <div class="body">
      {#if view === 'basic'}
        {#if mode === 'filter'}
          <FilterEditor block={blocks[0]} {nameFor} onopenprofile={openProfile} onchange={(b) => updateBlock(0, b)} />
        {:else}
          {#each blocks as block, i (i)}
            <div class="block-card">
              <FilterEditor
                {block}
                label={`Filter ${i + 1}`}
                {nameFor}
                onopenprofile={openProfile}
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
            {nameFor}
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
          <span class="field-label">Relays <span class="muted">(optional: only read from these)</span></span>
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

    <aside class="matches" aria-label="What this matches">
      <h2>What this matches</h2>
      {#if summary}
        <p class="summary">{summary}{#if built.relays.length > 0}, only from {built.relays.length} {built.relays.length === 1 ? 'relay' : 'relays'}{/if}</p>
        {#if matches === null || (!matches.settled && matches.count === 0)}
          <p class="muted" role="status">Looking on your relays...</p>
        {:else if matches.count === 0}
          <p class="muted" role="status">Nothing on your relays right now. New matches will show up in the timeline.</p>
        {:else}
          <p class="muted" role="status">{matches.count} found so far{matches.settled ? '' : '...'}</p>
          <ul class="match-list">
            {#each matches.latest as match (match.id)}
              <li>
                <div class="match-head">
                  <button type="button" class="match-author" style={pubkeyColorStyle(match.pubkey)} title={npubEncode(match.pubkey)} onclick={() => openProfile(match.pubkey)}>{nameFor(match.pubkey)}</button>
                  <span class="muted">{relativeTime(match.created_at)}</span>
                </div>
                <p class="match-text">{match.content || `Event kind ${match.kind}`}</p>
              </li>
            {/each}
          </ul>
        {/if}
      {:else}
        <p class="muted">Pick something to show and you'll see what it finds here, before you save.</p>
      {/if}
    </aside>
    </div>

    <footer class="actions">
      <button type="button" class="save" disabled={!canSave} onclick={save}>
        {#if snap.publishing}Saving...{:else if selectedAddress}Update{:else}Save{/if}
      </button>
      {#if selectedEntity}
        <button type="button" class="secondary-btn" onclick={(e) => openFeed(selectedEntity, e)}>Open as timeline</button>
      {/if}
      <div class="status" aria-live="polite">
        {#if snap.error}<span class="bad">{friendlyError(snap.error, snap.error)}</span>
        {:else if status && statusIsError}<span class="bad">{status}</span>
        {:else if saveBlocker}<span class="muted">{saveBlocker}</span>
        {:else if status}<span>{status}</span>{/if}
      </div>
      {#if preview}
        <button type="button" class="preview-btn" onclick={copyEncoded} title={preview.encoded}>
          Copy {preview.type}
        </button>
      {/if}
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
    grid-template-columns: 240px minmax(0, 1fr);
    height: 100vh;
    box-sizing: border-box;
  }

  main :global(button:focus-visible),
  main :global(summary:focus-visible) {
    outline: 2px solid var(--hg-accent-focus, var(--hg-accent-primary, #82d8f7));
    outline-offset: 1px;
  }

  @media (max-width: 640px) {
    main {
      grid-template-columns: minmax(0, 1fr);
      grid-template-rows: auto minmax(0, 1fr);
    }

    main .rail {
      max-height: 26vh;
      overflow-y: auto;
      border-right: 0;
      border-bottom: 1px solid var(--hg-border-muted, #242424);
    }
  }

  .intro {
    margin: 0;
    color: var(--hg-text-secondary, #c8c2b5);
    font-size: 13px;
  }

  .workbench {
    display: grid;
    flex: 1;
    gap: 16px;
    grid-template-columns: minmax(0, 1fr);
    min-height: 0;
    overflow-y: auto;
  }

  @media (max-width: 959px) {
    main .editor {
      overflow-y: auto;
    }

    main .workbench,
    main .body {
      flex: none;
      overflow: visible;
    }

    main .actions {
      position: sticky;
      bottom: -14px;
      z-index: 3;
      flex-wrap: wrap;
      margin: 0 -16px -14px;
      padding: 8px 16px;
      background: var(--hg-bg-base, #050505);
      border-top: 1px solid var(--hg-border-muted, #242424);
    }
  }

  @media (min-width: 960px) {
    .workbench {
      grid-template-columns: minmax(0, 1fr) 320px;
      overflow: hidden;
    }

    .workbench .matches {
      overflow-y: auto;
      padding-left: 16px;
      border-top: 0;
      border-left: 1px solid var(--hg-border-muted, #242424);
    }
  }

  .matches {
    min-width: 0;
    padding-top: 10px;
    border-top: 1px solid var(--hg-border-muted, #242424);
    font-size: 12px;
  }

  .matches h2 {
    margin: 0 0 6px;
    color: var(--hg-text-muted, #b8b1a4);
    font-size: 11px;
    font-weight: 400;
  }

  .matches p {
    margin: 0 0 8px;
  }

  .summary {
    color: var(--hg-text-primary, #f2efe7);
    font-size: 13px;
    font-weight: 600;
    line-height: 1.4;
  }

  .match-list {
    display: grid;
    gap: 8px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .match-list li {
    padding: 8px 0;
    border-top: 1px solid var(--hg-border-muted, #242424);
  }

  .match-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 8px;
  }

  .match-author {
    min-width: 0;
    overflow: hidden;
    padding: 0;
    border: 0;
    background: transparent;
    cursor: pointer;
    font: inherit;
    font-weight: 600;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .match-author:hover {
    text-decoration: underline;
  }

  .match-text {
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 3;
    overflow: hidden;
    margin: 2px 0 0 !important;
    color: var(--hg-text-secondary, #c8c2b5);
    overflow-wrap: anywhere;
  }

  .saved-actions {
    display: flex;
    gap: 4px;
    padding: 0 6px 6px;
  }

  .saved-action {
    padding: 2px 6px;
    border: 1px solid var(--hg-border, #303030);
    border-radius: 4px;
    background: transparent;
    color: var(--hg-text-muted, #b8b1a4);
    cursor: pointer;
    font: inherit;
    font-size: 10px;
  }

  .saved-action:hover {
    color: var(--hg-text-primary, #f2efe7);
  }

  .saved-action.danger.armed,
  .saved-action.danger:hover {
    border-color: var(--hg-accent-red, #ff6b6b);
    color: var(--hg-accent-red, #ff6b6b);
  }

  .secondary-btn {
    height: 32px;
    padding: 0 12px;
    border: 1px solid var(--hg-border, #303030);
    border-radius: 5px;
    background: transparent;
    color: var(--hg-text-primary, #f2efe7);
    cursor: pointer;
    font: inherit;
    font-size: 12px;
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
  .saved-meta {
    color: var(--hg-text-muted, #b8b1a4);
    font-size: 10px;
  }

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
  .status { flex: 1; min-width: 0; font-size: 12px; }
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
    border: 1px solid var(--hg-accent-primary, #9be564);
    border-radius: 5px;
    background: var(--hg-accent-primary, #9be564);
    color: var(--hg-bg-base, #050505);
    cursor: pointer;
    font: inherit;
    font-size: 12px;
    font-weight: 600;
  }
  .save:hover:not(:disabled) { opacity: 0.88; }
  .save:disabled {
    border-color: var(--hg-border, #303030);
    background: transparent;
    color: var(--hg-text-muted, #b8b1a4);
    cursor: not-allowed;
  }
</style>
