"""Builds the Home Assistant Cameras dashboard.

Add a camera to `tiles` (reolink() for cameras with pan/tilt through Neolink, blink() for Blink),
change COLUMNS to fit more per row, then run:
    python scripts/make-cameras-dashboard.py > cameras-dashboard.yaml
and paste the output into the dashboard's Raw configuration editor.
"""
import copy, yaml

COLUMNS = 4  # 4 across x 2 rows = 8 cameras before scrolling. Change this to fit more.

def reolink(cam, title, preset_icon, preset_name):
    def arrow(direction, icon):
        return {"entity": f"button.{cam}_{cam}_pan_{direction}", "icon": icon,
                "tap_action": {"action": "perform-action", "perform_action": "mqtt.publish",
                               "data": {"topic": f"neolink/{cam}/control/ptz", "payload": f"{direction} 4"}}}
    preset = {"entity": f"camera.{cam}", "icon": preset_icon, "name": preset_name,
              "tap_action": {"action": "perform-action", "perform_action": "mqtt.publish",
                             "data": {"topic": f"neolink/{cam}/control/ptz/preset", "payload": "1"}}}
    return {"type": "picture-glance", "title": title, "camera_image": f"camera.{cam}", "camera_view": "live",
            "entities": [arrow("left", "mdi:arrow-left"), arrow("up", "mdi:arrow-up"),
                         arrow("down", "mdi:arrow-down"), arrow("right", "mdi:arrow-right"), preset]}

def press(entity, icon, name):
    return {"entity": entity, "icon": icon, "name": name,
            "tap_action": {"action": "perform-action", "perform_action": "button.press",
                           "target": {"entity_id": entity}}}


def controls(device):
    """Light switch (tap toggles) and night vision selector (tap to choose)."""
    return [{"entity": f"switch.{device}_light", "name": "Light"},
            {"entity": f"select.{device}_night_vision", "name": "Night vision", "tap_action": {"action": "more-info"}}]


def blink(cam, title, live):
    """Battery Blink camera. Shows Blink's latest snapshot, so opening the dashboard never wakes
    the camera. Start wakes it; once Blink is sending video the tile switches to live video
    (the Generic Camera `live`) with Stop and Continue. Continue keeps watching when Blink ends
    a session (a notification asks)."""
    device = f"{cam}_live_view"
    state = f"sensor.{device}_live_view"
    snapshot = {"type": "picture-glance", "title": title, "camera_image": f"camera.{cam}", "camera_view": "auto",
                "entities": [
                    {"entity": f"camera.{cam}", "icon": "mdi:camera-iris", "name": "New snapshot",
                     "tap_action": {"action": "perform-action", "perform_action": "blink.trigger_camera",
                                    "target": {"entity_id": f"camera.{cam}"}}},
                    press(f"button.{device}_start_live_view", "mdi:play", "Start live view"),
                    *controls(device),
                ]}
    live_card = {"type": "picture-glance", "title": f"{title} (live)", "camera_image": f"camera.{live}",
                 "camera_view": "live",
                 "entities": [
                     press(f"button.{device}_stop_live_view", "mdi:stop", "Stop live view"),
                     press(f"button.{device}_continue_live_view", "mdi:play-pause", "Continue"),
                     *controls(device),
                 ]}
    return [
        {"type": "conditional", "conditions": [{"condition": "state", "entity": state, "state_not": ["live", "waiting"]}],
         "card": snapshot},
        {"type": "conditional", "conditions": [{"condition": "state", "entity": state, "state": ["live", "waiting"]}],
         "card": live_card},
    ]


def live_only(cam, title, device):
    """A camera that's always live through Frigate, like the wired Blink Parking Lot."""
    return {"type": "picture-glance", "title": title, "camera_image": f"camera.{cam}", "camera_view": "live",
            "entities": [{"entity": f"camera.{cam}", "icon": "mdi:cctv"}, *controls(device)]}


garage = reolink("garage", "Garage", "mdi:car", "Minivan")
basement = reolink("basement", "Basement", "mdi:stairs", "Stairs")
tiles = [garage, basement,
         live_only("parking_lot_live", "Parking Lot", "parking_lot_live_view"),
         # The Generic Camera live views were named by Home Assistant after the bridge's address:
         # the first is front_door, the "_2" one is front_porch (see their stream URLs).
         *blink("front_door", "Front Door", live="blink_bridge_cameras_svc_cluster_local"),
         *blink("front_porch_and_swings", "Front Porch", live="blink_bridge_cameras_svc_cluster_local_2")]

config = {"views": [
    {"title": "All cameras", "path": "all", "type": "panel",
     "cards": [{"type": "grid", "columns": COLUMNS, "square": False, "cards": copy.deepcopy(tiles)}]},
    {"title": "Garage", "path": "garage", "type": "panel", "cards": [copy.deepcopy(garage)]},
    {"title": "Basement", "path": "basement", "type": "panel", "cards": [copy.deepcopy(basement)]},
]}
text = yaml.safe_dump(config, sort_keys=False, width=200)
assert yaml.safe_load(text) == config and "&id" not in text
print(text)
