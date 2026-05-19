<script>
  import { onMount } from 'svelte';
  import {
    currentAverage,
    effectiveScore,
    lockedInContribution,
    letterFor,
    projectionTable,
    remainingWeight,
    totalWeight,
    weightsSumOk,
  } from './lib/grade.js';
  import {
    saveUserPreset,
    saveUserSave,
    searchAll,
    loadCurrentState,
    saveCurrentState,
    clearCurrentState,
  } from './lib/presets.js';

  // Seed with a realistic Berkeley-style class so first-time users see the app working.
  // outOf defaults to 100 so plain percentage entry still works; change per row for
  // tests graded out of e.g. 200 points. `curve` and `clobber` are independent
  // optional modifiers; both can be active on the same row.
  let rows = [
    { id: 1, name: 'Homework',      weight: 10, score: 94,   outOf: 100, curve: null, clobber: null },
    { id: 2, name: 'Midterm 1',     weight: 20, score: 157,  outOf: 200, curve: null, clobber: null },
    { id: 3, name: 'Midterm 2',     weight: 20, score: 78,   outOf: 100, curve: null, clobber: null },
    { id: 4, name: 'Final',         weight: 30, score: null, outOf: 100, curve: null, clobber: null },
    { id: 5, name: 'Participation', weight: 20, score: 100,  outOf: 100, curve: null, clobber: null },
  ];
  let nextId = 6;
  // UI-only: which rows have their modifier panel open. Not persisted.
  // Using a plain array because Svelte 4 reactivity reliably picks up
  // reassignment but not mutations to a Set instance.
  let expandedRowIds = [];

  // Mean-curves-to-X target options. Values are the % the mean is treated as.
  const TARGET_OPTIONS = [
    { label: 'A  (93%)',  value: 93 },
    { label: 'A- (90%)',  value: 90 },
    { label: 'B+ (87%)',  value: 87 },
    { label: 'B  (83%)',  value: 83 },
    { label: 'B- (80%)',  value: 80 },
    { label: 'C+ (77%)',  value: 77 },
    { label: 'C  (73%)',  value: 73 },
    { label: 'C- (70%)',  value: 70 },
  ];

  $: locked = lockedInContribution(rows);
  $: current = currentAverage(rows);
  $: remaining = remainingWeight(rows);
  $: total = totalWeight(rows);
  $: weightsOk = weightsSumOk(rows);
  $: projections = projectionTable(rows);
  $: currentLetter = letterFor(current);

  function addRow() {
    rows = [...rows, { id: nextId++, name: '', weight: 0, score: null, outOf: 100, curve: null, clobber: null }];
  }
  function removeRow(id) {
    rows = rows.filter((r) => r.id !== id);
    expandedRowIds = expandedRowIds.filter((x) => x !== id);
  }
  function togglePanel(row) {
    if (expandedRowIds.includes(row.id)) {
      expandedRowIds = expandedRowIds.filter((x) => x !== row.id);
    } else {
      expandedRowIds = [...expandedRowIds, row.id];
    }
  }
  function isExpanded(ids, id) {
    return ids.includes(id);
  }
  function hasAnyModifier(row) {
    return !!(row.curve || row.clobber);
  }
  function laterRows(row) {
    const idx = rows.findIndex((r) => r.id === row.id);
    return idx === -1 ? [] : rows.slice(idx + 1);
  }
  function addCurve(row) {
    row.curve = { mean: null, target: 83 };
    rows = rows;
  }
  function removeCurve(row) {
    row.curve = null;
    rows = rows;
  }
  function addClobber(row) {
    const later = laterRows(row);
    if (later.length === 0) return;
    row.clobber = { clobberedBy: later[later.length - 1].id }; // default to last row
    rows = rows;
  }
  function removeClobber(row) {
    row.clobber = null;
    rows = rows;
  }
  function setClobberTarget(row, value) {
    row.clobber = { clobberedBy: Number(value) };
    rows = rows;
  }
  function clobbererName(row) {
    if (!row.clobber || !row.clobber.clobberedBy) return null;
    const c = rows.find((r) => r.id === row.clobber.clobberedBy);
    return c ? (c.name || 'Untitled') : null;
  }
  // Returns the effective % of the row that clobbers this one — or null if
  // there's no clobber set or the clobberer doesn't have a score yet.
  function clobbererScore(row) {
    if (!row.clobber || !row.clobber.clobberedBy) return null;
    const c = rows.find((r) => r.id === row.clobber.clobberedBy);
    if (!c || c.score === null || c.score === '' || c.score === undefined) return null;
    return effectiveScore(c, rows);
  }
  function onScoreInput(row, value) {
    row.score = value === '' ? null : Number(value);
    rows = rows;
  }
  function onCurveField(row, field, value) {
    row.curve = { ...row.curve, [field]: value === '' ? null : Number(value) };
    rows = rows;
  }
  function fmt(n, digits = 1) {
    if (n === null || n === undefined || Number.isNaN(n)) return '—';
    return n.toFixed(digits);
  }

  // --- presets + saves ---
  let searchQuery = '';
  let showLoadDropdown = false;
  let showSaveModal = false;
  let newPresetName = '';
  let saveError = '';
  let showSaveScoresModal = false;
  let newSaveName = '';
  let saveScoresError = '';
  let showClearConfirm = false;
  let storeTick = 0; // bumped after any localStorage write so the search re-reads

  $: presetResults = (storeTick, searchAll(searchQuery));

  function openSaveModal() {
    newPresetName = '';
    saveError = '';
    showSaveModal = true;
  }
  function closeSaveModal() {
    showSaveModal = false;
  }
  function doSavePreset() {
    try {
      saveUserPreset({
        name: newPresetName,
        structure: rows.map((r) => ({ name: r.name, weight: r.weight, outOf: r.outOf })),
      });
      storeTick++;
      showSaveModal = false;
    } catch (e) {
      saveError = e.message;
    }
  }

  function openSaveScoresModal() {
    newSaveName = '';
    saveScoresError = '';
    showSaveScoresModal = true;
  }
  function closeSaveScoresModal() {
    showSaveScoresModal = false;
  }
  function doSaveScores() {
    try {
      saveUserSave({ name: newSaveName, rows });
      storeTick++;
      showSaveScoresModal = false;
    } catch (e) {
      saveScoresError = e.message;
    }
  }

  function openClearConfirm() { showClearConfirm = true; }
  function closeClearConfirm() { showClearConfirm = false; }
  function doClearAll() {
    rows = [];
    expandedRowIds = [];
    clearCurrentState();
    showClearConfirm = false;
  }

  // Loads either a preset (structure only) or a save (full rows with scores).
  function loadItem(item) {
    if (item.kind === 'save' && Array.isArray(item.rows)) {
      rows = item.rows.map(normalizeRow);
      nextId = Math.max(0, ...rows.map((r) => r.id)) + 1;
    } else {
      rows = item.structure.map((cat) => ({
        id: nextId++,
        name: cat.name,
        weight: cat.weight,
        score: null,
        outOf: cat.outOf ?? 100,
        curve: null,
        clobber: null,
      }));
    }
    searchQuery = '';
    showLoadDropdown = false;
    expandedRowIds = [];
  }

  // Defaults every persisted field so saves from older versions still load.
  function normalizeRow(r) {
    return {
      id: r.id,
      name: r.name ?? '',
      weight: r.weight ?? 0,
      score: r.score ?? null,
      outOf: r.outOf ?? 100,
      curve: r.curve ?? null,
      clobber: r.clobber ?? null,
    };
  }
  function handleKeydown(e) {
    if (e.key === 'Escape') {
      showSaveModal = false;
      showSaveScoresModal = false;
      showClearConfirm = false;
      showLoadDropdown = false;
    }
  }

  // --- auto-save ---
  // `restoreComplete` blocks the reactive auto-save from running until after
  // onMount has read the saved state. Otherwise the first `$:` tick after
  // mount would overwrite the saved state with the seed before we restore it.
  let restoreComplete = false;
  onMount(() => {
    const saved = loadCurrentState();
    if (saved && saved.length > 0) {
      rows = saved.map(normalizeRow);
      nextId = Math.max(0, ...rows.map((r) => r.id)) + 1;
    }
    restoreComplete = true;
  });
  $: if (restoreComplete) saveCurrentState(rows);

  // (Wheel listener removed — was suspected of interfering with page scroll.)
  // Show the inline "→ N%" effective-score hint whenever the row's displayed raw
  // points differ from the resulting percentage, OR when the row is clobbered
  // (the eff hint then doubles as the "← Final" indicator).
  function showEff(row) {
    const eff = effectiveScore(row, rows);
    if (eff === null) return false;
    if (row.clobber && row.clobber.clobberedBy) return true;
    return Math.abs(eff - Number(row.score)) > 0.05;
  }
  function curveShift(row) {
    if (!row.curve) return 0;
    const { mean, target } = row.curve;
    if (mean === null || mean === '' || target === null || target === '') return 0;
    const outOf = (row.outOf === null || row.outOf === '' || row.outOf === undefined)
      ? 100
      : Number(row.outOf);
    if (outOf === 0) return 0;
    const meanPct = (Number(mean) / outOf) * 100;
    return Number(target) - meanPct;
  }
