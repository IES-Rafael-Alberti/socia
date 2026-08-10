import assert from 'node:assert/strict';
import test from 'node:test';
import type { WorkflowData } from '@socia/eval';
import {
  assertWorkflowData,
  validateWorkflowData,
} from '../../../packages/socia-eval/src/workflow-validation';


function validWorkflow(): WorkflowData {
  return {
    case: {
      id: 'generic-case',
      title: 'Caso en {{tool_host}}',
      description: 'Caso de prueba',
      estimated_minutes: 15,
    },
    variables: { tool_host: 'tool.test' },
    context: {
      tools: { Tool: 'Herramienta de prueba' },
      pedagogy: { access: 'Comprobar una sesión válida' },
      notes: '',
    },
    phases: [
      {
        id: 'access',
        title: 'Acceso',
        description: 'Accede a la herramienta',
        order: 1,
        tool_hosts: ['{{tool_host}}'],
        milestones: [
          {
            id: 'authenticated',
            label: 'Acceder con una sesión válida',
            network_signatures: [
              {
                method: 'POST',
                url_contains: '/login',
                host_contains: '{{tool_host}}',
                response_status: [200],
              },
              {
                method: 'GET',
                url_contains: '/current-user',
                host_contains: '{{tool_host}}',
                response_status: [200],
              },
            ],
            hint_examples: ['Primera', 'Segunda', 'Tercera'],
          },
        ],
      },
    ],
  };
}


test('accepts a workflow with complete alternative signatures', () => {
  const result = validateWorkflowData(validWorkflow());
  assert.equal(result.valid, true);
  assert.deepEqual(result.errors, []);
  assert.doesNotThrow(() => assertWorkflowData(validWorkflow()));
});

test('keeps the legacy single signature form', () => {
  const workflow = validWorkflow();
  const milestone = workflow.phases[0].milestones[0];
  milestone.network_signature = milestone.network_signatures?.[0];
  delete milestone.network_signatures;

  assert.equal(validateWorkflowData(workflow).valid, true);
});

test('rejects missing, mixed and unknown workflow fields', () => {
  const workflow = validWorkflow() as WorkflowData & { invented?: boolean };
  workflow.invented = true;
  const milestone = workflow.phases[0].milestones[0];
  milestone.network_signature = milestone.network_signatures?.[0];

  const result = validateWorkflowData(workflow);
  assert.equal(result.valid, false);
  assert.match(result.errors.map((issue) => issue.path).join(' '), /\$\.invented/);
  assert.match(result.errors.map((issue) => issue.message).join(' '), /solo network_signature/);
});

test('rejects unknown variables and invalid dependencies', () => {
  const workflow = validWorkflow();
  const milestone = workflow.phases[0].milestones[0];
  milestone.label = 'Acceder a {{missing}}';
  milestone.depends_on = ['not-in-this-phase'];

  const result = validateWorkflowData(workflow);
  assert.equal(result.valid, false);
  assert.match(result.errors.map((issue) => issue.message).join(' '), /missing/);
  assert.match(result.errors.map((issue) => issue.message).join(' '), /not-in-this-phase/);
});
