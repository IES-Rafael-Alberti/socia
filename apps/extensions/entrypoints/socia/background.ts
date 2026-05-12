/**
 * SOCIA Background Service Worker.
 * Manages: workflow state, student trace recording, network-based milestone
 * verification, phase detection by progress, LLM hints, and trace export.
 */

import type {
  WorkflowData,
  SociaState,
  StudentAction,
  StudentNetworkEvent,
  Milestone,
  HintEvent,
} from '@socia/eval';
import { getBrand } from '@socia/branding';
import {
  createInitialState,
  loadStateFromStorage,
  loadWorkflowFromStorage,
  saveStateToStorage,
  saveWorkflowToStorage,
  clearAllFromStorage,
  getElapsedSeconds,
} from '@socia/runtime';
import { loadTrace, saveTrace, appendAction, clearTrace } from '@socia/runtime';
import {
  loadHintEvents,
  appendHintEvent,
  clearHintEvents,
} from '@socia/runtime';
import { buildTraceExport, downloadTraceExport } from '@socia/runtime';
import { finishAndDownload } from '@socia/runtime';
import { requestHint, lastHintDebug, clearHintHistory } from '@socia/runtime';
import {
  checkMilestones,
  detectPhaseByMilestones,
  getNextPendingMilestone,
} from '@socia/runtime';
import { loadServerSettings, isManaged } from '@socia/runtime';
import {
  fetchMe,
  fetchWorkflow,
  postProgress,
  requestHintFromServer,
  postEvaluation,
  downloadEvaluationPdf,
} from '@socia/runtime';

