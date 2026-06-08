/**
 * Types for the SOCIA workflow JSON.
 *
 * A workflow describes a SOC case as a sequence of phases, each with
 * milestones verified by the HTTP requests the student is expected to make.
 * Phase progression is derived from milestone completion, not from URLs.
 */

// ──────────────── Network Signature ────────────────

/** Describes the HTTP request that proves a milestone was achieved */
export interface NetworkSignature {
  /** HTTP method (or array for multiple valid methods) */
  method: string | string[];
  /** String(s) that must appear in the URL path */
  url_contains: string | string[];
  /** String that must appear in the host (e.g. "172.17.33.104") */
  host_contains: string;
  /** Valid response status codes */
  response_status: number[];
  /**
   * String(s) that must appear in the request body.
   * null = don't check body. Supports {{variables}}.
   * If array: depends on match_mode (default: all must match).
   */
  request_body_contains?: string | string[] | null;
  /**
   * String(s) that must appear in the response body.
   * null = don't check body.
   */
  response_body_contains?: string | string[] | null;
}

// ──────────────── Milestone ────────────────

export interface Milestone {
  id: string;
  /** Human-readable label (shown in guided mode UI) */
  label: string;
  /** The HTTP request that verifies this milestone */
  network_signature: NetworkSignature;
  /** Milestone IDs that must be completed before this one is evaluated */
  depends_on?: string[];
  /**
   * Cross-phase dependency: this milestone only activates after a
   * milestone from a previous phase has been completed.
   */
  after_milestone?: string;
  /**
   * How to match request_body_contains when it's an array:
   * - "all" = every string must be present (default)
   * - "any_of_body" = at least one string must be present
   */
  match_mode?: 'all' | 'any_of_body';
  /**
   * Progressive hint examples: 3 pistas de menos a más directa.
   * The LLM uses these as reference for tone and content.
   * Supports {{variables}}.
   */
  hint_examples?: string[];
}

// ──────────────── Phases ────────────────

export interface WorkflowPhase {
  id: string;
  title: string;
  description: string;
  role?: string;
  order: number;
  /** Hosts for this phase's tool (used for network event filtering) */
  tool_hosts: string[];
  /** Milestones for this phase */
  milestones: Milestone[];
}

// ──────────────── Context ────────────────

export interface WorkflowContext {
  /** Description of each tool so the LLM understands them */
  tools: Record<string, string>;
  /** Learning objective per phase (keyed by phase id) */
  pedagogy: Record<string, string>;
  /** Free-form teacher notes for the LLM */
  notes: string;
}

// ──────────────── Case ────────────────

export interface WorkflowCase {
  id: string;
  title: string;
  description: string;
  difficulty?: string;
  estimated_minutes?: number;
}

// ──────────────── Top-level Workflow ────────────────

export interface WorkflowData {
  case: WorkflowCase;
  /** Case-specific variables: attacker_ip, victim_ip, alert_id, etc. */
  variables: Record<string, string>;
  /** LLM context: tool descriptions, pedagogy, teacher notes */
  context: WorkflowContext;
  phases: WorkflowPhase[];
}

// ──────────────── Student Action (DOM events, recorded by SOCIA content script) ────────────────

export interface StudentAction {
  type: 'click' | 'input' | 'navigation' | 'form_submit';
  timestamp: number;
  url: string;
  elementText?: string;
  selector?: string;
  inputValue?: string;
}

// ──────────────── Student Network Event (captured by fetch/XHR interceptor) ────────────────

export interface StudentNetworkEvent {
  timestamp: number;
  method: string;
  url: string;
  host: string;
  pathname: string;
  status: number;
  contentType: string;
  requestBody: string | null;
  responseBody: string | null;
}

// ──────────────── SOCIA Internal State ────────────────

export interface SociaState {
  workflowId: string;
  workflowName: string;
  /** Index of the current active phase (determined by milestone progress) */
  currentPhaseIndex: number;
  timerStartTime: number;
  isActive: boolean;
  /** Set of completed milestone IDs */
  completedMilestones: string[];
  /** Epoch ms when each milestone was completed (keyed by milestone id) */
  milestoneCompletedAt: Record<string, number>;
  /** Epoch ms when the student first entered each phase (keyed by phase id) */
  phaseEnteredAt: Record<string, number>;
}

// ──────────────── Hint Event (for export timeline) ────────────────

export interface HintEvent {
  timestamp: number;
  milestone_id: string;
  hint: string;
}

// ──────────────── Messages ────────────────

export type SociaMessageType =
  | 'SOCIA_LOAD_WORKFLOW'
  | 'SOCIA_GET_STATE'
  | 'SOCIA_RESET_CASE'
  | 'SOCIA_FINISH_CASE'
  | 'SOCIA_STUDENT_ACTION'
  | 'SOCIA_STUDENT_NETWORK_EVENT'
  | 'SOCIA_REQUEST_HINT'
  | 'SOCIA_EXPORT_TRACE'
  | 'SOCIA_STATE_CHANGED';
