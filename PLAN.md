# Graded — Implementation Plan

A zero-cost, Desmos-style grade calculator for college students. Paste a syllabus or grade breakdown, see your current grade live, and find out exactly what you need on the final to hit an A.

---

## 1. Product Goals

| Goal | Why it matters |
|---|---|
| **Single page, no signup** | Beats Desmos only if friction is lower than opening a new graph. |
| **Live recomputation** as the student types | The whole point of using Desmos today — keep this feel. |
| **"What do I need on the final?" projections** | The killer feature Desmos doesn't give you for free. |
| **Handles curved tests** (mean + std-dev) | Berkeley-specific, but generalizes to any norm-referenced grading. |
| **$0 operating cost at any scale** | Required — no per-user infra costs ever. |
| **Free for students, monetizable on the side** | If we charge, students go back to Desmos. |

---

## 2. Tech Stack (chosen for zero-cost + simplicity)

| Layer | Choice | Why |
|---|---|---|
| **Framework** | **SvelteKit** (static adapter) | Smallest bundle of any reactive framework (~10KB runtime). Compiles `{score * weight}` to direct DOM updates — perfect for live-recompute UI. Easier to keep "extensively simple" than Next.js. |
| **Hosting** | **Cloudflare Pages** | Unlimited bandwidth on free tier, global CDN, no cold starts. Vercel is fine but bandwidth-capped. |
| **Storage** | **`localStorage` only** (MVP) | No database = no cost, no auth, no GDPR scope. Each class saved as a JSON blob keyed by name. |
| **Syllabus parsing** | **Regex/heuristic first, LLM fallback** | See §5 — most syllabi follow `Homework: 20%` patterns that regex handles for free. LLM only fires when heuristics fail. |
| **LLM provider (fallback only)** | **Google Gemini 2.0 Flash** free tier (15 RPM, 1500 RPD) OR **BYOK** | Free tier covers low-volume launch; switch to BYOK if abused. Never our own paid endpoint. |
| **Styling** | **Vanilla CSS + CSS variables** | Tailwind is fine but adds setup. For a one-page app, hand-written CSS keeps the bundle tiny and design intentional. |
| **Math** | Pure JS, no library | Weighted average + linear algebra for projections is ~30 lines. Don't pull in a stats library. |
| **Analytics** | **Plausible** self-hosted OR **Cloudflare Web Analytics** | Free, privacy-preserving, no cookie banner needed. |

**Explicitly NOT using:** Next.js (overkill), React (heavier reactivity), a database, a backend server, user auth, npm packages for things that are <50 lines of code.

---

## 3. UI Layout (Desmos-inspired)

```
┌─────────────────────────────────┬──────────────────────────────┐
│  LEFT PANEL — Inputs            │  RIGHT PANEL — Results       │
│                                 │                              │
│  [+ Paste syllabus]             │  Current grade               │
│                                 │   ─────────                  │
│  Category       Weight  Score   │     87.3%   (B+)             │
│  ──────────────────────────     │                              │
│  Homework       10%     94      │  Projection — what you need: │
│  Midterm 1  20% 72 ⇇clobber:Fin │   A   (93%)  → 98% on final  │
│  Midterm 2      20%     78      │   A-  (90%)  → 89% on final  │
│  Final          30%     ___     │   B+  (87%)  → 80% on final  │
│  Participation  20%     100     │  (M1 clobbered by Final)     │
│                                 │  ⚠ A requires >100 on final  │
│  [+ Add row]                    │                              │
│                                 │  Grade scale: [Berkeley ▾]   │
└─────────────────────────────────┴──────────────────────────────┘
```

**Interaction rules:**
- Every keystroke updates the right panel — no "Calculate" button.
- Empty score fields are treated as **not yet graded** and feed the projection.
- Rows with `[curve]` open an inline popover for mean / std-dev / curve target.
- Rows with **clobber** show a small `⇇` toggle; clicking it opens a dropdown of *later* rows whose score can replace this row's score (MVP behavior: straight replacement — the chosen later test's score overwrites this row's score for grade calculation).
- Grade scale dropdown: Berkeley default, +/- scale, no-minus scale, custom.
- Saved classes appear as tabs across the top — single click to switch.

