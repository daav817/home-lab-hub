"""Makes a random MQTT password for the Blink bridge and seals it twice: for Mosquitto
(home-assistant/mqtt-blink) and for the bridge (cameras/blink-mqtt). Nothing is printed.

Run from the repo root: python scripts/seal-mqtt-blink.py
"""

import base64
import json
import pathlib
import secrets
import subprocess

ROOT = pathlib.Path(__file__).resolve().parent.parent
KUBESEAL = ROOT / ".tools" / "kubeseal.exe"
password = secrets.token_urlsafe(32).replace("-", "").replace("_", "")


def seal(namespace: str, name: str, data: dict[str, str], out: pathlib.Path) -> None:
    secret = {
        "apiVersion": "v1",
        "kind": "Secret",
        "type": "Opaque",
        "metadata": {"name": name, "namespace": namespace},
        "data": {key: base64.b64encode(value.encode()).decode() for key, value in data.items()},
    }
    result = subprocess.run([str(KUBESEAL), "--format", "yaml"], input=json.dumps(secret).encode(), capture_output=True)
    if result.returncode != 0:
        raise SystemExit("kubeseal failed. Nothing was saved.")
    out.write_bytes(result.stdout)
    print(f"Saved {out.relative_to(ROOT)}")


seal("home-assistant", "mqtt-blink", {"BLINK_PASSWORD": password},
     ROOT / "platform/home-assistant/manifests/mqtt-blink.sealedsecret.yaml")
seal("cameras", "blink-mqtt", {"MQTT_PASSWORD": password},
     ROOT / "platform/cameras/manifests/blink-mqtt.sealedsecret.yaml")
