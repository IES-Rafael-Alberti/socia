/**
 * SOCIA grading formula — DETERMINISTIC.
 *
 * The LLM no longer decides the grade. It receives the grade (and the inputs
 * that produced it) and writes the justification around it. This way two
 * runs of the same trace always yield the same grade.
 *
 * Formula:
 *
 *   base         = (completed / total) × 10           // 0..10
 *   time_penalty = max(0, durationMinutes − estimatedMinutes)
 *                                                     // 1 point per minute over,
 *                                                     // 0 if within estimate or
 *                                                     // estimated_minutes missing
 *   hint_penalty = hints × 0.25
 *
 *   grade        = clamp(base − time_penalty − hint_penalty, 0, 10)
 *
 * Properties:
 * - 0 milestones completed → grade = 0 (no "free points" from being fast or
 *   not asking for hints).
 * - All milestones, within time, no hints → grade = 10.
 * - Time and hints only ever subtract; they never add.
 * - Time penalty is continuous (30s over the estimate = 0.5 points off).
 */

import type { WorkflowData } from './workflow-types.js';
import type { TraceExport } from './trace-export.js';

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
  /** The final 0–10 grade, clamped and rounded to 1 decimal. */
  grade: number;
  /** Raw `base − time_penalty − hint_penalty` (may be negative). For debugging. */
  gradeRaw: number;
  /** Milestone coverage in [0, 1] = completed / total. */
  milestoneCoverage: number;
  /** Inputs echoed for downstream display. */
  completed: number;
  total: number;
  hints: number;
  /** Base score from milestones, in [0, 10]. */
  base: number;
  /** Points subtracted by the time penalty (≥ 0). */
  timePenalty: number;
  /** Minutes over the estimate (≥ 0). 0 if within estimate or no estimate. */
  minutesOverEstimate: number;
  /** Points subtracted by the hint penalty (= hints × 0.25). */
  hintPenalty: number;
  /** True if the workflow had `estimated_minutes`; false → time penalty disabled. */
  estimateAvailable: boolean;
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

export function computeGrade(inputs: GradingInputs): GradingResult {
  const { completed, total, hints, durationSeconds, estimatedMinutes } = inputs;

  // Base: linear with milestone coverage.
  const milestoneCoverage = total > 0 ? clamp01(completed / total) : 0;
  const base = milestoneCoverage * 10;

  // Time penalty: 1 point per minute over the estimate; never below 0.
  const estimateAvailable =
    typeof estimatedMinutes === 'number' && estimatedMinutes > 0;
  const minutesOverEstimate = estimateAvailable
    ? Math.max(0, durationSeconds / 60 - estimatedMinutes!)
    : 0;
  const timePenalty = minutesOverEstimate;

  // Hint penalty: 0.25 per hint requested.
  const hintPenalty = Math.max(0, hints) * 0.25;

  const gradeRaw = base - timePenalty - hintPenalty;
  const grade = round1(Math.max(0, Math.min(10, gradeRaw)));

  return {
    grade,
    gradeRaw,
    milestoneCoverage,
    completed,
    total,
    hints,
    base: round1(base),
    timePenalty: round1(timePenalty),
    minutesOverEstimate: round1(minutesOverEstimate),
    hintPenalty: round1(hintPenalty),
    estimateAvailable,
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
