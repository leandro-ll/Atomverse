#!/usr/bin/env python3
"""Cross-platform runner for local backend development."""

from __future__ import annotations

import os
from pathlib import Path
import subprocess
import sys

REPO_ROOT = Path(__file__).resolve().parents[1]
BACKEND_DIR = REPO_ROOT / "backend"

# Find virtualenv Python
candidates = [
    BACKEND_DIR / ".venv" / "Scripts" / "python.exe",
    BACKEND_DIR / ".venv" / "bin" / "python",
]
py_exec = sys.executable
for candidate in candidates:
    if candidate.exists():
        py_exec = str(candidate)
        break

cmd = [
    py_exec,
    "-m",
    "uvicorn",
    "main:app",
    "--reload",
    "--port",
    "8000",
    "--app-dir",
    str(BACKEND_DIR),
]

print(f"Starting Atomverse backend with: {py_exec}")
print(f"Server will be available at: http://localhost:8000")
res = subprocess.run(cmd)
sys.exit(res.returncode)
