import copy
import json
from concurrent.futures import ThreadPoolExecutor
from datetime import date, timedelta

import pytest

from conftest import git
from training_journal.storage import GitFailure


def put(client, payload):
    return client.put(f"/api/workouts/{payload['date']}", json=payload)


def test_plan_and_openapi(environment):
    client, _, _ = environment
    plan = client.get("/api/plan").json()
    assert plan["default_sets"] == 3
    assert [item["exercise_id"] for item in plan["exercises"]] == [
        "hack_squat_machine", "standing_leg_curl", "standing_calf_raise", "adductor_machine",
        "seated_supported_biceps_curl", "hammer_curl", "single_arm_overhead_triceps",
        "straight_bar_pushdown", "barbell_row", "single_arm_machine_row", "cable_crunch", "side_ball_twist"]
    assert plan["exercises"][-1]["unit"] == "kg"
    schema = client.get("/openapi.json").json()
    assert "put" in schema["paths"]["/api/workouts/{date}"]
    assert client.get("/docs").status_code == 200


def test_empty_workout_roundtrip_and_identical_retry(environment, payload):
    client, _, settings = environment
    result = put(client, payload)
    assert result.status_code == 200, result.text
    body = result.json()
    assert body["saved"] and body["changed"]
    assert body["git"]["status"] == "committed"
    document = body["workout"]
    assert document["exercises"][0]["sets"][0] == {"value": None, "reps": None}
    assert document["created_at"].endswith("Z")
    disk = json.loads((settings.data_dir / "2026-09-22.json").read_text())
    assert disk == document
    assert client.get("/api/workouts/2026-09-22").json() == document
    head = git(settings.repo_dir, "rev-parse", "HEAD")
    retry = put(client, payload).json()
    assert retry["workout"] == document
    assert retry["changed"] is False
    assert retry["git"]["status"] == "unchanged"
    assert git(settings.repo_dir, "rev-parse", "HEAD") == head


def test_edit_historical_workout_with_variable_sets(environment, payload):
    client, _, settings = environment
    payload["date"] = "2020-01-03"
    first = put(client, payload).json()["workout"]
    payload["expected_revision"] = first["revision"]
    payload["exercises"][0]["sets"] = [{"value": 23.5, "reps": 8}]
    payload["exercises"][-1]["sets"].append({"value": 60, "reps": 1})
    response = put(client, payload)
    assert response.status_code == 200, response.text
    updated = response.json()["workout"]
    assert updated["date"] == first["date"]
    assert updated["created_at"] == first["created_at"]
    assert updated["updated_at"] >= first["updated_at"]
    assert updated["revision"] != first["revision"]
    assert len(list(settings.data_dir.glob("*.json"))) == 1
    assert updated["exercises"][0]["sets"] == [{"value": 23.5, "reps": 8}]
    assert len(updated["exercises"][-1]["sets"]) == 4


def test_revision_conflict_does_not_change_file_or_git(environment, payload):
    client, _, settings = environment
    first = put(client, payload).json()["workout"]
    stale = copy.deepcopy(payload)
    payload["expected_revision"] = first["revision"]
    payload["exercises"][0]["sets"][0]["value"] = 30
    latest = put(client, payload).json()["workout"]
    head = git(settings.repo_dir, "rev-parse", "HEAD")
    stale["expected_revision"] = first["revision"]
    stale["exercises"][0]["sets"][0]["value"] = 20
    result = put(client, stale)
    assert result.status_code == 409
    assert result.json()["detail"]["current_revision"] == latest["revision"]
    assert client.get("/api/workouts/2026-09-22").json() == latest
    assert git(settings.repo_dir, "rev-parse", "HEAD") == head


def test_expected_revision_for_missing_workout_conflicts(environment, payload):
    client, _, _ = environment
    payload["expected_revision"] = "a" * 32
    response = put(client, payload)
    assert response.status_code == 409
    assert response.json()["detail"]["current_revision"] is None


@pytest.mark.parametrize("field,value", [
    ("value", -1), ("value", "23,5"), ("value", "23.5"), ("value", True),
    ("reps", -1), ("reps", 1.5), ("reps", True), ("reps", "8"),
])
def test_invalid_numbers(environment, payload, field, value):
    client, _, settings = environment
    payload["exercises"][0]["sets"][0][field] = value
    assert put(client, payload).status_code == 422
    assert not settings.data_dir.exists()


@pytest.mark.parametrize("number", ["NaN", "Infinity", "-Infinity", "1e999"])
def test_nonfinite_numbers_are_rejected(environment, payload, number):
    client, _, _ = environment
    text = json.dumps(payload).replace('"value": null', f'"value": {number}', 1)
    assert client.put("/api/workouts/2026-09-22", content=text,
                      headers={"Content-Type": "application/json"}).status_code == 422


def test_required_null_keys_and_unique_ids(environment, payload):
    client, _, _ = environment
    del payload["exercises"][0]["sets"][0]["reps"]
    assert put(client, payload).status_code == 422
    payload["exercises"][0]["sets"][0]["reps"] = None
    payload["exercises"].append(copy.deepcopy(payload["exercises"][0]))
    assert put(client, payload).status_code == 422


def test_date_validation_and_missing_workout(environment, payload):
    client, _, _ = environment
    assert client.get("/api/workouts/2026-09-22").status_code == 404
    assert client.get("/api/workouts/2026-02-30").status_code == 422
    assert client.get("/api/workouts/20260922").status_code == 422
    assert client.put("/api/workouts/2026-09-21", json=payload).status_code == 422
    assert client.get("/api/workouts", params={"from": "2026-09-22", "to": "2026-09-01"}).status_code == 422


