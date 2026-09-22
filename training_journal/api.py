from __future__ import annotations

import logging
from typing import Annotated

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from .config import Settings
from .models import ISODate, Plan, ProgressPoint, ProgressSeries, SyncResult, WorkoutDocument, WorkoutWrite
from .storage import RevisionConflict, StorageError, WorkoutStore

logger = logging.getLogger(__name__)


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or Settings.from_env()
    store = WorkoutStore(settings)
    app = FastAPI(
        title="Dziennik treningowy", version="0.1.0",
        description="Private VPN-only API. Dates identify workouts; synchronization is explicit. No authentication.",
    )
    app.state.store = store

    @app.exception_handler(RequestValidationError)
    async def invalid_request(_: Request, exc: RequestValidationError):
        # Do not echo nonfinite input numbers, which cannot be encoded in JSON.
        errors = [{key: error[key] for key in ("type", "loc", "msg")} for error in exc.errors()]
        return JSONResponse(status_code=422, content={"detail": errors})

    @app.exception_handler(StorageError)
    async def invalid_storage(_: Request, exc: StorageError):
        logger.error("Storage error: %s", exc)
        return JSONResponse(status_code=503, content={"detail": {"code": "storage_error", "message": str(exc)}})

    @app.exception_handler(OSError)
    async def unavailable_storage(_: Request, exc: OSError):
        logger.error("Filesystem error: %s", exc)
        return JSONResponse(status_code=503, content={"detail": {
            "code": "storage_unavailable", "message": "Storage operation failed; retry the same request."
        }})

    @app.get("/api/plan", response_model=Plan)
    def get_plan():
        try:
            return Plan.model_validate_json(settings.plan_file.read_text(encoding="utf-8"))
        except ValueError as exc:
            raise StorageError("Invalid plan configuration") from exc

    def check_range(start: ISODate, end: ISODate):
        if start > end:
            raise HTTPException(422, "from must be on or before to")

    @app.get("/api/workouts", response_model=list[WorkoutDocument])
    def list_workouts(start: Annotated[ISODate, Query(alias="from")], end: Annotated[ISODate, Query(alias="to")]):
        check_range(start, end)
        return store.list(start, end)

    @app.get("/api/workouts/{date}", response_model=WorkoutDocument)
    def get_workout(date: ISODate):
        workout = store.get(date)
        if workout is None:
            raise HTTPException(404, "Workout not found")
        return workout

    @app.put("/api/workouts/{date}", response_model=SyncResult, responses={
        409: {"description": "Revision conflict; fetch the current document before editing."},
        503: {"description": "Storage unavailable; safely retry the same request."},
    })
    def save_workout(date: ISODate, request: WorkoutWrite):
        if date != request.date:
            raise HTTPException(422, "URL date must match the workout date")
        try:
            return store.save(request)
        except RevisionConflict as exc:
            raise HTTPException(409, detail={"code": "revision_conflict", "current_revision": exc.current_revision}) from exc

    @app.get("/api/progress", response_model=list[ProgressSeries])
    def get_progress(start: Annotated[ISODate, Query(alias="from")], end: Annotated[ISODate, Query(alias="to")]):
        check_range(start, end)
        groups = {}
        for workout in store.list(start, end):
            for exercise in workout.exercises:
                values = [item.value for item in exercise.sets if item.value is not None]
                if not values:
                    continue
                key = (exercise.exercise_id, exercise.unit)
                if key not in groups:
                    groups[key] = ProgressSeries(exercise_id=exercise.exercise_id, name=exercise.name,
                                                 unit=exercise.unit, points=[])
                groups[key].name = exercise.name
                groups[key].points.append(ProgressPoint(date=workout.date, value=max(values)))
        return list(groups.values())

    return app
