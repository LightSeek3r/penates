"""Risk isolines: the lines across which a commune risk class rises to a level, drawn like the seismic zones.

A line at level z marks where the class property rises to at least z. Ground whose communes have no value for the
property is unknown, not class 0: no line is drawn along it (see isolines.py).
"""

from __future__ import annotations

from collections import Counter
from dataclasses import dataclass

from settling.boundaries import Area, department_of
from settling.overlays.commune_classes import CommuneClasses
from settling.overlays.isolines import IsoLines, isolines


@dataclass(frozen=True)
class Risk:
    property: str  # of the `communes` layer
    levels: tuple[int, ...]  # ascending: the classes (cavities: counts) at which a line is drawn


# Mirrors RISK_LINES in app/src/domain/overlays.ts (a test compares them):
# overlay id -> property of the communes layer and levels.
# Radon starts at 2 because class 1 ("low potential") covers most of the Massif central and Brittany.
RISKS: dict[str, Risk] = {
    "flood": Risk("fl", (1, 2, 3)),
    "clay": Risk("cl", (1, 2, 3)),
    "radon": Risk("rn", (2, 3)),
    "cavities": Risk("cv", (1, 5, 25)),
}
SOURCE_PROPERTIES = tuple(risk.property for risk in RISKS.values())


@dataclass(frozen=True)
class RiskLines:
    by_risk: dict[str, IsoLines]  # overlay id -> its lines
    without_value: dict[str, list[str]]  # overlay id -> codes of the boundary communes with no value, ascending
    without_boundary: list[str]  # codes of the archive's communes that no boundary has, ascending


def risk_isolines(communes: list[Area], classes: CommuneClasses) -> RiskLines:
    by_risk = {id_: isolines(communes, classes.values[risk.property], risk.levels) for id_, risk in RISKS.items()}
    without_value = {
        id_: sorted(a.code for a in communes if a.code not in classes.values[risk.property]) for id_, risk in RISKS.items()
    }
    return RiskLines(by_risk, without_value, sorted(classes.communes - {a.code for a in communes}))


def departments_of(codes: list[str]) -> dict[str, int]:
    """How many of the commune codes each department holds, by department code."""
    return dict(sorted(Counter(department_of(code) for code in codes).items()))
