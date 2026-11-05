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

- **Alsace-Moselle (départements 57, 67, 68) and Mayotte**: these sales are not in DVF (they use a different land register). They are drawn with a neutral cross-hatch and labelled "Hors base DVF". Missing data is never shown as a low price.
- **Overseas départements** other than Mayotte are in DVF but are not on the v1 map.
- **Paris, Lyon, Marseille** appear as their arrondissements, because that is how DVF reports them. Searching the city selects the arrondissement under the map centre.
- **Merged communes**: DVF still uses some pre-merger codes. They are mapped to the current commune through IGN's table of former communes; a build fails if unmatched sales exceed 0.5 %.

## Seismic zone

The regulatory seismic zone of each commune (1 very low to 5 strong, décret 2010-1255) from the Géorisques API. Paris, Lyon and Marseille arrondissements take their city's zone. The few communes unknown to the API take the highest zone of their neighbours. In metropolitan France only zones 1 to 4 occur. This is regulatory zoning for building rules, not a forecast, and it is indicative: it does not replace the legal *état des risques* (ERRIAL) of a property.

## Distances to services

For each commune, the straight-line distance in metres, rounded to 100 m, from one point inside the commune (not its centre) to the nearest facility of each kind in metropolitan France, from the INSEE permanent facilities base (BPE 2025): short-stay hospitals (D101), general practitioners (D265), primary schools (C108 and C109), supermarkets and hypermarkets (B105, B104), bakeries (B207) and swimming pools (F101).

Facilities whose position is approximate (typically within about 500 m) are kept; only facilities without coordinates are left out. These are not travel times, they ignore facilities abroad, one point stands for the whole commune, and the figures hide differences inside large communes.

## Filters

A filter keeps the communes whose value is at or below the limit you set (for example, a hospital within 15 km). Communes that do not meet every active filter are greyed out. A commune with no value for an active criterion does not match it: an unknown is never counted as a pass.

## Known limits

- A median over few sales can be a single sale's price. That is why thin samples are hatched.
- Sale prices are not asking prices and not valuations. The map is not an estimate of any property.
- Averages hide variation inside large communes.
- Prices lag the market by up to a semester plus the time notaries take to file.

## Quality gate

Before tiles are published, `pipeline/check_tiles.py` checks them: 34,000+ communes, 90+ départements, at least 90 % of communes priced, all 20 Paris arrondissements between 7,000 and 16,000 €/m², Creuse median of commune medians under 1,500 €/m², départements 57, 67 and 68 marked no-coverage, and no well-sampled commune under 300 €/m². A failing gate stops publication.
