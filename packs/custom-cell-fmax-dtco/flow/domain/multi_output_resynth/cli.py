#!/usr/bin/env python3
from __future__ import annotations

import argparse

from .service import run_request


def main(argv=None):
    parser = argparse.ArgumentParser(prog="hima-mo-resynth")
    parser.add_argument("--request", required=True)
    parser.add_argument("--result", required=True)
    args = parser.parse_args(argv)
    result = run_request(args.request, args.result)
    return 0 if result["status"] == "succeeded" else 2


if __name__ == "__main__":
    raise SystemExit(main())
