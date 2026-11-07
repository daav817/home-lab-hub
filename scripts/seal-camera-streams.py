"""Makes a new random stream password and Wyze bridge web login, and seals them.
Nothing is printed or saved in plain text.

cameras/camera-streams: the login Frigate uses to read the Neolink and Wyze bridge streams.
cameras/wyze-bridge-web: the Wyze bridge's web page login and API token.

Run from the repo root: python scripts/seal-camera-streams.py
Then restart neolink, wyze-bridge and frigate so they pick up the new values.
"""

import base64
import json
import pathlib
import secrets
import subprocess

ROOT = pathlib.Path(__file__).resolve().parent.parent
KUBESEAL = ROOT / ".tools" / "kubeseal.exe"
OUT = ROOT / "platform" / "cameras" / "manifests"


def token() -> str:
    return secrets.token_urlsafe(32).replace("-", "").replace("_", "")


def seal(name: str, data: dict[str, str]) -> None:
    secret = {
        "apiVersion": "v1",
        "kind": "Secret",
        "type": "Opaque",
        "metadata": {"name": name, "namespace": "cameras"},
        "data": {key: base64.b64encode(value.encode()).decode() for key, value in data.items()},
    }
    result = subprocess.run([str(KUBESEAL), "--format", "yaml"], input=json.dumps(secret).encode(), capture_output=True)
    if result.returncode != 0:
        raise SystemExit("kubeseal failed. Nothing was saved.")
    path = OUT / f"{name}.sealedsecret.yaml"
    path.write_bytes(result.stdout)
    print(f"Saved {path.relative_to(ROOT)}")


seal("camera-streams", {"FRIGATE_RTSP_USER": "frigate", "FRIGATE_RTSP_PASSWORD": token()})
seal("wyze-bridge-web", {"WB_USERNAME": "wbadmin", "WB_PASSWORD": token(), "WB_API": token()})
