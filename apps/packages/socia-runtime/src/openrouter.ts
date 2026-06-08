/**
 * OpenRouter LLM client for SOCIA.
 * Used for: on-demand hints and post-hoc evaluation.
 *
 * Hints are milestone-aware: each milestone has `hint_examples` that guide
 * the LLM's tone and the progressive difficulty across successive nudges.
 *
 * The API key comes from one of two sources, in priority order:
 *   1. The user-supplied key in extension settings (`standaloneApiKey`).
 *   2. The build-time `EXT_OPENROUTER_API_KEY` env var (apps/extensions/.env).
 */

import type { WorkflowData, WorkflowPhase, StudentAction, Milestone } from '@socia/eval';
import { loadServerSettings } from './server-settings';
import {
  runEvaluation,
  type EvaluationReport,
} from '@socia/eval';
import { gradeFromTrace } from '@socia/eval';
import type { TraceExport } from '@socia/eval';

// Re-export so other modules (PDF renderer, finish-bundle) keep importing from here.
export type { EvaluationReport };

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

async function getApiKey(): Promise<string> {
  // Prefer the user-supplied standalone key (settings UI) over the build-time
  // env. This lets students drop in their own key without rebuilding.
  try {
    const s = await loadServerSettings();
    if (s.standaloneApiKey) return s.standaloneApiKey;
  } catch {}
  return import.meta.env.EXT_OPENROUTER_API_KEY ?? '';
}

function getHintModel(): string {
  return import.meta.env.EXT_OPENROUTER_MODEL_HINTS ?? 'xiaomi/mimo-v2-flash';
}

function getEvalModel(): string {
  return import.meta.env.EXT_OPENROUTER_MODEL_EVAL ?? 'xiaomi/mimo-v2-flash';
}

/** Replace {{key}} placeholders */
function interpolate(text: string, vars: Record<string, string>): string {
  return text.replace(/\{\{(\w+(?:\.\w+)*)\}\}/g, (match, key) => vars[key] ?? match);
}

/** Last hint debug info, accessible for the popup */
export let lastHintDebug: { systemPrompt: string; userPrompt: string; response: string } | null = null;

/** History of previous hints given in this session, keyed by milestone ID */
export const hintHistoryByMilestone: Map<string, string[]> = new Map();

/** Clear all hint history (on workflow reset/load) */
export function clearHintHistory(): void {
  hintHistoryByMilestone.clear();
}

async function chatCompletion(model: string, systemPrompt: string, userPrompt: string): Promise<string> {
  const apiKey = await getApiKey();
  if (!apiKey) {
    throw new Error('Falta la API key de OpenRouter. Añádela en los ajustes de SOCIA.');
  }

  const response = await fetch(OPENROUTER_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
      'HTTP-Referer': 'https://socia-extension.local',
      'X-Title': 'SOCIA - SOC Student Assistant',
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      max_tokens: 500,
      temperature: 0.7,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`OpenRouter error (${response.status}): ${error}`);
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content ?? 'Sin respuesta del modelo.';
}

// ──────────────── Hint Generation ────────────────

function summarizeStudentTrace(actions: StudentAction[], maxActions: number = 15): string {
  if (actions.length === 0) return 'NINGUNA. El alumno acaba de empezar y no ha hecho nada todavía.';

  const recent = actions.slice(-maxActions);
  return recent
    .map((a) => {
      switch (a.type) {
        case 'navigation':
          return `- Navegó a ${a.url}`;
        case 'click':
          return `- Clicó "${a.elementText || a.selector || '?'}"${a.url ? ` (en ${a.url})` : ''}`;
        case 'input':
          return `- Escribió en ${a.selector || 'campo'}${a.inputValue ? `: "${a.inputValue.substring(0, 50)}"` : ''}`;
        case 'form_submit':
          return `- Envió formulario (${a.url})`;
        default:
          return `- ${a.type}`;
      }
    })
    .join('\n');
}

/**
 * Request an on-demand hint from the LLM.
 * Milestone-aware: uses the workflow's `hint_examples` to calibrate tone.
 */
