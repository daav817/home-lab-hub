"""Blink live-view bridge.

Holds one Blink sign-in and serves each camera's live view as an MPEG-TS stream on a local TCP
port, which go2rtc (in the same pod) turns into RTSP for Frigate and Home Assistant. A live
session only starts when go2rtc connects, which only happens while something is watching.

When Blink ends a session:
- wired cameras reconnect straight away;
- battery cameras announce "waiting" over MQTT and wait up to CONTINUE_WAIT seconds for a
  "continue" message (a button in Home Assistant). The viewer's connection is kept open with
  MPEG-TS null packets meanwhile. Without an answer the view ends, saving battery.

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

    async def publish(self, topic: str, payload: str, retain: bool = True) -> None:
        if self.mqtt:
            with contextlib.suppress(aiomqtt.MqttError):
                await self.mqtt.publish(topic, payload, retain=retain)

    async def set_state(self, camera: Camera, state: str) -> None:
        camera.state = state
        log.info("%s: %s", camera.key, state)
        await self.publish(f"{TOPIC}/{camera.key}/state", state)

    async def announce(self) -> None:
        """Home Assistant discovery: a state sensor for every camera, and a Continue button for
        battery cameras."""
        for camera in self.cameras.values():
            device = {
                "identifiers": [f"blink_live_{camera.key}"],
                "name": f"{camera.name} live view",
                "manufacturer": "Blink",
                "model": "Live view bridge",
            }
            availability = {"topic": f"{TOPIC}/status"}
            await self.publish(
                f"{DISCOVERY}/sensor/blink_live_{camera.key}/state/config",
                json.dumps({
                    "name": "Live view",
                    "unique_id": f"blink_live_{camera.key}_state",
                    "state_topic": f"{TOPIC}/{camera.key}/state",
                    "icon": "mdi:cctv",
                    "availability": availability,
                    "device": device,
                }),
            )
            if not camera.wired:
                await self.publish(
                    f"{DISCOVERY}/button/blink_live_{camera.key}/continue/config",
                    json.dumps({
                        "name": "Continue live view",
                        "unique_id": f"blink_live_{camera.key}_continue",
                        "command_topic": f"{TOPIC}/{camera.key}/continue",
                        "payload_press": "continue",
                        "icon": "mdi:play-circle",
                        "availability": availability,
                        "device": device,
                    }),
                )
            await self.publish(f"{TOPIC}/{camera.key}/state", camera.state)

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
                    await client.subscribe(f"{TOPIC}/+/continue")
                    await client.subscribe(f"{DISCOVERY}/status")
                    async for message in client.messages:
                        topic = str(message.topic)
                        if topic == f"{DISCOVERY}/status" and message.payload == b"online":
                            await self.announce()  # Home Assistant restarted
                            continue
                        key = topic.split("/")[1]
                        if key in self.cameras:
                            log.info("%s: continue requested", key)
                            self.cameras[key].continue_event.set()
            except aiomqtt.MqttError as error:
                log.warning("MQTT connection lost (%s); retrying in 10 seconds", error)
                self.mqtt = None
                await asyncio.sleep(10)

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

    async def one_session(self, camera: Camera, writer: asyncio.StreamWriter, gone: asyncio.Event) -> int:
        """Streams one Blink live session to the viewer. Returns the bytes sent."""
        stream = await self.blink.cameras[camera.name].init_livestream()
        await stream.start("127.0.0.1", 0)
        feed = asyncio.create_task(stream.feed())
        sent = 0
        try:
            host, port = stream.socket.getsockname()[:2]
            reader, local = await asyncio.open_connection(host, port)
            try:
                while not gone.is_set():
                    try:
                        chunk = await asyncio.wait_for(reader.read(65536), timeout=20)
                    except TimeoutError:
                        break
                    if not chunk:
                        break
                    writer.write(chunk)
                    await writer.drain()
                    sent += len(chunk)
            finally:
                local.close()
        finally:
            stream.stop()
            feed.cancel()
            with contextlib.suppress(BaseException):
                await feed
        return sent

    async def wait_to_continue(self, camera: Camera, writer: asyncio.StreamWriter, gone: asyncio.Event) -> bool:
        camera.continue_event.clear()
        await self.set_state(camera, "waiting")
        deadline = time.monotonic() + CONTINUE_WAIT
        while time.monotonic() < deadline and not gone.is_set():
            if camera.continue_event.is_set():
                return True
            writer.write(NULL_PACKET * 7)
            await writer.drain()
            with contextlib.suppress(TimeoutError):
                await asyncio.wait_for(camera.continue_event.wait(), timeout=1)
        return camera.continue_event.is_set() and not gone.is_set()

    async def serve(self, camera: Camera, client: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        if camera.state != "idle" or self.blink is None:
            writer.close()  # one viewer connection per camera; go2rtc shares it
            return
        gone = asyncio.Event()

        async def watch() -> None:
            with contextlib.suppress(Exception):
                while await client.read(1024):
                    pass
            gone.set()

        watcher = asyncio.create_task(watch())
        backoff = 2
        try:
            while not gone.is_set():
                await self.set_state(camera, "live")
                started = time.monotonic()
                try:
                    sent = await self.one_session(camera, writer, gone)
                    log.info("%s: session ended after %.0f s, %d KB", camera.key, time.monotonic() - started, sent // 1024)
                except (ConnectionError, OSError) as error:
                    if gone.is_set():
                        break
                    log.warning("%s: session failed: %s", camera.key, error)
                except Exception:
                    log.exception("%s: session failed", camera.key)
                if gone.is_set():
                    break
                if camera.wired:
                    # Short sessions in a row mean Blink is refusing; slow down.
                    backoff = 2 if time.monotonic() - started > 60 else min(backoff * 2, 300)
                    await asyncio.sleep(backoff)
                elif not await self.wait_to_continue(camera, writer, gone):
                    break
        except (ConnectionError, OSError):
            pass  # viewer left
        finally:
            watcher.cancel()
            writer.close()
            await self.set_state(camera, "idle")

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
