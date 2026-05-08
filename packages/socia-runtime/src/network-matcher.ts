/**
 * Network Signature Matcher.
 *
 * Compares intercepted network events against milestone network_signatures
 * to determine which milestones the student has completed.
 */

import type {
  WorkflowData,
  WorkflowPhase,
  Milestone,
  NetworkSignature,
  StudentNetworkEvent,
} from '@socia/eval';

/**
 * Interpolate {{variable}} placeholders in a string using workflow variables.
 */
function interpolate(text: string, vars: Record<string, string>): string {
  return text.replace(/\{\{(\w+(?:\.\w+)*)\}\}/g, (match, key) => vars[key] ?? match);
}

/**
 * Check if a string or array of strings is contained in the target.
 * For arrays: match_mode determines if ALL must match (default) or ANY.
 */
function containsCheck(
  target: string | null | undefined,
  pattern: string | string[] | null | undefined,
  vars: Record<string, string>,
  matchMode: 'all' | 'any_of_body' = 'all'
): boolean {
  if (pattern === null || pattern === undefined) return true; // null = don't check
  if (!target) return false;

  const targetLower = target.toLowerCase();

  if (typeof pattern === 'string') {
    const interpolated = interpolate(pattern, vars).toLowerCase();
    return targetLower.includes(interpolated);
  }

  // Array of patterns
  if (matchMode === 'any_of_body') {
    return pattern.some((p) => {
      const interpolated = interpolate(p, vars).toLowerCase();
      return targetLower.includes(interpolated);
    });
  }

  // Default: all must match
  return pattern.every((p) => {
    const interpolated = interpolate(p, vars).toLowerCase();
    return targetLower.includes(interpolated);
  });
}

/**
 * Check if a URL contains the pattern(s).
 * For arrays: at least ONE must match (URL_contains is always OR).
 * Supports {{variable}} interpolation.
 */
function urlContainsCheck(
  url: string,
  pattern: string | string[],
  vars: Record<string, string>
): boolean {
  const urlLower = url.toLowerCase();
  if (typeof pattern === 'string') {
    return urlLower.includes(interpolate(pattern, vars).toLowerCase());
  }
  return pattern.some((p) => urlLower.includes(interpolate(p, vars).toLowerCase()));
}

/**
 * Check if a network event matches a milestone's network_signature.
 */
export function matchesSignature(
  event: StudentNetworkEvent,
  signature: NetworkSignature,
  vars: Record<string, string>,
  matchMode: 'all' | 'any_of_body' = 'all'
): boolean {
  // 1. Method check
  const methods = typeof signature.method === 'string' ? [signature.method] : signature.method;
  if (!methods.some((m) => m.toUpperCase() === event.method.toUpperCase())) {
    return false;
  }

  // 2. Host check (interpolate {{variables}})
  const hostPattern = interpolate(signature.host_contains, vars).toLowerCase();
  if (!event.host.toLowerCase().includes(hostPattern)) {
    return false;
  }

  // 3. URL path check (interpolate {{variables}})
  if (!urlContainsCheck(event.url, signature.url_contains, vars)) {
    return false;
  }

  // 4. Status check
  if (!signature.response_status.includes(event.status)) {
    return false;
  }

  // 5. Request body check
  if (!containsCheck(event.requestBody, signature.request_body_contains, vars, matchMode)) {
    return false;
  }

  // 6. Response body check
  if (!containsCheck(event.responseBody, signature.response_body_contains, vars, matchMode)) {
    return false;
  }

  return true;
}

/**
 * Check if a milestone's dependencies are all satisfied.
 */
function areDependenciesMet(
  milestone: Milestone,
  completedIds: Set<string>
): boolean {
  // Check same-phase dependencies
  if (milestone.depends_on) {
    for (const dep of milestone.depends_on) {
      if (!completedIds.has(dep)) return false;
    }
  }

  // Check cross-phase dependency
  if (milestone.after_milestone) {
    if (!completedIds.has(milestone.after_milestone)) return false;
  }

  return true;
}

/**
 * Given a new network event, check all pending milestones across all phases.
 * Returns the IDs of any newly completed milestones.
 */
export function checkMilestones(
  workflow: WorkflowData,
  event: StudentNetworkEvent,
  completedMilestoneIds: string[]
): string[] {
  const completedSet = new Set(completedMilestoneIds);
  const newlyCompleted: string[] = [];

  for (const phase of workflow.phases) {
    for (const milestone of phase.milestones) {
      // Skip already completed
      if (completedSet.has(milestone.id)) continue;

      // Check dependencies
      if (!areDependenciesMet(milestone, completedSet)) continue;

      // Check network signature match
      if (matchesSignature(event, milestone.network_signature, workflow.variables, milestone.match_mode)) {
        newlyCompleted.push(milestone.id);
        completedSet.add(milestone.id); // So subsequent milestones in this loop can see it
        console.log(`[SOCIA Matcher] ✅ Milestone completed: ${milestone.id} (${milestone.label})`);
      }
    }
  }

  return newlyCompleted;
}

/**
 * Determine the current phase based on milestone progress.
 * The current phase is the first phase that has uncompleted milestones.
 * If all milestones in all phases are complete, returns the last phase index.
 */
export function detectPhaseByMilestones(
  workflow: WorkflowData,
  completedMilestoneIds: string[]
): number {
  const completedSet = new Set(completedMilestoneIds);

  for (let i = 0; i < workflow.phases.length; i++) {
    const phase = workflow.phases[i];
    const allCompleted = phase.milestones.every((m) => completedSet.has(m.id));
    if (!allCompleted) return i;
  }

  // All phases complete — return last phase index
  return workflow.phases.length - 1;
}

/**
 * Get the next pending milestone in the current phase (for hints).
 * Returns the first milestone whose dependencies are met but is not yet completed.
 */
export function getNextPendingMilestone(
  phase: WorkflowPhase,
  completedMilestoneIds: string[]
): Milestone | null {
  const completedSet = new Set(completedMilestoneIds);

  for (const milestone of phase.milestones) {
    if (completedSet.has(milestone.id)) continue;
    if (areDependenciesMet(milestone, completedSet)) {
      return milestone;
    }
  }

  return null;
}
