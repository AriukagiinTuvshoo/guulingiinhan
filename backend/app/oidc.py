"""Google OpenID Connect authorization-code exchange and claim verification."""

from typing import Any
from urllib.parse import urlencode

import httpx
from google.auth.transport.requests import Request
from google.oauth2 import id_token

AUTHORIZATION_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth"
TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token"
ISSUER = "https://accounts.google.com"


class OIDCError(ValueError):
    pass


class GoogleOIDCProvider:
    """Small provider boundary, injectable in tests without Google credentials."""

    def __init__(self, client_id: str, client_secret: str, redirect_uri: str):
        self.client_id = client_id
        self.client_secret = client_secret
        self.redirect_uri = redirect_uri

    def authorization_url(self, state: str, nonce: str) -> str:
        return AUTHORIZATION_ENDPOINT + "?" + urlencode({
            "client_id": self.client_id,
            "redirect_uri": self.redirect_uri,
            "response_type": "code",
            "scope": "openid email profile",
            "state": state,
            "nonce": nonce,
            "prompt": "select_account",
        })

    def exchange(self, code: str) -> str:
        try:
            response = httpx.post(
                TOKEN_ENDPOINT,
                data={
                    "code": code,
                    "client_id": self.client_id,
                    "client_secret": self.client_secret,
                    "redirect_uri": self.redirect_uri,
                    "grant_type": "authorization_code",
                },
                timeout=8.0,
            )
            response.raise_for_status()
            token = response.json().get("id_token")
        except (httpx.HTTPError, ValueError, TypeError) as exc:
            raise OIDCError("Google authorization failed") from exc
        if not isinstance(token, str) or not token:
            raise OIDCError("Google authorization failed")
        return token

    def verify(self, token: str, expected_nonce: str) -> dict[str, Any]:
        try:
            claims = id_token.verify_oauth2_token(token, Request(), self.client_id)
        except Exception as exc:
            raise OIDCError("Google identity token rejected") from exc
        if claims.get("iss") not in {ISSUER, "accounts.google.com"}:
            raise OIDCError("Google identity token rejected")
        if claims.get("nonce") != expected_nonce:
            raise OIDCError("Google identity token rejected")
        if claims.get("email_verified") is not True:
            raise OIDCError("Google identity token rejected")
        if not isinstance(claims.get("sub"), str) or not claims["sub"]:
            raise OIDCError("Google identity token rejected")
        if not isinstance(claims.get("email"), str) or not claims["email"]:
            raise OIDCError("Google identity token rejected")
        claims["iss"] = ISSUER
        return claims
