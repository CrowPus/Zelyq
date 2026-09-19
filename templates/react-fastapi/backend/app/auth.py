from functools import lru_cache
from typing import Annotated, Any

import jwt
from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from .config import settings

bearer = HTTPBearer(auto_error=False)


@lru_cache(maxsize=8)
def jwks_client(url: str) -> jwt.PyJWKClient:
    return jwt.PyJWKClient(url, timeout=5, lifespan=300)


def current_user(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)],
) -> dict[str, Any]:
    config = settings()
    if config.auth_mode != "jwt":
        raise HTTPException(503, "Authentication is not configured for this operation")
    if credentials is None:
        raise HTTPException(401, "Sign in to continue", headers={"WWW-Authenticate": "Bearer"})
    try:
        key = jwks_client(config.auth_jwks_url).get_signing_key_from_jwt(credentials.credentials)
        claims = jwt.decode(
            credentials.credentials,
            key.key,
            algorithms=["RS256", "ES256"],
            audience=config.auth_audience,
            issuer=config.auth_issuer,
            options={"require": ["exp", "iat", "sub", "iss", "aud"]},
        )
        if not isinstance(claims.get("sub"), str) or not claims["sub"]:
            raise jwt.InvalidTokenError()
        # OIDC ID tokens must not be accepted as API tokens by the chosen provider's
        # audience policy. Configure an API-specific audience, never a web client ID.
        return claims
    except jwt.PyJWTError:
        raise HTTPException(401, "Invalid or expired access token") from None
