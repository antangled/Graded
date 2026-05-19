// Berkeley-style +/- scale. Used for grade lookup and projection targets.
export const BERKELEY_SCALE = [
  { letter: 'A+', min: 97 },
  { letter: 'A',  min: 93 },
  { letter: 'A-', min: 90 },
  { letter: 'B+', min: 87 },
  { letter: 'B',  min: 83 },
  { letter: 'B-', min: 80 },
  { letter: 'C+', min: 77 },
  { letter: 'C',  min: 73 },
  { letter: 'C-', min: 70 },
  { letter: 'D+', min: 67 },
  { letter: 'D',  min: 63 },
  { letter: 'D-', min: 60 },
  { letter: 'F',  min: 0  },
];

// Targets shown in the projection table — the ones students actually care about.
export const PROJECTION_TARGETS = ['A+', 'A', 'A-', 'B+', 'B', 'B-', 'C+', 'C'];

const num = (v) => Number(v) || 0;

const hasValue = (v) =>
  v !== null && v !== '' && v !== undefined && !Number.isNaN(Number(v));

// Returns the post-modifier score (as a percentage out of 100) for a row.
// Scores are stored as a fraction earned/outOf so a 157/200 input becomes 78.5%.
// outOf defaults to 100 — rows that omit it behave as straight percentages.
//
// Modifier application order:
//   1. Fraction — divide earned by outOf to get percent.
//   2. Curve — shift by (target - mean).
//   3. Clobber — if the clobberer's effective is HIGHER than this row's own
//      post-curve %, replace with the clobberer's effective. Clobber can only
//      help — if the clobberer would lower the score, clobber is nullified.
//
// `rows` is the full row list; required to resolve clobber cross-references.
// `depth` guards against accidental clobber cycles.
export function effectiveScore(row, rows, depth = 0) {
  if (depth > 5) return null;
  const ownPct = effectiveScoreOwn(row);
  if (ownPct === null) return null;

  if (row.clobber && row.clobber.clobberedBy && Array.isArray(rows)) {
    const clobberer = rows.find((r) => r.id === row.clobber.clobberedBy);
    if (clobberer && hasValue(clobberer.score)) {
      const clobScore = effectiveScore(clobberer, rows, depth + 1);
      if (clobScore !== null && clobScore > ownPct) return clobScore;
    }
    // Otherwise (clobberer ungraded, or lower than own): use own.
  }
  return ownPct;
}

// Same as effectiveScore but never applies clobber — just fraction + curve.
// Used wherever we need the row's "without clobber" value (UI hint, projection).
export function effectiveScoreOwn(row) {
  if (!hasValue(row.score)) return null;
  const earned = Number(row.score);
  const outOf = hasValue(row.outOf) ? Number(row.outOf) : 100;
  if (outOf === 0) return null;
  const pct = (earned / outOf) * 100;
  if (!row.curve) return pct;
  const { mean, target } = row.curve;
  if (!hasValue(mean) || !hasValue(target)) return pct;
  const meanPct = (Number(mean) / outOf) * 100;
  return pct + (Number(target) - meanPct);
}

const isGraded = (row, rows) => hasValue(effectiveScore(row, rows));

// Returns the contribution (in percentage points of the final grade) of all
// rows that already have a score. e.g. a row worth 10% with score 94 contributes 9.4.
// Uses effective (post-modifier) score so curved/clobbered rows count for their adjusted value.
export function lockedInContribution(rows) {
  return rows.filter((r) => isGraded(r, rows)).reduce(
    (sum, r) => sum + num(effectiveScore(r, rows)) * num(r.weight) / 100,
    0
  );
}

// Sum of weights of rows that are already graded.
export function gradedWeight(rows) {
  return rows.filter((r) => isGraded(r, rows)).reduce((sum, r) => sum + num(r.weight), 0);
}

// Sum of weights of rows still waiting for a score.
export function remainingWeight(rows) {
  return rows.filter((r) => !isGraded(r, rows)).reduce((sum, r) => sum + num(r.weight), 0);
}

// Weighted average over only the rows that are graded so far.
// This is the "what am I averaging in the work I've done?" number.
export function currentAverage(rows) {
  const w = gradedWeight(rows);
  if (w === 0) return null;
  return (lockedInContribution(rows) / w) * 100;
}

