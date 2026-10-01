from dataclasses import dataclass
from enum import Enum
class Mode(str, Enum):
    NORMAL="normal"
    RECOVERY="recovery"
    HOLD="hold"
@dataclass(frozen=True)
class Observation:
    radio_ready: bool
    normal_profile_present: bool
    normal_connected: bool
    recovery_capable: bool
    recovery_active: bool
    paired_controller_present: bool
@dataclass(frozen=True)
class Decision:
    mode: Mode
    action: str
    reason: str
def decide(o: Observation) -> Decision:
    if not o.radio_ready:
        return Decision(Mode.HOLD, "none", "radio_or_driver_unavailable")
    if o.normal_connected:
        return Decision(Mode.NORMAL, "keep_normal", "normal_link_healthy")
    if o.normal_profile_present:
        return Decision(Mode.NORMAL, "try_saved_profile_once", "saved_profile_available")
    if not o.recovery_capable:
        return Decision(Mode.HOLD, "none", "no_recovery_transport")
    if not o.paired_controller_present:
        return Decision(Mode.HOLD, "none", "recovery_requires_paired_controller")
    if o.recovery_active:
        return Decision(Mode.RECOVERY, "keep_recovery", "recovery_link_active")
    return Decision(Mode.RECOVERY, "start_private_recovery", "normal_unavailable")
def secret_policy(image_contains_shared_secret: bool, device_unique_secret: bool) -> bool:
    return (not image_contains_shared_secret) and device_unique_secret
