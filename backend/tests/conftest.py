"""Ensures the tests directory is importable so `from _helpers import ...`
resolves regardless of pytest's rootdir/invocation."""
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
