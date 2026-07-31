"""
timeweight.py — deterministic pacing + phase selection for the docx sidecar.

The LLM (run in helix-backend via AIRouterService → Claude) drafts the plan
CONTENT with no minute counts. The sidecar applies these deterministic rules so
every day's segment minutes provably sum to the period, independent of the model.
"""
from __future__ import annotations

MATH_PHASES = ["Pre-Instructional", "Engage", "Explore", "Apply", "Reflect"]
PHASE_WEIGHTS = {
    "Pre-Instructional": 0.12, "Engage": 0.18, "Explore": 0.32,
    "Apply": 0.26, "Reflect": 0.12,
}

def allocate_minutes(period_minutes: int, phases: list[str]) -> list[int]:
    if not phases or not period_minutes:
        return [None] * len(phases)
    weights = [PHASE_WEIGHTS.get(p, 0.2) for p in phases]
    tot = sum(weights) or 1.0
    raw = [period_minutes * w / tot for w in weights]
    mins = [max(3, int(round(x))) for x in raw]
    diff = period_minutes - sum(mins)
    order = sorted(range(len(mins)), key=lambda i: raw[i] - mins[i], reverse=(diff > 0))
    k = 0
    while diff != 0 and order:
        i = order[k % len(order)]
        if diff > 0:
            mins[i] += 1; diff -= 1
        elif mins[i] > 3:
            mins[i] -= 1; diff += 1
        k += 1
        if k > 1000:
            break
    return mins

def choose_phases(num_segments: int, day_index: int, total_days: int) -> list[str]:
    if num_segments >= 5:
        return MATH_PHASES[:num_segments]
    if num_segments == 4:
        return ["Engage", "Explore", "Apply", "Reflect"]
    if num_segments == 3:
        if total_days > 1 and day_index >= total_days - 1:
            return ["Engage", "Apply", "Reflect"]
        if total_days > 1 and day_index == 0:
            return ["Pre-Instructional", "Engage", "Explore"]
        return ["Engage", "Explore", "Apply"]
    if num_segments == 2:
        return ["Engage", "Explore"]
    return ["Explore"] * num_segments

def apply_pacing(plan: dict, period_minutes: int, segments_per_day: int,
                 differentiation_groups: list[str]) -> dict:
    """Normalize an LLM-drafted plan: enforce segment count, assign phases,
    time-weight to the period, prune differentiation to selected groups, and
    stamp the minutes into each teacher_actions header."""
    days = plan.get("days", [])
    for di, d in enumerate(days):
        segs = d.get("segments", [])[:segments_per_day]
        default = choose_phases(segments_per_day, di, len(days))
        while len(segs) < segments_per_day:
            segs.append({"lesson_component": default[len(segs)]})
        phases = [s.get("lesson_component") or default[i] for i, s in enumerate(segs)]
        minutes = allocate_minutes(period_minutes, phases)
        for i, s in enumerate(segs):
            s["lesson_component"] = phases[i]
            s["minutes"] = minutes[i]
            diff = s.get("differentiation") or {}
            s["differentiation"] = {g: diff[g] for g in diff
                                    if g in differentiation_groups and diff.get(g)}
            if s.get("minutes") is not None:
                ta = s.get("teacher_actions", "")
                if not ta.startswith("["):
                    s["teacher_actions"] = f"[{s['minutes']} min] {ta}"
        d["segments"] = segs
    plan["days"] = days
    plan["_pacing_ok"] = all(
        period_minutes == 0 or sum(s.get("minutes") or 0 for s in d["segments"]) == period_minutes
        for d in days
    )
    return plan
