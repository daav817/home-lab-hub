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

def blink(cam, title):
    # Blink is cloud-only: a recent snapshot, refreshed by Home Assistant. Tap for details.
    return {"type": "picture-glance", "title": title, "camera_image": f"camera.{cam}", "camera_view": "auto",
            "entities": [{"entity": f"camera.{cam}", "icon": "mdi:cctv"}]}

garage = reolink("garage", "Garage", "mdi:car", "Minivan")
basement = reolink("basement", "Basement", "mdi:stairs", "Stairs")
tiles = [garage, basement,
         blink("front_door", "Front Door"),
         blink("front_porch_and_swings", "Front Porch"),
         blink("parking_lot", "Parking Lot")]

config = {"views": [
    {"title": "All cameras", "path": "all", "type": "panel",
     "cards": [{"type": "grid", "columns": COLUMNS, "square": False, "cards": copy.deepcopy(tiles)}]},
    {"title": "Garage", "path": "garage", "type": "panel", "cards": [copy.deepcopy(garage)]},
    {"title": "Basement", "path": "basement", "type": "panel", "cards": [copy.deepcopy(basement)]},
]}
text = yaml.safe_dump(config, sort_keys=False, width=200)
assert yaml.safe_load(text) == config and "&id" not in text
print(text)
