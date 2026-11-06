import pytest

from settling import layers
from settling.layers import Layer, LayerResult, check_properties, merge


def _layer(**kwargs) -> Layer:
    return Layer(name="demo", fields={"x": "demo"}, compute=lambda ctx: LayerResult({}, {}), **kwargs)


def test_discover_has_unique_names() -> None:
    found = layers.discover()
    assert [layer.name for layer in found] == sorted(layer.name for layer in found)


def test_ranges_flag_outliers_only() -> None:
    communes = {"a": {"x": 1}, "b": {"x": 9}, "c": {}}
    assert check_properties([_layer(ranges={"x": (0, 5)})], communes) == ["demo.x: 1 values outside 0..5, e.g. [9]"]


def test_min_coverage_counts_absent_as_missing() -> None:
    communes = {"a": {"x": 1}, "b": {}, "c": {}, "d": {}}
    problems = check_properties([_layer(min_coverage={"x": 0.5})], communes)
    assert problems and "1/4" in problems[0]
    assert check_properties([_layer(min_coverage={"x": 0.25})], communes) == []


def test_layer_gate_is_prefixed_with_layer_name() -> None:
    assert check_properties([_layer(gate=lambda c: ["bad"])], {}) == ["demo: bad"]


def test_merge_refuses_a_property_written_twice() -> None:
    target = {"a": {"x": 1}}
    merge({"a": {"y": 2}, "b": {"y": 3}}, target, "demo")
    assert target == {"a": {"x": 1, "y": 2}, "b": {"y": 3}}
    with pytest.raises(ValueError, match="overwrites"):
        merge({"a": {"x": 5}}, target, "other")
