from pathlib import Path

import numpy as np
import pytest

from settling.layers import LayerContext, check_properties
from settling.layers import rent_tax
from settling.layers.rent_tax import LAYER, RentEstimate
from settling.sources import SourceError

RENT_HEADER = '"id_zone";"INSEE_C";"LIBGEO";"EPCI";"DEP";"REG";"loypredm2";"lwr.IPm2";"upr.IPm2";"TYPPRED";"nbobs_com";"nbobs_mail";"R2_adj"'
TAX_HEADER = "exercice;insee_com;e12vote;e22;e32vote;e52;e52a;e52tasa;e52ggemapi;taux_global_tfb"


def _estimate(rent: float = 10.0, width: float = 0.5, listings: int = 200, r2: float = 0.8) -> RentEstimate:
    return RentEstimate(rent, rent * (1 - width / 2), rent * (1 + width / 2), listings, r2)


def _rent_row(code: str, rent: str, low: str, high: str, listings: str, r2: str, name: str = "Guéret") -> str:
    return f'"1";"{code}";"{name}";"200034825";"23";"75";{rent};{low};{high};"commune";{listings};600;{r2}'


@pytest.mark.parametrize(
    ("estimate", "rating"),
    [
        (_estimate(), 3),
        (_estimate(listings=99), 2),  # below the source's commune-level estimate
        (_estimate(listings=29), 1),  # guide: fewer than 30 listings is weak
        (_estimate(r2=0.49), 1),  # guide: R2 below 0.5 is weak
        (_estimate(width=0.75), 2),  # wide interval, not solid
        (_estimate(width=1.01), 1),  # interval wider than the estimate
        (_estimate(listings=0), 1),
    ],
)
def test_rent_reliability_follows_documented_thresholds(estimate: RentEstimate, rating: int) -> None:
    assert rent_tax.rent_reliability(estimate) == rating


def test_rent_is_weighted_by_listings_and_rated_by_the_kinds_that_carry_it() -> None:
    flat, house = _estimate(rent=20.0, listings=900), _estimate(rent=10.0, listings=100, r2=0.3)
    rent, rating = rent_tax.combine_rents([flat, house])
    assert rent == pytest.approx(19.0)
    assert rating == 3  # the weak house estimate carries only 10% of the weight
    _, rating = rent_tax.combine_rents([_estimate(listings=600), _estimate(listings=400, r2=0.3)])
    assert rating == 1


def test_rent_without_listings_averages_kinds_equally() -> None:
    rent, rating = rent_tax.combine_rents([_estimate(rent=8.0, listings=0), _estimate(rent=6.0, listings=0)])
    assert (rent, rating) == (pytest.approx(7.0), 1)


def test_rating_falls_back_to_every_estimate_when_none_carries_a_quarter() -> None:
    estimates = [_estimate(listings=0)] * 4 + [_estimate(listings=0, r2=0.9)] * 2
    assert rent_tax.combine_rents(estimates)[1] == 1


def test_read_rent_csv_handles_windows_1252_decimal_commas_and_non_estimable_rows(tmp_path: Path) -> None:
    lines = [
        RENT_HEADER,
        _rent_row("23096", "9,44", "7,63", "11,67", "3753", "0,78"),
        _rent_row("23001", "NA", "NA", "NA", "0", "NA", name="Ahun"),
        _rent_row("23002", "", "5,1", "8,2", "4", "0,7", name="Ajain"),
    ]
    path = tmp_path / "pred.csv"
    path.write_bytes("\r\n".join(lines).encode("cp1252"))
    assert rent_tax.read_rent_csv(path) == {"23096": RentEstimate(9.44, 7.63, 11.67, 3753, 0.78)}


def test_read_tax_csv_checks_that_parts_add_up(tmp_path: Path) -> None:
    path = tmp_path / "tfb.csv"
    path.write_text(
        "\n".join([TAX_HEADER, "2025;75056;20.5;0.0;0.0;0.221;0.156;0.189;0.143;21.21",
                   "2025;23096;46.16;0.0;4.42;0.164;0.0;0.0;0.249;50.99",
                   "2025;69001;24.03;5.47;2.67;0.224;0.0;0.0;0.629;40.0",
                   "2025;69002;;;;;;;;"]),
        encoding="utf-8-sig",
    )
    year, rates, mismatched = rent_tax.read_tax_csv(path)
    assert year == "2025"
    assert rates == {"75056": 21.21, "23096": 50.99, "69001": 40.0}
    assert mismatched == ["69001"]


def test_read_tax_csv_refuses_mixed_years(tmp_path: Path) -> None:
    path = tmp_path / "tfb.csv"
    path.write_text("\n".join([TAX_HEADER, "2025;01001;1;0;0;0;0;0;0;1", "2024;01002;1;0;0;0;0;0;0;1"]), encoding="utf-8")
    with pytest.raises(SourceError, match="one tax year"):
        rent_tax.read_tax_csv(path)


