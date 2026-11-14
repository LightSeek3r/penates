"""Seismic isolines: the lines across which the commune zoning rises to level n (see isolines.py)."""

from __future__ import annotations

from settling.boundaries import Area
from settling.overlays.isolines import IsoLines, isolines

SEISMIC_LEVELS = (2, 3, 4, 5)


def seismic_isolines(communes: list[Area], zones: dict[str, int]) -> IsoLines:
    return isolines(communes, zones, SEISMIC_LEVELS)