export async function requestHint(
  workflow: WorkflowData,
  currentPhase: WorkflowPhase,
  pendingMilestone: Milestone | null,
  allStudentActions: StudentAction[],
  completedMilestoneIds: string[]
): Promise<string> {
  const vars = workflow.variables;

  // Find tool description
  let currentToolName = '';
  let currentToolDesc = '';
  for (const [name, desc] of Object.entries(workflow.context.tools)) {
    if (
      currentPhase.title.toLowerCase().includes(name.toLowerCase()) ||
      currentPhase.id.toLowerCase().includes(name.toLowerCase())
    ) {
      currentToolName = name;
      currentToolDesc = desc;
      break;
    }
  }

  const pedagogy = workflow.context.pedagogy[currentPhase.id] ?? '';
  const studentSummary = summarizeStudentTrace(allStudentActions);

  // Milestone-specific context
  const milestoneLabel = pendingMilestone
    ? interpolate(pendingMilestone.label, vars)
    : '(todos los hitos de esta fase completados)';

  // Hint examples from the milestone (interpolated)
  const hintExamples = pendingMilestone?.hint_examples?.map((h) => interpolate(h, vars)) ?? [];

  // Hint history for this specific milestone
  const milestoneId = pendingMilestone?.id ?? '_general';
  const previousHints = hintHistoryByMilestone.get(milestoneId) ?? [];

  // Completed milestones summary for context
  const completedSet = new Set(completedMilestoneIds);
  const completedInPhase = currentPhase.milestones
    .filter((m) => completedSet.has(m.id))
    .map((m) => interpolate(m.label, vars));
  const pendingInPhase = currentPhase.milestones
    .filter((m) => !completedSet.has(m.id))
    .map((m) => interpolate(m.label, vars));

  const systemPrompt = `Eres un tutor de ciberseguridad SOC para estudiantes de formación profesional.
Hablas DIRECTAMENTE al alumno (en segunda persona: "deberías", "fíjate", "piensa en").

REGLAS ESTRICTAS:
- Responde con MÁXIMO 2 frases cortas. Nada de listas, bullets ni enumeraciones.
- Guía al alumno hacia el SIGUIENTE HITO pendiente.
- Si el alumno no ha hecho nada todavía, indícale por dónde empezar.
- Adapta la pista a lo que REALMENTE ha hecho el alumno, no inventes acciones que no ha realizado.
- NUNCA hables del alumno en tercera persona. Dirígete a él directamente.
- Si ya has dado pistas anteriores, cada nueva pista debe ser MÁS CONCRETA y DIRECTA que la anterior.
- NUNCA repitas una pista anterior.
- Inspírate en los "Ejemplos de pistas del profesor" para el tono y contenido, pero adáptalos al estado real del alumno.`;

  const userPrompt = `## Caso: ${interpolate(workflow.case.title, vars)}
${interpolate(workflow.case.description, vars)}

## Notas del profesor
${workflow.context.notes}

## Herramienta de esta fase: ${currentToolName || '(desconocida)'}
${currentToolDesc || ''}

## Objetivo pedagógico
${pedagogy || currentPhase.description}

## Fase actual: "${interpolate(currentPhase.title, vars)}"
${interpolate(currentPhase.description, vars)}

## Progreso en esta fase:
Hitos completados: ${completedInPhase.length > 0 ? completedInPhase.join(', ') : 'ninguno'}
Hitos pendientes: ${pendingInPhase.length > 0 ? pendingInPhase.join(', ') : 'todos completados'}

## SIGUIENTE HITO PENDIENTE: "${milestoneLabel}"

## Ejemplos de pistas del profesor (de menos a más directa):
${hintExamples.length > 0
    ? hintExamples.map((h, i) => `${i + 1}. "${h}"`).join('\n')
    : '(Sin ejemplos disponibles)'}

## ACCIONES REALES del alumno hasta ahora (${allStudentActions.length} acciones totales):
${studentSummary}

## Pistas anteriores ya dadas PARA ESTE HITO (${previousHints.length}):
${previousHints.length === 0
    ? 'Ninguna. Esta es la primera pista para este hito.'
    : previousHints.map((h, i) => `${i + 1}. "${h}"`).join('\n')}

Genera UNA pista breve (máximo 2 frases).${previousHints.length > 0
    ? ' Debe ser MÁS ESPECÍFICA que las anteriores. No repitas lo ya dicho.'
    : previousHints.length === 0 && hintExamples.length > 0
      ? ' Inspírate en el primer ejemplo del profesor pero adáptalo al estado del alumno.'
      : ''}${previousHints.length >= 3
    ? ' El alumno se ha atascado mucho. Sé muy directo y prácticamente dile qué hacer.'
    : ''}`;

  console.log('[SOCIA OpenRouter] === HINT REQUEST ===');
  console.log('[SOCIA OpenRouter] Milestone:', milestoneLabel);
  console.log('[SOCIA OpenRouter] Previous hints for this milestone:', previousHints.length);

  const response = await chatCompletion(getHintModel(), systemPrompt, userPrompt);

  console.log('[SOCIA OpenRouter] Response:', response);

  // Save to milestone-specific history
  if (!hintHistoryByMilestone.has(milestoneId)) {
    hintHistoryByMilestone.set(milestoneId, []);
  }
  hintHistoryByMilestone.get(milestoneId)!.push(response);

  lastHintDebug = { systemPrompt, userPrompt, response };

  return response;
}

// ──────────────── Post-hoc Evaluation (v4) ────────────────

/**
 * JSON-mode chat completion. Same as `chatCompletion` above but asks the model
 * for a JSON object back. Used for the structured evaluation report.
 */
async function chatCompletionJson(
  model: string,
  systemPrompt: string,
  userPrompt: string
): Promise<string> {
  const apiKey = await getApiKey();
  if (!apiKey) {
    throw new Error('Falta la API key de OpenRouter. Añádela en los ajustes de SOCIA.');
  }

  const response = await fetch(OPENROUTER_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
      'HTTP-Referer': 'https://socia-extension.local',
      'X-Title': 'SOCIA - SOC Student Assistant',
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      max_tokens: 2000,
      temperature: 0.4,
      response_format: { type: 'json_object' },
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`OpenRouter error (${response.status}): ${error}`);
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content ?? '{}';
}

/**
 * Run the student evaluation. The grade is computed deterministically here
 * (shared/socia-eval/grading.ts) and the LLM only writes the qualitative
 * report around it. Identical pipeline as the server's managed mode.
 */
export async function evaluateCase(
  workflow: WorkflowData,
  traceExport: TraceExport
): Promise<EvaluationReport> {
  const grading = gradeFromTrace(workflow, traceExport);
  return runEvaluation(
    workflow,
    traceExport,
    grading,
    getEvalModel(),
    chatCompletionJson,
  );
}
