#!/usr/bin/env python3
"""Local MCP server for Outlook / Hotmail via Microsoft Graph.

This server is meant to be launched by Hermes through stdio MCP. It also
provides small CLI helpers for one-time authentication and status checks.

Auth strategy:
- Preferred: device code flow against personal Microsoft accounts (`consumers`)
- Token persistence: JSON file under ~/.hermes/microsoft-graph-outlook-mail/
- Token refresh: standard refresh_token grant

Environment is loaded from ~/.hermes/.env for keys prefixed with MS_GRAPH_.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
from pathlib import Path
from typing import Any

import requests
from mcp.server.fastmcp import FastMCP


HERMES_HOME = Path(os.environ.get("HERMES_HOME", str(Path.home() / ".hermes"))).expanduser()
ENV_FILE = HERMES_HOME / ".env"
STATE_DIR = HERMES_HOME / "microsoft-graph-outlook-mail"
TOKEN_FILE = STATE_DIR / "token.json"
PENDING_DEVICE_FILE = STATE_DIR / "device_login.json"
GRAPH_BASE = "https://graph.microsoft.com/v1.0"
DEFAULT_SCOPES = ["openid", "profile", "offline_access", "User.Read", "Mail.Read"]
WELL_KNOWN_FOLDERS = {
    "inbox": "inbox",
    "drafts": "drafts",
    "sent": "sentitems",
    "sentitems": "sentitems",
    "archive": "archive",
    "deleted": "deleteditems",
    "deleteditems": "deleteditems",
    "junk": "junkemail",
    "junkemail": "junkemail",
}


def _load_env_file() -> None:
    if not ENV_FILE.exists():
        return
    for raw_line in ENV_FILE.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        if not key.startswith("MS_GRAPH_"):
            continue
        value = value.strip().strip("'").strip('"')
        os.environ.setdefault(key, value)


def _now_ts() -> int:
    return int(time.time())


def _json_dump(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")


def _split_recipients(value: str) -> list[str]:
    parts = [part.strip() for part in re.split(r"[;,]", value or "") if part.strip()]
    return parts


class GraphClient:
    def __init__(self) -> None:
        _load_env_file()
        self.client_id = os.environ.get("MS_GRAPH_CLIENT_ID", "").strip()
        self.client_secret = os.environ.get("MS_GRAPH_CLIENT_SECRET", "").strip()
        self.tenant = os.environ.get("MS_GRAPH_TENANT", "consumers").strip() or "consumers"
        raw_scopes = os.environ.get("MS_GRAPH_SCOPES", "").strip()
        self.scopes = raw_scopes.split() if raw_scopes else list(DEFAULT_SCOPES)
        self.session = requests.Session()
        self.session.headers.update({"User-Agent": "hermes-outlook-graph-mcp/1.0"})

    @property
    def authorize_base(self) -> str:
        return f"https://login.microsoftonline.com/{self.tenant}/oauth2/v2.0"

    @property
    def token_url(self) -> str:
        return f"{self.authorize_base}/token"

    @property
    def device_code_url(self) -> str:
        return f"{self.authorize_base}/devicecode"

    def require_client_id(self) -> None:
        if not self.client_id:
            raise RuntimeError(
                f"Missing MS_GRAPH_CLIENT_ID in {ENV_FILE}. "
                "Add the app registration client ID first."
            )

    def _load_token_state(self) -> dict[str, Any]:
        if not TOKEN_FILE.exists():
            return {}
        try:
            return json.loads(TOKEN_FILE.read_text(encoding="utf-8"))
        except json.JSONDecodeError as exc:
            raise RuntimeError(f"Token file is invalid JSON: {TOKEN_FILE}") from exc

    def _save_token_state(self, state: dict[str, Any]) -> None:
        _json_dump(TOKEN_FILE, state)

    def clear_tokens(self) -> None:
        if TOKEN_FILE.exists():
            TOKEN_FILE.unlink()
        if PENDING_DEVICE_FILE.exists():
            PENDING_DEVICE_FILE.unlink()

    def auth_status(self) -> dict[str, Any]:
        state = self._load_token_state()
        expires_at = int(state.get("expires_at", 0) or 0)
        granted_scopes_raw = str(state.get("scope", "")).strip()
        granted_scopes = granted_scopes_raw.split() if granted_scopes_raw else []
        return {
            "configured": bool(self.client_id),
            "tenant": self.tenant,
            "scopes": self.scopes,
            "granted_scopes": granted_scopes,
            "missing_granted_scopes": [scope for scope in self.scopes if scope not in granted_scopes],
            "token_file": str(TOKEN_FILE),
            "authenticated": bool(state.get("refresh_token") or state.get("access_token")),
            "has_refresh_token": bool(state.get("refresh_token")),
            "expires_at": expires_at or None,
            "expired": bool(expires_at and expires_at <= _now_ts()),
        }

    def _refresh_access_token(self, state: dict[str, Any]) -> dict[str, Any]:
        refresh_token = state.get("refresh_token", "")
        if not refresh_token:
            raise RuntimeError(
                "No refresh token available. Run the device login first."
            )
        data = {
            "client_id": self.client_id,
            "grant_type": "refresh_token",
            "refresh_token": refresh_token,
            "scope": " ".join(self.scopes),
        }
        if self.client_secret:
            data["client_secret"] = self.client_secret
        resp = self.session.post(self.token_url, data=data, timeout=30)
        payload = resp.json()
        if resp.status_code >= 400:
            raise RuntimeError(
                f"Microsoft token refresh failed: {payload.get('error')} "
                f"{payload.get('error_description', '')}".strip()
            )
        updated = {
            **state,
            **payload,
            "obtained_at": _now_ts(),
            "expires_at": _now_ts() + int(payload.get("expires_in", 0) or 0),
        }
        self._save_token_state(updated)
        return updated

    def _ensure_access_token(self) -> str:
        self.require_client_id()
        state = self._load_token_state()
        if not state:
            raise RuntimeError(
                "Not authenticated. Run the device login helper first."
            )
        access_token = state.get("access_token", "")
        expires_at = int(state.get("expires_at", 0) or 0)
        if access_token and expires_at > _now_ts() + 60:
            return access_token
        refreshed = self._refresh_access_token(state)
        token = refreshed.get("access_token", "")
        if not token:
            raise RuntimeError("Refresh succeeded but no access token was returned.")
        return token

    def _graph_get(
        self,
        path: str,
        *,
        params: dict[str, Any] | None = None,
        extra_headers: dict[str, str] | None = None,
        retry_on_401: bool = True,
    ) -> dict[str, Any]:
        token = self._ensure_access_token()
        headers = {
            "Authorization": f"Bearer {token}",
            "Accept": "application/json",
            "Prefer": 'outlook.body-content-type="text"',
        }
        if extra_headers:
            headers.update(extra_headers)
        resp = self.session.get(f"{GRAPH_BASE}{path}", params=params, headers=headers, timeout=30)
        if resp.status_code == 401 and retry_on_401:
            self._refresh_access_token(self._load_token_state())
            return self._graph_get(
                path,
                params=params,
                extra_headers=extra_headers,
                retry_on_401=False,
            )
        payload = resp.json()
        if resp.status_code >= 400:
            message = payload.get("error", {}).get("message") or payload.get("error_description") or str(payload)
            raise RuntimeError(f"Graph request failed for {path}: {message}")
        return payload

    def _graph_post(
        self,
        path: str,
        *,
        json_body: dict[str, Any],
        retry_on_401: bool = True,
    ) -> dict[str, Any]:
        token = self._ensure_access_token()
        headers = {
            "Authorization": f"Bearer {token}",
            "Accept": "application/json",
            "Content-Type": "application/json",
        }
        resp = self.session.post(
            f"{GRAPH_BASE}{path}",
            headers=headers,
            json=json_body,
            timeout=30,
        )
        if resp.status_code == 401 and retry_on_401:
            self._refresh_access_token(self._load_token_state())
            return self._graph_post(path, json_body=json_body, retry_on_401=False)
        if resp.status_code == 202:
            return {"ok": True, "accepted": True}
        payload = {}
        if resp.text:
            try:
                payload = resp.json()
            except ValueError:
                payload = {"raw": resp.text}
        if resp.status_code >= 400:
            message = payload.get("error", {}).get("message") or payload.get("error_description") or str(payload)
            raise RuntimeError(f"Graph request failed for {path}: {message}")
        return payload

    def _graph_patch(
        self,
        path: str,
        *,
        json_body: dict[str, Any],
        retry_on_401: bool = True,
    ) -> dict[str, Any]:
        token = self._ensure_access_token()
        headers = {
            "Authorization": f"Bearer {token}",
            "Accept": "application/json",
            "Content-Type": "application/json",
            "Prefer": 'outlook.body-content-type="text"',
        }
        resp = self.session.patch(
            f"{GRAPH_BASE}{path}",
            headers=headers,
            json=json_body,
            timeout=30,
        )
        if resp.status_code == 401 and retry_on_401:
            self._refresh_access_token(self._load_token_state())
            return self._graph_patch(path, json_body=json_body, retry_on_401=False)
        payload = {}
        if resp.text:
            try:
                payload = resp.json()
            except ValueError:
                payload = {"raw": resp.text}
        if resp.status_code >= 400:
            message = payload.get("error", {}).get("message") or payload.get("error_description") or str(payload)
            raise RuntimeError(f"Graph request failed for {path}: {message}")
        if resp.status_code == 204:
            return {"ok": True, "updated": True}
        return payload

    def _graph_delete(self, path: str, *, retry_on_401: bool = True) -> dict[str, Any]:
        token = self._ensure_access_token()
        headers = {
            "Authorization": f"Bearer {token}",
            "Accept": "application/json",
        }
        resp = self.session.delete(f"{GRAPH_BASE}{path}", headers=headers, timeout=30)
        if resp.status_code == 401 and retry_on_401:
            self._refresh_access_token(self._load_token_state())
            return self._graph_delete(path, retry_on_401=False)
        payload = {}
        if resp.text:
            try:
                payload = resp.json()
            except ValueError:
                payload = {"raw": resp.text}
        if resp.status_code >= 400:
            message = payload.get("error", {}).get("message") or payload.get("error_description") or str(payload)
            raise RuntimeError(f"Graph request failed for {path}: {message}")
        return {"ok": True, "deleted": True}

    def start_device_login(self) -> dict[str, Any]:
        self.require_client_id()
        data = {
            "client_id": self.client_id,
            "scope": " ".join(self.scopes),
        }
        resp = self.session.post(self.device_code_url, data=data, timeout=30)
        payload = resp.json()
        if resp.status_code >= 400:
            raise RuntimeError(
                f"Device-code start failed: {payload.get('error')} "
                f"{payload.get('error_description', '')}".strip()
            )
        pending = {
            **payload,
            "requested_at": _now_ts(),
            "expires_at": _now_ts() + int(payload.get("expires_in", 900) or 900),
        }
        _json_dump(PENDING_DEVICE_FILE, pending)
        return pending

    def finish_device_login(self) -> dict[str, Any]:
        if not PENDING_DEVICE_FILE.exists():
            raise RuntimeError(
                "No pending device login found. Start one first."
            )
        pending = json.loads(PENDING_DEVICE_FILE.read_text(encoding="utf-8"))
        interval = int(pending.get("interval", 5) or 5)
        expires_at = int(pending.get("expires_at", 0) or 0)
        device_code = pending["device_code"]

        while _now_ts() < expires_at:
            poll_data = {
                "grant_type": "urn:ietf:params:oauth:grant-type:device_code",
                "client_id": self.client_id,
                "device_code": device_code,
            }
            if self.client_secret:
                poll_data["client_secret"] = self.client_secret
            token_resp = self.session.post(self.token_url, data=poll_data, timeout=30)
            token_payload = token_resp.json()
            if token_resp.status_code == 200:
                state = {
                    **token_payload,
                    "obtained_at": _now_ts(),
                    "expires_at": _now_ts() + int(token_payload.get("expires_in", 0) or 0),
                }
                self._save_token_state(state)
                if PENDING_DEVICE_FILE.exists():
                    PENDING_DEVICE_FILE.unlink()
                return state

            error_code = token_payload.get("error", "")
            if error_code == "authorization_pending":
                raise RuntimeError("Authorization is still pending.")
            if error_code == "slow_down":
                time.sleep(interval + 5)
                continue
            raise RuntimeError(
                f"Device-code token exchange failed: {error_code} "
                f"{token_payload.get('error_description', '')}".strip()
            )

        raise RuntimeError("Device-code login timed out before authorization completed.")

    def device_login(self) -> dict[str, Any]:
        pending = self.start_device_login()
        print(pending.get("message", ""), file=sys.stderr)
        interval = int(pending.get("interval", 5) or 5)
        expires_at = int(pending.get("expires_at", 0) or 0)
        while _now_ts() < expires_at:
            try:
                return self.finish_device_login()
            except RuntimeError as exc:
                if str(exc) != "Authorization is still pending.":
                    raise
                time.sleep(interval)
        raise RuntimeError("Device-code login timed out before authorization completed.")

    def get_me(self) -> dict[str, Any]:
        return self._graph_get("/me?$select=id,displayName,mail,userPrincipalName")

    def list_mail_folders(self, limit: int = 50) -> dict[str, Any]:
        limit = max(1, min(int(limit), 200))
        payload = self._graph_get(
            "/me/mailFolders",
            params={
                "$top": limit,
                "$select": "id,displayName,parentFolderId,totalItemCount,unreadItemCount,childFolderCount",
            },
        )
        return {"folders": payload.get("value", [])}

    def _messages_endpoint(self, folder: str | None) -> str:
        if not folder:
            return "/me/messages"
        name = folder.strip().lower()
        folder_id = WELL_KNOWN_FOLDERS.get(name, folder)
        return f"/me/mailFolders/{folder_id}/messages"

    def list_messages(self, folder: str = "inbox", limit: int = 10, unread_only: bool = False) -> dict[str, Any]:
        limit = max(1, min(int(limit), 100))
        params: dict[str, Any] = {
            "$top": limit,
            "$select": (
                "id,subject,from,receivedDateTime,sentDateTime,bodyPreview,"
                "conversationId,webLink,isRead,hasAttachments,internetMessageId"
            ),
            "$orderby": "receivedDateTime DESC",
        }
        if unread_only:
            params["$filter"] = "isRead eq false"
        payload = self._graph_get(self._messages_endpoint(folder), params=params)
        return {"messages": payload.get("value", [])}

    def search_messages(self, query: str, folder: str | None = None, limit: int = 10) -> dict[str, Any]:
        query = query.strip()
        if not query:
            raise RuntimeError("Search query must not be empty.")
        limit = max(1, min(int(limit), 50))
        payload = self._graph_get(
            self._messages_endpoint(folder),
            params={
                "$top": limit,
                "$search": f'"{query}"',
                "$select": (
                    "id,subject,from,receivedDateTime,sentDateTime,bodyPreview,"
                    "conversationId,webLink,isRead,hasAttachments,internetMessageId"
                ),
            },
            extra_headers={"ConsistencyLevel": "eventual"},
        )
        return {"messages": payload.get("value", [])}

    def get_message(self, message_id: str) -> dict[str, Any]:
        message_id = message_id.strip()
        if not message_id:
            raise RuntimeError("message_id must not be empty.")
        return self._graph_get(
            f"/me/messages/{message_id}",
            params={
                "$select": (
                    "id,subject,from,toRecipients,ccRecipients,bccRecipients,"
                    "receivedDateTime,sentDateTime,body,bodyPreview,conversationId,"
                    "webLink,isRead,hasAttachments,internetMessageId,parentFolderId"
                ),
            },
        )

    def send_mail(
        self,
        *,
        to: str,
        subject: str,
        body: str,
        cc: str = "",
        bcc: str = "",
        body_content_type: str = "Text",
        save_to_sent_items: bool = True,
    ) -> dict[str, Any]:
        to_list = _split_recipients(to)
        cc_list = _split_recipients(cc)
        bcc_list = _split_recipients(bcc)
        if not to_list:
            raise RuntimeError("At least one recipient is required in 'to'.")
        content_type = (body_content_type or "Text").strip().lower()
        if content_type not in {"text", "html"}:
            raise RuntimeError("body_content_type must be 'Text' or 'HTML'.")

        def _map_recipients(items: list[str]) -> list[dict[str, Any]]:
            return [{"emailAddress": {"address": address}} for address in items]

        payload = {
            "message": {
                "subject": subject,
                "body": {
                    "contentType": "HTML" if content_type == "html" else "Text",
                    "content": body,
                },
                "toRecipients": _map_recipients(to_list),
            },
            "saveToSentItems": bool(save_to_sent_items),
        }
        if cc_list:
            payload["message"]["ccRecipients"] = _map_recipients(cc_list)
        if bcc_list:
            payload["message"]["bccRecipients"] = _map_recipients(bcc_list)

        result = self._graph_post("/me/sendMail", json_body=payload)
        return {
            "ok": True,
            "result": result,
            "to": to_list,
            "cc": cc_list,
            "bcc": bcc_list,
            "subject": subject,
            "save_to_sent_items": bool(save_to_sent_items),
        }

    def mark_message_read(self, message_id: str, is_read: bool = True) -> dict[str, Any]:
        message_id = message_id.strip()
        if not message_id:
            raise RuntimeError("message_id must not be empty.")
        result = self._graph_patch(
            f"/me/messages/{message_id}",
            json_body={"isRead": bool(is_read)},
        )
        return {
            "ok": True,
            "message_id": message_id,
            "is_read": bool(is_read),
            "result": result,
        }

    def move_message(self, message_id: str, destination_folder: str) -> dict[str, Any]:
        message_id = message_id.strip()
        if not message_id:
            raise RuntimeError("message_id must not be empty.")
        destination_folder = destination_folder.strip()
        if not destination_folder:
            raise RuntimeError("destination_folder must not be empty.")
        normalized_destination = WELL_KNOWN_FOLDERS.get(destination_folder.lower(), destination_folder)
        result = self._graph_post(
            f"/me/messages/{message_id}/move",
            json_body={"destinationId": normalized_destination},
        )
        return {
            "ok": True,
            "message_id": message_id,
            "destination_folder": normalized_destination,
            "result": result,
        }

    def delete_message(self, message_id: str) -> dict[str, Any]:
        message_id = message_id.strip()
        if not message_id:
            raise RuntimeError("message_id must not be empty.")
        result = self._graph_delete(f"/me/messages/{message_id}")
        return {
            "ok": True,
            "message_id": message_id,
            "result": result,
        }


mcp = FastMCP("OutlookGraph", json_response=True)


@mcp.tool()
def auth_status() -> dict[str, Any]:
    """Return Microsoft Graph auth status for the local Outlook MCP server."""
    client = GraphClient()
    status = client.auth_status()
    if status["authenticated"]:
        try:
            status["me"] = client.get_me()
        except Exception as exc:  # pragma: no cover - best effort
            status["me_error"] = str(exc)
    return status


@mcp.tool()
def list_mail_folders(limit: int = 50) -> dict[str, Any]:
    """List mail folders from the signed-in Outlook / Hotmail mailbox."""
    return GraphClient().list_mail_folders(limit=limit)


@mcp.tool()
def list_messages(folder: str = "inbox", limit: int = 10, unread_only: bool = False) -> dict[str, Any]:
    """List recent messages from a folder such as inbox or sentitems."""
    return GraphClient().list_messages(folder=folder, limit=limit, unread_only=unread_only)


@mcp.tool()
def search_messages(query: str, folder: str = "", limit: int = 10) -> dict[str, Any]:
    """Search Outlook messages by text over subject/from/body fields."""
    normalized_folder = folder.strip() or None
    return GraphClient().search_messages(query=query, folder=normalized_folder, limit=limit)


@mcp.tool()
def get_message(message_id: str) -> dict[str, Any]:
    """Fetch one Outlook message with full body and recipient metadata."""
    return GraphClient().get_message(message_id=message_id)


@mcp.tool()
def send_mail(
    to: str,
    subject: str,
    body: str,
    cc: str = "",
    bcc: str = "",
    body_content_type: str = "Text",
    save_to_sent_items: bool = True,
) -> dict[str, Any]:
    """Send an Outlook / Hotmail email through Microsoft Graph.

    `to`, `cc`, and `bcc` accept comma- or semicolon-separated addresses.
    `body_content_type` must be `Text` or `HTML`.
    """
    return GraphClient().send_mail(
        to=to,
        subject=subject,
        body=body,
        cc=cc,
        bcc=bcc,
        body_content_type=body_content_type,
        save_to_sent_items=save_to_sent_items,
    )


@mcp.tool()
def mark_message_read(message_id: str, is_read: bool = True) -> dict[str, Any]:
    """Mark an Outlook message as read or unread. Requires Mail.ReadWrite."""
    return GraphClient().mark_message_read(message_id=message_id, is_read=is_read)


@mcp.tool()
def move_message(message_id: str, destination_folder: str) -> dict[str, Any]:
    """Move an Outlook message to another folder such as archive, deleteditems, or junkemail."""
    return GraphClient().move_message(
        message_id=message_id,
        destination_folder=destination_folder,
    )


@mcp.tool()
def delete_message(message_id: str) -> dict[str, Any]:
    """Delete an Outlook message. Requires Mail.ReadWrite."""
    return GraphClient().delete_message(message_id=message_id)


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Outlook Graph MCP server and auth helper")
    parser.add_argument("--status", action="store_true", help="print auth/config status and exit")
    parser.add_argument("--login-device", action="store_true", help="run one-time device-code login")
    parser.add_argument("--start-device-login", action="store_true", help="create a device code and save pending login state")
    parser.add_argument("--finish-device-login", action="store_true", help="finish a previously started device-code login")
    parser.add_argument("--logout", action="store_true", help="delete the local token cache")
    return parser.parse_args()


def main() -> int:
    args = _parse_args()
    client = GraphClient()

    try:
        if args.status:
            payload = client.auth_status()
            if payload["authenticated"]:
                try:
                    payload["me"] = client.get_me()
                except Exception as exc:
                    payload["me_error"] = str(exc)
            print(json.dumps(payload, indent=2, ensure_ascii=False))
            return 0

        if args.logout:
            client.clear_tokens()
            print(json.dumps({"ok": True, "cleared": str(TOKEN_FILE)}, indent=2, ensure_ascii=False))
            return 0

        if args.login_device:
            token_state = client.device_login()
            result = {
                "ok": True,
                "token_file": str(TOKEN_FILE),
                "expires_at": token_state.get("expires_at"),
            }
            try:
                result["me"] = client.get_me()
            except Exception as exc:
                result["me_error"] = str(exc)
            print(json.dumps(result, indent=2, ensure_ascii=False))
            return 0

        if args.start_device_login:
            pending = client.start_device_login()
            result = {
                "ok": True,
                "user_code": pending.get("user_code"),
                "verification_uri": pending.get("verification_uri"),
                "expires_in": pending.get("expires_in"),
                "message": pending.get("message"),
                "pending_file": str(PENDING_DEVICE_FILE),
            }
            print(json.dumps(result, indent=2, ensure_ascii=False))
            return 0

        if args.finish_device_login:
            token_state = client.finish_device_login()
            result = {
                "ok": True,
                "token_file": str(TOKEN_FILE),
                "expires_at": token_state.get("expires_at"),
            }
            try:
                result["me"] = client.get_me()
            except Exception as exc:
                result["me_error"] = str(exc)
            print(json.dumps(result, indent=2, ensure_ascii=False))
            return 0

        mcp.run()
        return 0
    except Exception as exc:
        print(str(exc), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
