"""Clip keeper: saves short camera clips to the router while recording is switched on.

Frigate keeps recording and detecting as before (its own history stays in the cluster). This
service watches Frigate's review messages and, for cameras that are switched on while
recording is active (the Away switch in Home Assistant, or the Home Assistant schedule), saves
a 10-60 second clip of each person, car or animal detection to the router's camera-clips
share. It keeps the share under a size limit (oldest clips first; clips put in a group are
never removed) and gives the hub an API to list, play, group and delete clips.

Pieces:
- MQTT (Mosquitto): Frigate's `frigate/reviews`; Home Assistant controls through discovery
  (Away switch, a switch per camera, storage limit, status sensors); `clips/schedule` from a
  Home Assistant automation that mirrors the schedule helper.
- Frigate's API: the camera list and `/api/<camera>/start/<s>/end/<e>/clip.mp4`.
- Storage: an rclone sidecar serves the router's SMB share as WebDAV on 127.0.0.1:8090.
- Index: SQLite on a small volume (clips, groups, settings), reconciled with the share.
- HTTP API on :8080 for the hub (bearer token; a network rule admits only the hub).
"""

from __future__ import annotations

import asyncio
import contextlib
import hmac
import json
import logging
import math
import os
import sqlite3
import time
import urllib.parse
import xml.etree.ElementTree as ET

import aiomqtt
from aiohttp import ClientSession, ClientTimeout, web

from clip_logic import (
    CLIP_ID, GROUP_NAME, StoredClip, clip_path, clip_window, cut_due, display_name, evictions,
    wanted_labels,
)

FRIGATE = os.environ.get("FRIGATE_URL", "http://frigate.cameras.svc.cluster.local:5000")
WEBDAV = os.environ.get("WEBDAV_URL", "http://127.0.0.1:8090")
MQTT_HOST = os.environ.get("MQTT_HOST", "mosquitto.home-assistant.svc.cluster.local")
MQTT_USER = os.environ.get("MQTT_USER", "clipkeeper")
MQTT_PASSWORD = os.environ.get("MQTT_PASSWORD", "")
API_TOKEN = os.environ.get("API_TOKEN", "")
DB_PATH = os.environ.get("DB_PATH", "/data/clips.db")
TZ = os.environ.get("TZ", "America/New_York")
LABELS = set(filter(None, os.environ.get("LABELS", "person,car,dog,cat").split(",")))
DEFAULT_CAMERAS = set(filter(None, os.environ.get("DEFAULT_CAMERAS", "").split(",")))
LIMIT_DEFAULT_GB = int(os.environ.get("LIMIT_DEFAULT_GB", "100"))
LIMIT_MIN_GB, LIMIT_MAX_GB = 100, int(os.environ.get("LIMIT_MAX_GB", "500"))
# Frigate writes recordings in 10-second segments and moves each one out of its cache only
# when it's closed, so a clip is fetched this long after its end.
SEGMENT_DELAY = int(os.environ.get("SEGMENT_DELAY", "25"))
GB = 1_000_000_000

DISCOVERY = "homeassistant"
TOPIC = "clips"

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("clip-keeper")


# --- Index -----------------------------------------------------------------------------------