**Mobile:** stack vertically (inputs above, results sticky at bottom). Most students will use this on a laptop, but mobile must not be broken.

---

## 4. Core Math

### 4a. Current grade (weighted average over graded items only)
```
current_pct = Σ(score_i × weight_i for graded i) / Σ(weight_i for graded i)
locked_in   = Σ(score_i × weight_i for graded i)   // contribution to final %
remaining_w = Σ(weight_i for ungraded i)
```
Show both: "Current average (graded so far)" **and** "Locked-in contribution to final grade." Students confuse these constantly.

### 4b. Projection — score needed on remaining items
For a target overall grade `T` and a single remaining item with weight `w_final`:
```
needed = (T − locked_in) / w_final
```
Render a table of needed scores for every grade boundary (A, A-, B+, B, …). Flag impossible targets (`needed > 100`) and trivially-met targets (`needed ≤ 0`).

If **multiple** items remain, default to "assume equal score on all remaining," and let the user pin specific predicted scores for some items.

### 4c. Clobber (later-test-replaces-earlier-test)

Common Berkeley policy: a later exam's score can "clobber" (replace) an earlier exam's score, usually applied automatically when it would help the student.

**MVP behavior (per user spec):**
- Each test row gets an optional **clobber-by** pointer to a *later* row in the list.
- When set, the earlier row's effective score is **replaced** by the later row's score for all grade calculations.
- Pure replacement — no max(), no conditional logic. If the user wants "only clobber if it helps me," they can just uncheck it. (A `max()` toggle is a v1.1 follow-up.)
- If the later (clobbering) row has no score yet, the earlier row uses its own score until the later row is filled in.

**Data shape:**
```js
{ id, name, weight, score, curve?, clobberedBy?: rowId }
```

**Interaction with curving:** apply the clobbering row's per-row curve *first*, then use that effective score as the replacement. This keeps the displayed number consistent with what the student sees in the clobbering row.

**Interaction with projections:** if the user asks "what do I need on the final?" and the final clobbers Midterm 1, the final's score now contributes to *both* its own weight and Midterm 1's weight. The needed-score formula becomes:
```
effective_final_weight = w_final + Σ(w_i for every row clobbered by final)
needed                 = (T − locked_in_excluding_clobbered_rows) / effective_final_weight
```
This is still a single linear equation — just with a fattened weight on the unknown.

### 4d. Curved tests (Berkeley-style)
Let the user input: raw score, class mean, class std-dev, and what the mean curves to (e.g., "mean = B" or "mean = 83%"). Then:
```
z              = (raw − mean) / stddev
effective_pct  = curve_target + z × step_size
```
`step_size` is configurable — Berkeley convention is roughly one letter grade per std-dev (≈10 points), but some classes use half a letter (≈5).

This is exposed as an optional toggle per row. Non-curved classes ignore it entirely.

---

## 5. Syllabus Parsing Strategy (zero-cost path)

**Stage 1 — Regex heuristics (free, instant, runs in browser):**
- Match patterns like `Homework\s*[:\-–]?\s*(\d+)%`, `(\d+)%\s*[\-–]?\s*Final`, table rows with `%`.
- Catches the majority of syllabi pasted as plain text.
- If total weights sum to 100% ± 2%, accept and skip the LLM.

**Stage 2 — LLM fallback (only if Stage 1 confidence is low):**
- Single request to Gemini 2.0 Flash with a strict JSON schema: `[{ name, weight }]`.
- Free tier limits (15 req/min, 1500/day) gate volume naturally.
- If we hit limits, surface "Paste your own Gemini/OpenAI key" (BYOK) and store it in `localStorage` — never on our servers.

**Why this matters:** if every parse hits an LLM, we have a unit-economics problem the moment we get popular. Regex-first means the LLM is a long-tail backstop, not the hot path.

---

## 6. Monetization (free for students, revenue on the side)

Ordered by least-invasive first:

