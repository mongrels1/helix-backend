"""Pacing with non-teaching days (Track LP1). Run: python -m pytest test_timeweight.py"""
import timeweight


def _day(name, status="teach"):
    return {"name": name, "status": status,
            "segments": [{"teacher_actions": "T", "differentiation": {"ESOL": "x"}}]}


def test_non_teaching_days_keep_their_column_and_get_no_minutes():
    plan = {"days": [_day("Mon"), _day("Tue", "ild"), _day("Wed"), _day("Thu"), _day("Fri", "no_school")]}
    out = timeweight.apply_pacing(plan, 55, 3, ["ESOL"])
    assert [d["name"] for d in out["days"]] == ["Mon", "Tue", "Wed", "Thu", "Fri"]
    for d in (out["days"][1], out["days"][4]):
        assert len(d["segments"]) == 3
        assert all(s["minutes"] is None and s["lesson_component"] == "" for s in d["segments"]
                   if "lesson_component" in s)
        assert all(s["differentiation"] == {} for s in d["segments"])
        assert not d["segments"][0]["teacher_actions"].startswith("[")
    assert out["_pacing_ok"] is True


def test_phase_choice_counts_teaching_days_only():
    plan = {"days": [_day("Mon"), _day("Tue"), _day("Wed"), _day("Thu"), _day("Fri", "no_school")]}
    out = timeweight.apply_pacing(plan, 55, 3, [])
    # Thursday is the last teaching day, so it closes the week
    assert [s["lesson_component"] for s in out["days"][3]["segments"]] == ["Engage", "Apply", "Reflect"]
    assert [s["lesson_component"] for s in out["days"][0]["segments"]] == ["Pre-Instructional", "Engage", "Explore"]


def test_legacy_plan_without_status_is_unchanged():
    plan = {"days": [{"name": "Mon", "segments": []}, {"name": "Tue", "segments": []}]}
    out = timeweight.apply_pacing(plan, 50, 2, [])
    assert all(sum(s["minutes"] for s in d["segments"]) == 50 for d in out["days"])
    assert out["_pacing_ok"] is True
