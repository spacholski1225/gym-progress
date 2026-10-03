from __future__ import annotations

import fcntl
import json
import logging
import os
import re
import subprocess
import tempfile
import threading
from contextlib import contextmanager
from datetime import date, datetime, timezone
from pathlib import Path
from uuid import uuid4

from .models import DeleteResult, GitResult, SyncResult, WorkoutDocument, WorkoutWrite

logger = logging.getLogger(__name__)


class RevisionConflict(Exception):
    def __init__(self, current_revision: str | None):
        self.current_revision = current_revision


class StorageError(Exception):
    pass


class GitFailure(Exception):
    pass


class GitVersioner:
    def __init__(self, repo_dir: Path):
        self.repo_dir = repo_dir

    def run(self, *args: str) -> str:
        try:
            result = subprocess.run(
                ["git", "-c", "user.name=Training Journal", "-c",
                 "user.email=training-journal@localhost", "-c", "commit.gpgsign=false",
                 "-c", "core.hooksPath=/dev/null", *args],
                cwd=self.repo_dir, capture_output=True, text=True, timeout=30,
                # Do not let inherited Git environment redirect the index/worktree.
                env={key: value for key, value in os.environ.items() if not key.startswith("GIT_")},
            )
        except (OSError, subprocess.TimeoutExpired) as exc:
            raise GitFailure(str(exc)) from exc
        if result.returncode:
            raise GitFailure(result.stderr.strip() or result.stdout.strip() or "Git command failed")
        return result.stdout.strip()

    def commit_workout(self, path: Path, message: str | None = None) -> GitResult:
        try:
            root = Path(self.run("rev-parse", "--show-toplevel")).resolve()
            if root != self.repo_dir:
                raise GitFailure("REPO_DIR must be the root of its own Git repository")
            for marker in ("MERGE_HEAD", "CHERRY_PICK_HEAD", "REVERT_HEAD", "rebase-merge", "rebase-apply"):
                marker_path = Path(self.run("rev-parse", "--git-path", marker))
                if (self.repo_dir / marker_path).exists():
                    raise GitFailure("Finish the ongoing Git merge/rebase before syncing")
            relative = path.relative_to(self.repo_dir).as_posix()
            if not self.run("status", "--porcelain", "--untracked-files=all", "--", relative):
                # Verify tracking too: an ignored file must not be reported as committed.
                self.run("ls-files", "--error-unmatch", "--", relative)
                return GitResult(status="unchanged", commit=self.run("rev-parse", "HEAD"))
            self.run("add", "--", relative)
            self.run("commit", "--only", "-m", message or f"Save workout {path.stem}", "--", relative)
            return GitResult(status="committed", commit=self.run("rev-parse", "HEAD"))
        except GitFailure as exc:
            logger.warning("Workout saved, but Git failed: %s", exc)
            return GitResult(status="failed", error=str(exc))


class WorkoutStore:
    def __init__(self, settings: Settings):
        self.settings = settings
        self.versioner = GitVersioner(settings.repo_dir)
        self._lock = threading.RLock()

    @contextmanager
    def locked(self):
        with self._lock:
            runtime = self.settings.repo_dir / ".runtime"
            runtime.mkdir(exist_ok=True)
            with (runtime / "workouts.lock").open("a") as lock_file:
                fcntl.flock(lock_file, fcntl.LOCK_EX)
                try:
                    yield
                finally:
                    fcntl.flock(lock_file, fcntl.LOCK_UN)

    def _path(self, day: date) -> Path:
        return self.settings.data_dir / f"{day.isoformat()}.json"

    def _read(self, day: date) -> WorkoutDocument | None:
        path = self._path(day)
        if path.is_symlink():
            raise StorageError("Workout files cannot be symbolic links")
        try:
            text = path.read_text(encoding="utf-8")
        except FileNotFoundError:
            return None
        try:
            workout = WorkoutDocument.model_validate_json(text)
            if workout.date != day:
                raise ValueError("Filename and workout date differ")
            return workout
        except ValueError as exc:
            raise StorageError(f"Invalid workout file: {path.name}") from exc

    def get(self, day: date) -> WorkoutDocument | None:
        with self.locked():
            return self._read(day)

    def list(self, start: date, end: date) -> list[WorkoutDocument]:
        with self.locked():
            result = []
            for path in sorted(self.settings.data_dir.glob("*.json")):
                if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", path.stem):
                    continue
                try:
                    day = date.fromisoformat(path.stem)
                except ValueError as exc:
                    raise StorageError(f"Invalid workout filename: {path.name}") from exc
                if start <= day <= end:
                    workout = self._read(day)
                    if workout is not None:
                        result.append(workout)
            return result

    @staticmethod
    def _content(workout: WorkoutDocument | WorkoutWrite) -> dict:
        return workout.model_dump(mode="json", include={"schema_version", "date", "exercises"})

    def _atomic_write(self, path: Path, workout: WorkoutDocument) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        payload = json.dumps(workout.model_dump(mode="json"), ensure_ascii=False, indent=2, allow_nan=False) + "\n"
        temporary = None
        try:
            with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=path.parent,
                                             prefix=f".{path.stem}.", suffix=".tmp", delete=False) as stream:
                temporary = Path(stream.name)
                stream.write(payload)
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(temporary, path)
            directory_fd = os.open(path.parent, os.O_RDONLY)
            try:
                os.fsync(directory_fd)
            finally:
                os.close(directory_fd)
        finally:
            if temporary is not None:
                temporary.unlink(missing_ok=True)

    def save(self, request: WorkoutWrite) -> SyncResult:
        with self.locked():
            existing = self._read(request.date)
            same = existing is not None and self._content(existing) == self._content(request)
            # An identical retry is safe even if the first response was lost.
            if not same:
                revision = existing.revision if existing else None
                if request.expected_revision != revision:
                    raise RevisionConflict(revision)
                now = datetime.now(timezone.utc)
                workout = WorkoutDocument(
                    **self._content(request), revision=uuid4().hex,
                    created_at=existing.created_at if existing else now, updated_at=now,
                )
                self._atomic_write(self._path(request.date), workout)
            else:
                workout = existing
            git = self.versioner.commit_workout(self._path(request.date))
            return SyncResult(changed=not same, workout=workout, git=git)

    def delete(self, day: date, expected_revision: str | None) -> DeleteResult | None:
        with self.locked():
            existing = self._read(day)
            if existing is None:
                return None
            if existing.revision != expected_revision:
                raise RevisionConflict(existing.revision)
            path = self._path(day)
            path.unlink()
            git = self.versioner.commit_workout(path, f"Delete workout {day.isoformat()}")
            return DeleteResult(date=day, git=git)
