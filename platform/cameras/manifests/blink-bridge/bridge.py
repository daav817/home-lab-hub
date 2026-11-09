"""Blink live-view bridge.

Holds one Blink sign-in and serves each camera's live view as an MPEG-TS stream on a local TCP
port, which go2rtc (in the same pod) turns into RTSP for Frigate and Home Assistant.

How a live view starts:
- "Start live view" (an MQTT button in Home Assistant) wakes the camera. The bridge keeps
  everything Blink sends from the start of the session, so when a player connects it gets the
  whole stream at once instead of waiting for a battery camera to wake (players give up after
  about 5 seconds). If no player connects within PREWARM_WAIT seconds, the session ends.
- For wired cameras, a player connecting directly (Frigate, for Parking Lot) also starts a
  session. Battery cameras only start from the button; a player can join a running session.

When Blink ends a session:
- wired cameras reconnect while anyone is watching (waiting longer after short sessions);
- battery cameras go to "waiting" and wait up to CONTINUE_WAIT seconds for "Continue". Players
  are kept connected with MPEG-TS null packets meanwhile. Without an answer the view ends.

A player that drops and reconnects within PLAYER_GRACE seconds keeps the session. Blink allows
one live view per Sync Module, so a wired camera steps aside while a battery camera on the same
module is live, and resumes afterwards.

The bridge also offers the wired camera's light and night vision setting as Home Assistant
controls (the battery cameras refused both). Two-way talk isn't supported by the Blink library.

Commands:
    python bridge.py setup    One-time sign-in with your Blink email, password and the
                              verification code Blink emails you. Saves only the token.
    python bridge.py run      The service (the container's default).
"""

import asyncio
import contextlib
import getpass
import json
import logging
import os
import sys
import time
from dataclasses import dataclass, field

import aiomqtt
from aiohttp import ClientSession
from blinkpy.auth import Auth, BlinkTwoFARequiredError
from blinkpy.blinkpy import Blink
from blinkpy.livestream import BlinkLiveStream


async def _recv_whole_packets(self) -> None:
    """Replaces BlinkLiveStream.recv (blinkpy 0.25.9). The library reads each packet with
    read(n), which may return part of it when the packet arrives split across TCP segments,
    and then treats that as the end of the stream ("Insufficient data for payload"): live views
    ended after a few seconds. readexactly waits for the whole packet."""
    try:
        while True:
            header = await self.target_reader.readexactly(9)
            msgtype = header[0]
            length = int.from_bytes(header[5:9], byteorder="big")
            if length <= 0:
                continue
            data = await self.target_reader.readexactly(length)
            if msgtype != 0x00 or data[0] != 0x47:
                continue  # not MPEG-TS video
            for writer in self.clients:
                if not writer.is_closing():
                    writer.write(data)
                    await writer.drain()
    except asyncio.IncompleteReadError:
        pass  # Blink closed the stream
    except Exception:
        logging.getLogger("blink-bridge").exception("Error while receiving Blink data")
    finally:
        self.target_writer.close()
        logging.getLogger("blinkpy.livestream").debug("Receiving was aborted, aborting sending")


BlinkLiveStream.recv = _recv_whole_packets

TOKEN_FILE = os.environ.get("BLINK_TOKEN_FILE", "/data/blink.json")
CONTINUE_WAIT = int(os.environ.get("CONTINUE_WAIT", "60"))
PREWARM_WAIT = int(os.environ.get("PREWARM_WAIT", "30"))
WAKE_TIMEOUT = int(os.environ.get("WAKE_TIMEOUT", "25"))
# A player (Frigate) that drops and reconnects within this many seconds keeps the session.
PLAYER_GRACE = int(os.environ.get("PLAYER_GRACE", "20"))
BUFFER_LIMIT = 8 * 1024 * 1024
MQTT_HOST = os.environ.get("MQTT_HOST", "mosquitto.home-assistant.svc.cluster.local")
MQTT_USER = os.environ.get("MQTT_USER", "blink")
MQTT_PASSWORD = os.environ.get("MQTT_PASSWORD", "")
DISCOVERY = "homeassistant"
GO2RTC_API = "http://127.0.0.1:1984"  # go2rtc in this pod (local only)
TOPIC = "blink"

