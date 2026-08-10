import type {
  Milestone,
  NetworkSignature,
  WorkflowData,
  WorkflowPhase,
} from './workflow-types.js';


export interface WorkflowValidationIssue {
  path: string;
  message: string;
}

export interface WorkflowValidationResult {
  valid: boolean;
  errors: WorkflowValidationIssue[];
  warnings: WorkflowValidationIssue[];
}

export class WorkflowValidationError extends Error {
  readonly issues: WorkflowValidationIssue[];

  constructor(issues: WorkflowValidationIssue[]) {
    super(formatWorkflowValidationIssues(issues));
    this.name = 'WorkflowValidationError';
    this.issues = issues;
  }
}

const PLACEHOLDER = /\{\{(\w+(?:\.\w+)*)\}\}/g;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function add(
  issues: WorkflowValidationIssue[],
  path: string,
  message: string,
): void {
  issues.push({ path, message });
}

function checkFields(
  value: Record<string, unknown>,
  path: string,
  required: string[],
  optional: string[],
  errors: WorkflowValidationIssue[],
): void {
  for (const field of required) {
    if (!(field in value)) add(errors, `${path}.${field}`, 'Falta este campo.');
  }
  const allowed = new Set([...required, ...optional]);
  for (const field of Object.keys(value)) {
    if (!allowed.has(field)) add(errors, `${path}.${field}`, 'Este campo no está permitido.');
  }
}

function checkString(
  value: unknown,
  path: string,
  errors: WorkflowValidationIssue[],
): value is string {
  if (typeof value !== 'string' || value.length === 0) {
    add(errors, path, 'Debe ser un texto no vacío.');
    return false;
  }
  return true;
}

function checkStringArray(
  value: unknown,
  path: string,
  errors: WorkflowValidationIssue[],
  allowEmpty = false,
): value is string[] {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) {
    add(errors, path, allowEmpty ? 'Debe ser una lista.' : 'Debe ser una lista no vacía.');
    return false;
  }
  value.forEach((item, index) => checkString(item, `${path}[${index}]`, errors));
  return value.every((item) => typeof item === 'string' && item.length > 0);
}

function checkStringRecord(
  value: unknown,
  path: string,
  errors: WorkflowValidationIssue[],
): value is Record<string, string> {
  if (!isRecord(value)) {
    add(errors, path, 'Debe ser un objeto de textos.');
    return false;
  }
  for (const [key, item] of Object.entries(value)) {
    checkString(item, `${path}.${key}`, errors);
  }
  return Object.values(value).every((item) => typeof item === 'string' && item.length > 0);
}

function checkPattern(
  value: unknown,
  path: string,
  errors: WorkflowValidationIssue[],
): value is string | string[] {
  return typeof value === 'string'
    ? checkString(value, path, errors)
    : checkStringArray(value, path, errors);
}

function checkOptionalPattern(
  value: unknown,
  path: string,
  errors: WorkflowValidationIssue[],
): void {
  if (value === undefined || value === null) return;
  checkPattern(value, path, errors);
}

function checkSignature(
  value: unknown,
  path: string,
  errors: WorkflowValidationIssue[],
): value is NetworkSignature {
  if (!isRecord(value)) {
    add(errors, path, 'Debe ser una firma de red.');
    return false;
  }
  checkFields(
    value,
    path,
    ['method', 'url_contains', 'host_contains', 'response_status'],
    ['request_body_contains', 'response_body_contains'],
    errors,
  );
  checkPattern(value.method, `${path}.method`, errors);
  checkPattern(value.url_contains, `${path}.url_contains`, errors);
  checkString(value.host_contains, `${path}.host_contains`, errors);
  if (!Array.isArray(value.response_status) || value.response_status.length === 0) {
    add(errors, `${path}.response_status`, 'Debe ser una lista no vacía.');
  } else {
    value.response_status.forEach((status, index) => {
      if (!Number.isInteger(status)) {
        add(errors, `${path}.response_status[${index}]`, 'Debe ser un número entero.');
      }
    });
  }
  checkOptionalPattern(value.request_body_contains, `${path}.request_body_contains`, errors);
  checkOptionalPattern(value.response_body_contains, `${path}.response_body_contains`, errors);
  return true;
}

