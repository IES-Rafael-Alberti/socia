/**
 * @socia/eval — pure, environment-agnostic evaluation primitives.
 *
 * Used by both the SOCIA extension (standalone evaluation in the service
 * worker) and the SOCIA Server (managed evaluation per submission).
 *
 * No `chrome.*`, no `fs`, no `express`. Only types, deterministic grading,
 * prompt builders, and the jsPDF-based PDF renderer.
 */

export * from './workflow-types';
export * from './trace-export';
export * from './grading';
export * from './eval-prompt';
export * from './evaluation-pdf';
