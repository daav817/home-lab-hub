"""Pure decisions for the clip keeper, kept apart so they can be unit tested (test_clip_logic.py)."""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import datetime
from zoneinfo import ZoneInfo

PRE_SECONDS = 5  # clip starts this long before the detection
POST_SECONDS = 5  # and ends this long after it
MIN_SECONDS = 10
MAX_SECONDS = 60

CLIP_ID = re.compile(r"^[A-Za-z0-9_.-]{1,120}$")
GROUP_NAME = re.compile(r"^[\w .,'()&-]{1,60}$")


def clip_window(start: float, end: float | None, covered_until: float = 0.0) -> tuple[float, float] | None:
    """Seconds (start, end) of the clip for a detection that started at `start` and ended at
    `end` (None: still going when the clip had to be cut). The clip begins PRE_SECONDS early,
    ends POST_SECONDS late, lasts MIN..MAX seconds, and never repeats video an earlier clip of
    the same camera already holds (`covered_until`). None if nothing new is left to save."""
    begin = start - PRE_SECONDS
    finish = begin + MAX_SECONDS if end is None else min(end + POST_SECONDS, begin + MAX_SECONDS)
    finish = max(finish, begin + MIN_SECONDS)
    if covered_until > begin:
        begin = covered_until
        if finish - begin < 3:  # only a sliver left: the earlier clip already shows it
            return None
        finish = min(max(finish, begin + MIN_SECONDS), begin + MAX_SECONDS)
    return begin, finish


# Doorbell presses. The Front Door camera is asleep when the button is pressed: Blink wakes it
# (5-25 s) and Frigate joins the stream 10-30 s later, so the clip covers the 90 s after the press.
DOORBELL_SECONDS = 90
DOORBELL_REPEAT = 60  # a press this soon after the last one shares its clip
DOORBELL_GROUP = "Doorbell"  # doorbell clips go in this group, so the size limit never removes them


def doorbell_window(pressed: float) -> tuple[float, float]:
    """Seconds (start, end) of the clip saved for a doorbell press."""
    return pressed - PRE_SECONDS, pressed + DOORBELL_SECONDS


def doorbell_clip_id(pressed: float, previous: tuple[float, str] | None) -> tuple[str, bool]:
    """The clip id for a press at `pressed`, and whether a new clip must be saved. `previous`
    is the last press's (time, clip id): a press within DOORBELL_REPEAT seconds of it reuses that
    clip, which already covers it."""
    if previous and 0 <= pressed - previous[0] < DOORBELL_REPEAT:
        return previous[1], False
    return f"doorbell-{int(pressed)}", True


def cut_due(start: float, end: float | None) -> float:
    """When (epoch seconds) the clip for this detection must be cut even if it hasn't ended."""
    return start - PRE_SECONDS + MAX_SECONDS


def wanted_labels(objects: list[str], labels: set[str]) -> list[str]:
    """The detected objects that trigger a clip, in a stable order."""
    return sorted({o for o in objects if o in labels})


def clip_path(camera: str, start: float, labels: list[str], review_id: str, tz: str) -> str:
    """camera/YYYY-MM-DD/HHMMSS_person-car_<id>.mp4 in local time."""
    when = datetime.fromtimestamp(start, ZoneInfo(tz))
    short = re.sub(r"[^A-Za-z0-9]", "", review_id.split("-")[-1])[:8] or "clip"
    label = "-".join(labels) or "object"
    return f"{camera}/{when:%Y-%m-%d}/{when:%H%M%S}_{label}_{short}.mp4"


@dataclass(frozen=True)
class StoredClip:
    id: str
    created: float
    size: int
    group: str | None


def evictions(clips: list[StoredClip], limit_bytes: int) -> tuple[list[str], bool]:
    """Which clips to delete to get under the limit: oldest first, never one that's in a group.
    Returns (ids to delete, still over the limit afterwards)."""
    used = sum(c.size for c in clips)
    remove: list[str] = []
    for clip in sorted((c for c in clips if c.group is None), key=lambda c: c.created):
        if used <= limit_bytes:
            break
        remove.append(clip.id)
        used -= clip.size
    return remove, used > limit_bytes


def display_name(camera: str) -> str:
    """parking_lot_live -> Parking Lot."""
    name = camera[: -len("_live")] if camera.endswith("_live") else camera
    return name.replace("_", " ").title()


def path_time(path: str, tz: str) -> float | None:
    """The start time encoded in a clip path made by clip_path (for files found on the share)."""
    match = re.match(r"^[^/]+/(\d{4}-\d{2}-\d{2})/(\d{6})_", path)
    if not match:
        return None
    when = datetime.strptime(" ".join(match.groups()), "%Y-%m-%d %H%M%S").replace(tzinfo=ZoneInfo(tz))
    return when.timestamp()
