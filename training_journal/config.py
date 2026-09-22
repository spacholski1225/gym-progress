from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class Settings:
    repo_dir: Path
    data_dir: Path
    plan_file: Path

    def __post_init__(self) -> None:
        repo = self.repo_dir.resolve()
        data = self.data_dir.resolve()
        plan = self.plan_file.resolve()
        if not data.is_relative_to(repo) or data == repo:
            raise ValueError("DATA_DIR must be a subdirectory of REPO_DIR for Git tracking")
        if data.relative_to(repo).parts[0] in {".git", ".runtime"}:
            raise ValueError("DATA_DIR cannot be inside .git or .runtime")
        object.__setattr__(self, "repo_dir", repo)
        object.__setattr__(self, "data_dir", data)
        object.__setattr__(self, "plan_file", plan)

    @classmethod
    def from_env(cls) -> Settings:
        repo = Path(os.environ.get("REPO_DIR", Path(__file__).resolve().parents[1])).resolve()
        data = Path(os.environ.get("DATA_DIR", "data"))
        plan = Path(os.environ.get("PLAN_FILE", "plan.json"))
        return cls(repo, repo / data, repo / plan)
