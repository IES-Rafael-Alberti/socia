/**
 * Persistent settings for SOCIA's managed mode (talking to SOCIA Server).
 *
 * - Standalone mode: serverUrl is empty/null → extension uses local OpenRouter
 *   key from OPENROUTER_API_KEY for hints + local PDF generation.
 * - Managed mode: serverUrl + classCode + studentToken set → extension talks
 *   to the server for workflow assignment, hints, evaluation upload.
 */

const KEY = 'socia.serverSettings.v1';

export interface ServerSettings {
  serverUrl: string | null;
  classCode: string | null;
  studentId: string | null;
  studentToken: string | null;
  studentName: string | null;
  studentEmail: string | null;
  classDomain: string | null; // null when domain not required
  domainRequired: boolean;
  // Standalone API key — kept across mode switches. Hidden in managed UI but
  // not removed (per UX decision).
  standaloneApiKey: string | null;
  /**
   * Standalone-only: whether to run cases in guided mode (visible milestones +
   * hint FAB) or unguided (cronómetro y registro silencioso). Ignored in
   * managed mode — there the server dictates the mode per launch.
   */
  standaloneGuidedMode: boolean;
  /**
   * Standalone-only: brand id (from `@socia/branding`) used when rendering
   * the evaluation PDF locally. Ignored in managed mode — there the server
   * picks its own brand. Empty/unknown id falls back to the default brand.
   */
  standaloneBrandId: string;
}

const DEFAULT: ServerSettings = {
  serverUrl: null,
  classCode: null,
  studentId: null,
  studentToken: null,
  studentName: null,
  studentEmail: null,
  classDomain: null,
  domainRequired: false,
  standaloneApiKey: null,
  standaloneGuidedMode: true,
  standaloneBrandId: 'socia',
};

export async function loadServerSettings(): Promise<ServerSettings> {
  const r = await chrome.storage.local.get(KEY);
  return { ...DEFAULT, ...((r[KEY] as Partial<ServerSettings>) ?? {}) };
}

export async function saveServerSettings(s: ServerSettings): Promise<void> {
  await chrome.storage.local.set({ [KEY]: s });
}

export async function patchServerSettings(p: Partial<ServerSettings>): Promise<ServerSettings> {
  const cur = await loadServerSettings();
  const next = { ...cur, ...p };
  await saveServerSettings(next);
  return next;
}

export function isManaged(s: ServerSettings): boolean {
  return !!(s.serverUrl && s.studentToken);
}

export function normalizeUrl(raw: string): string {
  let u = raw.trim();
  if (!u) return '';
  if (!/^https?:\/\//i.test(u)) u = 'http://' + u;
  return u.replace(/\/+$/, '');
}