function checkMilestone(
  value: unknown,
  path: string,
  errors: WorkflowValidationIssue[],
): value is Milestone {
  if (!isRecord(value)) {
    add(errors, path, 'Debe ser un hito.');
    return false;
  }
  checkFields(
    value,
    path,
    ['id', 'label'],
    [
      'network_signature',
      'network_signatures',
      'depends_on',
      'after_milestone',
      'match_mode',
      'hint_examples',
    ],
    errors,
  );
  checkString(value.id, `${path}.id`, errors);
  checkString(value.label, `${path}.label`, errors);

  const hasSingle = value.network_signature !== undefined;
  const hasAlternatives = value.network_signatures !== undefined;
  if (hasSingle === hasAlternatives) {
    add(
      errors,
      path,
      'Usa solo network_signature o network_signatures, y define uno de los dos.',
    );
  }
  if (hasSingle) checkSignature(value.network_signature, `${path}.network_signature`, errors);
  if (hasAlternatives) {
    if (!Array.isArray(value.network_signatures) || value.network_signatures.length === 0) {
      add(errors, `${path}.network_signatures`, 'Debe contener al menos una firma.');
    } else {
      value.network_signatures.forEach((signature, index) =>
        checkSignature(signature, `${path}.network_signatures[${index}]`, errors),
      );
    }
  }
  if (value.depends_on !== undefined) {
    checkStringArray(value.depends_on, `${path}.depends_on`, errors, true);
  }
  if (value.after_milestone !== undefined) {
    checkString(value.after_milestone, `${path}.after_milestone`, errors);
  }
  if (value.match_mode !== undefined && !['all', 'any_of_body'].includes(String(value.match_mode))) {
    add(errors, `${path}.match_mode`, 'Debe ser all o any_of_body.');
  }
  if (value.hint_examples !== undefined) {
    checkStringArray(value.hint_examples, `${path}.hint_examples`, errors, true);
  }
  return true;
}

function checkPhase(
  value: unknown,
  path: string,
  errors: WorkflowValidationIssue[],
): value is WorkflowPhase {
  if (!isRecord(value)) {
    add(errors, path, 'Debe ser una fase.');
    return false;
  }
  checkFields(
    value,
    path,
    ['id', 'title', 'description', 'order', 'tool_hosts', 'milestones'],
    ['role'],
    errors,
  );
  checkString(value.id, `${path}.id`, errors);
  checkString(value.title, `${path}.title`, errors);
  checkString(value.description, `${path}.description`, errors);
  if (value.role !== undefined) checkString(value.role, `${path}.role`, errors);
  if (!Number.isInteger(value.order)) add(errors, `${path}.order`, 'Debe ser un número entero.');
  checkStringArray(value.tool_hosts, `${path}.tool_hosts`, errors);
  if (!Array.isArray(value.milestones) || value.milestones.length === 0) {
    add(errors, `${path}.milestones`, 'Debe contener al menos un hito.');
  } else {
    value.milestones.forEach((milestone, index) =>
      checkMilestone(milestone, `${path}.milestones[${index}]`, errors),
    );
  }
  return true;
}

function walkStrings(value: unknown, path = ''): Array<[string, string]> {
  if (typeof value === 'string') return [[path, value]];
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => walkStrings(item, `${path}[${index}]`));
  }
  if (isRecord(value)) {
    return Object.entries(value).flatMap(([key, item]) =>
      walkStrings(item, path ? `${path}.${key}` : key),
    );
  }
  return [];
}

