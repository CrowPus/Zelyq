import json

from sqlalchemy.exc import SQLAlchemyError

from .db import describe_database

if __name__ == "__main__":
    try:
        print(json.dumps(describe_database()))
    except (SQLAlchemyError, ValueError, OSError):
        # Driver exceptions can include passwords, SQL, hostnames, or row data.
        print(json.dumps({"connected": False, "error": "Database connection or selected schema inspection failed. Check network, TLS, credentials and table permissions."}))
        raise SystemExit(1) from None
