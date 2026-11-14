"""Places overlay: one dot per kind of public-facing equipment and exact position, from the INSEE BPE.

Privacy rules, enforced here and checked again by pipeline/check_overlays.py:
- rows in partial diffusion (STATUT_DIFFUSION = P) never become a dot;
- the establishment name is kept only for the kinds marked `named` in kinds.json (public institutions), never for
  doctors, dentists, pharmacies, bakeries or shops, whose name is often a person's;
- nothing else of a row (address, SIRET, capacity...) leaves this module.
"""

from __future__ import annotations

import json
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path

import duckdb

from settling.overlays.names import normalise_name
from settling.proximity import APPROXIMATE_QUALITY, classify_position

KINDS_FILE = Path(__file__).with_name("kinds.json")
PARTIAL_DIFFUSION = "P"
# proximity.classify_position outcome -> the reason the report gives for the skipped row
SKIP_REASONS = {"outside_metropole": "outside_metropole", "skipped_missing_or_invalid_xy": "missing_or_invalid_xy"}


@dataclass(frozen=True)
class PlaceKind:
    id: str
    family: str
    bpe: tuple[str, ...]
    minzoom: int
    named: bool


@dataclass(frozen=True)
class Dot:
    kind: str
    lon: float
    lat: float
    rows: int  # BPE rows of the kind at exactly this position
    approximate: bool  # at least one of them has QUALITE_XY = M
    name: str | None


@dataclass(frozen=True)
class PlacesResult:
    dots: list[Dot]
    rows_skipped: dict[str, int]
    rows_by_kind: dict[str, int]
    names_unusable: dict[str, int]  # named kinds: rows whose name is empty or a '_Z'/'_U' marker


@dataclass
class _Group:
    rows: int = 0
    approximate: bool = False
    names: Counter[str] = field(default_factory=Counter)


def load_kinds(path: Path = KINDS_FILE) -> list[PlaceKind]:
    return [
        PlaceKind(row["id"], row["family"], tuple(row["bpe"]), row["minzoom"], row["named"])
        for row in json.loads(path.read_text(encoding="utf-8"))["places"]
    ]


def read_places(path: Path, kinds: list[PlaceKind], departments: list[str] | None) -> PlacesResult:
    by_code = {code: kind for kind in kinds for code in kind.bpe}
    groups: dict[tuple[str, float, float], _Group] = {}
    skipped: Counter[str] = Counter()
    rows_by_kind: Counter[str] = Counter()
    unusable: Counter[str] = Counter()
    for typequ, name, status, epsg, quality, x, y, lon, lat in _read_rows(path, list(by_code), departments):
        kind = by_code[typequ]
        outcome = classify_position(epsg, quality, x, y)
        if status == PARTIAL_DIFFUSION:
            skipped["partial_diffusion"] += 1
        elif outcome in SKIP_REASONS:
            skipped[SKIP_REASONS[outcome]] += 1
        elif lon is None or lat is None:
            skipped["missing_or_invalid_xy"] += 1
        else:
            rows_by_kind[kind.id] += 1
            group = groups.setdefault((kind.id, lon, lat), _Group())
            group.rows += 1
            group.approximate |= quality == APPROXIMATE_QUALITY
            if kind.named:
                readable = normalise_name(name)
                if readable is None:
                    unusable[kind.id] += 1
                else:
                    group.names[readable] += 1
    order = {kind.id: i for i, kind in enumerate(kinds)}
    dots = [
        Dot(kind_id, lon, lat, group.rows, group.approximate, _most_common(group.names))
        for (kind_id, lon, lat), group in sorted(groups.items(), key=lambda item: (order[item[0][0]], *item[0][1:]))
    ]
    return PlacesResult(dots, dict(sorted(skipped.items())), dict(rows_by_kind), dict(sorted(unusable.items())))


def dot_properties(dot: Dot) -> dict[str, int | str]:
    """The tile properties of a dot: `k`, then `n`, `c` (rows at the position, 2 or more) and `a` when they apply."""
    properties: dict[str, int | str] = {"k": dot.kind}
    if dot.name is not None:
        properties["n"] = dot.name
    if dot.rows >= 2:
        properties["c"] = dot.rows
    if dot.approximate:
        properties["a"] = 1
    return properties


def _read_rows(path: Path, codes: list[str], departments: list[str] | None) -> list[tuple]:
    in_codes = ", ".join(f"'{code}'" for code in codes)
    scope = "AND list_contains(?, DEP)" if departments else ""
    return duckdb.execute(
        f"""SELECT TYPEQU, NOMRS, STATUT_DIFFUSION, EPSG, QUALITE_XY, LAMBERT_X, LAMBERT_Y, LONGITUDE, LATITUDE
        FROM read_parquet('{path.as_posix()}') WHERE TYPEQU IN ({in_codes}) {scope}""",
        [departments] if departments else [],
    ).fetchall()


def _most_common(names: Counter[str]) -> str | None:
    # deliberate: rows at one position with different names (a school complex, a hospital's sites) show the most
    # frequent one, the first alphabetically on a tie; `c` tells the reader that more than one is there.
    return min(names, key=lambda name: (-names[name], name)) if names else None