// Letter grade for a numeric percent, based on the +/- scale.
export function letterFor(pct, scale = BERKELEY_SCALE) {
  if (pct === null || pct === undefined || Number.isNaN(pct)) return '—';
  for (const tier of scale) {
    if (pct >= tier.min) return tier.letter;
  }
  return 'F';
}

// Curve shift for a single row in percentage points (i.e. the boost the curve
// adds to the row's effective % once a raw score is plugged in). Returns 0 if
// the row has no curve or the curve is incomplete.
function curveShiftOf(row) {
  if (!row || !row.curve) return 0;
  const { mean, target } = row.curve;
  if (!hasValue(mean) || !hasValue(target)) return 0;
  const outOf = hasValue(row.outOf) ? Number(row.outOf) : 100;
  if (outOf === 0) return 0;
  const meanPct = (Number(mean) / outOf) * 100;
  return Number(target) - meanPct;
}

// Uniform raw score (as a percentage out of 100) that, applied to every
// still-influence-able row, makes the final weighted grade equal `targetPct`.
//
// Because clobber is conditional ("only if it helps"), the total grade is a
// piecewise-linear function of X with a kink at each clobber's break-even
// point. Rather than enumerating 2ⁿ branches analytically, we binary-search
// over X: `gradeAt(X)` is monotonically increasing in X, so the unique X
// where it equals targetPct is found in 50 iterations to ~10⁻¹⁵ precision.
export function neededOnRemaining(rows, targetPct) {
  // True if any row's contribution depends on X — either an ungraded row, or
  // a graded row whose clobberer is still ungraded (it might pick up X's value).
  const hasXDep = rows.some((r) => {
    const w = num(r.weight);
    if (w === 0) return false;
    if (!isGraded(r, rows)) return true;
    if (r.clobber && r.clobber.clobberedBy) {
      const c = rows.find((x) => x.id === r.clobber.clobberedBy);
      if (c && !hasValue(c.score)) return true;
    }
    return false;
  });
  if (!hasXDep) return null;

  const gradeAt = (X) => gradeAssumingRemainingScore(rows, X);

  // Bracket: -200 well below any "already locked in" case, 200 well above any
  // achievable target. Binary search converges from there.
  let lo = -200, hi = 200;
  for (let i = 0; i < 50; i++) {
    const mid = (lo + hi) / 2;
    if (gradeAt(mid) < targetPct) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

// Total grade percentage assuming every X-dependent row scores raw X% (after
// any curve). Used by the binary search above and exposed for testing.
function gradeAssumingRemainingScore(rows, X) {
  let total = 0;
  for (const r of rows) {
    const w = num(r.weight);
    if (w === 0) continue;

    const clobberer = r.clobber && r.clobber.clobberedBy
      ? rows.find((x) => x.id === r.clobber.clobberedBy)
      : null;
    const clobbererUngraded = clobberer && !hasValue(clobberer.score);

    let rowEff;
    if (clobberer && clobbererUngraded) {
      // Clobberer's hypothetical effective if it scores X: X + clobberer's curve shift.
      const cEff = X + curveShiftOf(clobberer);
      // This row's own effective without clobber. If r is also ungraded, X + r's shift.
      const rOwn = hasValue(r.score) ? effectiveScoreOwn(r) : X + curveShiftOf(r);
      // Conditional clobber: only fires if cEff > rOwn.
      rowEff = Math.max(cEff, rOwn ?? cEff);
    } else if (isGraded(r, rows)) {
      rowEff = effectiveScore(r, rows);
    } else {
      // Plain ungraded — uses its own curve, if any.
      rowEff = X + curveShiftOf(r);
    }
    total += rowEff * w / 100;
  }
  return total;
}

// Returns the full projection table for the standard target letters.
export function projectionTable(rows, scale = BERKELEY_SCALE) {
  return PROJECTION_TARGETS.map((letter) => {
    const tier = scale.find((t) => t.letter === letter);
    const target = tier ? tier.min : null;
    const needed = target !== null ? neededOnRemaining(rows, target) : null;
    return { letter, target, needed };
  });
}

// True if the row weights add up to ~100% (within 0.5 to absorb rounding).
export function weightsSumOk(rows) {
  const total = rows.reduce((s, r) => s + num(r.weight), 0);
  return Math.abs(total - 100) < 0.5;
}

export function totalWeight(rows) {
  return rows.reduce((s, r) => s + num(r.weight), 0);
}