class Index:
    def __init__(self, path: str):
        os.makedirs(os.path.dirname(path), exist_ok=True)
        self.db = sqlite3.connect(path)
        self.db.row_factory = sqlite3.Row
        self.db.executescript("""
            create table if not exists clips (
              id text primary key, camera text not null, start real not null, finish real not null,
              labels text not null, size integer not null, path text not null unique,
              grp text, created real not null);
            create index if not exists clips_created on clips(created);
            create index if not exists clips_grp on clips(grp);
            create table if not exists settings (key text primary key, value text not null);
        """)
        self.db.commit()

    def setting(self, key: str, default: str) -> str:
        row = self.db.execute("select value from settings where key = ?", (key,)).fetchone()
        return row["value"] if row else default

    def set_setting(self, key: str, value: str) -> None:
        self.db.execute("insert into settings(key, value) values(?, ?) on conflict(key) do update set value = excluded.value", (key, value))
        self.db.commit()

    def add(self, clip: dict) -> None:
        self.db.execute(
            "insert or replace into clips(id, camera, start, finish, labels, size, path, grp, created) values(?,?,?,?,?,?,?,?,?)",
            (clip["id"], clip["camera"], clip["start"], clip["finish"], clip["labels"], clip["size"], clip["path"], clip.get("grp"), clip["created"]),
        )
        self.db.commit()

    def get(self, clip_id: str):
        return self.db.execute("select * from clips where id = ?", (clip_id,)).fetchone()

    def remove(self, clip_id: str) -> None:
        self.db.execute("delete from clips where id = ?", (clip_id,))
        self.db.commit()

    def list(self, camera: str | None, group: str | None, ungrouped: bool, limit: int, before: float | None):
        sql, args = "select * from clips where 1=1", []
        if camera:
            sql += " and camera = ?"; args.append(camera)
        if ungrouped:
            sql += " and grp is null"
        elif group:
            sql += " and grp = ?"; args.append(group)
        if before:
            sql += " and start < ?"; args.append(before)
        sql += " order by start desc limit ?"; args.append(limit)
        return self.db.execute(sql, args).fetchall()

    def stored(self) -> list[StoredClip]:
        return [StoredClip(r["id"], r["created"], r["size"], r["grp"]) for r in self.db.execute("select id, created, size, grp from clips")]

    def totals(self) -> tuple[int, int]:
        row = self.db.execute("select count(*) n, coalesce(sum(size), 0) s from clips").fetchone()
        return row["n"], row["s"]

    def groups(self):
        return self.db.execute("select grp name, count(*) count, sum(size) bytes from clips where grp is not null group by grp order by grp").fetchall()

    def set_group(self, ids: list[str], group: str | None) -> int:
        cur = self.db.executemany("update clips set grp = ? where id = ?", [(group, i) for i in ids])
        self.db.commit()
        return cur.rowcount

    def paths(self) -> dict[str, str]:
        return {r["path"]: r["id"] for r in self.db.execute("select id, path from clips")}


# --- Storage (rclone WebDAV in front of the router share) ------------------------------------

class Storage:
    def __init__(self, http: ClientSession):
        self.http = http

    def url(self, path: str) -> str:
        return f"{WEBDAV}/{urllib.parse.quote(path)}"

    async def available(self) -> bool:
        try:
            async with self.http.request("PROPFIND", WEBDAV + "/", headers={"Depth": "0"}, timeout=ClientTimeout(total=10)) as r:
                return r.status in (200, 207)
        except Exception:
            return False

    async def put(self, path: str, data: bytes) -> None:
        parts = path.split("/")
        for i in range(1, len(parts)):  # make camera/ and camera/date/ (405 = already there)
            async with self.http.request("MKCOL", self.url("/".join(parts[:i]))) as r:
                if r.status not in (201, 405):
                    raise RuntimeError(f"couldn't make folder {'/'.join(parts[:i])}: HTTP {r.status}")
        temp = path + ".part"
        async with self.http.put(self.url(temp), data=data, timeout=ClientTimeout(total=300)) as r:
            if r.status not in (200, 201, 204):
                raise RuntimeError(f"upload failed: HTTP {r.status}")
        async with self.http.request("MOVE", self.url(temp), headers={"Destination": self.url(path), "Overwrite": "T"}) as r:
            if r.status not in (200, 201, 204):
                raise RuntimeError(f"rename failed: HTTP {r.status}")

    async def delete(self, path: str) -> None:
        async with self.http.delete(self.url(path)) as r:
            if r.status not in (200, 204, 404):
                raise RuntimeError(f"delete failed: HTTP {r.status}")

    async def walk(self, folder: str = "") -> list[tuple[str, int]]:
        """Every file under folder as (path, size), one PROPFIND per folder."""
        found: list[tuple[str, int]] = []
        async with self.http.request("PROPFIND", self.url(folder) + ("/" if folder else ""), headers={"Depth": "1"}) as r:
            if r.status != 207:
                return found
            tree = ET.fromstring(await r.text())
        ns = {"d": "DAV:"}
        base = urllib.parse.urlparse(self.url(folder)).path.rstrip("/")
        for item in tree.findall("d:response", ns):
            href = urllib.parse.unquote(urllib.parse.urlparse(item.findtext("d:href", "", ns)).path).rstrip("/")
            if href == urllib.parse.unquote(base) or not href:
                continue
            rel = href.lstrip("/")
            if item.find(".//d:resourcetype/d:collection", ns) is not None:
                found += await self.walk(rel)
            else:
                found.append((rel, int(item.findtext(".//d:getcontentlength", "0", ns) or 0)))
        return found


