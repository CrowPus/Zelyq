from typing import Any

import httpx

from .config import settings


def user_client(access_token: str) -> httpx.Client:
    """Create one client per request; retain user RLS context through the Data API."""
    config = settings()
    return httpx.Client(
        base_url=config.supabase_url.rstrip("/") + "/rest/v1/",
        headers={"apikey": config.supabase_publishable_key,
                 "Authorization": f"Bearer {access_token}"},
        timeout=10,
    )


def require_success(response: httpx.Response) -> Any:
    response.raise_for_status()
    return response.json()
