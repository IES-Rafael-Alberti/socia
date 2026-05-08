# Workflow TypeScript Type Definitions

These are the exact types that SOCIA uses internally. The workflow.json you generate must conform to `WorkflowData`.

## NetworkSignature

```typescript
/** Describes the HTTP request that proves a milestone was achieved */
export interface NetworkSignature {
  /** HTTP method (or array for multiple valid methods) */
  method: string | string[];
  /** String(s) that must appear in the URL path. Array = OR (any match). */
  url_contains: string | string[];
  /** String that must appear in the host (e.g. "172.17.33.104"). Supports {{variables}}. */
  host_contains: string;
  /** Valid response status codes */
  response_status: number[];
  /**
   * String(s) that must appear in the request body.
   * null/omitted = don't check body. Supports {{variables}}.
   * If array: depends on match_mode (default: all must match).
   */
  request_body_contains?: string | string[] | null;
  /**
   * String(s) that must appear in the response body.
   * null/omitted = don't check body. Supports {{variables}}.
   */
  response_body_contains?: string | string[] | null;
}
```

## Milestone

```typescript
export interface Milestone {
  id: string;
  /** Human-readable label (shown in guided mode UI). Supports {{variables}}. */
  label: string;
  /** The HTTP request that verifies this milestone */
  network_signature: NetworkSignature;
  /** Same-phase milestone IDs that must be completed first */
  depends_on?: string[];
  /** Cross-phase dependency: milestone ID from a previous phase */
  after_milestone?: string;
  /**
   * How to match request_body_contains when it's an array:
   * - "all" = every string must be present (default)
   * - "any_of_body" = at least one string must be present
   */
  match_mode?: 'all' | 'any_of_body';
  /**
   * 3 progressive hints: vague → medium → direct. In Spanish.
   * The LLM uses these as tone/content reference. Supports {{variables}}.
   */
  hint_examples?: string[];
}
```

## WorkflowPhase

```typescript
export interface WorkflowPhase {
  id: string;
  title: string;
  description: string;
  role?: string;
  order: number;
  /** IP:port of tools used in this phase */
  tool_hosts: string[];
  milestones: Milestone[];
}
```

## WorkflowContext

```typescript
export interface WorkflowContext {
  /** One paragraph per tool explaining what it is */
  tools: Record<string, string>;
  /** Learning objective per phase (keyed by phase id) */
  pedagogy: Record<string, string>;
  /** Free-form teacher notes for the hint LLM */
  notes: string;
}
```

## WorkflowCase

```typescript
export interface WorkflowCase {
  id: string;
  title: string;
  description: string;
  difficulty?: string;
  estimated_minutes?: number;
}
```

> El modo guiado / no guiado **no** se guarda en el JSON del workflow: lo elige el profesor al lanzar el caso desde el panel del servidor, o el alumno desde los Ajustes de la extensión SOCIA en modo standalone.

## WorkflowData (top-level)

```typescript
export interface WorkflowData {
  case: WorkflowCase;
  variables: Record<string, string>;
  context: WorkflowContext;
  phases: WorkflowPhase[];
}
```

## StudentNetworkEvent (what the matcher receives)

This is the shape of the event object that gets compared against your signatures. Understanding this helps you write correct signatures.

```typescript
export interface StudentNetworkEvent {
  timestamp: number;
  method: string;        // "GET", "POST", "PUT", "PATCH", "DELETE"
  url: string;           // Full URL: "http://172.17.33.104:9000/api/v1/login"
  host: string;          // "172.17.33.104:9000"
  pathname: string;      // "/api/v1/login"
  status: number;        // 200, 201, 401, etc.
  contentType: string;   // "application/json", etc.
  requestBody: string | null;   // Truncated to 1000 chars, passwords redacted
  responseBody: string | null;  // Truncated to 1000 chars
}
```

## Matching algorithm summary

The matcher (`network-matcher.ts`) processes each network event as follows:

1. Iterates ALL phases and ALL milestones (not just the current phase)
2. Skips already-completed milestones
3. Checks dependencies (`depends_on` + `after_milestone`) — skips if not met
4. For each pending, dependency-satisfied milestone, checks the signature:
   - `method`: case-insensitive match, any of array
   - `host_contains`: interpolated, case-insensitive substring
   - `url_contains`: interpolated, case-insensitive substring. Array = OR.
   - `response_status`: exact match, any of array
   - `request_body_contains`: interpolated, case-insensitive. String = substring. Array + `all` = AND. Array + `any_of_body` = OR.
   - `response_body_contains`: same as request_body_contains
5. If all checks pass → milestone is completed
6. Newly completed milestones are immediately visible to subsequent milestones in the same event loop (a single network event can cascade-complete multiple milestones)
