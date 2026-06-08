/**
 * Trace export.
 *
 * Produces a compact, evaluator-friendly JSON that narrates what the student
 * did, when, which hints they received, and how far they got.
 *
 * The workflow itself is NOT embedded — consumers receive the workflow.json
 * separately and correlate by `case_id`. This keeps exports small and focused
 * on the student's own behaviour.
 *
 * Design decisions:
 * - Timestamps in the timeline are relative strings ("mm:ss") for LLM readability.
 * - Hints are inline in the timeline, not in a separate section, so the
 *   evaluator sees what the student did right before and right after each hint.
 * - Noise filtering: clicks on the floating hint overlay, very long captcha URLs,
 *   and obvious non-SOC navigations are not dropped but trimmed.
 */

import type {
  WorkflowData,
  StudentAction,
  SociaState,
  HintEvent,
} from './workflow-types.js';

// ──────────────── Types ────────────────

type TimelineEvent =
  | { at: string; type: 'session_start' }
  | { at: string; type: 'session_end' }
  | {
      at: string;
      type: 'navigation';
      url: string;
    }
  | {
      at: string;
      type: 'click';
      url: string;
      elementText?: string;
      selector?: string;
    }
  | {
      at: string;
      type: 'input';
      url: string;
      selector?: string;
      value?: string;
    }
  | {
      at: string;
      type: 'form_submit';
      url: string;
      selector?: string;
    }
  | {
      at: string;
      type: 'milestone_completed';
      milestone_id: string;
    }
  | {
      at: string;
      type: 'phase_entered';
      phase_id: string;
    }
  | {
      at: string;
      type: 'hint_received';
      milestone_id: string;
      hint: string;
    };

export interface TraceExport {
  exported_at: string;
  case_id: string;

  session: {
    started_at: string;
    finished_at: string;
    duration: string;
    duration_seconds: number;
    mode: 'guided' | 'unguided';
  };

  outcome: {
    milestones_completed: string[];
    milestones_total: number;
    completion_rate: number;
    by_phase: Array<{
      phase_id: string;
      completed: number;
      total: number;
      entered_at: string | null;
      time_in_phase_seconds: number;
      phase_completed: boolean;
    }>;
    milestones: Array<{
      id: string;
      completed_at: string | null;
    }>;
  };

  timeline: TimelineEvent[];
}

// ──────────────── Time formatting ────────────────

/**
 * Format seconds as mm:ss or hh:mm:ss depending on magnitude.
 * Used for the `at` field in timeline events and for `duration` / `completed_at`.
 */
function formatRelative(seconds: number): string {
  if (seconds < 0) seconds = 0;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const pad = (n: number) => String(n).padStart(2, '0');
  if (h > 0) return `${pad(h)}:${pad(m)}:${pad(s)}`;
  return `${pad(m)}:${pad(s)}`;
}

/** Convert an epoch ms timestamp to a relative "mm:ss" string from session start. */
function toRelative(timestampMs: number, startMs: number): string {
  return formatRelative((timestampMs - startMs) / 1000);
}

// ──────────────── Noise filtering ────────────────

const MAX_URL_LENGTH = 200;

/**
 * URLs with query strings longer than MAX_URL_LENGTH are truncated so the
 * export stays readable. Common culprits: Google captcha redirects, tracking
 * params, OAuth flows.
 */
function cleanUrl(url: string | undefined): string {
  if (!url) return '';
  if (url.length <= MAX_URL_LENGTH) return url;
  return url.substring(0, MAX_URL_LENGTH) + '…[truncated]';
}

/** Clicks on the floating hint overlay are represented as hint_received events,
 * not as clicks — drop them from the action trace. */
function isOverlayClick(action: StudentAction): boolean {
  return action.type === 'click' && action.selector === '#socia-hint-overlay';
}

// ──────────────── Build timeline ────────────────

function buildTimeline(
  state: SociaState,
  trace: StudentAction[],
  hintEvents: HintEvent[],
  sessionStartMs: number,
  sessionEndMs: number,
  phaseIdList: string[]
): TimelineEvent[] {
  const events: Array<{ ts: number; event: TimelineEvent }> = [];

  // Session bounds
  events.push({
    ts: sessionStartMs,
    event: { at: formatRelative(0), type: 'session_start' },
  });

  // Student actions
  for (const a of trace) {
    if (isOverlayClick(a)) continue; // captured as hint_received instead

    const at = toRelative(a.timestamp, sessionStartMs);
    switch (a.type) {
      case 'navigation':
        events.push({
          ts: a.timestamp,
          event: { at, type: 'navigation', url: cleanUrl(a.url) },
        });
        break;
      case 'click':
        events.push({
          ts: a.timestamp,
          event: {
            at,
            type: 'click',
            url: cleanUrl(a.url),
            elementText: a.elementText || undefined,
            selector: a.selector || undefined,
          },
        });
        break;
      case 'input':
        events.push({
          ts: a.timestamp,
          event: {
            at,
            type: 'input',
            url: cleanUrl(a.url),
            selector: a.selector || undefined,
            value: a.inputValue || undefined,
          },
        });
        break;
      case 'form_submit':
        events.push({
          ts: a.timestamp,
          event: {
            at,
            type: 'form_submit',
            url: cleanUrl(a.url),
            selector: a.selector || undefined,
          },
        });
        break;
    }
  }

  // Milestone completions
  for (const [id, ts] of Object.entries(state.milestoneCompletedAt)) {
    events.push({
      ts,
      event: {
        at: toRelative(ts, sessionStartMs),
        type: 'milestone_completed',
        milestone_id: id,
      },
    });
  }

  // Phase transitions — skip phase 0 (same timestamp as session_start, noisy)
  for (const [phaseId, ts] of Object.entries(state.phaseEnteredAt)) {
    // Only emit transitions that happen after session start (by more than 1s)
    if (ts - sessionStartMs < 1000) continue;
    events.push({
      ts,
      event: {
        at: toRelative(ts, sessionStartMs),
        type: 'phase_entered',
        phase_id: phaseId,
      },
    });
  }

  // Hints
  for (const h of hintEvents) {
    events.push({
      ts: h.timestamp,
      event: {
        at: toRelative(h.timestamp, sessionStartMs),
        type: 'hint_received',
        milestone_id: h.milestone_id,
        hint: h.hint,
      },
    });
  }

  // Session end
  events.push({
    ts: sessionEndMs,
    event: {
      at: toRelative(sessionEndMs, sessionStartMs),
      type: 'session_end',
    },
  });

  // Stable sort by timestamp. For events with the same timestamp, preserve
  // the order in which we appended them (actions before milestones, since
  // the action is usually what triggered the milestone completion).
  events.sort((a, b) => a.ts - b.ts);

  return events.map((e) => e.event);
  void phaseIdList; // reserved for potential future ordering; kept to avoid unused-param lint
}

