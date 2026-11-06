"""Pluggable commune indicators.

A layer is one module in this package that defines `LAYER`. The build discovers every such module,
runs `compute` once, merges the returned properties into the commune tiles by INSEE code, records the
provenance in the manifest and lets the plausibility gate check the values (`ranges`, `min_coverage`,
`gate`). Modules never edit `build.py`, so layers can be written and tested independently.

Honesty rule: a commune whose value is unknown is simply absent from `properties`. Never write 0 for
"no data"; 0 is a measurement.
"""

from __future__ import annotations

import importlib
import pkgutil
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
import requests

from settling.boundaries import Area

Value = int | float
Properties = dict[str, dict[str, Value]]


@dataclass(frozen=True)
class LayerContext:
    session: requests.Session
    raw: Path  # download cache directory (gitignored)
    communes: list[Area]
    merged_codes: dict[str, str]  # old commune code -> current code, from the DVF join
    origins: np.ndarray  # (n, 2) Lambert-93 representative point of each commune, same order as `communes`
    overrides: dict[str, Path] = field(default_factory=dict)  # layer name -> local file given with --layer-file

    @property
    def codes(self) -> list[str]:
        return [commune.code for commune in self.communes]


@dataclass(frozen=True)
class LayerResult:
    properties: Properties  # INSEE code -> {tile property: value}; omit unknown values
    source: dict  # provenance: url, edition/date, licence, sha256 of the file used
    report: dict = field(default_factory=dict)  # coverage, quantiles, notes; written to build-report.json


@dataclass(frozen=True)
class Layer:
    name: str  # unique, snake_case; also the key of --layer-file name=path
    fields: dict[str, str]  # tile property -> description (goes into the PMTiles metadata)
    compute: Callable[[LayerContext], LayerResult]
    ranges: dict[str, tuple[Value, Value]] = field(default_factory=dict)  # property -> inclusive (min, max)
    min_coverage: dict[str, float] = field(default_factory=dict)  # property -> least share of communes present
    gate: Callable[[dict[str, dict]], list[str]] | None = None  # extra checks on the published tiles


def discover() -> list[Layer]:
    """Every `LAYER` defined by a module of this package, ordered by name."""
    found = []
    for module_info in pkgutil.iter_modules(__path__):
        module = importlib.import_module(f"{__name__}.{module_info.name}")
        layer = getattr(module, "LAYER", None)
        if layer is not None:
            found.append(layer)
    names = [layer.name for layer in found]
    if len(set(names)) != len(names):
        raise ValueError(f"duplicate layer names: {sorted(names)}")
    return sorted(found, key=lambda layer: layer.name)


def check_properties(layers: list[Layer], communes: dict[str, dict]) -> list[str]:
    """Generic plausibility checks of published commune properties, then each layer's own `gate`."""
    problems: list[str] = []
    total = len(communes)
    for layer in layers:
        for prop, (low, high) in layer.ranges.items():
            values = [c[prop] for c in communes.values() if prop in c]
            outside = [v for v in values if not low <= v <= high]
            if outside:
                problems.append(f"{layer.name}.{prop}: {len(outside)} values outside {low}..{high}, e.g. {outside[:3]}")
        for prop, least in layer.min_coverage.items():
            present = sum(prop in c for c in communes.values())
            if total and present / total < least:
                problems.append(f"{layer.name}.{prop}: present for {present}/{total} communes, expected at least {least:.0%}")
        if layer.gate is not None:
            problems.extend(f"{layer.name}: {issue}" for issue in layer.gate(communes))
    return problems


def merge(properties: Properties, into: dict[str, dict[str, Value]], layer: str) -> None:
    """Merge one layer's properties into the per-commune dictionary; two layers must never write one name."""
    for code, props in properties.items():
        target = into.setdefault(code, {})
        clash = target.keys() & props.keys()
        if clash:
            raise ValueError(f"layer {layer} overwrites {sorted(clash)} of {code}")
        target.update(props)
