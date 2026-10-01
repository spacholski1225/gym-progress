from __future__ import annotations

import re
from datetime import date, datetime
from typing import Annotated, Literal

from pydantic import BaseModel, BeforeValidator, ConfigDict, Field, model_validator


def parse_date(value: object) -> date:
    if type(value) is date:
        return value
    if not isinstance(value, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
        raise ValueError("Use an ISO date: YYYY-MM-DD")
    return date.fromisoformat(value)


ISODate = Annotated[date, BeforeValidator(parse_date)]
Unit = Literal["kg", "sec"]
Revision = Annotated[str, Field(pattern=r"^[a-f0-9]{32}$")]
NonnegativeNumber = Annotated[float, Field(strict=True, ge=0, allow_inf_nan=False)]
NonnegativeInteger = Annotated[int, Field(strict=True, ge=0)]


class Model(BaseModel):
    model_config = ConfigDict(extra="forbid")


class WorkoutSet(Model):
    # Required keys; null explicitly represents an unfilled input.
    value: NonnegativeNumber | None
    reps: NonnegativeInteger | None


class ExerciseDefinition(Model):
    exercise_id: Annotated[str, Field(pattern=r"^[a-z][a-z0-9_]*$", max_length=80)]
    name: Annotated[str, Field(min_length=1, max_length=200)]
    unit: Unit


class Exercise(ExerciseDefinition):
    sets: Annotated[list[WorkoutSet], Field(min_length=1)]


class Plan(Model):
    plan_id: Annotated[str, Field(pattern=r"^[A-Z]$", min_length=1, max_length=1)] = "A"
    schema_version: Literal[1] = 1
    default_sets: Annotated[int, Field(strict=True, ge=1)]
    exercises: Annotated[list[ExerciseDefinition], Field(min_length=1)]

    @model_validator(mode="after")
    def unique_ids(self) -> Plan:
        ensure_unique_ids(self.exercises)
        return self


def ensure_unique_ids(exercises: list) -> None:
    ids = [exercise.exercise_id for exercise in exercises]
    if len(ids) != len(set(ids)):
        raise ValueError("exercise_id must be unique within a workout or plan")


class WorkoutContent(Model):
    schema_version: Literal[1]
    date: ISODate
    exercises: Annotated[list[Exercise], Field(min_length=1)]

    @model_validator(mode="after")
    def unique_ids(self) -> WorkoutContent:
        ensure_unique_ids(self.exercises)
        return self


class WorkoutWrite(WorkoutContent):
    expected_revision: Revision | None = None


class WorkoutDocument(WorkoutContent):
    revision: Revision
    created_at: datetime
    updated_at: datetime


class GitResult(Model):
    status: Literal["committed", "unchanged", "failed"]
    commit: str | None = None
    error: str | None = None


class SyncResult(Model):
    saved: Literal[True] = True
    changed: bool
    workout: WorkoutDocument
    git: GitResult


class ProgressPoint(Model):
    date: ISODate
    value: NonnegativeNumber


class ProgressSeries(Model):
    exercise_id: str
    name: str
    unit: Unit
    points: list[ProgressPoint]
