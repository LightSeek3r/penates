# Methodology: price per m²

What the map shows, how it is computed, and what it cannot tell you. The code is in `pipeline/`; `pipeline/README.md` has the commands. The in-app "Sources et limites" dialog summarises this page.

## Source

DGFiP "Demandes de valeurs foncières" (DVF) via the Etalab geolocated file, five years of notarial sales (Licence Ouverte v2.0). The data is refreshed in April and October with about one semester of lag. Boundaries are IGN Admin Express (Licence Ouverte v2.0).

Under the DGFiP terms of use the data must not be used to re-identify people and must not be search-indexable. The map therefore publishes **aggregates per commune only**: no individual sale appears in the tiles, the repository, or any page.

## Which sales count

For each sale (mutation):

1. Nature is a plain sale ("Vente"). Off-plan sales (VEFA), exchanges, auctions and expropriations are dropped.
2. The sale contains exactly one dwelling, a house or a flat. A dwelling is identified by parcel, type, built surface, room count and first lot number, because the source repeats a row per land use. Sales of several dwellings are dropped, not split.
3. No commercial or industrial premises in the same sale. Cellars, parking and bare land are ignored.
4. Price above zero, built surface at least 9 m², and a price per m² between 200 and 30,000 € (a coarse guard against data-entry errors, not a valuation rule).

Price per m² = sale value ÷ real built surface. For houses the sale value includes the plot, so a house with a large garden shows a higher €/m² than the same house on a small plot.

## What is shown for an area

- **Median** price per m², for all dwellings, houses, or flats.
- **Window**: the 36 months ending at the newest sale in the file. A commune with fewer than 10 sales in 36 months uses 60 months instead if that gives more sales, and the panel says so ("Sur 60 mois").
- **Sales count** behind the median, and the period.
- **Yearly medians** 2021 to 2025 (all dwellings), drawn only for years with at least 5 sales.
- **Reliability**, from the count: 30 or more sales is solid, 10 to 29 fairly solid, 1 to 9 is *indicative* and drawn hatched, 0 means no sale kept and is drawn with dots.

## What is not covered

- **Alsace-Moselle (départements 57, 67, 68) and Mayotte**: these sales are not in DVF (they use a different land register). They are drawn with an amber cross-hatch and labelled "Hors base DVF". Missing data is never shown as a low price.
- **Overseas départements** other than Mayotte are in DVF but are not on the v1 map.
- **Paris, Lyon, Marseille** appear as their arrondissements, because that is how DVF reports them. Searching the city selects the arrondissement under the map centre.
- **Merged communes**: DVF still uses some pre-merger codes. They are mapped to the current commune through IGN's table of former communes; a build fails if unmatched sales exceed 0.5 %.

## Known limits

- A median over few sales can be a single sale's price. That is why thin samples are hatched.
- Sale prices are not asking prices and not valuations. The map is not an estimate of any property.
- Averages hide variation inside large communes.
- Prices lag the market by up to a semester plus the time notaries take to file.

## Quality gate

Before tiles are published, `pipeline/check_tiles.py` checks them: 34,000+ communes, 90+ départements, at least 90 % of communes priced, all 20 Paris arrondissements between 7,000 and 16,000 €/m², Creuse median of commune medians under 1,500 €/m², départements 57, 67 and 68 marked no-coverage, and no well-sampled commune under 300 €/m². A failing gate stops publication.
