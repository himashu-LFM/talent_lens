"""Auto-screen watcher: periodically screens new Gmail applications for saved
"watches" (label + job) and stores results for the UI to pick up.

State lives in DATA_DIR/watches.json and DATA_DIR/auto_results.json.
"""
from __future__ import annotations

import json
import logging
import os
import threading
import time
import uuid
from datetime import datetime, timezone

from app.config import DATA_DIR, WATCHER_TICK_SECONDS
from app.services import gmail_client
from app.services.screening import run_screening

log = logging.getLogger("talentlens.watcher")
_WATCHES = os.path.join(DATA_DIR, "watches.json")
_RESULTS = os.path.join(DATA_DIR, "auto_results.json")
_lock = threading.Lock()
_thread: threading.Thread | None = None
_stop = threading.Event()


def _read(path: str) -> list[dict]:
    if not os.path.exists(path):
        return []
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except Exception:  # noqa: BLE001
        return []


def _write(path: str, data: list[dict]) -> None:
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, default=str)
    os.replace(tmp, path)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


# ---- watches CRUD ----------------------------------------------------------
def list_watches() -> list[dict]:
    return _read(_WATCHES)


def add_watch(data: dict) -> dict:
    with _lock:
        watches = _read(_WATCHES)
        w = {
            "id": uuid.uuid4().hex[:10],
            "label_id": data["label_id"],
            "label_name": data.get("label_name", ""),
            "title": data.get("title", ""),
            "description": data["description"],
            "top_n": int(data.get("top_n", 10)),
            "interval_min": max(2, int(data.get("interval_min", 15))),
            "unread_only": bool(data.get("unread_only", True)),
            "mark_read": bool(data.get("mark_read", True)),
            "weights": data.get("weights"),
            "enabled": True,
            "created_at": _now(),
            "last_run": None,
            "last_fetched": 0,
            "runs": 0,
        }
        watches.append(w)
        _write(_WATCHES, watches)
        return w


def update_watch(wid: str, fields: dict) -> dict | None:
    with _lock:
        watches = _read(_WATCHES)
        for w in watches:
            if w["id"] == wid:
                for k in ("enabled", "interval_min", "top_n", "unread_only", "mark_read"):
                    if k in fields:
                        w[k] = fields[k]
                _write(_WATCHES, watches)
                return w
    return None


def delete_watch(wid: str) -> None:
    with _lock:
        _write(_WATCHES, [w for w in _read(_WATCHES) if w["id"] != wid])


# ---- results ---------------------------------------------------------------
def list_results(unacked_only: bool = False) -> list[dict]:
    res = _read(_RESULTS)
    if unacked_only:
        res = [r for r in res if not r.get("acked")]
    return sorted(res, key=lambda r: r["created_at"], reverse=True)


def ack_result(rid: str) -> None:
    with _lock:
        res = _read(_RESULTS)
        for r in res:
            if r["id"] == rid:
                r["acked"] = True
        _write(_RESULTS, res)


def delete_result(rid: str) -> None:
    with _lock:
        _write(_RESULTS, [r for r in _read(_RESULTS) if r["id"] != rid])


# ---- execution -------------------------------------------------------------
def run_watch_now(wid: str) -> dict:
    w = next((x for x in _read(_WATCHES) if x["id"] == wid), None)
    if not w:
        raise KeyError("watch not found")
    return _execute(w)


def _execute(w: dict) -> dict:
    files, meta = gmail_client.fetch_resumes(w["label_id"], w["unread_only"], w["mark_read"])
    outcome = {"fetched": len(files), "stored": False}
    if files:
        result = run_screening(w["title"], w["description"], w["top_n"], files,
                               sources=meta, weights=w.get("weights"))
        result["fetched"] = len(files)
        entry = {
            "id": uuid.uuid4().hex[:10],
            "watch_id": w["id"],
            "title": w["title"] or w.get("label_name") or "Auto-screen",
            "label_name": w.get("label_name", ""),
            "created_at": _now(),
            "acked": False,
            "result": result,
        }
        with _lock:
            res = _read(_RESULTS)
            res.append(entry)
            _write(_RESULTS, res[-200:])  # keep last 200
        outcome["stored"] = True
        outcome["result_id"] = entry["id"]
    with _lock:
        watches = _read(_WATCHES)
        for x in watches:
            if x["id"] == w["id"]:
                x["last_run"] = _now()
                x["last_fetched"] = len(files)
                x["runs"] = x.get("runs", 0) + 1
        _write(_WATCHES, watches)
    return outcome


def _due(w: dict, now: float) -> bool:
    if not w.get("enabled", True):
        return False
    if not w.get("last_run"):
        return True
    last = datetime.fromisoformat(w["last_run"]).timestamp()
    return now - last >= w["interval_min"] * 60


def _loop() -> None:
    log.info("auto-screen watcher started (tick %ss)", WATCHER_TICK_SECONDS)
    while not _stop.is_set():
        try:
            if gmail_client.is_connected():
                now = time.time()
                for w in _read(_WATCHES):
                    if _due(w, now):
                        try:
                            out = _execute(w)
                            log.info("watch %s ran: %s", w["id"], out)
                        except Exception as e:  # noqa: BLE001
                            log.warning("watch %s failed: %s", w["id"], e)
        except Exception as e:  # noqa: BLE001
            log.warning("watcher tick error: %s", e)
        _stop.wait(WATCHER_TICK_SECONDS)


def start() -> None:
    global _thread
    if _thread and _thread.is_alive():
        return
    _stop.clear()
    _thread = threading.Thread(target=_loop, name="auto-screen", daemon=True)
    _thread.start()


def stop() -> None:
    _stop.set()
