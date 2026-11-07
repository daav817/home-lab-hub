"""Blink live-view bridge.

Holds one Blink sign-in and serves each camera's live view as an MPEG-TS stream on a local TCP
port, which go2rtc (in the same pod) turns into RTSP for Frigate and Home Assistant.

How a live view starts:
- "Start live view" (an MQTT button in Home Assistant) wakes the camera. The bridge keeps
  everything Blink sends from the start of the session, so when a player connects it gets the
  whole stream at once instead of waiting for a battery camera to wake (players give up after
  about 5 seconds). If no player connects within PREWARM_WAIT seconds, the session ends.
- A player connecting directly (Frigate, for the wired Parking Lot) also starts a session.

When Blink ends a session:
- wired cameras reconnect straight away while anyone is watching;
- battery cameras go to "waiting" and wait up to CONTINUE_WAIT seconds for "Continue". Players
  are kept connected with MPEG-TS null packets meanwhile. Without an answer the view ends.

The bridge also offers each camera's night vision setting, and the light on cameras that have
one, as Home Assistant controls. Two-way talk isn't supported by the Blink library.

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

TOKEN_FILE = os.environ.get("BLINK_TOKEN_FILE", "/data/blink.json")
CONTINUE_WAIT = int(os.environ.get("CONTINUE_WAIT", "60"))
PREWARM_WAIT = int(os.environ.get("PREWARM_WAIT", "30"))
BUFFER_LIMIT = 8 * 1024 * 1024
MQTT_HOST = os.environ.get("MQTT_HOST", "mosquitto.home-assistant.svc.cluster.local")
MQTT_USER = os.environ.get("MQTT_USER", "blink")
MQTT_PASSWORD = os.environ.get("MQTT_PASSWORD", "")
DISCOVERY = "homeassistant"
TOPIC = "blink"

# 188-byte MPEG-TS null packet (PID 0x1FFF). Players ignore it; it keeps the connection busy.
NULL_PACKET = bytes([0x47, 0x1F, 0xFF, 0x10]) + b"\xff" * 184

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("blink-bridge")
# The Blink library logs request details at debug level; keep it quiet.
logging.getLogger("blinkpy").setLevel(logging.WARNING)


@dataclass
class Camera:
    key: str  # stream name, e.g. front_door
    name: str  # Blink camera name, e.g. Front Door
    wired: bool
    port: int
    state: str = "idle"
    continue_event: asyncio.Event = field(default_factory=asyncio.Event)
    stop_event: asyncio.Event = field(default_factory=asyncio.Event)
    viewers: set = field(default_factory=set)  # one asyncio.Queue per connected player
    buffer: bytearray = field(default_factory=bytearray)  # stream since the session started
    attached: bool = False  # a player has connected during this run
    task: asyncio.Task | None = None


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

    # --- MQTT and Home Assistant ---------------------------------------------------------

    async def publish(self, topic: str, payload: str, retain: bool = True) -> None:
        if self.mqtt:
            with contextlib.suppress(aiomqtt.MqttError):
                await self.mqtt.publish(topic, payload, retain=retain)

    async def set_state(self, camera: Camera, state: str) -> None:
        if camera.state != state:
            camera.state = state
            log.info("%s: %s", camera.key, state)
        await self.publish(f"{TOPIC}/{camera.key}/state", state)

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
            await entity("select", "night_vision", {
                "name": "Night vision", "command_topic": f"{base}/night_vision/set",
                "state_topic": f"{base}/night_vision", "options": ["auto", "on", "off"], "icon": "mdi:weather-night",
            })
            await entity("switch", "light", {
                "name": "Light", "command_topic": f"{base}/light/set", "state_topic": f"{base}/light",
                "payload_on": "on", "payload_off": "off", "optimistic": False, "icon": "mdi:spotlight-beam",
            })
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
            log.info("%s: start requested", camera.key)
            self.ensure_running(camera)
        elif command == "stop":
            log.info("%s: stop requested", camera.key)
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
            result = await self.blink.cameras[camera.name].async_set_floodlight(payload == "on")
            log.info("%s: light %s (%s)", camera.key, payload, "ok" if result else "refused")
            if result is not None:
                await self.publish(f"{TOPIC}/{camera.key}/light", payload)

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
            camera.attached = False
            camera.buffer.clear()
            camera.task = asyncio.create_task(self.run_camera(camera))

    def send(self, camera: Camera, chunk: bytes) -> None:
        for queue in list(camera.viewers):
            queue.put_nowait(chunk)

    async def one_session(self, camera: Camera) -> int:
        """Streams one Blink session to the viewers, keeping it in the buffer until a player
        has connected. Returns the bytes received."""
        stream = await self.blink.cameras[camera.name].init_livestream()
        await stream.start("127.0.0.1", 0)
        feed = asyncio.create_task(stream.feed())
        received = 0
        first_data = None
        try:
            host, port = stream.socket.getsockname()[:2]
            reader, local = await asyncio.open_connection(host, port)
            try:
                while not camera.stop_event.is_set():
                    try:
                        chunk = await asyncio.wait_for(reader.read(65536), timeout=5)
                    except TimeoutError:
                        chunk = None
                    if chunk == b"":
                        break  # Blink ended the session
                    if chunk:
                        if first_data is None:
                            first_data = time.monotonic()
                            await self.set_state(camera, "live")
                        received += len(chunk)
                        if not camera.attached and len(camera.buffer) < BUFFER_LIMIT:
                            camera.buffer.extend(chunk)
                        self.send(camera, chunk)
                    # Started from Home Assistant but no player came: give up.
                    if not camera.attached and time.monotonic() - (first_data or time.monotonic()) > PREWARM_WAIT:
                        log.info("%s: no player connected within %d s", camera.key, PREWARM_WAIT)
                        camera.stop_event.set()
            finally:
                local.close()
        finally:
            stream.stop()
            feed.cancel()
            with contextlib.suppress(BaseException):
                await feed
        return received

    async def wait_to_continue(self, camera: Camera) -> bool:
        camera.continue_event.clear()
        await self.set_state(camera, "waiting")
        deadline = time.monotonic() + CONTINUE_WAIT
        while time.monotonic() < deadline and camera.viewers and not camera.stop_event.is_set():
            if camera.continue_event.is_set():
                return True
            self.send(camera, NULL_PACKET * 7)
            with contextlib.suppress(TimeoutError):
                await asyncio.wait_for(camera.continue_event.wait(), timeout=1)
        return camera.continue_event.is_set() and bool(camera.viewers) and not camera.stop_event.is_set()

    async def run_camera(self, camera: Camera) -> None:
        backoff = 2
        try:
            while not camera.stop_event.is_set():
                await self.set_state(camera, "starting")
                started = time.monotonic()
                try:
                    received = await self.one_session(camera)
                    log.info("%s: session ended after %.0f s, %d KB", camera.key, time.monotonic() - started, received // 1024)
                except Exception:
                    log.exception("%s: session failed", camera.key)
                if camera.stop_event.is_set() or not camera.viewers:
                    break
                if camera.wired:
                    # Short sessions in a row mean Blink is refusing; slow down.
                    backoff = 2 if time.monotonic() - started > 60 else min(backoff * 2, 300)
                    await asyncio.sleep(backoff)
                elif not await self.wait_to_continue(camera):
                    break
        finally:
            for queue in list(camera.viewers):
                queue.put_nowait(None)  # tells each player connection to close
            camera.buffer.clear()
            await self.set_state(camera, "idle")

    async def serve(self, camera: Camera, client: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        """One player connection from go2rtc. Gets the stream so far, then the live data."""
        if self.blink is None:
            writer.close()
            return
        queue: asyncio.Queue = asyncio.Queue()
        if camera.buffer:
            queue.put_nowait(bytes(camera.buffer))
        camera.viewers.add(queue)
        camera.attached = True
        self.ensure_running(camera)

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
            if not camera.viewers:
                camera.stop_event.set()  # last player left

    async def run(self) -> None:
        async with ClientSession() as session:
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
