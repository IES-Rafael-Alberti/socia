/**
 * Shared evaluation logic — used by both the SOCIA extension (standalone mode)
 * and the SOCIA Server (managed mode). Encapsulates:
 *
 *   1. The `EvaluationReport` schema returned by the LLM.
 *   2. Building the system + user prompts from the workflow + trace.
 *   3. Parsing the LLM response back into an `EvaluationReport`.
 *
 * It does NOT include the HTTP call itself — each consumer wires its own
 * fetch (different keys, headers, hosts, etc.). This way the prompt and the
 * schema stay in one place; if you change them, both sides change at once.
 */

import type { WorkflowData } from './workflow-types.js';
import type { GradingResult } from './grading.js';

// ──────────────── Public schema ────────────────

/**
 * Structured evaluation output. The LLM is constrained to return a JSON object
 * matching this shape, so the PDF renderer can rely on it.
 */
export interface EvaluationReport {
  /** 2–4 sentence overall assessment in Spanish */
  summary: string;
  /** Numeric score */
  score: {
    completed: number;
    total: number;
    percentage: number;
    grade_out_of_10: number;
  };
  /** Per-phase feedback */
  phase_feedback: Array<{
    phase_id: string;
    phase_title: string;
    completed: number;
    total: number;
    what_went_well: string;
    what_to_improve: string;
  }>;
  /** 2–5 concrete strengths shown in the trace */
  strengths: string[];
  /** 2–5 concrete weaknesses or gaps */
  weaknesses: string[];
  /** 2–5 actionable recommendations for the student */
  recommendations: string[];
  /** Commentary on the hints received (how many, whether they helped) */
  hints_analysis: string;
  /** Final 2–3 sentence closing statement */
  conclusion: string;
}

// ──────────────── Helpers ────────────────

/** Replace {{key}} placeholders with values from a vars dictionary. */
function interpolate(text: string, vars: Record<string, string>): string {
  return text.replace(/\{\{(\w+(?:\.\w+)*)\}\}/g, (_match, key) => vars[key] ?? `{{${key}}}`);
}

// ──────────────── Prompt builders ────────────────

/**
 * Build the chat messages for the evaluation request. The result is the
 * canonical SOCIA evaluation prompt — both standalone (extension) and managed
 * (server) callers must use this so the output schema is identical.
 *
 * The grade is **computed deterministically** before this call (see
 * `shared/socia-eval/grading.ts`) and passed in via `grading`. The LLM does
 * NOT decide the grade; it only writes the qualitative report consistent
 * with it.
 */
