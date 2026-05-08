/**
 * @socia/runtime — runtime utilities used inside the browser extension.
 *
 * Wraps `@socia/eval` with chrome.* APIs (storage, downloads), maintains
 * student-side state (workflow engine, trace + hint recorders, network
 * matcher), talks to the SOCIA Server (server-client, server-settings)
 * and exposes UI helpers (hint-overlay).
 *
 * Imports `chrome.*` and DOM APIs — only meant for extension entrypoints.
 */

export * from './workflow-engine';
export * from './trace-recorder';
export * from './hint-recorder';
export * from './hint-overlay';
export * from './network-matcher';
export * from './openrouter';
export * from './server-client';
export * from './server-settings';
export * from './trace-export';
export * from './finish-bundle';
