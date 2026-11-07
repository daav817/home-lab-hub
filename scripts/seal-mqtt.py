"""Makes random MQTT passwords and seals them. Nothing is printed or saved in plain text.

home-assistant/mqtt-users holds all three for the broker. cameras/mqtt-clients holds the ones
Frigate and Neolink use. Rerun to change all the passwords, then re-enter the Home Assistant one
in its MQTT integration.

Run from the repo root: python scripts/seal-mqtt.py
"""

import base64
import json
import pathlib
import secrets
import subprocess

ROOT = pathlib.Path(__file__).resolve().parent.parent
KUBESEAL = ROOT / ".tools" / "kubeseal.exe"

passwords = {name: secrets.token_urlsafe(32).replace("-", "").replace("_", "") for name in ("ha", "frigate", "neolink")}


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


seal(
    "home-assistant",
    "mqtt-users",
    {"HA_PASSWORD": passwords["ha"], "FRIGATE_PASSWORD": passwords["frigate"], "NEOLINK_PASSWORD": passwords["neolink"]},
    ROOT / "platform/home-assistant/manifests/mqtt-users.sealedsecret.yaml",
)
seal(
    "cameras",
    "mqtt-clients",
    {
        "FRIGATE_MQTT_USER": "frigate",
        "FRIGATE_MQTT_PASSWORD": passwords["frigate"],
        "NEOLINK_MQTT_USER": "neolink",
        "NEOLINK_MQTT_PASSWORD": passwords["neolink"],
    },
    ROOT / "platform/cameras/manifests/mqtt-clients.sealedsecret.yaml",
)