def test_git_commit_excludes_staged_and_unstaged_code(environment, payload):
    client, _, settings = environment
    repo = settings.repo_dir
    (repo / "staged.py").write_text("staged = True\n")
    git(repo, "add", "staged.py")
    (repo / "plan.json").write_text((repo / "plan.json").read_text() + "\n")
    assert put(client, payload).json()["git"]["status"] == "committed"
    assert git(repo, "diff-tree", "--no-commit-id", "--name-only", "-r", "HEAD") == "data/2026-09-22.json"
    assert git(repo, "diff", "--cached", "--name-only") == "staged.py"
    assert git(repo, "diff", "--name-only") == "plan.json"
    # Editing an already tracked workout must preserve unrelated staged changes too.
    payload["expected_revision"] = client.get("/api/workouts/2026-09-22").json()["revision"]
    payload["exercises"][0]["sets"][0]["value"] = 42
    assert put(client, payload).json()["git"]["status"] == "committed"
    assert git(repo, "diff", "--cached", "--name-only") == "staged.py"


def test_git_failure_preserves_data_and_retries_commit(environment, payload, monkeypatch):
    client, store, settings = environment
    original = store.versioner.run

    def fail_commit(*args):
        if args[0] == "commit":
            raise GitFailure("simulated commit failure")
        return original(*args)

    monkeypatch.setattr(store.versioner, "run", fail_commit)
    first = put(client, payload).json()
    assert first["saved"] is True
    assert first["git"]["status"] == "failed"
    assert client.get("/api/workouts/2026-09-22").json() == first["workout"]
    monkeypatch.setattr(store.versioner, "run", original)
    retry = put(client, payload).json()
    assert retry["changed"] is False
    assert retry["workout"] == first["workout"]
    assert retry["git"]["status"] == "committed"
    assert git(settings.repo_dir, "status", "--porcelain") == ""


def test_atomic_replace_failure_keeps_previous_workout(environment, payload, monkeypatch):
    client, _, settings = environment
    first = put(client, payload).json()["workout"]
    head = git(settings.repo_dir, "rev-parse", "HEAD")
    payload["expected_revision"] = first["revision"]
    payload["exercises"][0]["sets"][0]["value"] = 25

    def fail_replace(*args):
        raise OSError("simulated interrupted write")

    monkeypatch.setattr("training_journal.storage.os.replace", fail_replace)
    assert put(client, payload).status_code == 503
    assert client.get("/api/workouts/2026-09-22").json() == first
    assert not list(settings.data_dir.glob(".*.tmp"))
    assert git(settings.repo_dir, "rev-parse", "HEAD") == head


def test_plan_change_does_not_rewrite_history(environment, payload):
    client, _, settings = environment
    before = put(client, payload).json()["workout"]
    plan = json.loads(settings.plan_file.read_text())
    plan["exercises"][0]["name"] = "Nowa nazwa"
    settings.plan_file.write_text(json.dumps(plan))
    assert client.get("/api/plan").json()["exercises"][0]["name"] == "Nowa nazwa"
    assert client.get("/api/workouts/2026-09-22").json() == before


@pytest.mark.parametrize("days", [30, 90])
def test_progress_inclusive_window_and_units(environment, payload, days):
    client, _, _ = environment
    end = date(2026, 9, 22)
    start = end - timedelta(days=days - 1)
    for day in [end, start - timedelta(days=1), start, end + timedelta(days=1)]:
        payload["date"] = day.isoformat()
        payload["exercises"][0]["sets"] = [{"value": 20, "reps": None}, {"value": 23.5, "reps": 8}]
        payload["exercises"][1]["sets"] = [{"value": 0, "reps": 0}]
        payload["exercises"][-1]["sets"] = [{"value": 60, "reps": 1}, {"value": 45, "reps": 1}]
        payload["exercises"][0]["unit"] = "sec" if day == end else "kg"
        assert put(client, payload).status_code == 200
    params = {"from": start.isoformat(), "to": end.isoformat()}
    workouts = client.get("/api/workouts", params=params).json()
    assert [item["date"] for item in workouts] == [start.isoformat(), end.isoformat()]
    assert all(item["revision"] for item in workouts)
    progress = client.get("/api/progress", params=params).json()
    by_key = {(item["exercise_id"], item["unit"]): item for item in progress}
    assert len(by_key) == 4
    assert by_key[("hack_squat_machine", "kg")]["points"] == [{"date": start.isoformat(), "value": 23.5}]
    assert by_key[("hack_squat_machine", "sec")]["points"] == [{"date": end.isoformat(), "value": 23.5}]
    assert [p["value"] for p in by_key[("standing_leg_curl", "kg")]["points"]] == [0, 0]
    assert [p["value"] for p in by_key[("side_ball_twist", "kg")]["points"]] == [60, 60]


def test_concurrent_writers_cannot_overwrite_same_revision(environment, payload):
    client, _, settings = environment
    original = put(client, payload).json()["workout"]
    requests = []
    for value in [10, 20]:
        item = copy.deepcopy(payload)
        item["expected_revision"] = original["revision"]
        item["exercises"][0]["sets"][0]["value"] = value
        requests.append(item)
    with ThreadPoolExecutor(max_workers=2) as pool:
        responses = list(pool.map(lambda item: put(client, item), requests))
    assert sorted(response.status_code for response in responses) == [200, 409]
    assert git(settings.repo_dir, "status", "--porcelain") == ""


def test_corrupt_workout_is_not_silently_overwritten(environment, payload):
    client, _, settings = environment
    put(client, payload)
    path = settings.data_dir / "2026-09-22.json"
    path.write_text("{broken")
    assert client.get("/api/workouts/2026-09-22").status_code == 503
    assert put(client, payload).status_code == 503
    assert path.read_text() == "{broken"
