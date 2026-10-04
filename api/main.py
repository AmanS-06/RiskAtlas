"""RiskAtlas API. Run from the repo root: uvicorn api.main:app --reload

GET  /health         liveness and whether the models loaded
GET  /meta           features, targets, bands, mesh map and model info, all from config/
POST /predict        full payload: probabilities, uncertainty, SHAP, physiology, counterfactuals
POST /predict/fast   probabilities and bands only, for live what-if sliders

Contract: api/schemas.py and docs/api.md. Environment variables: api/settings.py.
"""
import logging
import time
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from api import settings
from api.schemas import (API_VERSION, DISCLAIMER, ErrorResponse, FastPredictResponse, HealthResponse, MetaResponse,
                         PredictRequest, PredictResponse)
from api.service import ServiceUnavailable, load_engine
from pipeline.leakage import LeakageError

log = logging.getLogger("api")
MOCK_HEADER = "X-RiskAtlas-Mock"
ERROR_RESPONSES = {422: {"model": ErrorResponse, "description": "Invalid request or a label column used as input"},
                   503: {"model": ErrorResponse, "description": "Models not loaded, or trained against a different features.yaml"}}


def error(status: int, code: str, message: str, details=None) -> JSONResponse:
    body = {"code": code, "message": message}
    if details:
        body["details"] = details
    return JSONResponse(status_code=status, content={"error": body})


def create_app(mock=None) -> FastAPI:
    """mock=None reads API_MOCK. Tests pass it explicitly."""
    use_mock = settings.mock_enabled() if mock is None else mock

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        # Load once. A failure is kept, not raised, so the server still starts and every endpoint
        # answers with a clear 503 instead of the process dying.
        app.state.engine, app.state.load_error = None, None
        t0 = time.perf_counter()
        try:
            app.state.engine = load_engine(use_mock)
            log.info("%s engine ready in %.1f s", "mock" if use_mock else "model", time.perf_counter() - t0)
        except ServiceUnavailable as exc:
            app.state.load_error = exc
            log.error("engine not available: %s", exc)
        yield

    app = FastAPI(title="RiskAtlas API", version=API_VERSION, lifespan=lifespan,
                  description=DISCLAIMER + " Contract and usage: docs/api.md.")
    origins = settings.cors_origins()
    app.add_middleware(CORSMiddleware, allow_origins=origins, allow_methods=["GET", "POST", "OPTIONS"],
                       allow_headers=["*"], expose_headers=[MOCK_HEADER, "X-Cache"],
                       allow_credentials="*" not in origins)

    # ---- errors: every non-2xx response is {"error": {"code", "message", "details"?}} ------------------

    @app.exception_handler(LeakageError)
    async def on_leakage(request: Request, exc: LeakageError):
        return error(422, "leakage", str(exc), [{"field": k, "message": "label columns cannot be inputs"}
                                                for k in getattr(exc, "keys", [])])

    @app.exception_handler(ServiceUnavailable)
    async def on_unavailable(request: Request, exc: ServiceUnavailable):
        return error(503, exc.code, str(exc))

    @app.exception_handler(RequestValidationError)
    async def on_validation(request: Request, exc: RequestValidationError):
        details = []
        for e in exc.errors():
            loc = [str(p) for p in e["loc"] if p != "body"]
            msg = e["msg"].removeprefix("Value error, ")
            details.append({"field": ".".join(loc) or None, "message": msg, "type": e["type"]})
        first = details[0]
        where = f"{first['field']}: " if first["field"] else ""
        more = f" (and {len(details) - 1} more)" if len(details) > 1 else ""
        return error(422, "validation_error", f"Invalid request. {where}{first['message']}{more}", details)

    @app.exception_handler(StarletteHTTPException)
    async def on_http(request: Request, exc: StarletteHTTPException):
        code = {404: "not_found", 405: "method_not_allowed"}.get(exc.status_code, "http_error")
        return error(exc.status_code, code, str(exc.detail))

    @app.exception_handler(Exception)
    async def on_unexpected(request: Request, exc: Exception):
        log.exception("unhandled error on %s %s", request.method, request.url.path)
        return error(500, "internal_error", "Unexpected server error. The details are in the server log.")

    # ---- routes -----------------------------------------------------------------------------------------
    # Plain `def` routes: FastAPI runs them in a threadpool, so a 2 to 4 s /predict never blocks the
    # event loop (or /health, or a concurrent /predict/fast).

    def get_engine(request: Request):
        engine = request.app.state.engine
        if engine is None:
            exc = request.app.state.load_error
            raise exc if exc else ServiceUnavailable("models_unavailable", "Models are not loaded")
        return engine

    def stamp(response: Response, engine, hit=None) -> None:
        if engine.mock:
            response.headers[MOCK_HEADER] = "true"
        if hit is not None:
            response.headers["X-Cache"] = "HIT" if hit else "MISS"

    @app.get("/health", response_model=HealthResponse, responses={503: {"model": HealthResponse}})
    def health(request: Request):
        engine = request.app.state.engine
        if engine is None:
            err = request.app.state.load_error
            body = HealthResponse(status="degraded", mock=use_mock, models_loaded=False, error=str(err))
            return JSONResponse(status_code=503, content=body.model_dump())
        response = JSONResponse(content=HealthResponse(**engine.health()).model_dump())
        stamp(response, engine)
        return response

    @app.get("/meta", response_model=MetaResponse, responses=ERROR_RESPONSES)
    def meta(response: Response, engine=Depends(get_engine)):
        stamp(response, engine)
        return engine.meta

    @app.post("/predict", response_model=PredictResponse, responses=ERROR_RESPONSES)
    def predict(payload: PredictRequest, response: Response, engine=Depends(get_engine)):
        out, hit = engine.predict(payload.model_dump(exclude_unset=True), fast=False)
        response.headers["Cache-Control"] = "no-store"
        stamp(response, engine, hit)
        return {**out, "disclaimer": DISCLAIMER}

    @app.post("/predict/fast", response_model=FastPredictResponse, responses=ERROR_RESPONSES)
    def predict_fast(payload: PredictRequest, response: Response, engine=Depends(get_engine)):
        out, hit = engine.predict(payload.model_dump(exclude_unset=True), fast=True)
        response.headers["Cache-Control"] = "no-store"
        stamp(response, engine, hit)
        return {**out, "disclaimer": DISCLAIMER}

    return app


app = create_app()