# 188-byte MPEG-TS null packet (PID 0x1FFF). Players ignore it; it keeps the connection busy.
NULL_PACKET = bytes([0x47, 0x1F, 0xFF, 0x10]) + b"\xff" * 184

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("blink-bridge")
# The Blink library logs request details at debug level; keep it quiet.
logging.getLogger("blinkpy").setLevel(logging.WARNING)
# Except a few live-stream lines that say why Blink ended a session. Other debug lines from the
# stream code include sign-in details, so only these exact messages pass.
_SESSION_LINES = ("Command state", "Client disconnected", "Last client disconnected",
                  "Streaming was aborted", "Sending was aborted", "Receiving was aborted")
_stream_log = logging.getLogger("blinkpy.livestream")
_stream_log.setLevel(logging.DEBUG)
_stream_log.addFilter(lambda record: record.levelno >= logging.WARNING or str(record.msg).startswith(_SESSION_LINES))


@dataclass
class Camera:
    key: str  # stream name, e.g. front_door
    name: str  # Blink camera name, e.g. Front Door
    wired: bool
    port: int
    state: str = "idle"
    continue_event: asyncio.Event = field(default_factory=asyncio.Event)
    stop_event: asyncio.Event = field(default_factory=asyncio.Event)
    pause_event: asyncio.Event = field(default_factory=asyncio.Event)  # ends this session only
    viewers: set = field(default_factory=set)  # one asyncio.Queue per connected player
    buffer: bytearray = field(default_factory=bytearray)  # stream since the session started
    attached: bool = False  # a player has connected during this run
    task: asyncio.Task | None = None
    from_motion: bool = False  # started by a Blink motion event: no Continue prompt
    stop_reason: str = ""  # why the session was told to end, for the log
    backoff: float = 2  # wired cameras: wait before the next session (grows if Blink refuses)
    next_start: float = 0.0  # monotonic time the next session may start
    unwatched: asyncio.Task | None = None  # pending stop after the last player left
    in_session: bool = False  # battery camera: has (or is about to take) its Sync Module's live view
    streaming: bool = False  # a Blink live session is open


def parse_cameras() -> list[Camera]:
    """BLINK_CAMERAS="front_door=Front Door=battery;parking_lot=Parking Lot=wired"."""
    cameras = []
    for index, item in enumerate(filter(None, os.environ.get("BLINK_CAMERAS", "").split(";"))):
        key, name, kind = (part.strip() for part in item.split("="))
        if kind not in ("wired", "battery"):
            raise SystemExit(f"Camera {key}: type must be wired or battery, not {kind}")
        cameras.append(Camera(key, name, kind == "wired", 18001 + index))
    return cameras


def save_token(auth: Auth) -> None:
    """Saves the sign-in token, never the password."""
    data = {k: v for k, v in auth.login_attributes.items() if k != "password"}
    tmp = TOKEN_FILE + ".tmp"
    with open(os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600), "w") as handle:
        json.dump(data, handle)
    os.replace(tmp, TOKEN_FILE)


async def setup() -> None:
    email = input("Blink email: ").strip()
    password = getpass.getpass("Blink password (hidden): ")
    async with ClientSession() as session:
        blink = Blink(session=session)
        blink.auth = Auth({"username": email, "password": password}, no_prompt=True, session=session)
        try:
            ok = await blink.start()
        except BlinkTwoFARequiredError:
            code = input("Blink emailed you a verification code. Enter it: ").strip()
            ok = await blink.send_2fa_code(code)
        if not ok:
            raise SystemExit("Sign-in failed. Nothing was saved.")
        save_token(blink.auth)
        print("Signed in. Cameras on this account:")
        for name, camera in blink.cameras.items():
            print(f"  {name} ({camera.product_type})")
        print(f"Token saved to {TOKEN_FILE}. The bridge picks it up within 10 seconds.")


