import json
import os
from pathlib import Path

from .main import app

if __name__ == "__main__":
    # The contract check generates into a scratch directory to compare against
    # what is committed, so it must be able to say where the file goes without
    # overwriting the committed one.
    default = Path(__file__).resolve().parents[1] / "openapi.json"
    destination = Path(os.environ.get("ZELYQ_OPENAPI_OUT") or default)
    destination.write_text(json.dumps(app.openapi(), indent=2, sort_keys=True) + "\n")