function semanticChecks(
  workflow: WorkflowData,
  errors: WorkflowValidationIssue[],
  warnings: WorkflowValidationIssue[],
): void {
  const variables = new Set(Object.keys(workflow.variables));
  for (const [path, text] of walkStrings(workflow)) {
    if (path.startsWith('variables.')) continue;
    for (const match of text.matchAll(PLACEHOLDER)) {
      const name = match[1];
      if (!variables.has(name)) add(errors, path, `La variable {{${name}}} no está definida.`);
    }
  }

  const phaseIds = new Map<string, number>();
  const phaseOrders = new Map<number, number>();
  const milestonePhase = new Map<string, { phaseId: string; order: number; path: string }>();

  workflow.phases.forEach((phase, phaseIndex) => {
    const phasePath = `phases[${phaseIndex}]`;
    if (phaseIds.has(phase.id)) add(errors, `${phasePath}.id`, `El id ${phase.id} está repetido.`);
    else phaseIds.set(phase.id, phaseIndex);
    if (phaseOrders.has(phase.order)) {
      add(errors, `${phasePath}.order`, `El orden ${phase.order} está repetido.`);
    } else phaseOrders.set(phase.order, phaseIndex);

    phase.milestones.forEach((milestone, milestoneIndex) => {
      const milestonePath = `${phasePath}.milestones[${milestoneIndex}]`;
      if (milestonePhase.has(milestone.id)) {
        add(errors, `${milestonePath}.id`, `El id ${milestone.id} está repetido.`);
      } else {
        milestonePhase.set(milestone.id, {
          phaseId: phase.id,
          order: phase.order,
          path: milestonePath,
        });
      }
      if (milestone.hint_examples && milestone.hint_examples.length !== 3) {
        add(warnings, `${milestonePath}.hint_examples`, 'Se recomiendan tres pistas progresivas.');
      }
    });
  });

  workflow.phases.forEach((phase, phaseIndex) => {
    const ids = new Set(phase.milestones.map((milestone) => milestone.id));
    const graph = new Map<string, string[]>();
    phase.milestones.forEach((milestone, milestoneIndex) => {
      const path = `phases[${phaseIndex}].milestones[${milestoneIndex}]`;
      graph.set(milestone.id, milestone.depends_on ?? []);
      for (const dependency of milestone.depends_on ?? []) {
        if (!ids.has(dependency)) {
          add(errors, `${path}.depends_on`, `${dependency} no pertenece a esta fase.`);
        }
      }
      if (milestone.after_milestone) {
        const dependency = milestonePhase.get(milestone.after_milestone);
        if (!dependency) {
          add(errors, `${path}.after_milestone`, `${milestone.after_milestone} no existe.`);
        } else if (dependency.order >= phase.order) {
          add(errors, `${path}.after_milestone`, 'Debe apuntar a una fase anterior.');
        }
      }
    });

    const visiting = new Set<string>();
    const visited = new Set<string>();
    const visit = (id: string): void => {
      if (visiting.has(id)) {
        add(errors, `phases[${phaseIndex}].milestones`, `Hay un ciclo que incluye ${id}.`);
        return;
      }
      if (visited.has(id)) return;
      visiting.add(id);
      for (const dependency of graph.get(id) ?? []) {
        if (graph.has(dependency)) visit(dependency);
      }
      visiting.delete(id);
      visited.add(id);
    };
    for (const id of graph.keys()) visit(id);
  });

  for (const key of Object.keys(workflow.context.pedagogy)) {
    if (!phaseIds.has(key)) add(errors, `context.pedagogy.${key}`, 'No corresponde a ninguna fase.');
  }
  for (const phase of workflow.phases) {
    if (!(phase.id in workflow.context.pedagogy)) {
      add(warnings, 'context.pedagogy', `Falta el objetivo de la fase ${phase.id}.`);
    }
  }
}

export function validateWorkflowData(value: unknown): WorkflowValidationResult {
  const errors: WorkflowValidationIssue[] = [];
  const warnings: WorkflowValidationIssue[] = [];
  if (!isRecord(value)) {
    return {
      valid: false,
      errors: [{ path: '$', message: 'El workflow debe ser un objeto JSON.' }],
      warnings,
    };
  }

  checkFields(value, '$', ['case', 'variables', 'context', 'phases'], [], errors);

  if (!isRecord(value.case)) {
    add(errors, 'case', 'Debe ser un objeto.');
  } else {
    checkFields(
      value.case,
      'case',
      ['id', 'title', 'description'],
      ['difficulty', 'estimated_minutes', 'title_template'],
      errors,
    );
    checkString(value.case.id, 'case.id', errors);
    checkString(value.case.title, 'case.title', errors);
    checkString(value.case.description, 'case.description', errors);
    if (value.case.difficulty !== undefined) checkString(value.case.difficulty, 'case.difficulty', errors);
    if (value.case.title_template !== undefined) checkString(value.case.title_template, 'case.title_template', errors);
    if (
      value.case.estimated_minutes !== undefined &&
      (!Number.isInteger(value.case.estimated_minutes) || Number(value.case.estimated_minutes) <= 0)
    ) {
      add(errors, 'case.estimated_minutes', 'Debe ser un número entero mayor que cero.');
    }
  }

  checkStringRecord(value.variables, 'variables', errors);

  if (!isRecord(value.context)) {
    add(errors, 'context', 'Debe ser un objeto.');
  } else {
    checkFields(value.context, 'context', ['tools', 'pedagogy', 'notes'], [], errors);
    checkStringRecord(value.context.tools, 'context.tools', errors);
    checkStringRecord(value.context.pedagogy, 'context.pedagogy', errors);
    if (typeof value.context.notes !== 'string') add(errors, 'context.notes', 'Debe ser un texto.');
  }

  if (!Array.isArray(value.phases) || value.phases.length === 0) {
    add(errors, 'phases', 'Debe contener al menos una fase.');
  } else {
    value.phases.forEach((phase, index) => checkPhase(phase, `phases[${index}]`, errors));
  }

  if (errors.length === 0) semanticChecks(value as unknown as WorkflowData, errors, warnings);
  return { valid: errors.length === 0, errors, warnings };
}

export function assertWorkflowData(value: unknown): WorkflowData {
  const result = validateWorkflowData(value);
  if (!result.valid) throw new WorkflowValidationError(result.errors);
  return value as WorkflowData;
}

export function formatWorkflowValidationIssues(issues: WorkflowValidationIssue[]): string {
  return issues.map((issue) => `${issue.path}: ${issue.message}`).join('\n');
}