# --- The keeper ------------------------------------------------------------------------------

class Keeper:
    def __init__(self) -> None:
        self.index = Index(DB_PATH)
        self.http: ClientSession | None = None
        self.storage: Storage | None = None
        self.mqtt: aiomqtt.Client | None = None
        self.cameras: list[str] = []
        self.schedule_on = False
        self.storage_state = "starting"
        self.covered: dict[str, float] = {}  # camera -> end of its last saved clip
        self.pending: dict[str, dict] = {}  # review id -> detection being followed
        self.lock = asyncio.Lock()  # one save or clean-up at a time

    # Settings live in the index so they survive restarts.
    @property
    def away(self) -> bool:
        return self.index.setting("away", "off") == "on"

    @property
    def limit_gb(self) -> int:
        return int(self.index.setting("limit_gb", str(LIMIT_DEFAULT_GB)))

    def camera_on(self, camera: str) -> bool:
        return self.index.setting(f"camera:{camera}", "on" if camera in DEFAULT_CAMERAS else "off") == "on"

    def recording(self) -> bool:
        return self.away or self.schedule_on

    def recording_text(self) -> str:
        if self.away and self.schedule_on:
            return "On (Away + schedule)"
        if self.away:
            return "On (Away)"
        return "On (schedule)" if self.schedule_on else "Off"

    # --- Home Assistant (MQTT discovery) ---

    async def publish(self, topic: str, payload: str, retain: bool = True) -> None:
        if self.mqtt:
            with contextlib.suppress(aiomqtt.MqttError):
                await self.mqtt.publish(topic, payload, retain=retain)

    async def announce(self) -> None:
        device = {"identifiers": ["camera_clips"], "name": "Camera clips", "manufacturer": "Home Lab Hub",
                  "model": "Clip keeper"}
        common = {"availability": {"topic": f"{TOPIC}/status"}, "device": device}

        async def entity(kind: str, slug: str, config: dict) -> None:
            await self.publish(f"{DISCOVERY}/{kind}/camera_clips/{slug}/config",
                               json.dumps({**config, "unique_id": f"camera_clips_{slug}", **common}))

        await entity("switch", "away", {"name": "Away recording", "command_topic": f"{TOPIC}/away/set",
                                         "state_topic": f"{TOPIC}/away", "icon": "mdi:home-export-outline"})
        await entity("sensor", "recording", {"name": "Recording", "state_topic": f"{TOPIC}/recording", "icon": "mdi:record-rec"})
        await entity("number", "limit", {"name": "Storage limit", "command_topic": f"{TOPIC}/limit/set",
                                          "state_topic": f"{TOPIC}/limit", "min": LIMIT_MIN_GB, "max": LIMIT_MAX_GB,
                                          "step": 50, "unit_of_measurement": "GB", "mode": "slider", "icon": "mdi:harddisk"})
        await entity("sensor", "used", {"name": "Storage used", "state_topic": f"{TOPIC}/used", "unit_of_measurement": "GB",
                                         "icon": "mdi:folder-play", "state_class": "measurement"})
        await entity("sensor", "count", {"name": "Clips", "state_topic": f"{TOPIC}/count", "icon": "mdi:filmstrip-box-multiple",
                                          "state_class": "measurement"})
        await entity("sensor", "storage", {"name": "Storage status", "state_topic": f"{TOPIC}/storage", "icon": "mdi:nas"})
        for camera in self.cameras:
            await entity("switch", f"camera_{camera}", {
                "name": f"{display_name(camera)} clips", "command_topic": f"{TOPIC}/camera/{camera}/set",
                "state_topic": f"{TOPIC}/camera/{camera}", "icon": "mdi:cctv"})
        await self.publish_state()

    async def publish_state(self) -> None:
        count, used = self.index.totals()
        await self.publish(f"{TOPIC}/status", "online")
        await self.publish(f"{TOPIC}/away", "ON" if self.away else "OFF")
        await self.publish(f"{TOPIC}/recording", self.recording_text())
        await self.publish(f"{TOPIC}/limit", str(self.limit_gb))
        await self.publish(f"{TOPIC}/used", f"{used / GB:.2f}")
        await self.publish(f"{TOPIC}/count", str(count))
        await self.publish(f"{TOPIC}/storage", self.storage_state)
        for camera in self.cameras:
            await self.publish(f"{TOPIC}/camera/{camera}", "ON" if self.camera_on(camera) else "OFF")

    async def set_away(self, on: bool) -> None:
        self.index.set_setting("away", "on" if on else "off")
        log.info("Away recording %s", "on" if on else "off")
        await self.publish_state()

    async def set_camera(self, camera: str, on: bool) -> None:
        if camera in self.cameras:
            self.index.set_setting(f"camera:{camera}", "on" if on else "off")
            log.info("%s clips %s", camera, "on" if on else "off")
            await self.publish_state()

    async def set_limit(self, gb: int) -> None:
        gb = max(LIMIT_MIN_GB, min(LIMIT_MAX_GB, int(round(gb / 50) * 50)))
        self.index.set_setting("limit_gb", str(gb))
        log.info("Storage limit %d GB", gb)
        await self.enforce_limit()
        await self.publish_state()

    async def mqtt_loop(self) -> None:
        will = aiomqtt.Will(f"{TOPIC}/status", "offline", retain=True)
        while True:
            try:
                async with aiomqtt.Client(MQTT_HOST, username=MQTT_USER, password=MQTT_PASSWORD, will=will,
                                          identifier="clip-keeper") as client:
                    self.mqtt = client
                    for topic in ("frigate/reviews", f"{TOPIC}/schedule", f"{TOPIC}/away/set", f"{TOPIC}/limit/set",
                                  f"{TOPIC}/camera/+/set", f"{DISCOVERY}/status"):
                        await client.subscribe(topic)
                    await self.announce()
                    async for message in client.messages:
                        try:
                            await self.on_message(str(message.topic), (message.payload or b"").decode(errors="replace"))
                        except Exception:
                            log.exception("Handling %s failed", message.topic)
            except aiomqtt.MqttError as error:
                log.warning("MQTT connection lost (%s); retrying in 10 seconds", error)
                self.mqtt = None
                await asyncio.sleep(10)

    async def on_message(self, topic: str, payload: str) -> None:
        if topic == "frigate/reviews":
            await self.on_review(json.loads(payload))
        elif topic == f"{TOPIC}/schedule":
            on = payload.strip().lower() == "on"
            if on != self.schedule_on:
                self.schedule_on = on
                log.info("Schedule %s", "on" if on else "off")
                await self.publish_state()
        elif topic == f"{TOPIC}/away/set":
            await self.set_away(payload.strip().upper() == "ON")
        elif topic == f"{TOPIC}/limit/set":
            await self.set_limit(int(float(payload)))
        elif topic.startswith(f"{TOPIC}/camera/") and topic.endswith("/set"):
            await self.set_camera(topic.split("/")[2], payload.strip().upper() == "ON")
        elif topic == f"{DISCOVERY}/status" and payload == "online":
            await self.announce()

    # --- Detections -> clips ---

    async def on_review(self, message: dict) -> None:
        after = message.get("after") or {}
        review_id, camera = after.get("id"), after.get("camera")
        if not review_id or not camera:
            return
        kind = message.get("type")
        follow = self.pending.get(review_id)
        if follow is None:
            labels = wanted_labels((after.get("data") or {}).get("objects") or [], LABELS)
            if kind == "end" or not labels or not self.recording() or not self.camera_on(camera):
                return
            follow = {"camera": camera, "start": float(after["start_time"]), "end": None, "labels": labels,
                      "done": asyncio.Event()}
            self.pending[review_id] = follow
            log.info("%s: %s seen, following review %s", camera, ",".join(labels), review_id)
            asyncio.create_task(self.finish(review_id))
        else:
            follow["labels"] = sorted(set(follow["labels"]) | set(wanted_labels((after.get("data") or {}).get("objects") or [], LABELS)))
        if kind == "end":
            follow["end"] = float(after.get("end_time") or time.time())
            follow["done"].set()

    async def finish(self, review_id: str) -> None:
        follow = self.pending[review_id]
        try:
            # Wait for the detection to end, but cut the clip at its maximum length.
            with contextlib.suppress(TimeoutError):
                await asyncio.wait_for(follow["done"].wait(), timeout=max(0.0, cut_due(follow["start"], None) - time.time()))
            window = clip_window(follow["start"], follow["end"], self.covered.get(follow["camera"], 0.0))
            if window is None:
                log.info("%s: review %s already covered by the previous clip", follow["camera"], review_id)
                return
            self.covered[follow["camera"]] = window[1]  # claim it now so overlapping reviews don't repeat it
            await asyncio.sleep(max(0.0, window[1] + SEGMENT_DELAY - time.time()))
            await self.save(review_id, follow["camera"], window, follow["labels"])
        except Exception:
            log.exception("%s: saving the clip for review %s failed", follow["camera"], review_id)
        finally:
            self.pending.pop(review_id, None)

    async def fetch_clip(self, camera: str, start: float, end: float) -> bytes:
        url = f"{FRIGATE}/api/{camera}/start/{math.floor(start)}/end/{math.ceil(end)}/clip.mp4"
        for attempt in range(2):
            async with self.http.get(url, timeout=ClientTimeout(total=120)) as r:
                data = await r.read() if r.status == 200 else b""
            if len(data) > 100_000:
                return data
            await asyncio.sleep(15)  # the last segment may still be in Frigate's cache
        raise RuntimeError(f"Frigate returned too little video ({len(data)} bytes)")

    async def save(self, review_id: str, camera: str, window: tuple[float, float], labels: list[str]) -> None:
        async with self.lock:
            if not await self.check_storage():
                log.warning("%s: storage not available; clip for %s not saved", camera, review_id)
                return
            if self.storage_state.startswith("Full"):
                log.warning("%s: the limit is filled by grouped clips; clip for %s not saved", camera, review_id)
                return
            data = await self.fetch_clip(camera, *window)
            path = clip_path(camera, window[0], labels, review_id, TZ)
            await self.storage.put(path, data)
            self.index.add({"id": review_id, "camera": camera, "start": window[0], "finish": window[1],
                            "labels": ",".join(labels), "size": len(data), "path": path, "created": time.time()})
            log.info("%s: saved %s (%.0f s, %.1f MB)", camera, path, window[1] - window[0], len(data) / 1e6)
            await self.enforce_limit(locked=True)
        await self.publish_state()

    # --- Limit and housekeeping ---

    async def enforce_limit(self, locked: bool = False) -> None:
        async def run() -> None:
            remove, over = evictions(self.index.stored(), self.limit_gb * GB)
            for clip_id in remove:
                row = self.index.get(clip_id)
                if row:
                    await self.storage.delete(row["path"])
                    self.index.remove(clip_id)
            if remove:
                log.info("Removed %d oldest clip(s) to stay under %d GB", len(remove), self.limit_gb)
            if over:
                self.storage_state = f"Full: grouped clips use more than {self.limit_gb} GB"
            elif self.storage_state.startswith("Full"):
                self.storage_state = "OK"
        if locked:
            await run()
        else:
            async with self.lock:
                await run()

    async def check_storage(self) -> bool:
        ok = await self.storage.available()
        if not ok:
            self.storage_state = "Not configured or unreachable"
        elif not self.storage_state.startswith("Full"):
            self.storage_state = "OK"
        return ok

    async def reconcile(self) -> None:
        """Matches the index to the share: adds files found there, drops entries whose file is gone."""
        if not await self.check_storage():
            return
        async with self.lock:
            files = {p: s for p, s in await self.storage.walk() if p.endswith(".mp4")}
            known = self.index.paths()
            for path, clip_id in known.items():
                if path not in files:
                    self.index.remove(clip_id)
            for path, size in files.items():
                if path not in known:
                    start = path_time(path, TZ) or time.time()
                    self.index.add({"id": "file-" + path.rsplit("/", 1)[-1][:-4], "camera": path.split("/")[0],
                                    "start": start, "finish": start, "labels": "", "size": size, "path": path,
                                    "created": start})
            log.info("Index matches the share: %d clip(s)", len(files))

    async def refresh_cameras(self) -> None:
        async with self.http.get(f"{FRIGATE}/api/config", timeout=ClientTimeout(total=30)) as r:
            config = await r.json()
        cameras = sorted(config.get("cameras", {}))
        if cameras != self.cameras:
            self.cameras = cameras
            log.info("Cameras in Frigate: %s", ", ".join(cameras))
            await self.announce()

    async def housekeeping(self) -> None:
        while True:
            try:
                await self.refresh_cameras()
                await self.reconcile()
                await self.enforce_limit()
                await self.publish_state()
            except Exception:
                log.exception("Housekeeping failed")
            await asyncio.sleep(600)

    # --- HTTP API for the hub ---

    def authorized(self, request: web.Request) -> bool:
        given = request.headers.get("Authorization", "")
        return bool(API_TOKEN) and hmac.compare_digest(given, f"Bearer {API_TOKEN}")

    @staticmethod
    def clip_json(row) -> dict:
        return {"id": row["id"], "camera": row["camera"], "cameraName": display_name(row["camera"]),
                "start": row["start"], "seconds": round(row["finish"] - row["start"]),
                "labels": [l for l in row["labels"].split(",") if l], "size": row["size"], "group": row["grp"]}

    def routes(self) -> web.Application:
        app = web.Application(middlewares=[self.auth_middleware])
        app.add_routes([
            web.get("/healthz", self.healthz),
            web.get("/api/status", self.api_status),
            web.get("/api/clips", self.api_clips),
            web.get("/api/clips/{id}/video", self.api_video),
            web.post("/api/clips/delete", self.api_delete),
            web.post("/api/clips/group", self.api_group),
            web.get("/api/groups", self.api_groups),
            web.put("/api/settings", self.api_settings),
            web.post("/api/clips/from-review", self.api_from_review),
        ])
        return app

    @web.middleware
    async def auth_middleware(self, request: web.Request, handler):
        if request.path != "/healthz" and not self.authorized(request):
            return web.json_response({"error": "unauthorized"}, status=401)
        return await handler(request)

    async def healthz(self, request: web.Request) -> web.Response:
        return web.json_response({"ok": True})

    async def api_status(self, request: web.Request) -> web.Response:
        count, used = self.index.totals()
        return web.json_response({
            "storage": self.storage_state, "used": used, "count": count, "limitGb": self.limit_gb,
            "limitMinGb": LIMIT_MIN_GB, "limitMaxGb": LIMIT_MAX_GB, "away": self.away, "schedule": self.schedule_on,
            "recording": self.recording_text(), "labels": sorted(LABELS),
            "cameras": [{"id": c, "name": display_name(c), "on": self.camera_on(c)} for c in self.cameras],
        })

    async def api_clips(self, request: web.Request) -> web.Response:
        q = request.query
        rows = self.index.list(q.get("camera") or None, q.get("group") or None, q.get("ungrouped") == "1",
                               min(int(q.get("limit", "200")), 1000), float(q["before"]) if q.get("before") else None)
        return web.json_response([self.clip_json(r) for r in rows])

    async def api_video(self, request: web.Request) -> web.StreamResponse:
        clip_id = request.match_info["id"]
        row = self.index.get(clip_id) if CLIP_ID.match(clip_id) else None
        if not row:
            return web.json_response({"error": "not found"}, status=404)
        headers = {"Range": request.headers["Range"]} if "Range" in request.headers else {}
        async with self.http.get(self.storage.url(row["path"]), headers=headers, timeout=ClientTimeout(total=None, sock_read=60)) as up:
            if up.status not in (200, 206):
                return web.json_response({"error": f"storage answered {up.status}"}, status=502)
            response = web.StreamResponse(status=up.status)
            response.content_type = "video/mp4"
            response.headers["Accept-Ranges"] = "bytes"
            for name in ("Content-Length", "Content-Range"):
                if name in up.headers:
                    response.headers[name] = up.headers[name]
            await response.prepare(request)
            async for chunk in up.content.iter_chunked(256 * 1024):
                await response.write(chunk)
            await response.write_eof()
            return response

    async def ids_from(self, request: web.Request) -> list[str]:
        body = await request.json()
        ids = body.get("ids") or []
        if not isinstance(ids, list) or len(ids) > 500 or not all(isinstance(i, str) and CLIP_ID.match(i) for i in ids):
            raise web.HTTPBadRequest(text="ids must be a list of clip ids")
        return ids

    async def api_delete(self, request: web.Request) -> web.Response:
        ids = await self.ids_from(request)
        deleted = 0
        async with self.lock:
            for clip_id in ids:
                row = self.index.get(clip_id)
                if row:
                    await self.storage.delete(row["path"])
                    self.index.remove(clip_id)
                    deleted += 1
        if self.storage_state.startswith("Full"):
            await self.enforce_limit()
        await self.publish_state()
        return web.json_response({"deleted": deleted})

    async def api_group(self, request: web.Request) -> web.Response:
        body = await request.json()
        ids = await self.ids_from(request)
        group = body.get("group")
        if group is not None and (not isinstance(group, str) or not GROUP_NAME.match(group.strip())):
            raise web.HTTPBadRequest(text="group names: letters, numbers, spaces and . , ' ( ) & - up to 60")
        changed = self.index.set_group(ids, group.strip() if group else None)
        await self.enforce_limit()
        return web.json_response({"changed": changed})

    async def api_groups(self, request: web.Request) -> web.Response:
        return web.json_response([{"name": r["name"], "count": r["count"], "bytes": r["bytes"]} for r in self.index.groups()])

    async def api_from_review(self, request: web.Request) -> web.Response:
        """Saves a clip of a past Frigate review item on request (whether or not recording is on)."""
        review_id = str((await request.json()).get("id", ""))
        if not CLIP_ID.match(review_id):
            raise web.HTTPBadRequest(text="bad review id")
        async with self.http.get(f"{FRIGATE}/api/review/{review_id}", timeout=ClientTimeout(total=30)) as r:
            if r.status != 200:
                return web.json_response({"error": "Frigate has no such review"}, status=404)
            review = await r.json()
        if not review.get("end_time"):
            return web.json_response({"error": "that review is still going"}, status=409)
        labels = wanted_labels((review.get("data") or {}).get("objects") or [], LABELS) or ["object"]
        window = clip_window(float(review["start_time"]), float(review["end_time"]))
        await self.save(review["id"], review["camera"], window, labels)
        row = self.index.get(review["id"])
        if not row:
            return web.json_response({"error": f"not saved: {self.storage_state}"}, status=503)
        return web.json_response(self.clip_json(row))

    async def api_settings(self, request: web.Request) -> web.Response:
        body = await request.json()
        if "limitGb" in body:
            await self.set_limit(int(body["limitGb"]))
        if "away" in body:
            await self.set_away(bool(body["away"]))
        for camera, on in (body.get("cameras") or {}).items():
            await self.set_camera(str(camera), bool(on))
        return await self.api_status(request)

    # --- Start ---

    async def run(self) -> None:
        async with ClientSession() as http:
            self.http = http
            self.storage = Storage(http)
            runner = web.AppRunner(self.routes())
            await runner.setup()
            await web.TCPSite(runner, "0.0.0.0", 8080).start()
            log.info("API on :8080; labels %s; cameras on by default: %s", ",".join(sorted(LABELS)), ",".join(sorted(DEFAULT_CAMERAS)))
            await asyncio.gather(self.mqtt_loop(), self.housekeeping())


if __name__ == "__main__":
    asyncio.run(Keeper().run())
