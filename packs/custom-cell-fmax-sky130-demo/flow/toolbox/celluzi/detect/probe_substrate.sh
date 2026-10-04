#!/usr/bin/env bash
# M1 substrate probe — runs INSIDE the container. Read-only analysis of the frozen baseline.
set +e
echo "===== CircuitOps availability ====="
python3 -c 'import importlib.util as u; print("circuitops module present:", bool(u.find_spec("circuitops")))' 2>/dev/null || echo "(python check failed)"
find /foss /usr/local /opt -maxdepth 5 -iname '*circuitops*' 2>/dev/null | head -5
echo
echo "===== OpenROAD timing-path extraction from baseline aes ODB ====="
openroad -no_init -exit /foss/designs/celluzi/detect/sta_paths.tcl 2>&1 | tail -95
