---
name: workflow-generator
description: >
  Generate SOCIA workflow.json files from MENTORA recording data (network-log.json, activity-log.json, metadata.json).
  Use this skill whenever you need to create, design, or update a workflow for the SOCIA student evaluation extension.
  Triggers: "workflow", "workflow.json", "generar workflow", "crear workflow", "convertir grabación en workflow",
  "network-log", "activity-log", "mentora recording", "milestones", "hitos", "fases".
  Also use this skill when the user provides a MENTORA ZIP export or its extracted files and wants to build a
  guided exercise from them. This is the only authoritative source for the workflow schema.
---

# Workflow Generator for SOCIA

You are an agent that creates `workflow.json` files for the SOCIA browser extension. SOCIA evaluates cybersecurity students by detecting their actions through HTTP network requests. Each workflow defines a guided exercise: phases, milestones, and the network signatures that prove a student completed each step.

Your input is the data recorded by MENTORA (the teacher's recording extension). Your output is a valid `workflow.json` that SOCIA can load.

## What you receive

A MENTORA recording ZIP contains these files:

| File | Content | Your use |
|---|---|---|
| `network-log.json` | Array of intercepted HTTP requests/responses (method, url, host, status, requestBody, responseBody, contentType) | **Primary source** — you extract milestone signatures from here |
| `activity-log.json` | Array of DOM events (clicks, inputs, navigations, form submissions) with timestamps, selectors, element text | Context — helps you understand *what* the teacher did between network events |
| `metadata.json` | Session info: title, duration, page list, timestamps | Context — case title, estimated time |
| Screenshots (PNG) | Visual snapshots of key actions | Context — if provided, helps confirm tool UIs |

The most critical file is `network-log.json`. Every milestone in the workflow must map to a real HTTP request from this file.

## The workflow.json schema

Read the full TypeScript type definitions in `references/workflow-types-reference.md` for exact field types. Here is the structure:

```json
{
  "case": {
    "id": "kebab-case-id",
    "title": "Descriptive title with {{variables}}",
    "description": "What the student will do in this exercise",
    "difficulty": "beginner | media | advanced",
    "estimated_minutes": 15
  },
  "variables": {
    "attacker_ip": "172.31.0.2",
    "thehive_host": "172.17.33.104:9000"
  },
  "context": {
    "tools": {
      "TheHive": "Description of what this tool is and does",
      "Graylog": "Description..."
    },
    "pedagogy": {
      "phase_id": "What the student should learn in this phase"
    },
    "notes": "Free-form notes for the hint LLM (attack context, expected findings, caveats)"
  },
  "phases": [
    {
      "id": "triage",
      "title": "Phase title",
      "description": "What the student does in this phase",
      "role": "Analista SOC N1",
      "order": 1,
      "tool_hosts": ["172.17.33.104:9000"],
      "milestones": [
        {
          "id": "milestone-id",
          "label": "Human-readable milestone description",
          "depends_on": ["previous-milestone-id"],
          "after_milestone": "milestone-from-previous-phase",
          "match_mode": "all",
          "network_signature": {
            "method": "POST",
            "url_contains": "/api/v1/login",
            "host_contains": "{{thehive_host}}",
            "response_status": [200],
            "request_body_contains": "search-term",
            "response_body_contains": "expected-response"
          },
          "hint_examples": [
            "Vague pedagogical nudge (what concept applies here?)",
            "Medium hint (which tool/section to use)",
            "Direct instruction (click X, then Y, then Z)"
          ]
        }
      ]
    }
  ]
}
```

## Step-by-step process

### 1. Analyze the network log

Read `network-log.json` and identify the **meaningful API calls** — the ones that represent deliberate student actions. Filter out:

- Static resource loads (CSS, JS, images, fonts, WASM)
- Browser-internal requests (`chrome-extension://`, `localhost`)
- Repeated polling/heartbeat requests (same endpoint hit dozens of times)
- Preflight OPTIONS requests

Focus on requests that indicate a clear action: logins (POST to session/auth endpoints), data queries (POST with search bodies), record creation (POST/PUT with meaningful payloads), state changes (PATCH/DELETE).

### 2. Group actions into phases

Group the meaningful requests by the tool they belong to (look at the `host` field). Each distinct tool or logical step in the incident response process typically maps to a phase. Common patterns:

- **Triage phase**: Login to SIRP (TheHive) → view alert → create case → add observables → run analyzers
- **Investigation phase**: Login to log platform (Graylog) → search logs → filter by indicators
- **Containment phase**: Login to firewall (OPNsense) → create alias → add firewall rule → apply changes
- **Closure phase**: Document findings → close case

If multiple tools are used within the same logical step (e.g., investigating in both Graylog AND TheHive observables at the same time), they can share a phase with `tool_hosts` listing both hosts.

### 3. Create milestones from network requests

For each significant action, create a milestone. The `network_signature` must match the actual request from the network log.

#### How to write a good network_signature

The matcher checks these fields **in order** — all must pass:

1. **`method`**: The HTTP method. Use the exact method from the log. Can be a string or array.
2. **`host_contains`**: A substring of the host. Use a `{{variable}}` when the IP/port may change between lab environments.
3. **`url_contains`**: Substring(s) of the URL path. For a single pattern, use a string. For alternatives (e.g., an endpoint that might have different URL structures), use an array — the matcher treats arrays as OR (any match).
4. **`response_status`**: Array of valid HTTP status codes. Include all codes that indicate success (e.g., `[200, 201]` for creation endpoints).
5. **`request_body_contains`** (optional): String or array of strings that must appear in the request body. Use this to distinguish between generic API calls (e.g., a query endpoint used for many things). **Array = AND by default** (all must be present). Set `match_mode: "any_of_body"` for OR logic.
6. **`response_body_contains`** (optional): Same as above but for the response body. Useful to verify the server confirmed the action (e.g., `"_type":"Case"` confirms a case was created).

#### Rules for signatures

- **Be specific enough to avoid false positives, but general enough to survive minor variations.** Don't match on entire URLs with IDs that will change. Match on the API path pattern.
- **Always use `{{variables}}` for IPs, hostnames, and case-specific data** (attacker IPs, alert IDs, search terms). This makes the workflow reusable across lab setups.
- **Check the request body when the URL alone is ambiguous.** For example, TheHive uses `/api/v1/query` for everything — the body distinguishes "getAlert" from "getCase" from "getObservable".
- **Use `response_body_contains` sparingly** — only when you need to confirm the *result* of an action, not just that it was attempted. Example: verifying a case was actually created (`"_type":"Case"`).
- **Discriminate the correct entity on generic endpoints.** When a milestone represents "view details of X" and the endpoint returns data for any entity of that type (any alert, any case, any observable), add `response_body_contains` with an identifier of the correct entity — typically `{{alert_title}}`, the case name, or the observable value. Without this, opening *any* entity of the same type would complete the milestone. This is especially important for TheHive's `/api/v1/query` endpoint, which returns different entities depending on the query body but always has the same URL pattern.
- **Bodies are truncated to 1000 characters** in the network log. Don't rely on content that would appear deep into a large response.

### 4. Define dependencies

Dependencies control the order milestones become active:

- **`depends_on: ["id"]`** — Same-phase prerequisite. The milestone won't be evaluated until all listed milestones are complete. Use for sequential steps within a phase (login before search).
- **`after_milestone: "id"`** — Cross-phase prerequisite. This milestone only activates after a milestone from a previous phase is complete. Use to gate an entire branch on a prior phase's completion.

For **parallel branches** (e.g., Graylog investigation AND observable enrichment can happen in any order), put both branches in the same phase with `after_milestone` pointing to the shared prerequisite, but no `depends_on` between them:

```
Phase 1: A → B → C (sequential: depends_on)
Phase 2: D (after_milestone: C) ─┬─ branch 1
         E (after_milestone: C) ─┘  branch 2 (parallel with D)
         F (depends_on: [E])        (sequential within branch 2)
```

The matcher iterates ALL milestones across ALL phases on every network event, so parallel branches work naturally.

### 5. Write variables

Extract all environment-specific values into `variables`:

- IP addresses and ports of tools (`thehive_host`, `graylog_host`, `opnsense_host`)
- Case-specific data (`attacker_ip`, `victim_host`, `alert_id`)
- Search terms (`rule_ids`, `alert_title`)

Then use `{{variable_name}}` in signatures, labels, hints, titles, and descriptions. This makes the workflow portable between different lab environments.

### 6. Write context

The `context` object helps the hint LLM understand the scenario:

- **`tools`**: One paragraph per tool describing what it is and what it's used for in cybersecurity operations.
- **`pedagogy`**: One entry per phase explaining the learning objective. What concept should the student understand after completing this phase?
- **`notes`**: Anything the hint LLM should know — attack background, expected findings ("the attack did NOT succeed"), common student mistakes, tips.

### 7. Write hint_examples

Each milestone should have 3 progressive hints in Spanish:

1. **Conceptual** — Poses a question about which concept or tool applies. Doesn't name specific buttons or URLs.
2. **Directional** — Names the tool/section and what to look for, but doesn't give exact steps.
3. **Step-by-step** — Tells the student exactly what to click, in order.

Use `{{variables}}` in hints so they adapt to the case. The hint LLM uses these as **tone and content references** — it doesn't show them verbatim, but uses them to calibrate its own hints.

### 8. Validate the workflow

Run the validator script. It enforces the schema **strictly** (rejects undeclared fields — catches typos like `network_match`, `hints_examples`, `methods`) and checks semantic invariants. Any error is blocking: iterate until it passes. Warnings are quality recommendations; address them when you can.

```bash
uv run tools/skills/workflow-generator/scripts/validate_workflow.py path/to/workflow.json
```

What it covers:

- **Schema**: required fields present, correct types, and `extra="forbid"` at every level (no stray fields anywhere — including `case.mode`, which is forbidden).
- **Variables**: every `{{variable}}` used in titles, descriptions, signatures, or `hint_examples` is defined in the `variables` block.
- **Dependencies**: `depends_on` references milestones in the **same phase**; `after_milestone` references milestones in an **earlier phase** (lower `order`); no cycles.
- **Uniqueness**: `phase.id`, `phase.order`, and `milestone.id` unique across the whole workflow.
- **Pedagogy**: keys of `context.pedagogy` correspond to `phase.id` values.
- **Per-student**: if `per_student_ports` is present, every listed name exists in `variables`.
- **(Warning) `case.title`** uses `{{variables}}` so the panel re-interpolates it on edit (otherwise the title stays frozen).
- **(Warning) `tool_hosts` and `hint_examples`** use host variables (`{{thehive_host}}`, `{{graylog_host}}`) instead of literal IPs — IPs change.
- **(Warning) `hint_examples`** follows the convention of 3 hints, least to most directive.

Things the **validator cannot check** that you must ensure when designing:

- Each `network_signature` maps to at least one real request from `network-log.json`.
- Milestones that detect "viewing details" of an entity (alert, case, observable) include a `response_body_contains` with a discriminating value (`{{alert_title}}`, victim host, observable value) to avoid false positives when the student opens a different entity of the same type.

## Common patterns and examples

### Login detection
```json
{
  "id": "thehive-login",
  "label": "Iniciar sesión en TheHive",
  "network_signature": {
    "method": "POST",
    "url_contains": "/api/v1/login",
    "host_contains": "{{thehive_host}}",
    "response_status": [200]
  }
}
```

### Distinguishing queries on a generic endpoint
TheHive uses `/api/v1/query` for everything. Use `request_body_contains` to distinguish:
```json
{
  "id": "view-alert",
  "label": "Revisar detalles de la alerta de {{alert_title}}",
  "network_signature": {
    "method": "POST",
    "url_contains": "/api/v1/query",
    "host_contains": "{{thehive_host}}",
    "response_status": [200],
    "request_body_contains": ["getAlert", "extraData"],
    "response_body_contains": "{{alert_title}}"
  }
}
```
Note: `response_body_contains` with `{{alert_title}}` ensures only the correct alert completes the milestone. Without it, opening *any* alert would count as a match because the `request_body_contains` fields (`getAlert`, `extraData`) are the same for every alert detail request.

### Case creation with response verification
```json
{
  "id": "create-case",
  "label": "Crear caso a partir de la alerta",
  "network_signature": {
    "method": "POST",
    "url_contains": "/api/v1/alert/",
    "host_contains": "{{thehive_host}}",
    "response_status": [200, 201],
    "request_body_contains": "severity",
    "response_body_contains": "\"_type\":\"Case\""
  }
}
```

### Search query with case-specific terms
```json
{
  "id": "search-brute-force-logs",
  "label": "Buscar logs de fuerza bruta por IP origen",
  "network_signature": {
    "method": "POST",
    "url_contains": ["/api/views/search/", "/execute"],
    "host_contains": "{{graylog_host}}",
    "response_status": [200, 201],
    "request_body_contains": "{{attacker_ip}}"
  }
}
```
Note: `url_contains` is an array here because Graylog's search URL has a structure like `/api/views/search/{id}/messages/{id}/execute`. Using two fragments ensures the URL is specific enough — any one matching is sufficient (the matcher treats URL arrays as OR).

### Parallel branches
```json
{
  "id": "graylog-login",
  "after_milestone": "create-case",
  "network_signature": { "..." : "..." }
},
{
  "id": "view-observable-ip",
  "after_milestone": "create-case",
  "network_signature": { "..." : "..." }
}
```
Both milestones activate after `create-case` but are independent of each other — the student can do them in any order.

## Output

Produce a single, valid JSON file. Use 2-space indentation. Name it descriptively: `workflow-<case-description>.json`.

After generating the workflow, run through the validation checklist above and report any issues. If the teacher provides a network log, count how many of the N milestones can be verified against actual requests in the log and report: "Verificados X/N hitos contra el network-log."
