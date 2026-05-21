// LLM proxy. Students call these (with their bearer token) instead of OpenRouter directly.
import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { db } from '../db.js';
import { requireStudent, type StudentReq } from '../auth.js';
import { writeEvaluationPdf } from '../pdf.js';
import { uid } from '../util.js';
import { broadcastAdmins } from '../ws.js';
import {
  buildEvaluationMessages,
  interpolateWorkflowText,
  parseEvaluationResponse,
  type EvaluationReport,
} from '@socia/eval';
import { gradeFromTrace } from '@socia/eval';
import type { WorkflowData } from '@socia/eval';
import type { TraceExport } from '@socia/eval';
import { getBrand } from '@socia/branding';

export const llmRouter = Router();

llmRouter.use(requireStudent);

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

async function callOpenRouter(
  model: string,
  messages: ChatMessage[],
  jsonMode = false,
): Promise<string> {
  if (!config.openrouterKey) throw new Error('openrouter_not_configured');
  const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.openrouterKey}`,
      'HTTP-Referer': 'https://socia.local',
      'X-Title': 'SOCIA Server',
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: jsonMode ? 0.4 : 0.7,
      max_tokens: jsonMode ? 2000 : 500,
      ...(jsonMode ? { response_format: { type: 'json_object' } } : {}),
    }),
  });
  if (!r.ok) {
    const txt = await r.text();
    throw new Error(`openrouter_${r.status}: ${txt.slice(0, 200)}`);
  }
  const json = (await r.json()) as { choices?: { message?: { content?: string } }[] };
  return json.choices?.[0]?.message?.content ?? '';
}

llmRouter.post('/hint', async (req, res) => {
  const { caseInstructions, completed, pending, previousHints } = req.body ?? {};
  try {
    const messages: ChatMessage[] = [
      {
        role: 'system',
        content:
          'Eres un instructor de un SOC. Devuelve UNA pista corta (1-2 frases) más concreta que las anteriores, sin repetir, en español.',
      },
      {
        role: 'user',
        content: JSON.stringify({ caseInstructions, completed, pending, previousHints }),
      },
    ];
    const out = await callOpenRouter(config.openrouterHintsModel, messages, false);
    res.json({ hint: out.trim() });
  } catch (e) {
    res.status(502).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

interface EvaluationRequestBody {
  launchId: string;
  workflow: WorkflowData;
  traceExport: TraceExport;
}

llmRouter.post('/evaluation', async (req: StudentReq, res) => {
  const s = req.student!;
  const body = req.body as Partial<EvaluationRequestBody>;
  if (
    typeof body.launchId !== 'string' ||
    !body.workflow?.case ||
    !Array.isArray(body.workflow.phases) ||
    !body.traceExport
  ) {
    res.status(400).json({ error: 'invalid_payload' });
    return;
  }
  const { launchId, workflow, traceExport } = body as EvaluationRequestBody;

  const stepsTotal = workflow.phases.reduce((acc, p) => acc + p.milestones.length, 0);
  const stepsDone = traceExport.outcome?.milestones_completed?.length ?? 0;
  const hints = traceExport.timeline.filter((e) => e.type === 'hint_received').length;
  const durationSeconds = traceExport.session?.duration_seconds ?? 0;
  const caseName = interpolateWorkflowText(workflow.case.title, workflow.variables);

  // Deterministic grade — formula lives in @socia/eval (packages/socia-eval) so the
  // extension's standalone path produces the same numbers.
  const grading = gradeFromTrace(workflow, traceExport);

  // Run the canonical SOCIA evaluation prompt with the pre-computed grade.
  let report: EvaluationReport | null = null;
  let evalError: string | undefined;
  try {
    const { systemPrompt, userPrompt } = buildEvaluationMessages(
      workflow,
      traceExport,
      grading,
    );
    const raw = await callOpenRouter(
      config.openrouterEvalModel,
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      true,
    );
    report = parseEvaluationResponse(raw);
    // Authoritative score wins (LLM may have drifted despite the instruction).
    report.score = {
      completed: stepsDone,
      total: stepsTotal,
      percentage: stepsTotal > 0 ? Math.round((stepsDone / stepsTotal) * 100) : 0,
      grade_out_of_10: grading.grade,
    };
  } catch (err) {
    evalError = err instanceof Error ? err.message : String(err);
  }

  // Persist evaluation + render PDF if we have a report.
  const id = uid('ev_');
  let pdfRel: string | null = null;
  if (report) {
    pdfRel = path.join('evaluations', `${id}.pdf`);
    const pdfAbs = path.join(config.dataDir, pdfRel);
    const brand = getBrand(config.brandId);
    writeEvaluationPdf({
      filePath: pdfAbs,
      caseId: workflow.case.id,
      caseTitle: caseName,
      sessionStartedAt: traceExport.session.started_at,
      durationText: traceExport.session.duration,
      mode: traceExport.session.mode ?? 'guided',
      report,
      brand,
    });
  }

  db.prepare(
    `INSERT INTO evaluations (id, student_id, launch_id, workflow_title, case_name, steps_done,
                              steps_total, hints, duration_seconds, grade, pdf_path, closed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    s.id,
    launchId,
    workflow.case.title,
    caseName,
    stepsDone,
    stepsTotal,
    hints,
    durationSeconds,
    grading.grade,
    pdfRel,
    Date.now(),
  );

  db.prepare(
    `UPDATE progress SET status = 'finished', finished_at = ?, updated_at = ?
     WHERE student_id = ? AND launch_id = ?`,
  ).run(Date.now(), Date.now(), s.id, launchId);

  broadcastAdmins({ type: 'eval_added', evalId: id, studentId: s.id });

  const cls = db
    .prepare('SELECT allow_pdf_download AS allowPdfDownload FROM classes WHERE id = ?')
    .get(s.class_id) as { allowPdfDownload: number } | undefined;

  res.json({
    evalId: id,
    grade: grading.grade,
    pdfAvailable: !!cls?.allowPdfDownload && !!pdfRel,
    error: evalError,
  });
});

llmRouter.get('/evaluation/:id/pdf', (req: StudentReq, res) => {
  const s = req.student!;
  const e = db
    .prepare(
      `SELECT pdf_path AS pdfPath, student_id AS studentId
       FROM evaluations WHERE id = ?`,
    )
    .get(req.params.id) as { pdfPath: string; studentId: string } | undefined;
  if (!e || e.studentId !== s.id) {
    res.status(404).end();
    return;
  }
  const cls = db
    .prepare('SELECT allow_pdf_download AS allowPdfDownload FROM classes WHERE id = ?')
    .get(s.class_id) as { allowPdfDownload: number } | undefined;
  if (!cls?.allowPdfDownload) {
    res.status(403).end();
    return;
  }
  const fp = path.isAbsolute(e.pdfPath) ? e.pdfPath : path.join(config.dataDir, e.pdfPath);
  if (!fs.existsSync(fp)) {
    res.status(404).end();
    return;
  }
  res.type('application/pdf').sendFile(fp);
});