// ──────────────── Build outcome ────────────────

function buildOutcome(
  workflow: WorkflowData,
  state: SociaState,
  sessionStartMs: number,
  sessionEndMs: number
): TraceExport['outcome'] {
  const completedSet = new Set(state.completedMilestones);
  const totalMilestones = workflow.phases.reduce(
    (sum, p) => sum + p.milestones.length,
    0
  );

  // Per-phase outcome
  const byPhase = workflow.phases.map((phase, idx) => {
    const phaseCompleted = phase.milestones.filter((m) => completedSet.has(m.id));
    const enteredMs = state.phaseEnteredAt[phase.id] ?? null;
    const enteredAt = enteredMs !== null ? toRelative(enteredMs, sessionStartMs) : null;

    // Time in phase = from when entered, until either (a) next phase was entered,
    // or (b) session ended.
    let timeInPhaseSeconds = 0;
    if (enteredMs !== null) {
      const nextPhase = workflow.phases[idx + 1];
      const nextEnteredMs = nextPhase ? state.phaseEnteredAt[nextPhase.id] : null;
      const exitMs = nextEnteredMs ?? sessionEndMs;
      timeInPhaseSeconds = Math.max(0, Math.floor((exitMs - enteredMs) / 1000));
    }

    return {
      phase_id: phase.id,
      completed: phaseCompleted.length,
      total: phase.milestones.length,
      entered_at: enteredAt,
      time_in_phase_seconds: timeInPhaseSeconds,
      phase_completed:
        phase.milestones.length > 0 && phaseCompleted.length === phase.milestones.length,
    };
  });

  // Per-milestone outcome (flat list, preserves workflow order)
  const milestones: Array<{ id: string; completed_at: string | null }> = [];
  for (const phase of workflow.phases) {
    for (const m of phase.milestones) {
      const ts = state.milestoneCompletedAt[m.id];
      milestones.push({
        id: m.id,
        completed_at: ts !== undefined ? toRelative(ts, sessionStartMs) : null,
      });
    }
  }

  return {
    milestones_completed: state.completedMilestones,
    milestones_total: totalMilestones,
    completion_rate:
      totalMilestones > 0
        ? Number((state.completedMilestones.length / totalMilestones).toFixed(3))
        : 0,
    by_phase: byPhase,
    milestones,
  };
}

// ──────────────── Entrypoint ────────────────

export function buildTraceExport(
  workflow: WorkflowData,
  state: SociaState,
  trace: StudentAction[],
  hintEvents: HintEvent[] = [],
  mode: 'guided' | 'unguided' = 'guided'
): TraceExport {
  const sessionStartMs = state.timerStartTime;
  const sessionEndMs = Date.now();
  const durationSeconds = Math.max(0, Math.floor((sessionEndMs - sessionStartMs) / 1000));

  const phaseIdList = workflow.phases.map((p) => p.id);

  return {
    exported_at: new Date(sessionEndMs).toISOString(),
    case_id: workflow.case.id,

    session: {
      started_at: new Date(sessionStartMs).toISOString(),
      finished_at: new Date(sessionEndMs).toISOString(),
      duration: formatRelative(durationSeconds),
      duration_seconds: durationSeconds,
      mode,
    },

    outcome: buildOutcome(workflow, state, sessionStartMs, sessionEndMs),

    timeline: buildTimeline(
      state,
      trace,
      hintEvents,
      sessionStartMs,
      sessionEndMs,
      phaseIdList
    ),
  };
}

// ──────────────── Download ────────────────

export function traceExportToJson(exportData: TraceExport): string {
  return JSON.stringify(exportData, null, 2);
}

export function buildExportFilenameBase(exportData: TraceExport): string {
  const timestamp = new Date()
    .toISOString()
    .replace(/[:.]/g, '-')
    .substring(0, 19);
  const caseId = exportData.case_id || 'caso';
  return `socia-${caseId}-${timestamp}`;
}

/**
 * NOTE: download helper used to live here, but that pulled `chrome.downloads`
 * into the shared module. The download is now in `utils/socia/trace-export.ts`
 * which re-exports the rest of this module.
 */
