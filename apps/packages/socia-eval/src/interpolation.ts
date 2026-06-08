/** Replace {{key}} placeholders with values from a workflow variables map. */
export function interpolateWorkflowText(text: string, vars: Record<string, string>): string {
  return text.replace(/\{\{(\w+(?:\.\w+)*)\}\}/g, (_match, key) => vars[key] ?? `{{${key}}}`);
}