export default defineBackground(() => {
  console.log('[SOCIA Background] Service worker started');

  let workflow: WorkflowData | null = null;
  let state: SociaState | null = null;
  let trace: StudentAction[] = [];
  let hintEvents: HintEvent[] = [];
  let networkTrace: StudentNetworkEvent[] = [];
  let isFinishing = false;

  // Managed-mode tracking
  let managedLaunchId: string | null = null;
  let managedLaunchGuided: boolean | null = null;
  let managedPoll: ReturnType<typeof setInterval> | null = null;
  let lastReportedMilestoneCount = -1;
  let lastReportedHintCount = -1;

  // After the student presses "Terminar" in managed mode, we remember the
  // launchId so the next polling tick doesn't re-load the same case before the
  // server has registered the `finished` progress (5s race window). Cleared
  // automatically when the server reports `freshLaunch: true` for the same id
  // (which only happens after the teacher pressed "Volver a lanzar" → reset).
  let recentlyFinishedLaunchId: string | null = null;

  // Effective mode for the current session, resolved from either the managed
  // launch (server-driven) or the standalone setting. Cached so getStateResponse
  // can stay synchronous; refreshed on settings changes and on new launches.
  let currentMode: 'guided' | 'unguided' = 'guided';

  async function refreshCurrentMode() {
    if (managedLaunchGuided !== null) {
      currentMode = managedLaunchGuided ? 'guided' : 'unguided';
      return;
    }
    const settings = await loadServerSettings();
    currentMode = settings.standaloneGuidedMode ? 'guided' : 'unguided';
  }

  // Restore saved state on startup
  (async () => {
    workflow = await loadWorkflowFromStorage();
    state = await loadStateFromStorage();
    trace = await loadTrace();
    hintEvents = await loadHintEvents();

    // Migration for pre-4.0 states that lack the new timestamp fields
    if (state) {
      if (!state.milestoneCompletedAt) state.milestoneCompletedAt = {};
      if (!state.phaseEnteredAt) {
        state.phaseEnteredAt = {};
        // Best-effort: assume student entered phase 0 at session start
        const firstPhaseId = workflow?.phases[0]?.id;
        if (firstPhaseId) state.phaseEnteredAt[firstPhaseId] = state.timerStartTime;
      }
    }

    if (workflow && state) {
      console.log(
        '[SOCIA Background] Restored workflow:',
        workflow.case.title,
        `(${trace.length} actions, ${state.completedMilestones.length} milestones, ${hintEvents.length} hints)`
      );
    }
    await refreshCurrentMode();
    // Start managed-mode poll if applicable
    void startManagedPollIfNeeded();
  })();

  // ──────────────── Managed mode polling ────────────────

  async function startManagedPollIfNeeded() {
    const settings = await loadServerSettings();
    if (!isManaged(settings)) {
      stopManagedPoll();
      return;
    }
    if (managedPoll) return;
    const tick = async () => {
      try {
        const me = await fetchMe();
        // The server signaled this is a fresh launch for us (no progress row).
        // If it matches the launch we just finished, the teacher must have
        // reset us — drop the defense flag so we accept the case again below.
        if (
          me.launch &&
          me.launch.freshLaunch &&
          recentlyFinishedLaunchId &&
          me.launch.launchId === recentlyFinishedLaunchId
        ) {
          recentlyFinishedLaunchId = null;
        }
        if (
          me.launch &&
          me.launch.launchId !== managedLaunchId &&
          me.launch.launchId !== recentlyFinishedLaunchId &&
          !workflow
        ) {
          // New launch from teacher and we have nothing loaded → fetch workflow
          managedLaunchId = me.launch.launchId;
          managedLaunchGuided = me.launch.guided ?? true;
          await refreshCurrentMode();
          const wfData = (await fetchWorkflow(me.launch.workflowId)) as WorkflowData;
          if (wfData?.phases && wfData?.case) {
            await loadWorkflow(wfData);
            await reportProgress();
          }
        } else if (!me.launch && managedLaunchId && !workflow) {
          managedLaunchId = null;
          managedLaunchGuided = null;
          await refreshCurrentMode();
        }
      } catch (err) {
        // network blip — try again next tick
      }
    };
    void tick();
    managedPoll = setInterval(tick, 5000);
  }

  function stopManagedPoll() {
    if (managedPoll) {
      clearInterval(managedPoll);
      managedPoll = null;
    }
  }

  async function reportProgress(statusOverride?: 'finished') {
    if (!workflow || !state || !managedLaunchId) return;
    try {
      const total = workflow.phases.reduce((a, p) => a + p.milestones.length, 0);
      const step = state.completedMilestones.length;
      const status: 'running' | 'finished' | 'waiting' =
        statusOverride === 'finished'
          ? 'finished'
          : step === 0
            ? 'waiting'
            : 'running';
      await postProgress({
        launchId: managedLaunchId,
        step,
        total,
        status,
        hints: hintEvents.length,
      });
      lastReportedMilestoneCount = step;
      lastReportedHintCount = hintEvents.length;
    } catch {
      /* server unreachable — allowed in spec */
    }
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message.type?.startsWith('SOCIA_')) return false;

    handleMessage(message)
      .then(sendResponse)
      .catch((err) => {
        console.error('[SOCIA Background] Error:', err);
        sendResponse({ success: false, error: String(err) });
      });
    return true;
  });

  async function handleMessage(msg: Record<string, unknown>) {
    switch (msg.type) {
      case 'SOCIA_LOAD_WORKFLOW':
        return await loadWorkflow(msg.workflow as WorkflowData);
      case 'SOCIA_GET_STATE':
        return getStateResponse();
      case 'SOCIA_RESET_CASE':
        return await resetCase();
      case 'SOCIA_FINISH_CASE':
        return await finishCase({ evaluate: msg.evaluate !== false });
      case 'SOCIA_STUDENT_ACTION':
        return await handleAction(msg.action as StudentAction);
      case 'SOCIA_STUDENT_NETWORK_EVENT':
        return await handleNetworkEvent(msg.networkEvent as StudentNetworkEvent);
      case 'SOCIA_REQUEST_HINT':
        return await handleHintRequest();
      case 'SOCIA_EXPORT_TRACE':
        return await handleExport();
      case 'SOCIA_GET_HINT_DEBUG':
        return { success: true, debug: lastHintDebug };
      case 'SOCIA_SETTINGS_CHANGED':
        await refreshCurrentMode();
        await startManagedPollIfNeeded();
        broadcastStateChange();
        return { success: true };
      case 'SOCIA_DOWNLOAD_SERVER_PDF': {
        const evalId = msg.evalId as string;
        try {
          const blob = await downloadEvaluationPdf(evalId);
          const buf = new Uint8Array(await blob.arrayBuffer());
          let bin = '';
          const chunk = 0x8000;
          for (let i = 0; i < buf.length; i += chunk) {
            bin += String.fromCharCode.apply(null, Array.from(buf.subarray(i, i + chunk)));
          }
          const url = `data:application/pdf;base64,${btoa(bin)}`;
          await chrome.downloads.download({ url, filename: `socia-evaluacion-${evalId}.pdf` });
          return { success: true };
        } catch (err) {
          return { success: false, error: String(err) };
        }
      }
      default:
        return { error: 'Unknown SOCIA message type' };
    }
  }

  // ──────────────── Workflow Management ────────────────

  async function loadWorkflow(w: WorkflowData) {
    workflow = w;
    state = createInitialState(w);
    trace = [];
    hintEvents = [];
    networkTrace = [];
    clearHintHistory();
    await saveWorkflowToStorage(w);
    await saveStateToStorage(state);
    await clearTrace();
    await clearHintEvents();
    await refreshCurrentMode();
    broadcastStateChange();
    return { success: true };
  }

  function getStateResponse() {
    if (!state || !workflow) {
      // The case state may already have been cleared inside finishCase() while
      // the LLM call / cleanup still runs. Surface isFinishing so the popup
      // can show "Evaluando…" instead of falling back to the empty/idle view.
      return { success: false, error: 'No workflow loaded', isFinishing };
    }

    const currentPhase = workflow.phases[state.currentPhaseIndex] ?? null;

    // Build milestone status for UI
    const completedSet = new Set(state.completedMilestones);
    const milestoneStatus: Record<string, boolean> = {};
    for (const phase of workflow.phases) {
      for (const m of phase.milestones) {
        milestoneStatus[m.id] = completedSet.has(m.id);
      }
    }

    return {
      success: true,
      workflow,
      state,
      currentPhase,
      currentPhaseIndex: state.currentPhaseIndex,
      totalPhases: workflow.phases.length,
      elapsedSeconds: getElapsedSeconds(state),
      traceLength: trace.length,
      networkEventCount: networkTrace.length,
      mode: currentMode,
      completedMilestones: state.completedMilestones,
      milestoneStatus,
      isFinishing,
    };
  }

  async function resetCase() {
    if (!workflow) return { success: false, error: 'No workflow loaded' };
    state = createInitialState(workflow);
    trace = [];
    hintEvents = [];
    networkTrace = [];
    clearHintHistory();
    await saveStateToStorage(state);
    await clearTrace();
    await clearHintEvents();
    broadcastStateChange();
    return { success: true };
  }

  async function finishCase(opts: { evaluate?: boolean } = {}) {
    if (isFinishing) {
      return { success: false, error: 'Finish already in progress' };
    }
    isFinishing = true;
    broadcastStateChange();
    try {
    const evaluate = opts.evaluate !== false;
    let result: {
      success: boolean;
      evaluationSucceeded?: boolean;
      error?: string;
      managed?: boolean;
      evalId?: string;
      pdfAvailable?: boolean;
      grade?: number;
    } = { success: true };

    const settings = await loadServerSettings();
    const managed = isManaged(settings) && !!managedLaunchId;

    if (managed && workflow && state) {
      // Managed mode always evaluates — the "no evaluar" branch is standalone-only.
      try {
        const exportData = buildTraceExport(workflow, state, trace, hintEvents, currentMode);
        const r = await postEvaluation({
          launchId: managedLaunchId!,
          workflow,
          traceExport: exportData,
        });
        await reportProgress('finished');
        result = {
          success: true,
          evaluationSucceeded: !r.error,
          managed: true,
          evalId: r.evalId,
          grade: r.grade,
          pdfAvailable: r.pdfAvailable,
          error: r.error,
        };
      } catch (err) {
        result = {
          success: true,
          evaluationSucceeded: false,
          managed: true,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    } else if (workflow && state && trace.length > 0) {
      try {
        const exportData = buildTraceExport(workflow, state, trace, hintEvents, currentMode);
        if (evaluate) {
          const localSettings = await loadServerSettings();
          const brand = getBrand(localSettings.standaloneBrandId);
          const finish = await finishAndDownload(workflow, exportData, brand);
          result = {
            success: true,
            evaluationSucceeded: finish.evaluationSucceeded,
            error: finish.error,
          };
        } else {
          // Sin evaluación: solo descargamos la traza (no se llama al LLM
          // ni se genera PDF). Útil cuando el alumno quiere cerrar el caso
          // sin gastar una llamada de evaluación.
          await downloadTraceExport(exportData);
          result = {
            success: true,
            evaluationSucceeded: false,
          };
        }
      } catch (err) {
        console.error('[SOCIA Background] Finish error:', err);
        result = {
          success: false,
          evaluationSucceeded: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    }

    // Always clear session state, even if download/evaluation failed —
    // the student pressed Terminar, so the case is done.
    await clearAllFromStorage();
    await clearTrace();
    await clearHintEvents();
    state = null;
    workflow = null;
    trace = [];
    hintEvents = [];
    networkTrace = [];
    // Remember the launch we just finished so the next managed-poll tick
    // doesn't re-load it before the server has registered our `finished`
    // progress row. Cleared by the tick when server reports freshLaunch=true
    // for the same id (i.e. teacher pressed "Volver a lanzar").
    if (managedLaunchId) recentlyFinishedLaunchId = managedLaunchId;
    managedLaunchId = null;
    managedLaunchGuided = null;
    await refreshCurrentMode();
    lastReportedMilestoneCount = -1;
    lastReportedHintCount = -1;
    return result;
    } finally {
      isFinishing = false;
      broadcastStateChange();
    }
  }

  // ──────────────── Action Recording ────────────────

  async function handleAction(action: StudentAction) {
    if (!state || !workflow) return { success: false };
    trace = appendAction(trace, action);
    return { success: true };
  }

  // ──────────────── Network Event Processing ────────────────

  async function handleNetworkEvent(event: StudentNetworkEvent) {
    if (!state || !workflow) return { success: false };

    // Store network event
    networkTrace.push(event);

    // Check if this event completes any milestones
    const newlyCompleted = checkMilestones(workflow, event, state.completedMilestones);

    if (newlyCompleted.length > 0) {
      const completedAt = event.timestamp || Date.now();

      // Record completion timestamp for each newly completed milestone
      for (const id of newlyCompleted) {
        state.milestoneCompletedAt[id] = completedAt;
      }
      state.completedMilestones = [...state.completedMilestones, ...newlyCompleted];

      // Recalculate phase based on milestone progress
      const newPhaseIndex = detectPhaseByMilestones(workflow, state.completedMilestones);
      if (newPhaseIndex !== state.currentPhaseIndex) {
        console.log(`[SOCIA Background] Phase advanced: ${state.currentPhaseIndex} → ${newPhaseIndex}`);
        state.currentPhaseIndex = newPhaseIndex;

        // Record when the student first entered this new phase
        const newPhaseId = workflow.phases[newPhaseIndex]?.id;
        if (newPhaseId && !state.phaseEnteredAt[newPhaseId]) {
          state.phaseEnteredAt[newPhaseId] = completedAt;
        }
      }

      await saveStateToStorage(state);
      broadcastStateChange();
      void reportProgress();
    }

    return { success: true, newlyCompleted };
  }

  // ──────────────── Hints ────────────────

  async function handleHintRequest() {
    if (!state || !workflow) return { success: false, error: 'No workflow loaded' };

    const currentPhase = workflow.phases[state.currentPhaseIndex];
    if (!currentPhase) {
      return { success: false, error: 'No se ha detectado en qué fase estás.' };
    }

    const pendingMilestone = getNextPendingMilestone(currentPhase, state.completedMilestones);

    try {
      const settings = await loadServerSettings();
      const managed = isManaged(settings) && !!managedLaunchId;
      let hint: string;
      if (managed) {
        hint = await requestHintFromServer({
          caseInstructions: workflow.case.title + ' — ' + (currentPhase.description ?? ''),
          completed: state.completedMilestones,
          pending: currentPhase.milestones
            .filter((m) => !state!.completedMilestones.includes(m.id))
            .map((m) => m.label),
          previousHints: hintEvents.map((h) => h.hint),
        });
      } else {
        hint = await requestHint(
          workflow,
          currentPhase,
          pendingMilestone,
          trace,
          state.completedMilestones,
        );
      }

      hintEvents = appendHintEvent(hintEvents, {
        timestamp: Date.now(),
        milestone_id: pendingMilestone?.id ?? '_general',
        hint,
      });

      if (managed) void reportProgress();

      return { success: true, hint };
    } catch (err) {
      return {
        success: false,
        error: `Error obteniendo pista: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  // ──────────────── Export ────────────────

  async function handleExport() {
    if (!state || !workflow) return { success: false, error: 'No workflow loaded' };

    try {
      const exportData = buildTraceExport(workflow, state, trace, hintEvents, currentMode);
      await downloadTraceExport(exportData);
      return { success: true };
    } catch (err) {
      return {
        success: false,
        error: `Error exportando: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  // ──────────────── Broadcast ────────────────

  async function broadcastStateChange() {
    const tabs = await chrome.tabs.query({});
    for (const tab of tabs) {
      if (tab.id) {
        try {
          await chrome.tabs.sendMessage(tab.id, { type: 'SOCIA_STATE_CHANGED' });
        } catch {
          /* tab may not have content script */
        }
      }
    }
  }
});
