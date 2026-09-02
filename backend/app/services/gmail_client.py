"""Gmail API integration: OAuth connect, list labels, fetch resume attachments.

Setup (one-time, done by the user):
  1. Create a Google Cloud project and enable the Gmail API.
  2. Create an OAuth client ID of type "Desktop app".
  3. Download the JSON and save it as  backend/credentials.json.
On first connect the user approves consent in a browser; the resulting token is
cached in backend/token.json so later runs need no re-approval.
"""
from __future__ import annotations

import base64
import os

from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError

# modify: read + mark-as-read; send: email candidates from the app.
SCOPES = [
    "https://www.googleapis.com/auth/gmail.modify",
    "https://www.googleapis.com/auth/gmail.send",
]

_HERE = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
# Paths can be overridden for hosted deployments (e.g. Render "Secret Files").
CREDENTIALS_FILE = os.getenv("GMAIL_CREDENTIALS_FILE", os.path.join(_HERE, "credentials.json"))
TOKEN_FILE = os.getenv("GMAIL_TOKEN_FILE", os.path.join(_HERE, "token.json"))

RESUME_EXTS = (".pdf", ".docx", ".txt")


class GmailNotConfigured(Exception):
    """Raised when credentials.json is missing."""


class GmailNotConnected(Exception):
    """Raised when no valid cached token exists."""


def credentials_present() -> bool:
    return os.path.exists(CREDENTIALS_FILE)


def _load_cached_creds() -> Credentials | None:
    if not os.path.exists(TOKEN_FILE):
        return None
    # Use the scopes actually stored in the token (don't force the new SCOPES list,
    # or refreshing an older token would fail). can_send() checks for 'send'.
    creds = Credentials.from_authorized_user_file(TOKEN_FILE)
    if creds and creds.expired and creds.refresh_token:
        creds.refresh(Request())
        _save(creds)
    return creds if creds and creds.valid else None


def granted_scopes() -> list[str]:
    creds = _load_cached_creds()
    return list(creds.scopes or []) if creds else []


def can_send() -> bool:
    return "https://www.googleapis.com/auth/gmail.send" in granted_scopes()


def disconnect() -> None:
    """Forget the cached token so the user can re-authorise (e.g. for new scopes)."""
    if os.path.exists(TOKEN_FILE):
        os.remove(TOKEN_FILE)


def send_email(to: str, subject: str, body: str) -> str:
    """Send a plain-text email from the connected account. Returns message id."""
    import base64 as _b64
    from email.mime.text import MIMEText

    if not can_send():
        raise PermissionError(
            "Sending requires re-authorising Gmail with the 'send' permission: "
            "disconnect and connect again."
        )
    svc = _service()
    msg = MIMEText(body, "plain", "utf-8")
    msg["to"] = to
    msg["subject"] = subject
    raw = _b64.urlsafe_b64encode(msg.as_bytes()).decode()
    sent = svc.users().messages().send(userId="me", body={"raw": raw}).execute()
    return sent.get("id", "")


def _save(creds: Credentials) -> None:
    with open(TOKEN_FILE, "w", encoding="utf-8") as f:
        f.write(creds.to_json())


def is_connected() -> bool:
    try:
        return _load_cached_creds() is not None
    except Exception:
        return False


def connect() -> str:
    """Run the interactive OAuth flow (opens a browser). Returns the account email."""
    if not credentials_present():
        raise GmailNotConfigured(
            "credentials.json not found in the backend folder. "
            "Create a Google Cloud OAuth 'Desktop app' client and save it there."
        )
    creds = _load_cached_creds()
    if creds is None:
        flow = InstalledAppFlow.from_client_secrets_file(CREDENTIALS_FILE, SCOPES)
        creds = flow.run_local_server(port=0)
        _save(creds)
    return _account_email(creds)


def _service():
    creds = _load_cached_creds()
    if creds is None:
        raise GmailNotConnected("Gmail is not connected yet.")
    return build("gmail", "v1", credentials=creds, cache_discovery=False)


