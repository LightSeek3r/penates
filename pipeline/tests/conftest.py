from pathlib import Path

import duckdb
import pytest
from shapely.geometry import box

from settling.boundaries import Area, Boundaries, assemble_communes
from settling.clean import CleanResult, clean_sales

FIXTURE_CSV = Path(__file__).parent / "fixtures" / "dvf_sample.csv"


@pytest.fixture
def con() -> duckdb.DuckDBPyConnection:
    connection = duckdb.connect()
    yield connection
    connection.close()


@pytest.fixture
def cleaned(con: duckdb.DuckDBPyConnection) -> CleanResult:
    return clean_sales(con, FIXTURE_CSV, departments=None)


@pytest.fixture
def boundaries() -> Boundaries:
    communes = [
        Area("01001", "Alpha", "01", box(4.9, 45.9, 5.05, 46.05)),
        Area("01002", "Beta", "01", box(5.05, 46.05, 5.15, 46.15)),
        Area("01003", "Gamma", "01", box(5.2, 46.2, 5.3, 46.3)),
        Area("01004", "Delta (no sales)", "01", box(5.4, 46.4, 5.5, 46.5)),
        Area("75056", "Paris", "75", box(2.2, 48.8, 2.5, 48.9)),
        Area("57001", "Moselle One", "57", box(6.0, 49.0, 6.1, 49.1)),
    ]
    arrondissements = [Area("75101", "Paris 1er Arrondissement", "75", box(2.33, 48.85, 2.36, 48.87))]
    departments = [
        Area("01", "Ain", "01", box(4.9, 45.9, 5.5, 46.5)),
        Area("57", "Moselle", "57", box(6.0, 49.0, 6.1, 49.1)),
        Area("75", "Paris", "75", box(2.2, 48.8, 2.5, 48.9)),
    ]
    return Boundaries(
        communes=assemble_communes(communes, arrondissements),
        departments=departments,
        merged_codes={"01099": "01003"},
    )
