import json
import subprocess
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from training_journal.api import create_app
from training_journal.config import Settings

PROJECT = Path(__file__).resolve().parents[1]


def git(repo, *args):
    return subprocess.run(
        ["git", "-c", "user.name=Test", "-c", "user.email=test@localhost",
         "-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", *args],
        cwd=repo, capture_output=True, text=True, check=True,
    ).stdout.strip()


@pytest.fixture
def environment(tmp_path):
    git(tmp_path, "init", "-b", "main")
    (tmp_path / "plan.json").write_text((PROJECT / "plan.json").read_text(), encoding="utf-8")
    (tmp_path / "plan-b.json").write_text((PROJECT / "plan-b.json").read_text(), encoding="utf-8")
    (tmp_path / ".gitignore").write_text(".runtime/\n")
    git(tmp_path, "add", ".")
    git(tmp_path, "commit", "-m", "Initial plan")
    settings = Settings(tmp_path, tmp_path / "data", tmp_path / "plan.json")
    app = create_app(settings)
    with TestClient(app) as client:
        yield client, app.state.store, settings


@pytest.fixture
def payload():
    plan = json.loads((PROJECT / "plan.json").read_text())
    return {
        "schema_version": 1,
        "date": "2026-09-22",
        "expected_revision": None,
        "exercises": [{**exercise, "sets": [{"value": None, "reps": None} for _ in range(3)]}
                      for exercise in plan["exercises"]],
    }
