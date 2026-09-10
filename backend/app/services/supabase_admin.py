"""Minimal Supabase service-role client (PostgREST + Storage) over `requests`.

The signed-in app talks to Supabase directly from the browser under row-level
security. This module exists for the three places where there is no signed-in
user to act as:

  • the public application form   (an anonymous candidate writing a row)
  • the candidate status page     (reading their own application by token)
  • the background workers        (email queue, retention sweep)

`requests` is already installed as a `google-auth` dependency, so this adds no
new package. Every call raises `SupabaseError` with the server's message.
"""
from __future__ import annotations

import json
import logging
from typing import Any

import requests

from app.config import RESUME_BUCKET, SUPABASE_SERVICE_KEY, SUPABASE_URL, supabase_configured

log = logging.getLogger("talentlens.supabase")
TIMEOUT = 20


class SupabaseError(Exception):
    pass


class NotConfigured(SupabaseError):
    def __init__(self) -> None:
        super().__init__(
            "Supabase service credentials are not configured on the server. "
            "Set SUPABASE_URL and SUPABASE_SERVICE_KEY."
        )


def _require() -> None:
    if not supabase_configured():
        raise NotConfigured()


def _headers(extra: dict | None = None) -> dict:
    h = {
        "apikey": SUPABASE_SERVICE_KEY,
        "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}",
        "Content-Type": "application/json",
    }
    if extra:
        h.update(extra)
    return h


def _check(resp: requests.Response, what: str) -> Any:
    if resp.status_code >= 400:
        detail = resp.text[:400]
        try:
            body = resp.json()
            detail = body.get("message") or body.get("error") or detail
        except Exception:  # noqa: BLE001
            pass
        raise SupabaseError(f"{what} failed ({resp.status_code}): {detail}")
    if not resp.content:
        return None
    ctype = resp.headers.get("Content-Type", "")
    if "application/json" not in ctype:
        return resp.content
    try:
        return resp.json()
    except json.JSONDecodeError:
        return None


# --------------------------------------------------------------------- tables
def select(table: str, params: dict | None = None, single: bool = False) -> Any:
    """PostgREST select. `params` uses PostgREST syntax, e.g. {"id": "eq.<uuid>"}."""
    _require()
    q = {"select": "*"}
    q.update(params or {})
    r = requests.get(f"{SUPABASE_URL}/rest/v1/{table}", headers=_headers(),
                     params=q, timeout=TIMEOUT)
    rows = _check(r, f"select {table}") or []
    if single:
        return rows[0] if rows else None
    return rows


def insert(table: str, rows: dict | list[dict], upsert: bool = False,
           on_conflict: str | None = None) -> list[dict]:
    _require()
    prefer = "return=representation"
    if upsert:
        prefer += ",resolution=merge-duplicates"
    params = {"on_conflict": on_conflict} if on_conflict else None
    r = requests.post(f"{SUPABASE_URL}/rest/v1/{table}",
                      headers=_headers({"Prefer": prefer}),
                      params=params, json=rows, timeout=TIMEOUT)
    return _check(r, f"insert {table}") or []


def update(table: str, params: dict, patch: dict) -> list[dict]:
    _require()
    r = requests.patch(f"{SUPABASE_URL}/rest/v1/{table}",
                       headers=_headers({"Prefer": "return=representation"}),
                       params=params, json=patch, timeout=TIMEOUT)
    return _check(r, f"update {table}") or []


def delete(table: str, params: dict) -> None:
    _require()
    r = requests.delete(f"{SUPABASE_URL}/rest/v1/{table}", headers=_headers(),
                        params=params, timeout=TIMEOUT)
    _check(r, f"delete {table}")


def rpc(fn: str, payload: dict | None = None) -> Any:
    _require()
    r = requests.post(f"{SUPABASE_URL}/rest/v1/rpc/{fn}", headers=_headers(),
                      json=payload or {}, timeout=TIMEOUT)
    return _check(r, f"rpc {fn}")


# -------------------------------------------------------------------- storage
def storage_upload(path: str, data: bytes, content_type: str = "application/octet-stream",
                   bucket: str = RESUME_BUCKET, upsert: bool = True) -> str:
    """Upload bytes to a private bucket. Returns the object path."""
    _require()
    headers = {
        "apikey": SUPABASE_SERVICE_KEY,
        "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}",
        "Content-Type": content_type,
        "x-upsert": "true" if upsert else "false",
    }
    r = requests.post(f"{SUPABASE_URL}/storage/v1/object/{bucket}/{path}",
                      headers=headers, data=data, timeout=60)
    _check(r, f"storage upload {path}")
    return path


def storage_signed_url(path: str, expires_in: int = 3600,
                       bucket: str = RESUME_BUCKET) -> str:
    _require()
    r = requests.post(f"{SUPABASE_URL}/storage/v1/object/sign/{bucket}/{path}",
                      headers=_headers(), json={"expiresIn": expires_in}, timeout=TIMEOUT)
    body = _check(r, f"sign {path}") or {}
    signed = body.get("signedURL") or body.get("signedUrl") or ""
    if signed.startswith("/"):
        return f"{SUPABASE_URL}/storage/v1{signed}"
    return signed


def storage_delete(paths: list[str], bucket: str = RESUME_BUCKET) -> None:
    if not paths:
        return
    _require()
    r = requests.delete(f"{SUPABASE_URL}/storage/v1/object/{bucket}",
                        headers=_headers(), json={"prefixes": paths}, timeout=TIMEOUT)
    _check(r, "storage delete")


def storage_download(path: str, bucket: str = RESUME_BUCKET) -> bytes:
    _require()
    r = requests.get(f"{SUPABASE_URL}/storage/v1/object/{bucket}/{path}",
                     headers=_headers(), timeout=60)
    out = _check(r, f"storage download {path}")
    return out if isinstance(out, bytes) else b""
