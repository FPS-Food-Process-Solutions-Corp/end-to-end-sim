"""Named replacement seams for a future integrated controller."""

from .amr import StubAmr
from .humanoid_mover import StubHumanoidMover
from .lift import StubLift
from .perception import StubPerception
from .platform import StubPlatform
from .vla import StubVla

__all__ = ["StubAmr", "StubHumanoidMover", "StubLift", "StubPerception", "StubPlatform", "StubVla"]