def test_tax_rates_join_by_own_code_then_city_then_agreeing_former_communes() -> None:
    rates = {"23096": 50.99, "75056": 21.21, "69123": 32.82, "01002": 40.01, "01003": 39.98, "02002": 30.0,
             "02003": 35.0}
    merged = {"01002": "01001", "01003": "01001", "02002": "02001", "02003": "02001"}
    codes = ["23096", "75101", "69381", "01001", "02001", "09304"]
    assigned, methods, missing, disagreeing = rent_tax.assign_tax_rates(codes, rates, merged)
    assert assigned == {"23096": 50.99, "75101": 21.21, "69381": 32.82, "01001": 40.01}
    assert methods == {"own_code": 1, "plm_parent": 2, "former_communes": 1}
    assert disagreeing == [{"code": "02001", "rates": {"02002": 30.0, "02003": 35.0}}]
    assert missing == ["09304"]


def test_rents_join_by_own_code_or_combined_former_communes() -> None:
    flats = {"75101": _estimate(rent=35.0), "01002": _estimate(rent=12.0, listings=300),
             "01003": _estimate(rent=8.0, listings=100)}
    houses = {"75101": _estimate(rent=26.0, listings=0)}
    rents, methods, missing = rent_tax.assign_rents(["75101", "01001", "09999"], [flats, houses], {"01002": "01001",
                                                                                                   "01003": "01001"})
    assert rents["75101"] == (pytest.approx(35.0), 3)
    assert rents["01001"] == (pytest.approx(11.0), 3)
    assert methods == {"own_code": 1, "former_communes": 1}
    assert missing == ["09999"]


def test_properties_are_rounded_and_unknown_values_are_absent() -> None:
    properties = rent_tax.build_properties({"23096": (9.4408, 3)}, {"23096": 50.99, "09304x": 39.96})
    assert properties == {"23096": {"rt": 9.4, "rtq": 3, "tf": 51.0}, "09304x": {"tf": 40.0}}


def _published(**overrides: dict) -> dict[str, dict]:
    communes = {f"751{n:02d}": {"rt": 32.0, "rtq": 3, "tf": 21.2} for n in range(1, 21)}
    communes |= {f"23{n:03d}": {"rt": 7.0, "rtq": 1, "tf": 40.0} for n in range(1, 21)}
    communes |= {"69381": {"rt": 17.1, "rtq": 3, "tf": 32.8}, "69264": {"rt": 12.9, "rtq": 3, "tf": 32.5},
                 "23096": {"rt": 9.5, "rtq": 3, "tf": 51.0}}
    return communes | overrides


def test_gate_passes_on_verified_values() -> None:
    assert check_properties([LAYER], _published()) == []


def test_gate_flags_a_wrong_tax_rate_a_missing_one_and_unpaired_reliability() -> None:
    problems = rent_tax.gate(_published(**{"69381": {"rt": 17.1, "rtq": 3, "tf": 30.0}, "23096": {"rt": 9.5}}))
    assert "69381: tf 30.0 != 32.8" in problems
    assert "23096: tf None != 51.0" in problems
    assert any("not paired" in p for p in problems)


def test_gate_flags_implausible_rent_medians_only_with_enough_communes() -> None:
    cheap_paris = {f"751{n:02d}": {"rt": 12.0, "rtq": 3, "tf": 21.2} for n in range(1, 21)}
    assert any(p.startswith("Paris: median rt 12.0") for p in rent_tax.gate(_published(**cheap_paris)))
    assert rent_tax.gate({"75101": {"rt": 12.0, "rtq": 3, "tf": 21.2}}) == []


def test_ranges_cover_the_2025_extremes() -> None:
    assert check_properties([LAYER], {"a": {"rt": 5.7, "rtq": 1, "tf": 4.6}, "b": {"rt": 37.9, "rtq": 3, "tf": 101.1}}) == []


def test_compute_from_override_directory(tmp_path: Path) -> None:
    from shapely.geometry import box

    from settling.boundaries import Area

    for name in rent_tax.RENT_FILES.values():
        rows = [RENT_HEADER, _rent_row("23096", "9,44", "7,63", "11,67", "3753", "0,78"),
                _rent_row("75101", "35,38", "21,90", "57,17", "3451", "0,83", name="Paris 1er")]
        (tmp_path / name).write_bytes("\r\n".join(rows).encode("cp1252"))
    (tmp_path / rent_tax.TAX_FILE).write_text(
        "\n".join([TAX_HEADER, "2025;23096;46.16;0.0;4.42;0.164;0.0;0.0;0.249;50.99",
                   "2025;75056;20.5;0.0;0.0;0.221;0.156;0.189;0.143;21.21"]), encoding="utf-8")
    communes = [Area(code, code, code[:2], box(0, 0, 1, 1)) for code in ("23096", "75101", "23999")]
    ctx = LayerContext(None, tmp_path, communes, {}, np.zeros((3, 2)), {"rent_tax": tmp_path})
    result = LAYER.compute(ctx)
    assert result.properties == {"23096": {"rt": 9.4, "rtq": 3, "tf": 51.0}, "75101": {"rt": 35.4, "rtq": 2, "tf": 21.2}}
    assert result.report["tf"]["by_method"] == {"own_code": 1, "plm_parent": 1}
    assert result.report["rt"]["missing"] == ["23999"]
    assert result.source["tax"]["year"] == "2025"
    assert len(result.source["rent"]["files"]["flat"]["sha256"]) == 64