class Bridge:
    def __init__(self, cameras: list[Camera]):
        self.cameras = {camera.key: camera for camera in cameras}
        self.blink: Blink | None = None
        self.mqtt: aiomqtt.Client | None = None
        self.saved_token = None
        self.http: ClientSession | None = None

    # --- MQTT and Home Assistant ---------------------------------------------------------

    async def publish(self, topic: str, payload: str, retain: bool = True) -> None:
        if self.mqtt:
            with contextlib.suppress(aiomqtt.MqttError):
                await self.mqtt.publish(topic, payload, retain=retain)

    async def set_state(self, camera: Camera, state: str) -> None:
        if camera.state != state:
            camera.state = state
            log.info("%s: %s", camera.key, state)
            if not camera.wired and state in ("live", "idle"):
                asyncio.create_task(self.preload(camera, state == "live"))
        await self.publish(f"{TOPIC}/{camera.key}/state", state)

    async def preload(self, camera: Camera, on: bool) -> None:
        """Keeps go2rtc (in this pod) reading a battery camera while its session runs, so a player
        that reconnects mid-session (Frigate, after a gap in the video) gets an answer at once
        instead of waiting more than go2rtc's fixed 5 s for the stream to be described. The
        wired camera is preloaded in go2rtc.yaml."""
        if self.http is None:
            return
        url = f"{GO2RTC_API}/api/preload"
        try:
            if on:
                # go2rtc also tries to save the preload in its (read-only) config file, which
                # fails with 500 after the preload itself has started: that's expected.
                async with self.http.put(url, params={"src": camera.key, "video": "", "audio": ""}) as response:
                    if response.status not in (200, 500):
                        log.warning("%s: go2rtc preload failed (%d)", camera.key, response.status)
            else:
                async with self.http.delete(url, params={"src": camera.key}):
                    pass
        except Exception as error:
            log.warning("%s: go2rtc preload %s failed: %s", camera.key, "on" if on else "off", error)

    async def announce(self) -> None:
        """Home Assistant discovery for each camera's controls."""
        for camera in self.cameras.values():
            base = f"{TOPIC}/{camera.key}"
            common = {
                "availability": {"topic": f"{TOPIC}/status"},
                "device": {
                    "identifiers": [f"blink_live_{camera.key}"],
                    "name": f"{camera.name.title()} live view",
                    "manufacturer": "Blink",
                    "model": "Live view bridge",
                },
            }

            async def entity(kind: str, slug: str, config: dict) -> None:
                await self.publish(
                    f"{DISCOVERY}/{kind}/blink_live_{camera.key}/{slug}/config",
                    json.dumps({**config, "unique_id": f"blink_live_{camera.key}_{slug}", **common}),
                )

            await entity("sensor", "state", {"name": "Live view", "state_topic": f"{base}/state", "icon": "mdi:cctv"})
            # Light and night vision only on the wired camera: the battery cameras refused both.
            if camera.wired:
                await entity("select", "night_vision", {
                    "name": "Night vision", "command_topic": f"{base}/night_vision/set",
                    "state_topic": f"{base}/night_vision", "options": ["auto", "on", "off"], "icon": "mdi:weather-night",
                })
                await entity("switch", "light", {
                    "name": "Light", "command_topic": f"{base}/light/set", "state_topic": f"{base}/light",
                    "payload_on": "on", "payload_off": "off", "optimistic": False, "icon": "mdi:spotlight-beam",
                })
            else:
                for kind, slug in (("select", "night_vision"), ("switch", "light")):
                    # An empty config tells Home Assistant to remove the entity.
                    await self.publish(f"{DISCOVERY}/{kind}/blink_live_{camera.key}/{slug}/config", "")
            if not camera.wired:
                await entity("button", "start", {
                    "name": "Start live view", "command_topic": f"{base}/start", "payload_press": "start",
                    "icon": "mdi:play",
                })
                await entity("button", "stop", {
                    "name": "Stop live view", "command_topic": f"{base}/stop", "payload_press": "stop",
                    "icon": "mdi:stop",
                })
                await entity("button", "continue", {
                    "name": "Continue live view", "command_topic": f"{base}/continue", "payload_press": "continue",
                    "icon": "mdi:play-pause",
                })
            await self.publish(f"{base}/state", camera.state)

    async def handle_command(self, camera: Camera, command: str, payload: str) -> None:
        if command == "start":
            # "motion" comes from Home Assistant when Blink sees motion, so Frigate can record.
            from_motion = payload == "motion"
            log.info("%s: start requested%s", camera.key, " (motion)" if from_motion else "")
            if camera.task is None or camera.task.done():
                camera.from_motion = from_motion
            elif not from_motion:
                camera.from_motion = False  # someone is watching: offer Continue as usual
                if camera.state == "waiting":
                    camera.continue_event.set()  # Start while waiting means Continue
            self.ensure_running(camera)
        elif command == "stop":
            log.info("%s: stop requested", camera.key)
            camera.stop_reason = "Stop pressed"
            camera.stop_event.set()
        elif command == "continue":
            log.info("%s: continue requested", camera.key)
            camera.continue_event.set()
        elif command == "night_vision/set" and payload in ("auto", "on", "off"):
            result = await self.blink.cameras[camera.name].async_set_night_vision(payload)
            log.info("%s: night vision %s (%s)", camera.key, payload, "ok" if result else "refused")
            if result:
                await self.publish(f"{TOPIC}/{camera.key}/night_vision", payload)
        elif command == "light/set" and payload in ("on", "off"):
            await self.set_light(camera, payload)

    async def set_light(self, camera: Camera, payload: str) -> None:
        """Blink refuses light changes while the camera is streaming ("busy"), so pause the
        live session for a moment. A wired camera's session resumes on its own."""
        blink_camera = self.blink.cameras[camera.name]
        paused = camera.task is not None and not camera.task.done()
        if paused:
            camera.pause_event.set()
        try:
            for attempt in range(8):
                await asyncio.sleep(3 if paused or attempt else 0)
                result = await blink_camera.async_set_floodlight(payload == "on")
                if result is not None:
                    log.info("%s: light %s", camera.key, payload)
                    await self.publish(f"{TOPIC}/{camera.key}/light", payload)
                    return
            log.warning("%s: Blink kept refusing to turn the light %s", camera.key, payload)
        finally:
            camera.pause_event.clear()

    async def mqtt_loop(self) -> None:
        will = aiomqtt.Will(f"{TOPIC}/status", "offline", retain=True)
        while True:
            try:
                async with aiomqtt.Client(
                    MQTT_HOST, username=MQTT_USER, password=MQTT_PASSWORD, will=will, identifier="blink-bridge"
                ) as client:
                    self.mqtt = client
                    await client.publish(f"{TOPIC}/status", "online", retain=True)
                    await self.announce()
                    for command in ("start", "stop", "continue", "night_vision/set", "light/set"):
                        await client.subscribe(f"{TOPIC}/+/{command}")
                    await client.subscribe(f"{DISCOVERY}/status")
                    async for message in client.messages:
                        topic = str(message.topic)
                        payload = message.payload.decode(errors="replace") if message.payload else ""
                        if topic == f"{DISCOVERY}/status":
                            if payload == "online":
                                await self.announce()  # Home Assistant restarted
                            continue
                        parts = topic.split("/", 2)
                        camera = self.cameras.get(parts[1])
                        if camera and self.blink:
                            try:
                                await self.handle_command(camera, parts[2], payload)
                            except Exception:
                                log.exception("%s: %s failed", camera.key, parts[2])
            except aiomqtt.MqttError as error:
                log.warning("MQTT connection lost (%s); retrying in 10 seconds", error)
                self.mqtt = None
                await asyncio.sleep(10)

    # --- Blink sign-in -------------------------------------------------------------------

    async def sign_in(self, session: ClientSession) -> None:
        while not os.path.exists(TOKEN_FILE):
            log.info("No Blink sign-in yet. Run: python bridge.py setup")
            await asyncio.sleep(10)
        with open(TOKEN_FILE) as handle:
            data = json.load(handle)
        blink = Blink(session=session, refresh_rate=300)
        blink.auth = Auth(data, no_prompt=True, session=session)
        if not await blink.start():
            raise SystemExit("Blink sign-in failed. The token may have expired: run setup again.")
        save_token(blink.auth)
        self.saved_token = blink.auth.refresh_token
        self.blink = blink
        missing = [c.name for c in self.cameras.values() if c.name not in blink.cameras]
        if missing:
            log.warning("Not found on the Blink account: %s. Found: %s", missing, list(blink.cameras))
        log.info("Signed in to Blink")

    async def keep_token(self) -> None:
        """Saves the token whenever Blink rotates it, so a restart can sign in again."""
        while True:
            await asyncio.sleep(60)
            if self.blink and self.blink.auth.refresh_token != self.saved_token:
                save_token(self.blink.auth)
                self.saved_token = self.blink.auth.refresh_token
                log.info("Saved a refreshed Blink token")

    # --- Live sessions -------------------------------------------------------------------

    def ensure_running(self, camera: Camera) -> None:
        if camera.task is None or camera.task.done():
            camera.stop_event.clear()
            camera.stop_reason = ""
            camera.attached = False
            camera.buffer.clear()
            camera.task = asyncio.create_task(self.run_camera(camera))

    def send(self, camera: Camera, chunk: bytes) -> None:
        for queue in list(camera.viewers):
            queue.put_nowait(chunk)

    def network(self, camera: Camera) -> str | None:
        blink_camera = self.blink.cameras.get(camera.name) if self.blink else None
        return getattr(blink_camera, "network_id", None)

    def battery_on_same_module(self, camera: Camera) -> Camera | None:
        """A battery camera that wants the Sync Module this camera is on. Blink gives each Sync
        Module one live view at a time, so the wired camera steps aside for it."""
        network = self.network(camera)
        for other in self.cameras.values():
            if other is not camera and not other.wired and other.in_session and self.network(other) == network:
                return other
        return None

    async def wait_for_module(self, camera: Camera) -> None:
        """Battery camera: waits (up to 20 s) for a wired camera on the same Sync Module to let go."""
        network = self.network(camera)
        deadline = time.monotonic() + 20
        while time.monotonic() < deadline and any(
            other.streaming for other in self.cameras.values() if other is not camera and self.network(other) == network
        ):
            await asyncio.sleep(0.5)

    async def one_session(self, camera: Camera) -> tuple[int, str]:
        """Streams one Blink session to the viewers, keeping it in the buffer until a player
        has connected. Returns the bytes received and why it ended."""
        stream = await self.blink.cameras[camera.name].init_livestream()
        await stream.start("127.0.0.1", 0)
        camera.streaming = True
        feed = asyncio.create_task(stream.feed())
        received = 0
        first_data = None
        opened = time.monotonic()
        reason = ""
        try:
            host, port = stream.socket.getsockname()[:2]
            reader, local = await asyncio.open_connection(host, port)
            try:
                while not reason:
                    if camera.stop_event.is_set():
                        reason = camera.stop_reason or "stopped"
                        break
                    if camera.pause_event.is_set():
                        reason = "paused to change the light"
                        break
                    if camera.wired and (other := self.battery_on_same_module(camera)):
                        reason = f"stepping aside for {other.key} (same Sync Module)"
                        break
                    try:
                        chunk = await asyncio.wait_for(reader.read(65536), timeout=1)
                    except TimeoutError:
                        chunk = None
                    if chunk == b"":
                        reason = "Blink ended the stream"
                        break
                    if chunk:
                        if first_data is None:
                            first_data = time.monotonic()
                            await self.set_state(camera, "live")
                        received += len(chunk)
                        if not camera.attached and len(camera.buffer) < BUFFER_LIMIT:
                            camera.buffer.extend(chunk)
                        self.send(camera, chunk)
                    if first_data is None and time.monotonic() - opened > WAKE_TIMEOUT:
                        reason = f"no video within {WAKE_TIMEOUT} s of asking Blink"
                        log.warning("%s: %s", camera.key, reason)
                    # Started from Home Assistant but no player came: give up.
                    elif not camera.attached and time.monotonic() - (first_data or time.monotonic()) > PREWARM_WAIT:
                        reason = f"no player connected within {PREWARM_WAIT} s"
                        camera.stop_reason = reason
                        camera.stop_event.set()
            finally:
                local.close()
        finally:
            stream.stop()
            feed.cancel()
            with contextlib.suppress(BaseException):
                await feed
            camera.streaming = False
        return received, reason

    async def wait_to_continue(self, camera: Camera) -> bool:
        """Waits the full window for Continue, even if the player disconnects meanwhile (the live
        tile reconnects when the next session starts). Continue pressed during the session
        counts too, so the next session starts straight away."""
        if camera.continue_event.is_set():
            return True
        await self.set_state(camera, "waiting")
        deadline = time.monotonic() + CONTINUE_WAIT
        while time.monotonic() < deadline and not camera.stop_event.is_set():
            if camera.continue_event.is_set():
                return True
            self.send(camera, NULL_PACKET * 7)
            with contextlib.suppress(TimeoutError):
                await asyncio.wait_for(camera.continue_event.wait(), timeout=1)
        return camera.continue_event.is_set() and not camera.stop_event.is_set()

    async def wait_for_turn(self, camera: Camera) -> bool:
        """Wired camera: waits out the gap after a short session and any battery camera using
        the same Sync Module. False if the view was stopped meanwhile."""
        announced = False
        while not camera.stop_event.is_set():
            other = self.battery_on_same_module(camera)
            if other is None and time.monotonic() >= camera.next_start:
                return True
            if other and not announced:
                log.info("%s: waiting for %s to finish (same Sync Module)", camera.key, other.key)
                announced = True
            with contextlib.suppress(TimeoutError):
                await asyncio.wait_for(camera.stop_event.wait(), timeout=1)
        return False

    async def run_camera(self, camera: Camera) -> None:
        try:
            while not camera.stop_event.is_set():
                camera.continue_event.clear()  # a press during this session continues it
                await self.set_state(camera, "starting")
                if camera.wired and not await self.wait_for_turn(camera):
                    break
                # A player already connected (or reconnecting later) gets the stream from the
                # start of this session.
                camera.buffer.clear()
                camera.attached = bool(camera.viewers)
                started = time.monotonic()
                reason = "failed"
                camera.in_session = not camera.wired
                try:
                    if not camera.wired:
                        await self.wait_for_module(camera)
                    received, reason = await self.one_session(camera)
                    log.info("%s: session ended after %.0f s, %d KB: %s",
                             camera.key, time.monotonic() - started, received // 1024, reason)
                except Exception:
                    log.exception("%s: session failed", camera.key)
                finally:
                    camera.in_session = False
                if camera.stop_event.is_set():
                    break
                if camera.wired:
                    # Short sessions in a row mean Blink is refusing; slow down. Stepping aside or
                    # pausing for the light isn't Blink refusing.
                    if reason.startswith(("stepping aside", "paused")) or time.monotonic() - started > 60:
                        camera.backoff = 2
                    else:
                        camera.backoff = min(camera.backoff * 2, 60)
                    camera.next_start = time.monotonic() + camera.backoff
                elif camera.from_motion or not await self.wait_to_continue(camera):
                    break
        finally:
            if camera.stop_reason:
                log.info("%s: view ended: %s", camera.key, camera.stop_reason)
            for queue in list(camera.viewers):
                queue.put_nowait(None)  # tells each player connection to close
            camera.buffer.clear()
            await self.set_state(camera, "idle")

    async def stop_if_unwatched(self, camera: Camera) -> None:
        """Ends the view once nobody has been watching for PLAYER_GRACE seconds. A player that
        drops and comes back sooner (Frigate reconnecting) keeps the same session."""
        await asyncio.sleep(PLAYER_GRACE)
        camera.unwatched = None
        if not camera.viewers and camera.state != "waiting":
            camera.stop_reason = f"no player for {PLAYER_GRACE} s"
            camera.stop_event.set()

    async def serve(self, camera: Camera, client: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        """One player connection from go2rtc. Gets the stream so far, then the live data."""
        if self.blink is None:
            writer.close()
            return
        if not camera.wired and (camera.task is None or camera.task.done()):
            # Battery cameras only start from the Start button. A player reconnecting after a
            # session ended (go2rtc retries on its own) must not wake the camera again.
            writer.close()
            return
        # Start the session first: starting one resets the buffer and the attached flag.
        self.ensure_running(camera)
        if camera.unwatched:
            camera.unwatched.cancel()
            camera.unwatched = None
        queue: asyncio.Queue = asyncio.Queue()
        if camera.buffer:
            queue.put_nowait(bytes(camera.buffer))
        camera.viewers.add(queue)
        camera.attached = True
        log.info("%s: player connected (%d watching)", camera.key, len(camera.viewers))

        async def watch() -> None:
            with contextlib.suppress(Exception):
                while await client.read(1024):
                    pass
            queue.put_nowait(None)

        watcher = asyncio.create_task(watch())
        try:
            while (chunk := await queue.get()) is not None:
                writer.write(chunk)
                await writer.drain()
        except (ConnectionError, OSError):
            pass
        finally:
            watcher.cancel()
            camera.viewers.discard(queue)
            with contextlib.suppress(Exception):
                writer.close()
            log.info("%s: player left (%d watching)", camera.key, len(camera.viewers))
            running = camera.task is not None and not camera.task.done()
            if running and not camera.viewers and camera.state != "waiting" and camera.unwatched is None:
                camera.unwatched = asyncio.create_task(self.stop_if_unwatched(camera))

    async def run(self) -> None:
        async with ClientSession() as session:
            self.http = session
            mqtt = asyncio.create_task(self.mqtt_loop())
            await self.sign_in(session)
            for camera in self.cameras.values():
                await asyncio.start_server(
                    lambda r, w, c=camera: self.serve(c, r, w), "127.0.0.1", camera.port
                )
                log.info("%s (%s, %s) on port %d", camera.key, camera.name, "wired" if camera.wired else "battery", camera.port)
            await asyncio.gather(mqtt, self.keep_token())


def main() -> None:
    command = sys.argv[1] if len(sys.argv) > 1 else "run"
    if command == "setup":
        asyncio.run(setup())
    elif command == "run":
        cameras = parse_cameras()
        if not cameras:
            raise SystemExit("Set BLINK_CAMERAS")
        asyncio.run(Bridge(cameras).run())
    else:
        raise SystemExit(__doc__)


if __name__ == "__main__":
    main()