export function buildEvaluationMessages(
  workflow: WorkflowData,
  traceExport: unknown,
  grading: GradingResult,
): { systemPrompt: string; userPrompt: string } {
  const vars = workflow.variables;

  const systemPrompt = `Eres un evaluador de prácticas de ciberseguridad SOC en un instituto de FP. Evalúas a un alumno que ha resuelto un caso usando herramientas reales del SOC.

PRINCIPIOS DE EVALUACIÓN:
- El alumno NO tiene que hacer las cosas exactamente igual que el profesor. Lo importante es que alcance los OBJETIVOS (hitos).
- Un hito sólo se marca completado si la petición HTTP del alumno encaja con la firma del hito. Por tanto, si un hito aparece como no completado, fíate: no lo hizo (o lo intentó mal).
- Analiza la línea temporal de acciones para entender CÓMO el alumno intentó resolver cada hito, no solo si lo logró.
- Ten en cuenta las pistas recibidas: un alumno que completa un hito sin pistas vale más que uno que necesitó varias. Si pidió muchas pistas de seguidas sin actuar entremedias, señálalo.
- El tono debe ser constructivo pero honesto. Habla al alumno (segunda persona) en las secciones strengths/weaknesses/recommendations.
- Todo el texto en español neutro.

LA NOTA YA ESTÁ CALCULADA — NO LA CAMBIES:
- La nota se calcula con una fórmula determinista en SOCIA, NO la decides tú.
- Recibirás los valores calculados (\`score\`) en la sección de datos del usuario.
- Tu trabajo es escribir un informe COHERENTE con esa nota: si la nota es alta, no escribas un summary catastrófico; si es baja, no escribas que "lo ha hecho genial".
- En el JSON que devuelvas, copia EXACTAMENTE los valores de \`score\` que recibiste. No los modifiques ni los redondees.

DEBES devolver un objeto JSON válido con esta estructura exacta:
{
  "summary": "string (2-4 frases con la valoración general, coherente con la nota)",
  "score": { "completed": número, "total": número, "percentage": 0-100, "grade_out_of_10": 0-10 },
  "phase_feedback": [
    {
      "phase_id": "string (id exacto de la fase)",
      "phase_title": "string",
      "completed": número,
      "total": número,
      "what_went_well": "string (2-4 frases, puede ser vacío si no completó nada)",
      "what_to_improve": "string (2-4 frases, puede ser vacío si completó todo)"
    }
  ],
  "strengths": ["string", "string", ...],
  "weaknesses": ["string", "string", ...],
  "recommendations": ["string", "string", ...],
  "hints_analysis": "string (2-3 frases sobre el uso de pistas)",
  "conclusion": "string (2-3 frases de cierre)"
}

NO incluyas nada fuera del JSON. NO uses markdown. NO añadas campos extra.`;

  // Pre-computed score block the LLM must echo verbatim.
  const total = workflow.phases.reduce(
    (acc, p) => acc + p.milestones.length,
    0,
  );
  const completed = Math.round(grading.components.milestones * total);
  const percentage = Math.round((total > 0 ? completed / total : 0) * 100);

  const traceMode =
    (traceExport as { session?: { mode?: 'guided' | 'unguided' } } | null)?.session?.mode ??
    'guided';

  const userPrompt = `## Caso
Título: ${interpolate(workflow.case.title, vars)}
Descripción: ${interpolate(workflow.case.description, vars)}
Modo: ${traceMode}

## Notas del profesor (contexto del caso)
${workflow.context.notes || '(ninguna)'}

## Fases y hitos del workflow
${workflow.phases
  .map(
    (phase) =>
      `### ${interpolate(phase.title, vars)} (id: ${phase.id}, rol: ${phase.role || '—'})
${phase.milestones.map((m) => `  - [${m.id}] ${interpolate(m.label, vars)}`).join('\n')}`,
  )
  .join('\n\n')}

## Nota calculada (NO la modifiques — cópiala tal cual al campo "score")
\`\`\`json
{
  "completed": ${completed},
  "total": ${total},
  "percentage": ${percentage},
  "grade_out_of_10": ${grading.grade}
}
\`\`\`

Desglose interno (para que entiendas el porqué de la nota; NO lo metas en el JSON):
- Cobertura de hitos: ${(grading.components.milestones * 100).toFixed(0)}%   (peso ${(grading.weights.milestones * 100).toFixed(0)}%)
- Puntualidad:        ${(grading.components.time * 100).toFixed(0)}%   (peso ${(grading.weights.time * 100).toFixed(0)}%${grading.timeSkipped ? ' — sin estimated_minutes en el workflow, peso redistribuido' : ''})
- Autonomía (pistas): ${(grading.components.autonomy * 100).toFixed(0)}%   (peso ${(grading.weights.hints * 100).toFixed(0)}%)

## Traza del alumno (formato v4.0 — incluye resultados, timing por fase, pistas recibidas y timeline cronológica)
${JSON.stringify(traceExport, null, 2)}

---

Genera la evaluación en el JSON estructurado que se te indicó. Recuerda: copia el bloque "score" tal cual al JSON, no lo cambies.`;

  return { systemPrompt, userPrompt };
}

/**
 * Parse the LLM JSON response into an `EvaluationReport`. Throws with a clear
 * message if the response is not valid JSON or is missing required fields.
 */
export function parseEvaluationResponse(raw: string): EvaluationReport {
  // Strip surrounding code fences / extra text by extracting the first JSON object.
  let payload = raw.trim();
  const fence = payload.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  if (fence) payload = fence[1].trim();
  if (!payload.startsWith('{')) {
    const m = payload.match(/\{[\s\S]*\}/);
    if (m) payload = m[0];
  }
  let parsed: EvaluationReport;
  try {
    parsed = JSON.parse(payload) as EvaluationReport;
  } catch (err) {
    throw new Error(
      `No se pudo parsear la evaluación del LLM: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (!parsed.summary || !parsed.score || !Array.isArray(parsed.phase_feedback)) {
    throw new Error('Respuesta del evaluador incompleta');
  }
  return parsed;
}

// ──────────────── Convenience (extension-side, build full report from raw) ────────────────

export interface ChatCompletionFn {
  (model: string, systemPrompt: string, userPrompt: string): Promise<string>;
}

/**
 * Run the evaluation by calling a caller-provided chat function with the
 * shared prompt and parsing the response. The grade is computed
 * deterministically before the call and the LLM is instructed to echo the
 * score block verbatim — but since the LLM may still drift, we overwrite
 * the score in the parsed result with the deterministic one (single source
 * of truth: `grading`).
 */
export async function runEvaluation(
  workflow: WorkflowData,
  traceExport: unknown,
  grading: GradingResult,
  model: string,
  chat: ChatCompletionFn,
): Promise<EvaluationReport> {
  const { systemPrompt, userPrompt } = buildEvaluationMessages(
    workflow,
    traceExport,
    grading,
  );
  const raw = await chat(model, systemPrompt, userPrompt);
  const parsed = parseEvaluationResponse(raw);

  // Authoritative score wins over whatever the LLM echoed back.
  const total = workflow.phases.reduce(
    (acc, p) => acc + p.milestones.length,
    0,
  );
  const completed = Math.round(grading.components.milestones * total);
  parsed.score = {
    completed,
    total,
    percentage: total > 0 ? Math.round((completed / total) * 100) : 0,
    grade_out_of_10: grading.grade,
  };
  return parsed;
}