def _account_email(creds: Credentials) -> str:
    svc = build("gmail", "v1", credentials=creds, cache_discovery=False)
    profile = svc.users().getProfile(userId="me").execute()
    return profile.get("emailAddress", "")


def list_labels() -> list[dict]:
    svc = _service()
    labels = svc.users().labels().list(userId="me").execute().get("labels", [])
    # Surface user labels first, then system ones.
    labels.sort(key=lambda l: (l.get("type") != "user", l.get("name", "").lower()))
    return [{"id": l["id"], "name": l["name"], "type": l.get("type", "system")}
            for l in labels]


def create_label(name: str) -> dict:
    """Create a new Gmail label. If it already exists, return the existing one."""
    svc = _service()
    name = name.strip()
    if not name:
        raise ValueError("Label name is required.")
    try:
        lbl = svc.users().labels().create(
            userId="me",
            body={
                "name": name,
                "labelListVisibility": "labelShow",
                "messageListVisibility": "show",
            },
        ).execute()
        return {"id": lbl["id"], "name": lbl["name"], "type": lbl.get("type", "user")}
    except HttpError as e:
        if e.resp.status == 409:  # already exists — return it
            for l in svc.users().labels().list(userId="me").execute().get("labels", []):
                if l["name"].lower() == name.lower():
                    return {"id": l["id"], "name": l["name"],
                            "type": l.get("type", "user")}
        raise


def _walk_parts(part, out: list[dict]):
    """Recursively collect attachment parts."""
    filename = part.get("filename") or ""
    body = part.get("body", {})
    if filename and filename.lower().endswith(RESUME_EXTS):
        out.append({"filename": filename,
                    "attachmentId": body.get("attachmentId"),
                    "data": body.get("data")})
    for sub in part.get("parts", []) or []:
        _walk_parts(sub, out)


def fetch_resumes(label_id: str, unread_only: bool, mark_read: bool = True):
    """Download resume attachments from messages under a label.

    Returns (files, meta) where:
        files = list of (unique_filename, bytes)
        meta  = {unique_filename: "subject — from"}  for display
    """
    svc = _service()
    query = "is:unread" if unread_only else ""
    msg_ids: list[str] = []
    page_token = None
    while True:
        resp = svc.users().messages().list(
            userId="me", labelIds=[label_id], q=query,
            maxResults=100, pageToken=page_token,
        ).execute()
        msg_ids.extend(m["id"] for m in resp.get("messages", []))
        page_token = resp.get("nextPageToken")
        if not page_token:
            break

    files: list[tuple[str, bytes]] = []
    meta: dict[str, str] = {}
    used_names: set[str] = set()
    processed_msgs: list[str] = []

    for mid in msg_ids:
        msg = svc.users().messages().get(userId="me", id=mid, format="full").execute()
        headers = {h["name"].lower(): h["value"]
                   for h in msg.get("payload", {}).get("headers", [])}
        subject = headers.get("subject", "(no subject)")
        sender = headers.get("from", "")

        parts: list[dict] = []
        _walk_parts(msg.get("payload", {}), parts)
        found_here = False
        for p in parts:
            data = p.get("data")
            if not data and p.get("attachmentId"):
                att = svc.users().messages().attachments().get(
                    userId="me", messageId=mid, id=p["attachmentId"],
                ).execute()
                data = att.get("data")
            if not data:
                continue
            raw = base64.urlsafe_b64decode(data)

            name = p["filename"]
            unique = name
            n = 1
            while unique in used_names:
                stem, dot, ext = name.rpartition(".")
                unique = f"{stem}_{n}.{ext}" if dot else f"{name}_{n}"
                n += 1
            used_names.add(unique)

            files.append((unique, raw))
            meta[unique] = subject + " - " + sender
            found_here = True

        if found_here:
            processed_msgs.append(mid)

    if mark_read and processed_msgs:
        svc.users().messages().batchModify(
            userId="me",
            body={"ids": processed_msgs, "removeLabelIds": ["UNREAD"]},
        ).execute()

    return files, meta
