/**
 * SOCIA grading formula — DETERMINISTIC.
 *
 * The LLM no longer decides the grade. It receives the grade (and the inputs
 * that produced it) and writes the justification around it. This way two
 * runs of the same trace always yield the same grade.
 *
 * Formula (Option C — explicit weights):
 *
 *   grade = 10 × (0.7 × M  +  0.2 × (1 − T)  +  0.1 × (1 − P))
 *
 *   M = completed / total                        (milestone coverage)
 *   T = clamp((actual − target) / target, 0, 1)  (lateness; target = estimated_minutes)
 *   P = clamp(hints / total, 0, 1)               (autonomy)
 *
 * Edge cases:
 * - If `estimated_minutes` is not defined, skip the time penalty: redistribute
 *   the time weight onto the other two so the formula stays out of 10.
 * - If `total` milestones is 0, grade = 0.
 */

import type { WorkflowData } from './workflow-types.js';
import type { TraceExport } from './trace-export.js';

export interface GradingWeights {
  milestones: number;
  time: number;
  hints: number;
}

export const DEFAULT_WEIGHTS: GradingWeights = {
  milestones: 0.7,
  time: 0.2,
  hints: 0.1,
};

export interface GradingInputs {
  completed: number;
  total: number;
  hints: number;
  /** Seconds elapsed during the case. */
  durationSeconds: number;
  /** From workflow.case.estimated_minutes. Undefined → time penalty disabled. */
  estimatedMinutes?: number | undefined;
}

export interface GradingResult {
  /** The final 0–10 grade, rounded to 1 decimal. */
  grade: number;
  /** Same number, raw (not rounded) — useful for debugging. */
  gradeRaw: number;
  /** Component scores, all in [0, 1]. */
  components: {
    /** M — milestone coverage (1 = perfect). */
    milestones: number;
    /** 1 − T — time score (1 = on or under target, 0 = at/over double). */
    time: number;
    /** 1 − P — autonomy score (1 = no hints). */
    autonomy: number;
  };
  /** Weights actually applied (after redistribution if any). */
  weights: GradingWeights;
  /** True if `estimatedMinutes` was missing and time was redistributed. */
  timeSkipped: boolean;
}

/** Round to 1 decimal — e.g. 8.473 → 8.5. */
function round1(x: number): number {
  return Math.round(x * 10) / 10;
}

function clamp01(x: number): number {
  if (Number.isNaN(x)) return 0;
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

export function computeGrade(
  inputs: GradingInputs,
  weights: GradingWeights = DEFAULT_WEIGHTS,
): GradingResult {
  const { completed, total, hints, durationSeconds, estimatedMinutes } = inputs;

  // Milestone coverage M
  const M = total > 0 ? clamp01(completed / total) : 0;

  // Time penalty T (lateness over target). target = estimated_minutes (no margin).
  const hasTime =
    typeof estimatedMinutes === 'number' && estimatedMinutes > 0;
  let T = 0;
  if (hasTime) {
    const targetSeconds = estimatedMinutes! * 60;
    T = clamp01((durationSeconds - targetSeconds) / targetSeconds);
  }
  const timeScore = 1 - T;

  // Hints penalty P (capped at total milestones — beyond that, fully penalised).
  const P = total > 0 ? clamp01(hints / total) : (hints > 0 ? 1 : 0);
  const autonomyScore = 1 - P;

  // Effective weights (redistribute time weight if no estimated_minutes).
  let w = weights;
  if (!hasTime) {
    const m = weights.milestones + weights.time;
    // Redistribute the time weight proportionally onto milestones (keep
    // hints weight steady — it's a small slice and we don't want to
    // overweight autonomy because a workflow lacked an estimate).
    w = {
      milestones: m,
      time: 0,
      hints: weights.hints,
    };
  }

  const gradeRaw =
    10 * (w.milestones * M + w.time * timeScore + w.hints * autonomyScore);
  const grade = clamp01(gradeRaw / 10) * 10; // safety
  return {
    grade: round1(grade),
    gradeRaw,
    components: {
      milestones: round1(M * 10) / 10,
      time: round1(timeScore * 10) / 10,
      autonomy: round1(autonomyScore * 10) / 10,
    },
    weights: w,
    timeSkipped: !hasTime,
  };
}

/**
 * Convenience: compute grade straight from a workflow + trace export pair.
 * Both the extension and the server build a TraceExport before evaluation,
 * so this is the canonical entry point for both sides.
 */
export function gradeFromTrace(
  workflow: WorkflowData,
  traceExport: TraceExport,
): GradingResult {
  const total = workflow.phases.reduce(
    (acc, p) => acc + p.milestones.length,
    0,
  );
  const completed = traceExport.outcome?.milestones_completed?.length ?? 0;
  const hints = traceExport.timeline.filter(
    (e) => e.type === 'hint_received',
  ).length;
  const durationSeconds = traceExport.session?.duration_seconds ?? 0;
  const estimatedMinutes =
    typeof workflow.case.estimated_minutes === 'number'
      ? workflow.case.estimated_minutes
      : undefined;

  return computeGrade({
    completed,
    total,
    hints,
    durationSeconds,
    estimatedMinutes,
  });
}
