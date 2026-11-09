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

SPINNER = "/local/camera-loading.svg"  # from the Home Assistant config (home-assistant.yaml)
# Round, dark backing so controls on top of the video are easy to see.
ROUND = {"transform": "none", "color": "white", "background": "rgba(0,0,0,0.6)", "border-radius": "50%",
         "padding": "8px", "--mdc-icon-size": "30px"}


def label(entity, prefix, place):
    """Text on the picture: the prefix, then the entity's state."""
    return {"type": "state-label", "entity": entity, "prefix": prefix,
            "style": {"transform": "none", "color": "white", "background": "rgba(0,0,0,0.6)",
                      "padding": "4px 10px", "border-radius": "12px", "font-size": "14px", **place}}


def press(entity, icon, name):
    return {"entity": entity, "icon": icon, "name": name,
            "tap_action": {"action": "perform-action", "perform_action": "button.press",
                           "target": {"entity_id": entity}}}


def blink(cam, title, live):
    """Battery Blink camera. Shows Blink's latest snapshot, so opening the dashboard never wakes
    the camera. Tapping the picture (or Start) wakes it; once Blink is sending video, the tile
    switches to Frigate's live view of it (Frigate joins the session within about 10 seconds
    and records it). Tapping the live picture opens it large.
    Between sessions the tile shows the snapshot again with Continue: Blink ends each session
    after a minute or two, and the bridge waits 2 minutes for Continue (a notification asks)."""
    device = f"{cam}_live_view"
    state = f"sensor.{device}_live_view"
    start = {"action": "perform-action", "perform_action": "button.press",
             "target": {"entity_id": f"button.{device}_start_live_view"}}
    snapshot = {"type": "picture-glance", "title": title, "camera_image": f"camera.{cam}", "camera_view": "auto",
                "tap_action": start,
                "entities": [
                    {"entity": f"camera.{cam}", "icon": "mdi:camera-iris", "name": "New snapshot",
                     "tap_action": {"action": "perform-action", "perform_action": "blink.trigger_camera",
                                    "target": {"entity_id": f"camera.{cam}"}}},
                    press(f"button.{device}_start_live_view", "mdi:play", "Start live view"),
                    press(f"button.{device}_continue_live_view", "mdi:play-pause", "Continue"),
                ]}
    live_card = {"type": "picture-glance", "title": f"{title} (live)", "camera_image": f"camera.{live}",
                 "camera_view": "live", "entity": f"camera.{live}", "tap_action": {"action": "more-info"},
                 "entities": [
                     press(f"button.{device}_stop_live_view", "mdi:stop", "Stop live view"),
                     press(f"button.{device}_continue_live_view", "mdi:play-pause", "Continue"),
                 ]}
    # While Blink wakes the camera (5-25 s): the snapshot with a spinner over it.
    waking = {"type": "picture-elements", "camera_image": f"camera.{cam}", "camera_view": "auto",
              "elements": [
                  {"type": "image", "image": SPINNER, "style": {"top": "45%", "left": "50%", "width": "22%"}},
                  label(state, f"{title}: ", {"bottom": "4%", "left": "4%"}),
                  {"type": "icon", "icon": "mdi:stop", "title": "Stop",
                   "tap_action": press(f"button.{device}_stop_live_view", "mdi:stop", "Stop")["tap_action"],
                   "style": {**ROUND, "bottom": "4%", "right": "4%"}},
              ]}
    return [
        {"type": "conditional", "conditions": [{"condition": "state", "entity": state, "state_not": "live"},
                                               {"condition": "state", "entity": state, "state_not": "starting"}],
         "card": snapshot},
        {"type": "conditional", "conditions": [{"condition": "state", "entity": state, "state": "starting"}],
         "card": waking},
        {"type": "conditional", "conditions": [{"condition": "state", "entity": state, "state": "live"}],
         "card": live_card},
    ]


def live_only(cam, title, device):
    """A camera that's always live through Frigate, like the wired Blink Parking Lot, with its
    controls on the picture: a big light button (tap to switch; the live view pauses a few
    seconds while Blink changes it), night vision, and full screen."""
    return {"type": "picture-elements", "camera_image": f"camera.{cam}", "camera_view": "live",
            "elements": [
                label(f"sensor.{device}_live_view", f"{title} · ", {"bottom": "4%", "left": "4%"}),
                {"type": "icon", "icon": "mdi:fullscreen", "title": "Full screen",
                 "tap_action": {"action": "more-info", "entity": f"camera.{cam}"},
                 "style": {**ROUND, "top": "4%", "right": "4%"}},
                {"type": "state-icon", "entity": f"select.{device}_night_vision", "title": "Night vision",
                 "tap_action": {"action": "more-info"},
                 "style": {**ROUND, "bottom": "4%", "right": "25%"}},
                {"type": "state-icon", "entity": f"switch.{device}_light", "title": "Parking Lot light",
                 "tap_action": {"action": "toggle"},
                 "style": {**ROUND, "--mdc-icon-size": "46px", "bottom": "15%", "right": "4%"}},
                label(f"switch.{device}_light", "Light: ", {"bottom": "4%", "right": "4%"}),
            ]}


garage = reolink("garage", "Garage", "mdi:car", "Minivan")
basement = reolink("basement", "Basement", "mdi:stairs", "Stairs")
tiles = [garage, basement,
         live_only("parking_lot_live", "Parking Lot", "parking_lot_live_view"),
         # Live video comes through Frigate (camera.<name>_live), the same route as the Reolinks.
         *blink("front_door", "Front Door", live="front_door_live"),
         *blink("front_porch_and_swings", "Front Porch", live="front_porch_live")]

config = {"views": [
    {"title": "All cameras", "path": "all", "type": "panel",
     "cards": [{"type": "grid", "columns": COLUMNS, "square": False, "cards": copy.deepcopy(tiles)}]},
    {"title": "Garage", "path": "garage", "type": "panel", "cards": [copy.deepcopy(garage)]},
    {"title": "Basement", "path": "basement", "type": "panel", "cards": [copy.deepcopy(basement)]},
]}
text = yaml.safe_dump(config, sort_keys=False, width=200)
assert yaml.safe_load(text) == config and "&id" not in text
print(text)
