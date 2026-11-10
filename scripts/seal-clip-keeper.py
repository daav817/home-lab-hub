"""Makes the clip keeper's random MQTT password and hub API token and seals them where they're
used. Nothing is printed except the files written.

- home-assistant/mqtt-clipkeeper  CLIPKEEPER_PASSWORD  (Mosquitto builds its user from it)
- cameras/clip-keeper-mqtt        MQTT_PASSWORD        (the keeper logs in with it)
- cameras/clip-keeper-api         CLIPS_API_TOKEN      (the keeper checks it)
- hub/hub-clips                   CLIPS_API_TOKEN      (the hub sends it)

Run from the repo root: python scripts/seal-clip-keeper.py
"""

import base64
import json
import pathlib
import secrets
import subprocess

ROOT = pathlib.Path(__file__).resolve().parent.parent
KUBESEAL = ROOT / ".tools" / "kubeseal.exe"
mqtt_password = secrets.token_hex(24)
api_token = secrets.token_hex(32)


def seal(namespace: str, name: str, data: dict[str, str], out: str) -> None:
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
    path = ROOT / out
    path.write_bytes(result.stdout)
    print(f"Saved {out}")


seal("home-assistant", "mqtt-clipkeeper", {"CLIPKEEPER_PASSWORD": mqtt_password},
     "platform/home-assistant/manifests/mqtt-clipkeeper.sealedsecret.yaml")
seal("cameras", "clip-keeper-mqtt", {"MQTT_PASSWORD": mqtt_password},
     "platform/cameras/manifests/clip-keeper-mqtt.sealedsecret.yaml")
seal("cameras", "clip-keeper-api", {"CLIPS_API_TOKEN": api_token},
     "platform/cameras/manifests/clip-keeper-api.sealedsecret.yaml")
seal("hub", "hub-clips", {"CLIPS_API_TOKEN": api_token}, "k8s/hub-clips.sealedsecret.yaml")
