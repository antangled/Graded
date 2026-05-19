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
//   1. Clobber — if set and the clobbering row has a score, replace this row's
//      effective % with the clobberer's effective %. The clobbered row's own
//      curve is bypassed (the score isn't "ours" anymore).
//   2. Fraction — divide earned by outOf to get percent.
//   3. Curve — shift by (target - mean).
//
// `rows` is the full row list; required to resolve clobber cross-references.
// `depth` guards against accidental clobber cycles.
export function effectiveScore(row, rows, depth = 0) {
  if (depth > 5) return null;
  if (!hasValue(row.score)) return null;

  if (row.clobber && row.clobber.clobberedBy && Array.isArray(rows)) {
    const clobberer = rows.find((r) => r.id === row.clobber.clobberedBy);
    if (clobberer && hasValue(clobberer.score)) {
      const v = effectiveScore(clobberer, rows, depth + 1);
      if (v !== null) return v;
    }
    // Clobberer not graded yet → fall through and use this row's own score.
  }

  const earned = Number(row.score);
  const outOf = hasValue(row.outOf) ? Number(row.outOf) : 100;
  if (outOf === 0) return null;
  const pct = (earned / outOf) * 100;
  if (!row.curve) return pct;
  const { mean, target } = row.curve;
  if (!hasValue(mean) || !hasValue(target)) return pct;
  // mean is in raw points (same scale as the row's outOf); convert to a
  // percentage before computing the shift so it matches the target's units.
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
// "Influence-able" means either ungraded, or graded but clobbered by an
// ungraded row (in which case its effective score will change as soon as
// the clobberer is graded). The math:
//
//   final = Σ_r effective_r × weight_r / 100  =  targetPct
//
// Each row contributes either a constant or a term linear in X (the uniform
// raw score we're solving for):
//   - Graded & clobber resolves to graded → constant: effective × weight / 100
//   - Clobbered by ungraded row c          → linear: X + curveShift(c)
//   - Plain ungraded with optional curve   → linear: X + curveShift(r)
//
// Returns null if no rows are X-dependent (nothing left to project).
export function neededOnRemaining(rows, targetPct) {
  let totalBase = 0;
  let totalX = 0;

  for (const r of rows) {
    const w = num(r.weight);
    if (w === 0) continue;

    const clobberer = r.clobber && r.clobber.clobberedBy
      ? rows.find((x) => x.id === r.clobber.clobberedBy)
      : null;
    const clobbererUngraded = clobberer && !hasValue(clobberer.score);

    if (clobberer && clobbererUngraded) {
      // Row's effective will be the clobberer's effective once it's graded.
      const shift = curveShiftOf(clobberer);
      totalBase += shift * w / 100;
      totalX += w / 100;
    } else if (isGraded(r, rows)) {
      // Row is graded (and clobber, if any, resolves to a graded row).
      const eff = effectiveScore(r, rows);
      totalBase += eff * w / 100;
    } else {
      // Row is ungraded with no clobber — uses its own curve, if any.
      const shift = curveShiftOf(r);
      totalBase += shift * w / 100;
      totalX += w / 100;
    }
  }

  if (totalX === 0) return null;
  return (targetPct - totalBase) / totalX;
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