</script>

<svelte:window on:keydown={handleKeydown} />

<main class="app">
  <header class="topbar">
    <div class="brand">
      <span class="brand-mark">A</span>
      <span class="brand-name">Graded</span>
    </div>
    <div class="tagline">grade calculator · zero signup</div>
  </header>

  <div class="layout">
    <!-- LEFT: inputs -->
    <section class="panel inputs">
      <div class="panel-head">
        <h2>Grade breakdown</h2>
        <div class="weight-pill" class:warn={!weightsOk}>
          {fmt(total, 0)}% total
          {#if !weightsOk}<span class="hint">should be 100</span>{/if}
        </div>
      </div>

      <div class="preset-bar">
        <div class="search-wrap">
          <span class="search-icon">⌕</span>
          <input
            type="search"
            class="preset-search"
            placeholder="Load preset — try “Math 54”"
            bind:value={searchQuery}
            on:focus={() => (showLoadDropdown = true)}
            on:blur={() => setTimeout(() => (showLoadDropdown = false), 150)}
          />
          {#if showLoadDropdown}
            <div class="preset-dropdown">
              {#if presetResults.length === 0}
                <div class="preset-empty">No matches for “{searchQuery}”</div>
              {:else}
                {#each presetResults as p (p.id)}
                  <button
                    type="button"
                    class="preset-item"
                    on:mousedown|preventDefault={() => loadItem(p)}
                  >
                    <span class="preset-name">{p.name}</span>
                    <span class="preset-meta">
                      {#if p.kind === 'save'}
                        {p.rows?.length ?? 0} rows · scores included
                        <span class="preset-tag saved">your save</span>
                      {:else}
                        {#if p.school}{p.school} · {/if}
                        {p.structure?.length ?? 0} categories
                        {#if p.builtin}<span class="preset-tag builtin">built-in</span>
                        {:else}<span class="preset-tag">your preset</span>{/if}
                      {/if}
                    </span>
                  </button>
                {/each}
              {/if}
            </div>
          {/if}
        </div>
        <button class="btn-ghost" on:click={openSaveModal}>Save as preset</button>
        <button class="btn-ghost" on:click={openSaveScoresModal}>Save scores</button>
      </div>

      <div class="row-head">
        <span class="col-name">Category</span>
        <span class="col-weight">Weight</span>
        <span class="col-score">Score / Out of</span>
        <span class="col-curve"></span>
        <span class="col-actions"></span>
      </div>

      {#each rows as row (row.id)}
        <div class="row-block">
          <div class="row">
            <div class="col-name name-cell">
              <input
                type="text"
                placeholder="e.g. Midterm 1"
                bind:value={row.name}
              />
              {#if showEff(row)}
                <span class="eff-hint">
                  → {fmt(effectiveScore(row, rows), 1)}%
                  {#if clobbererName(row)}<span class="eff-meta">← {clobbererName(row)}</span>{/if}
                </span>
              {/if}
            </div>
            <div class="col-weight input-with-suffix">
              <input
                type="number"
                min="0"
                max="100"
                step="0.5"
                bind:value={row.weight}
              />
              <span class="suffix">%</span>
            </div>
            <div class="col-score score-cell">
              <div class="score-fraction">
                <input
                  type="number"
                  class="score-earned"
                  placeholder="—"
                  min="0"
                  step="0.1"
                  value={row.score ?? ''}
                  on:input={(e) => onScoreInput(row, e.target.value)}
                />
                <span class="score-slash">/</span>
                <input
                  type="number"
                  class="score-outof"
                  min="1"
                  step="1"
                  bind:value={row.outOf}
                />
              </div>
            </div>
            <button
              class="col-curve curve-toggle"
              class:on={hasAnyModifier(row) || isExpanded(expandedRowIds, row.id)}
              on:click={() => togglePanel(row)}
              title="Modifiers (curve, clobber)"
            >ƒ</button>
            <button
              class="col-actions remove"
              on:click={() => removeRow(row.id)}
              title="Remove row"
            >×</button>
          </div>

          {#if isExpanded(expandedRowIds, row.id)}
            <div class="curve-panel modifiers-panel">
              {#if row.curve}
                <div class="modifier-section">
                  <div class="modifier-head">
                    <span>Curve · mean → target</span>
                    <button class="modifier-remove" title="Remove curve" on:click={() => removeCurve(row)}>×</button>
                  </div>
                  <div class="curve-fields">
                    <label>
                      <span>Class mean</span>
                      <div class="input-with-suffix">
                        <input
                          type="number"
                          min="0"
                          step="0.1"
                          placeholder="raw score"
                          value={row.curve.mean ?? ''}
                          on:input={(e) => onCurveField(row, 'mean', e.target.value)}
                        />
                        <span class="suffix">/ {row.outOf ?? 100}</span>
                      </div>
                    </label>
                    <label>
                      <span>Curves to</span>
                      <select
                        value={row.curve.target}
                        on:change={(e) => onCurveField(row, 'target', e.target.value)}
                      >
                        {#each TARGET_OPTIONS as opt}
                          <option value={opt.value}>{opt.label}</option>
                        {/each}
                      </select>
                    </label>
                  </div>
                  <div class="curve-math">
                    {#if row.curve.mean === null || row.curve.mean === ''}
                      <span class="muted">enter the class mean to apply the curve</span>
                    {:else}
                      adds <strong>{curveShift(row) >= 0 ? '+' : ''}{fmt(curveShift(row), 1)}</strong>
                      to every score in this row
                    {/if}
                  </div>
                </div>
              {/if}

              {#if row.clobber}
                {@const later = laterRows(row)}
                <div class="modifier-section">
                  <div class="modifier-head">
                    <span>Clobber · later test replaces this</span>
                    <button class="modifier-remove" title="Remove clobber" on:click={() => removeClobber(row)}>×</button>
                  </div>
                  <div class="curve-fields">
                    <label class="full-width">
                      <span>Clobbered by</span>
                      <select
                        value={row.clobber.clobberedBy}
                        on:change={(e) => setClobberTarget(row, e.target.value)}
                      >
                        {#each later as l}
                          <option value={l.id}>{l.name || 'Untitled'}</option>
                        {/each}
                      </select>
                    </label>
                  </div>
                  <div class="curve-math">
                    {#if !clobbererName(row)}
                      <span class="muted">pick a later row to clobber from</span>
                    {:else}
                      this row's score is replaced by <strong>{clobbererName(row)}</strong>'s effective score
                      {#if clobbererScore(row) !== null}
                        (<strong>{fmt(clobbererScore(row), 1)}%</strong>)
                      {:else}
                        — once it's graded
                      {/if}
                    {/if}
                  </div>
                </div>
              {/if}

              <div class="add-modifier-row">
                {#if !row.curve}
                  <button class="add-modifier-btn" on:click={() => addCurve(row)}>+ Curve</button>
                {/if}
                {#if !row.clobber && laterRows(row).length > 0}
                  <button class="add-modifier-btn" on:click={() => addClobber(row)}>+ Clobber</button>
                {/if}
                {#if !row.curve && !row.clobber && laterRows(row).length === 0}
                  <span class="muted small">No clobber — this is the last row.</span>
                {/if}
                {#if row.curve && row.clobber}
                  <span class="muted small">All modifier types added.</span>
                {/if}
              </div>
            </div>
          {/if}
        </div>
      {/each}

      <div class="add-row-bar">
        <button class="add-row" on:click={addRow}>+ Add row</button>
        <button
          type="button"
          class="trash-btn"
          on:click={openClearConfirm}
          title="Clear all rows"
          aria-label="Clear all rows"
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <polyline points="3 6 5 6 21 6"></polyline>
            <path d="M19 6l-1.5 14a2 2 0 0 1-2 1.8H8.5a2 2 0 0 1-2-1.8L5 6"></path>
            <path d="M10 11v6"></path>
            <path d="M14 11v6"></path>
            <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
          </svg>
        </button>
      </div>

      <p class="muted small">
        Leave <em>Score</em> blank for items you haven't taken yet. Scores above 100 are
        allowed (use them for extra credit). Click <span class="kbd">ƒ</span> on any row to apply a curve or clobber.
      </p>
    </section>

    <!-- RIGHT: results -->
    <aside class="panel results">
      <div class="current">
        <div class="current-label">Current grade</div>
        <div class="current-value">
          <span class="num">{fmt(current)}</span><span class="pct">%</span>
        </div>
        <div class="current-letter">{currentLetter}</div>
        <div class="current-sub">
          {fmt(locked)} pts locked in · {fmt(remaining, 0)}% of grade still outstanding
        </div>
      </div>

      <div class="projection">
        <div class="projection-head">
          <h3>To finish with…</h3>
          <span class="muted small">avg score needed on remaining</span>
        </div>

        {#if remaining === 0}
          <div class="muted">All items have a score — nothing left to project.</div>
        {:else}
          <ul class="proj-list">
            {#each projections as p}
              {@const impossible = p.needed !== null && p.needed > 100}
              {@const trivial    = p.needed !== null && p.needed <= 0}
              <li class="proj-row" class:impossible class:trivial>
                <span class="proj-letter">{p.letter}</span>
                <span class="proj-target">≥ {p.target}%</span>
                <span class="proj-needed">
                  {#if trivial}
                    already locked in
                  {:else if impossible}
                    not possible ({fmt(p.needed, 0)}%)
                  {:else}
                    need <strong>{fmt(p.needed, 1)}%</strong>
                  {/if}
                </span>
              </li>
            {/each}
          </ul>
        {/if}
      </div>
    </aside>
  </div>

  <footer class="foot muted small">
    Built for students. Your data stays in your browser.
  </footer>

  {#if showSaveScoresModal}
    <div class="modal-backdrop" on:click={closeSaveScoresModal}>
      <div class="modal" role="dialog" aria-label="Save your scores" on:click|stopPropagation>
        <h3>Save your scores</h3>
        <p class="muted small modal-sub">
          Saves everything — categories, weights, scores, curves, clobbers.
          Use this to switch between classes or back up your progress.
        </p>
        <input
          type="text"
          class="modal-input"
          placeholder="e.g. CS 61B — Spring 2026"
          bind:value={newSaveName}
          on:keydown={(e) => e.key === 'Enter' && doSaveScores()}
          autofocus
        />
        {#if saveScoresError}<div class="modal-error">{saveScoresError}</div>{/if}
        <div class="modal-note muted small">
          Your work is also auto-saved to this browser as you type — this button
          is only for keeping <em>named</em> snapshots you can switch between.
        </div>
        <div class="modal-actions">
          <button type="button" class="btn-ghost" on:click={closeSaveScoresModal}>Cancel</button>
          <button
            type="button"
            class="btn-primary"
            on:click={doSaveScores}
            disabled={!newSaveName.trim()}
          >Save scores</button>
        </div>
      </div>
    </div>
  {/if}

  {#if showClearConfirm}
    <div class="modal-backdrop" on:click={closeClearConfirm}>
      <div class="modal" role="dialog" aria-label="Clear all rows" on:click|stopPropagation>
        <h3>Clear all rows?</h3>
        <p class="muted small modal-sub">
          Removes every category and score from the calculator. Your saved snapshots
          and presets are not touched — you can reload from the search bar if needed.
        </p>
        <div class="modal-actions">
          <button type="button" class="btn-ghost" on:click={closeClearConfirm}>Cancel</button>
          <button type="button" class="btn-primary btn-destructive" on:click={doClearAll}>
            Clear everything
          </button>
        </div>
      </div>
    </div>
  {/if}

  {#if showSaveModal}
    <div class="modal-backdrop" on:click={closeSaveModal}>
      <div
        class="modal"
        role="dialog"
        aria-label="Name your preset"
        on:click|stopPropagation
      >
        <h3>Name your preset</h3>
        <p class="muted small modal-sub">
          Saves the category names and weights — not your scores.
          Use the format <em>Class - Professor</em>.
        </p>
        <input
          type="text"
          class="modal-input"
          placeholder="e.g. Math 54 - Serganova"
          bind:value={newPresetName}
          on:keydown={(e) => e.key === 'Enter' && doSavePreset()}
          autofocus
        />
        {#if saveError}
          <div class="modal-error">{saveError}</div>
        {/if}
        <div class="modal-note muted small">
          Right now this saves to your browser only.
          Public sharing across schools is on the roadmap.
        </div>
        <div class="modal-actions">
          <button type="button" class="btn-ghost" on:click={closeSaveModal}>Cancel</button>
          <button
            type="button"
            class="btn-primary"
            on:click={doSavePreset}
            disabled={!newPresetName.trim()}
          >Save preset</button>
        </div>
      </div>
    </div>
  {/if}
</main>
