"""Run the ML pipeline from the repo root: python -m pipeline [step ...]

With no steps, rebuilds everything. Under the holdout protocol the evaluation is left out, because
it opens the locked holdout; run `python -m pipeline evaluate report` once the models are final.
Under the default full_cv protocol there is no holdout, so evaluation is part of the default run.
"""
import importlib
import sys
import time

from pipeline.settings import get_logger, protocol

STEPS = ["audit", "train", "evaluate", "explain", "external", "analysis", "counterfactual", "report"]


def default_steps() -> list:
    return [s for s in STEPS if s != "evaluate" or protocol() == "full_cv"]


def main(steps) -> None:
    log = get_logger("pipeline")
    unknown = [s for s in steps if s not in STEPS]
    if unknown:
        raise SystemExit(f"unknown step(s) {unknown}; choose from {STEPS}")
    for s in steps:
        t0 = time.perf_counter()
        log.info("=== %s ===", s)
        importlib.import_module(f"pipeline.{s}").run()
        log.info("=== %s done in %.0f s ===", s, time.perf_counter() - t0)


if __name__ == "__main__":
    main(sys.argv[1:] or default_steps())