1. **Affiliate links — contextual, not banner ads.** When a student adds a "Textbook cost" row or searches a class, link to Chegg/Quizlet/Course Hero study guides for that class. Revenue without polluting the calculator.
2. **"Save & sync across devices" — $3/mo Pro tier.** The calculator stays 100% free; sync, unlimited saved classes, GPA tracking across semesters, and CSV export are paid. Most students never pay — that's fine.
3. **University site-licenses.** A study-skills office or tutoring center pays a small annual fee for a branded version. Long sales cycle but high LTV.
4. **Donations (Ko-fi / Buy Me a Coffee).** Low yield but zero overhead.

**Deliberately avoiding:** display ads (kills the clean UI premise), paywalled core math (drives users back to Desmos), data sales (would require a privacy policy nobody trusts).

---

## 7. Build Roadmap

**MVP (week 1) — the thing that beats Desmos**
- [ ] SvelteKit scaffold + Cloudflare Pages deploy.
- [ ] Two-panel layout, add/remove rows, weighted-average math.
- [ ] Live projection table (needed score per grade boundary).
- [ ] `localStorage` save per class name.
- [ ] Mobile responsive (stacked).

**v1 (week 2) — the differentiators**
- [ ] Curved-test row type with mean/std-dev inputs.
- [ ] **Clobber toggle per row** (straight replacement by a later row's score; projection math accounts for fattened final weight).
- [ ] Multiple remaining items with per-item pinned predictions.
- [ ] Regex syllabus parser + paste box.
- [ ] Configurable grade scales (Berkeley, +/-, custom).

**v1.1 (week 3) — polish + parsing**
- [ ] Gemini fallback + BYOK flow.
- [ ] Shareable read-only URLs (state encoded in URL hash, no server).
- [ ] Keyboard navigation (Tab through rows, Enter to add).
- [ ] Empty-state with a real example loaded.

**v2 (later) — paid features**
- [ ] Optional Supabase-backed sync (free tier covers ~50K users).
- [ ] GPA tracker across semesters.
- [ ] CSV import/export.

---

## 8. Cost Model

| Item | Free tier ceiling | What happens above it |
|---|---|---|
| Cloudflare Pages | Unlimited bandwidth, 500 builds/mo | Builds rarely exceed this. |
| Gemini Flash | 1500 requests/day | Fall back to BYOK prompt. |
| `localStorage` | ~5MB per user | Plenty for dozens of classes. |
| Analytics (Plausible self-host or CF Web Analytics) | Free | n/a |
| **Total** | **$0** | Still $0 if we add BYOK gating. |

The architecture has no per-user variable cost. If we get 100 users or 100,000 users tomorrow, hosting cost stays $0. Only the optional paid tier requires a backend (Supabase free tier covers the first ~50K rows easily).

---

## 9. Resolved Decisions

1. **Class tabs + share button** — tabs are closer to Desmos. Sharing handled by a separate community library (see §10), not URL-hash encoding.
2. **Drop lowest — explicitly OUT of scope.** Requires students to enter every homework grade individually, which defeats "convenient." If a category has a drop-lowest rule, the student can pre-average their kept scores manually.
3. **Extra credit — no special handling.** Scores >100 are allowed and flow through naturally; a category contribution or final total may exceed 100%. Display the over-100 number as-is; do not clamp.
4. **Show Math toggle.** Curved-test Z-score and other intermediate math are hidden behind a per-row "Show math" affordance. Default-collapsed.

## 10. Future: Community Class Library (v2+)

A "Share this class" button that uploads the **structure only** — category names, weights, clobber pointers, curve settings — but **never the student's actual scores**. Other students at the same school can search by school + class name (e.g., "UC Berkeley → CS 61A") and load the calculator pre-configured.

**Inspiration:** tierlistmaker.com's pattern of community-shared templates.

**Why it's deferred:**
- Requires a backend (Supabase free tier works, but adds auth/moderation/spam concerns).
- Breaks the strict $0 infra property of the MVP.
- Needs review/voting/dedup logic to avoid "CS 61A — Fake Edition" abuse.

**Shape when built:** Supabase table `class_templates(school, course_code, course_name, structure_json, submitted_by, votes)`. Submission is anonymous; voting requires a soft auth (email or anonymous device ID).
