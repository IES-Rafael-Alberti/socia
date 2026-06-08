#!/usr/bin/env -S uv run --quiet
# /// script
# requires-python = ">=3.10"
# dependencies = ["pydantic>=2.5"]
# ///
"""
validate_workflow.py — strict validator for SOCIA workflow JSON files.

Two layers:
  1. Schema (pydantic with `extra='forbid'`): correct shape, no stray fields.
  2. Semantic checks: referenced variables exist, ids are unique, intra/inter
     phase dependencies are coherent, plus quality conventions.

Usage:
  uv run apps/skills/workflow-generator/scripts/validate_workflow.py <workflow.json>

Output:
  - Errors and warnings on stderr (each with its path inside the JSON).
  - Exits 0 if there are no errors (warnings do not fail); 1 if there are
    errors; 2 on bad arguments.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, ValidationError


# ── Schema ─────────────────────────────────────────────────────────


class _Strict(BaseModel):
    """Base: forbid any field not declared on the model."""

    model_config = ConfigDict(extra="forbid")


class NetworkSignature(_Strict):
    method: str | list[str]
    url_contains: str | list[str]
    host_contains: str
    response_status: list[int] = Field(min_length=1)
    request_body_contains: str | list[str] | None = None
    response_body_contains: str | list[str] | None = None


class Milestone(_Strict):
    id: str
    label: str
    network_signature: NetworkSignature
    depends_on: list[str] | None = None
    after_milestone: str | None = None
    match_mode: Literal["all", "any_of_body"] | None = None
    hint_examples: list[str] | None = None


class Phase(_Strict):
    id: str
    title: str
    description: str
    role: str | None = None
    order: int
    tool_hosts: list[str]
    milestones: list[Milestone]


class Case(_Strict):
    id: str
    title: str
    description: str
    difficulty: str | None = None
    estimated_minutes: int | None = None
    title_template: str | None = None


class Context(_Strict):
    tools: dict[str, str]
    pedagogy: dict[str, str]
    notes: str


class Workflow(_Strict):
    case: Case
    variables: dict[str, str]
    context: Context
    phases: list[Phase]
    per_student_ports: list[str] | None = None


# ── Semantic checks ────────────────────────────────────────────────

PLACEHOLDER = re.compile(r"\{\{(\w+(?:\.\w+)*)\}\}")
# IPv4 with literal `.` separator (does not match defanged forms like 172[.]31[.]0[.]2).
IPV4 = re.compile(r"\b(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?\b")


def _walk_strings(node: Any, path: str = "") -> list[tuple[str, str]]:
    """Return (path, value) for every leaf string in the tree."""
    out: list[tuple[str, str]] = []
    if isinstance(node, str):
        out.append((path, node))
    elif isinstance(node, list):
        for i, v in enumerate(node):
            out.extend(_walk_strings(v, f"{path}[{i}]"))
    elif isinstance(node, dict):
        for k, v in node.items():
            out.extend(_walk_strings(v, f"{path}.{k}" if path else k))
    return out


def _detect_cycles_in_phase(
    phase: Phase, phase_index: int, errors: list[str]
) -> None:
    """DFS over `depends_on` within the phase to detect cycles."""
    graph = {m.id: list(m.depends_on or []) for m in phase.milestones}
    WHITE, GRAY, BLACK = 0, 1, 2
    color = {k: WHITE for k in graph}

    def dfs(n: str) -> None:
        color[n] = GRAY
        for nb in graph.get(n, []):
            if nb not in graph:
                continue  # missing reference: reported separately
            if color[nb] == GRAY:
                errors.append(
                    f"phases[{phase_index}] (`{phase.id}`): cycle in depends_on "
                    f"involving `{nb}`"
                )
                return
            if color[nb] == WHITE:
                dfs(nb)
        color[n] = BLACK

    for k in list(graph.keys()):
        if color[k] == WHITE:
            dfs(k)


def semantic_checks(wf: Workflow, raw: dict) -> tuple[list[str], list[str]]:
    errors: list[str] = []
    warnings: list[str] = []
    var_names = set(wf.variables.keys())

    # 1. Every {{variable}} used in any string must exist in `variables`.
    for path, s in _walk_strings(raw):
        if path.startswith("variables"):
            continue  # values inside `variables` can't reference themselves
        for m in PLACEHOLDER.finditer(s):
            name = m.group(1)
            if name not in var_names:
                errors.append(
                    f"{path}: variable `{name}` referenced but not defined "
                    f"in `variables`"
                )

    # 2. Uniqueness of phase.id, phase.order, and milestone.id (global).
    seen_phase_ids: dict[str, int] = {}
    seen_orders: dict[int, int] = {}
    milestone_to_phase: dict[str, str] = {}
    order_by_milestone: dict[str, int] = {}
    for pi, phase in enumerate(wf.phases):
        if phase.id in seen_phase_ids:
            errors.append(
                f"phases[{pi}].id `{phase.id}` duplicated "
                f"(also in phases[{seen_phase_ids[phase.id]}])"
            )
        else:
            seen_phase_ids[phase.id] = pi
        if phase.order in seen_orders:
            errors.append(
                f"phases[{pi}].order={phase.order} duplicated "
                f"(also in phases[{seen_orders[phase.order]}])"
            )
        else:
            seen_orders[phase.order] = pi
        for mi, ms in enumerate(phase.milestones):
            if ms.id in milestone_to_phase:
                errors.append(
                    f"phases[{pi}].milestones[{mi}].id `{ms.id}` duplicated "
                    f"(also in phase `{milestone_to_phase[ms.id]}`)"
                )
            else:
                milestone_to_phase[ms.id] = phase.id
                order_by_milestone[ms.id] = phase.order

    # 3. depends_on (same phase) and after_milestone (earlier phase).
    for pi, phase in enumerate(wf.phases):
        ms_ids_this_phase = {m.id for m in phase.milestones}
        for mi, ms in enumerate(phase.milestones):
            base = f"phases[{pi}].milestones[{mi}]"
            for dep in ms.depends_on or []:
                if dep == ms.id:
                    errors.append(
                        f"{base}.depends_on: `{dep}` cannot depend on itself"
                    )
                elif dep not in ms_ids_this_phase:
                    errors.append(
                        f"{base}.depends_on: `{dep}` is not in the same phase "
                        f"(use `after_milestone` for cross-phase dependencies)"
                    )
            if ms.after_milestone:
                if ms.after_milestone not in order_by_milestone:
                    errors.append(
                        f"{base}.after_milestone: `{ms.after_milestone}` does not exist"
                    )
                elif order_by_milestone[ms.after_milestone] >= phase.order:
                    errors.append(
                        f"{base}.after_milestone: `{ms.after_milestone}` is not in an "
                        f"earlier phase (its order="
                        f"{order_by_milestone[ms.after_milestone]} >= {phase.order})"
                    )

    # 4. Cycles in depends_on within each phase.
    for pi, phase in enumerate(wf.phases):
        _detect_cycles_in_phase(phase, pi, errors)

    # 5. context.pedagogy: keys must be phase ids.
    phase_ids = set(seen_phase_ids.keys())
    for pk in wf.context.pedagogy.keys():
        if pk not in phase_ids:
            errors.append(
                f"context.pedagogy: key `{pk}` does not correspond to any phase.id"
            )
    for pid in phase_ids:
        if pid not in wf.context.pedagogy:
            warnings.append(
                f"context.pedagogy: missing entry for phase `{pid}`"
            )

    # 6. per_student_ports references variables in IP:PORT format.
    if wf.per_student_ports:
        for name in wf.per_student_ports:
            if name not in var_names:
                errors.append(
                    f"per_student_ports: variable `{name}` not defined in `variables`"
                )
            elif ":" not in wf.variables[name]:
                warnings.append(
                    f"per_student_ports: `{name}`=`{wf.variables[name]}` "
                    f"has no base port (expected IP:PORT)"
                )

    # 7. `case.mode` is forbidden (already caught by `extra=forbid`, but we
    # surface a specific message in case it slips through a partial validation).
    if isinstance(raw.get("case"), dict) and "mode" in raw["case"]:
        errors.append(
            "case.mode: forbidden field (the guided/unguided choice is made "
            "at runtime, not embedded in the workflow)"
        )

    # ── Warnings (quality, non-blocking) ───────────────────────────

    # case.title literal: won't update when editing variables in the panel.
    if (
        not PLACEHOLDER.search(wf.case.title)
        and wf.case.title_template is None
    ):
        warnings.append(
            "case.title: literal without {{variables}} — the title won't "
            "update when editing variables in the panel"
        )

    # tool_hosts with literal IPs instead of variables.
    for pi, phase in enumerate(wf.phases):
        for hi, h in enumerate(phase.tool_hosts):
            if IPV4.search(h) and not PLACEHOLDER.search(h):
                warnings.append(
                    f"phases[{pi}].tool_hosts[{hi}]=`{h}`: literal IP — "
                    f"prefer a variable (e.g. {{{{thehive_host}}}}) so the "
                    f"case still works when the IP changes"
                )

    # hint_examples with literal IPs outside placeholders.
    for pi, phase in enumerate(wf.phases):
        for mi, ms in enumerate(phase.milestones):
            for hi, h in enumerate(ms.hint_examples or []):
                cleaned = PLACEHOLDER.sub("", h)
                if IPV4.search(cleaned):
                    warnings.append(
                        f"phases[{pi}].milestones[{mi}].hint_examples[{hi}]: "
                        f"contains a literal IP — use a host variable so it "
                        f"doesn't go stale"
                    )

    # hint_examples: convention of 3 (least to most directive).
    for pi, phase in enumerate(wf.phases):
        for mi, ms in enumerate(phase.milestones):
            n = len(ms.hint_examples or [])
            if n and n != 3:
                warnings.append(
                    f"phases[{pi}].milestones[{mi}].hint_examples: {n} entries "
                    f"(convention: 3 hints, least to most directive)"
                )

    # phase.order: contiguous integers starting at 1.
    orders = sorted(p.order for p in wf.phases)
    expected = list(range(1, len(orders) + 1))
    if orders != expected:
        warnings.append(
            f"phases[*].order: {orders} (convention: contiguous integers "
            f"starting at 1)"
        )

    return errors, warnings


# ── CLI ────────────────────────────────────────────────────────────


def _format_validation_error(ve: ValidationError) -> list[str]:
    out: list[str] = []
    for err in ve.errors():
        loc = ".".join(str(p) for p in err["loc"])
        etype = err["type"]
        if etype == "extra_forbidden":
            out.append(
                f"{loc}: field not allowed (the skill doesn't declare this "
                f"field; check for typos or hallucinated fields)"
            )
        else:
            out.append(f"{loc}: {err['msg']} [{etype}]")
    return out


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print(
            "usage: validate_workflow.py <workflow.json>", file=sys.stderr
        )
        return 2
    path = Path(argv[1])
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as e:
        print(f"❌ Could not read/parse JSON: {e}", file=sys.stderr)
        return 1

    errors: list[str] = []
    warnings: list[str] = []

    try:
        wf = Workflow.model_validate(raw)
    except ValidationError as ve:
        errors.extend(_format_validation_error(ve))
        # Skip semantic checks if the shape is broken.
    else:
        e2, w2 = semantic_checks(wf, raw)
        errors.extend(e2)
        warnings.extend(w2)

    if errors:
        print(f"❌ {len(errors)} error(s):", file=sys.stderr)
        for e in errors:
            print(f"  - {e}", file=sys.stderr)
    if warnings:
        print(f"⚠️  {len(warnings)} warning(s):", file=sys.stderr)
        for w in warnings:
            print(f"  - {w}", file=sys.stderr)
    if not errors and not warnings:
        print(f"✅ {path}: no errors or warnings")
    elif not errors:
        print(f"✅ {path}: no errors (warnings above)")

    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
