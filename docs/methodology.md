# Methodology: price per m² and the other indicators

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

## Rules shared by every other indicator

- **One value per commune** (per arrondissement in Paris, Lyon and Marseille). Nothing on the map describes a street, a building or a plot.
- **Unknown is absent, never 0.** When a source has no figure for a commune, the commune simply has no value: it is drawn in the "Pas de donnée" colour, its details panel leaves the line out, and it never passes a filter. A 0 on the map is a measurement (for example "no cavity recorded").
- **Merged communes** take the values of their former communes when the source still lists those separately. For risks the highest value wins; how other indicators combine them is stated in their section.
- **Editions.** Some sources are pinned in the code (the BPE, the clay map, the fibre quarter, the crime and rent editions): moving to a newer one is a deliberate change, re-checked against spot values. The others are read at build time (GASPAR, radon, climate sheets, terrain services, latest tax year). Either way, the edition or download date and a checksum are recorded in the build manifest.
- **Metropolitan France and Corsica only**, like the price map.

## Risks: seismic zone, flood, clay, radon, cavities

These are screening indicators. They say whether a question is worth asking about a commune, not what the answer is for a given home. They are offered as filters, listed in the details panel and drawn as overlays (see Overlays); they are not colours of the map. None of them replaces the legal risk statement (*état des risques*, ERRIAL) that comes with a sale or a lease, and none describes your plot.

### Seismic zone

The regulatory seismic zone of each commune (property `sz`, 1 very low to 5 strong, décret 2010-1255) from the Géorisques API. Paris, Lyon and Marseille arrondissements take their city's zone. The few communes unknown to the API take the highest zone of their neighbours. In metropolitan France only zones 1 to 4 occur. This is regulatory zoning for building rules, not a forecast, and it is indicative: it does not replace the legal *état des risques* (ERRIAL) of a property.

### Flood

**In plain words**: how far the State has gone in recording flood risk in the commune, from "nothing recorded" to "an approved flood prevention plan".

- **What is measured** (property `fl`): the highest step reached in the commune. Every flood type counts, coastal flooding included; plans that were cancelled, repealed or withdrawn are ignored.
  - **3**: a flood risk prevention plan (PPRi, or PPRL for coastal flooding) is in force: approved, or applied ahead of approval;
  - **2**: such a plan has been prescribed (ordered, not yet approved);
  - **1**: flood-prone areas are mapped in a flood atlas (AZI), or flooding is listed for the commune in the departmental major-risk file (DDRM);
  - **0**: the commune is known to GASPAR and none of the above is recorded.
- **Source**: GASPAR (administrative procedures on risks), Ministère de la Transition écologique / Géorisques, file `gaspar.zip`; the edition is the date in its file names, recorded in the build manifest. Licence Ouverte v2.0.
- **Unknown**: a commune that appears in no GASPAR table has no value. Paris, Lyon and Marseille arrondissements take the city's record when GASPAR only knows the city.
- **Limits**: this is the state of the paperwork for the whole commune, not the water depth at an address. A commune with an approved plan may have most of its homes well outside the flood zone; a 0 is not proof of safety, it means nothing is recorded.

### Clay shrink-swell

**In plain words**: whether clay soils that swell when wet and shrink in droughts, cracking houses, cover a large part of the commune.

- **What is measured** (property `cl`): the highest exposure level that, together with the levels above it, covers **at least a quarter (25 %)** of the commune's area: **0** a priori nil (no clay mapped), **1** low, **2** medium, **3** high. Example: 20 % high and 10 % medium gives 2.
- **Source**: BRGM, "Retrait-gonflement des argiles, carte d'exposition 2026" (arrêté du 9 janvier 2026), one file per département published on Géorisques (files dated 2025-11-28). Licence Ouverte v2.0, as stated on georisques.gouv.fr.
- **Unknown**: the city of Paris is not covered by the BRGM map, so its 20 arrondissements have no value.
- **Limits**: a commune rated 1 can contain high-exposure streets covering less than a quarter of its area, and the reverse. Exposure at a plot is read on the BRGM map itself; the soil study required before building is what counts.

### Radon

**In plain words**: how likely the ground under the commune is to release radon, a natural radioactive gas that can build up indoors.

- **What is measured** (property `rn`): the commune's radon potential category under the arrêté du 27 juin 2018: **1** low, **2** low but with geological factors that can ease the gas's transfer to buildings, **3** significant on at least part of the commune.
- **Source**: ASNR (formerly IRSN), "Connaître le potentiel radon de ma commune", on data.gouv.fr; the resource date is recorded in the build manifest. Licence Ouverte v1.0.
- **Unknown**: communes missing from the file have no value; arrondissements take their city's category when only the city is listed.
- **Limits**: the category describes the geology, not a home. Only a measurement inside the dwelling gives the real exposure.

### Underground cavities

**In plain words**: how many old quarries, cellars, man-made underground works or natural cavities are known in the commune.

- **What is measured** (property `cv`): the number of cavities recorded in the BRGM inventory (BDCavités) for the commune. A cavity is attributed by the commune code entered in the inventory, by its current commune after a merger, or else by its coordinates.
- **Source**: BRGM / Géorisques, "Inventaire des cavités souterraines (BDCavités)", one export per département. Licence Ouverte v2.0, as stated on georisques.gouv.fr.
- **Unknown**: the inventory is not published on Géorisques for Paris and the Île-de-France départements 78, 91, 92, 93, 94 and 95, nor for any département whose export is empty: those communes have no value, not 0. When a Paris, Lyon or Marseille record has no coordinates, it cannot be placed in an arrondissement and that city's arrondissements stay without a value.
- **Limits**: the inventory is incomplete and uneven between départements; **0 means none recorded, not none present**. A count says nothing about size, depth or whether a cavity has been filled.

## Altitude and relief

**In plain words**: how high the town centre is, and how hilly the commune is.

- **Altitude** (property `alt`, metres): ground altitude at the commune's chef-lieu point (where the town hall and main settlement are), from IGN ADMIN EXPRESS, same edition as the boundaries. A commune without a chef-lieu point (the uninhabited "villages morts" of the Meuse), or whose point has no terrain value, uses the point inside its polygon that the distances use.
- **Relief** (property `rel`, metres): highest minus lowest ground altitude among the 25 m grid cells whose centres fall inside the commune.
- **Source**: IGN RGE ALTI (bare-ground terrain model, NGF altitudes), read through the Géoplateforme altimetry API (altitude) and WMS-R raster service (relief). Licence Ouverte v2.0. The query date is recorded in the build manifest.
- **Unknown**: altitude is absent when no reference point has a terrain value; relief is absent when fewer than 16 grid cells (1 ha) fall inside the commune.
- **Limits**: in a large mountain commune the altitude of the centre says little about its hamlets. The 25 m grid slightly flattens summits and gorges (Mont Blanc reads 4,775 m instead of 4,806 m), so relief is a slight underestimate. The commune outlines are simplified, so cells along a border can belong to a neighbour. Relief is not the slope of your plot.

## Climate: sunshine and hot days

**In plain words**: how sunny and how hot the area was on average over 1991-2020, estimated from the nearest weather stations.

- **What is measured**:
  - **Sunshine** (property `sun`): mean annual sunshine duration, in hours, rounded to 10 h;
  - **Hot days** (property `hot`): mean number of days per year with a maximum temperature of 30 °C or more, rounded to a whole day.
- **Source**: Météo-France, "Fiches climatologiques" on data.gouv.fr (one sheet per station with its 1991-2020 statistics, re-edited monthly; the sheet dates are recorded in the build manifest). Licence Ouverte v2.0. A station's value is used only if its statistics period lies within 1991-2020 and spans at least 25 years: a short, recent record would overstate hot days in a warming climate. Altitudes of the target points come from IGN RGE ALTI.
- **How a commune gets a value**: climate is measured at stations, not in communes, so every value is an **interpolation**. The target point is the chef-lieu (else the inner point). The value is an inverse-square-distance weighted mean of the **5 nearest stations** within a cutoff of **80 km for sunshine** (stations are about ten times fewer) and **50 km for hot days**. Distance counts altitude too: each 100 m of altitude difference weighs like 20 km of horizontal distance, so stations at a similar height are preferred. No temperature-altitude correction is applied to the values.
- **Station distance** (property `cd`): the horizontal distance in km from the target point to the nearest station used (the larger of the two when both values exist). The details panel shows it next to the climate values: the larger it is, the rougher the estimate.
- **Unknown**: with no usable station within the cutoff, the value is absent. This is common in mountain départements (sunshine is missing for most of Corsica, for instance). In the national build of 2026-11-06 sunshine covered 94.7 % and hot days 99.6 % of communes.
- **Limits**: a regional trend, not the shade of your street or a valley's microclimate. These are past averages, not a projection.

**Coming: hot days around 2050.** The app already lists a "Jours de chaleur vers 2050" theme (property `h50`), for a France warmed by 2.7 °C under the reference warming trajectory (TRACC). The data is **not yet produced**: the Météo-France files are published only in an archive format the build cannot download yet. Until then every commune shows "Pas de donnée" for this theme and a filter on it matches no commune.

## Distances to services

For each commune, the straight-line distance in metres, rounded to 100 m, from one point inside the commune (not its centre) to the nearest facility of each kind in metropolitan France and Corsica, from the INSEE permanent facilities base (BPE 2025, geography at 2025-01-01). They are offered as filters and listed in the details panel; the facilities themselves can be shown as dots (see Overlays). The facility types (BPE codes) are:

| Facility | Property | BPE codes |
| --- | --- | --- |
| Hospital (short-stay) | `d_hos` | D101 |
| General practitioner | `d_gp` | D265 |
| Pharmacy (dispensing doctors included) | `d_pha` | D307 |
| Dentist | `d_den` | D277 |
| Crèche (childcare centre or micro-crèche) | `d_cre` | D502, D509 |
| Primary school | `d_sch` | C108, C109 |
| Collège (lower secondary) | `d_col` | C201 |
| Lycée (general, technological, vocational, agricultural, and their general and vocational sections) | `d_lyc` | C301, C302, C303, C304, C305 |
| Supermarket or hypermarket | `d_sup` | B104, B105 |
| Bakery | `d_bak` | B207 |
| Post office (post office, relais poste, agence postale) | `d_pos` | A206, A207, A208 |
| Swimming pool | `d_pool` | F101 |
| Railway station (SNCF passenger station of national, regional or local interest) | `d_gar` | E107, E108, E109 |

Parent-child meeting places and childcare information offices (D503, D504) are not crèches and are left out. Facilities whose position is approximate (INSEE quality "M": the street is only probable, or the point can be 500 m or more off, but still in the right commune) are kept; only facilities without valid coordinates are left out.

- **Unknown**: every commune gets a distance for every type, since each type exists in the BPE.
- **Limits**: these are not travel times; a river, a motorway or a mountain can make the real trip much longer. One point stands for the whole commune, so the figures hide differences inside large communes. Facilities abroad are ignored, which lengthens distances near the borders. The BPE says a facility exists, not that it takes new patients or pupils, nor how often trains stop at a station.

## Internet: fibre

**In plain words**: the share of homes and business premises in the commune where a fibre-to-the-home connection can be ordered.

- **What is measured** (property `fb`, %): premises eligible to fibre to the home (FttH) ÷ all premises (dwellings plus business premises) in ARCEP's building base, rounded to a whole percent. 0 and 100 mean exactly none and exactly all; a share that would round to 0 or 100 without being exact is shown as 1 or 99.
- **Source**: ARCEP, "Ma connexion internet" communal statistics, quarter **2026 T2** (data at 2026-06-30). Paris, Lyon and Marseille are published only as whole cities there, so their arrondissements use ARCEP's FttH deployment observatory (cartefibre) of the same quarter: connectable premises ÷ estimated premises. The two publications agree within 0.4 point for the three cities. Licence Ouverte v2.0.
- **Unknown**: a commune with no premises in the source (uninhabited villages, or a commune restored after a merger whose premises are still counted in the former merged commune) has no value; 7 metropolitan communes in 2026 T2. A merged commune whose former communes are still separate rows takes their summed counts.
- **Limits**: eligible is not subscribed, and not a promise of a speed or of a free connection: the last section to the home may still have to be built. The figure says nothing about mobile coverage or other technologies.

## Recorded crime (only on request)

**In plain words**: how many violent offences and home burglaries the police and gendarmerie recorded, for the size of the commune. These themes are **hidden by default**: they appear only after ticking "Afficher la délinquance enregistrée". That choice stays in your browser and is never sent; these themes and filters are never counted in the usage statistics.

- **What is measured**, each as the mean of the annual rates over the **latest 3 years of the base (2023-2025)**, one decimal:
  - **Violence** (property `cr_v`): victims of recorded physical violence (within the family and outside it) and of sexual violence, per 1,000 residents per year. Armed and violent robberies are not included: the SSMSI counts them in offences, not victims, and warns against adding indicators of different units;
  - **Burglary** (property `cr_b`): recorded home burglaries per 1,000 dwellings per year (INSEE census dwellings, second homes and vacant dwellings included), the base's own denominator.
- **Source**: SSMSI (statistical service of the Ministère de l'Intérieur), "Base statistique communale de la délinquance enregistrée par la police et la gendarmerie nationales", edition of July 2026 (years 2016-2025, geography at 2026-01-01). Licence Ouverte v2.0. Offences are counted where they were committed. Paris, Lyon and Marseille arrondissements have their own rows.
- **Unknown**: the SSMSI withholds communes that did not record more than 5 facts in 3 successive years (statistical secrecy); a value is shown only if every figure behind it was published for each of the 3 years. On top of that, no value is shown for communes under **1,000 residents**: their rates swing on one or two facts. Withheld communes have no value, never 0. A published 0 is a real 3-year zero.
- **Limits**: **recorded offences are not crime as it happens**. The figures depend on how readily victims report and on police activity as much as on actual crime, and they say nothing about the risk to a given person. Rates per resident overstate places whose daytime population far exceeds the residents (city centres, retail zones, stations, resorts).

## Housing costs: rent and land tax

### Indicative rent

**In plain words**: what a typical rental home is advertised for in the commune, per m² per month.

- **What is measured** (property `rt`, €/m²/month, one decimal): the predicted asking rent, charges included, unfurnished, for a reference flat (52 m²) and a reference house (92 m²) let in Q3 2025. The source has no "all housing" figure, so the map weighs the flat and house predictions by the number of listings of each kind in the commune itself (equal weights when there is none).
- **Reliability** (property `rtq`), following the source's own advice: **1 weak** when the model's adjusted R² is under 0.5, or the commune has fewer than 30 listings, or the 95 % prediction interval is wider than the rent itself; **3 solid** with at least 100 listings in the commune (estimated at commune level), R² at least 0.5 and an interval no wider than 70 % of the rent; **2** otherwise. The rating of `rt` is the lowest among the estimates carrying at least a quarter of its weight. Weak values are hatched on the map and marked "estimation fragile" in the details panel.
- **Source**: "Carte des loyers" 2025 (Ministère chargé du logement / ANIL, data.gouv.fr), from leboncoin and SeLoger listings 2019-2025, communes at 2025-01-01. Licence Ouverte v2.0. Required credit: « Estimations ANIL, à partir des données du Groupe SeLoger et de leboncoin ».
- **Unknown**: a commune without a prediction has no value. A merged commune whose former communes are still listed separately takes their listing-weighted rent.
- **Limits**: **asking rents from listings, not signed leases**, and a model estimate, not the rent of a given home. Below 100 listings the estimate leans on a wider area than the commune.

### Land-tax rate

**In plain words**: the total property-tax rate (taxe foncière on built property) voted for the commune, as a percentage.

- **What is measured** (property `tf`, %, one decimal): DGFiP's global built-property rate, the sum of the commune's voted rate (which since 2021 includes the former département rate), syndicates of communes, the intercommunality, special equipment taxes, the Île-de-France TASARIF and GEMAPI. Not included: the household-waste collection tax (TEOM), the State's management fees added to the bill, and the smoothing rates of communes nouvelles still converging (the voted rate is shown).
- **Source**: DGFiP, "Fiscalité locale des particuliers" on data.economie.gouv.fr, from the REI (fichier de recensement des éléments d'imposition), latest year available (2025 when checked on 2026-11-06). Licence Ouverte v2.0.
- **Unknown**: a merged commune takes its former communes' rate only if they all share it to one decimal; otherwise it has no value. Paris, Lyon and Marseille arrondissements take their city's single rate.
- **Limits**: **the rate is not the bill**. It applies to a base (half the cadastral rental value) that differs for every home, so two homes in the same commune can pay very different amounts.

## Overlays: risk lines and places

Overlays are drawn over whichever colour is chosen, and any number can be on at once. Nothing is on by default. An overlay the loaded data does not carry is not offered. Overlays are switched on in the Overlays tab and listed in the legend; they are part of the link (`ov=` in the address).

### Places

**In plain words**: where hospitals, doctors, schools, shops, stations, pools, cinemas and libraries are, one dot per place.

- **Source**: the INSEE permanent facilities base (BPE 2025, geography at 2025-01-01), the same file as the distances above, at each facility's own position. Licence Ouverte v2.0. The kinds and their BPE codes:

| Overlay | `k` | BPE codes | Name shown |
| --- | --- | --- | --- |
| Hospitals and clinics (short stay) | `hos` | D101 | yes |
| General practitioners | `gp` | D265 | no |
| Pharmacies | `pha` | D307 | no |
| Dentists | `den` | D277 | no |
| Crèches and micro-crèches | `cre` | D502, D509 | no |
| Nursery schools | `mat` | C107 | yes |
| Primary schools | `pri` | C108, C109 | yes |
| Collèges | `col` | C201 | yes |
| Lycées | `lyc` | C301, C302, C303, C304, C305 | yes |
| Universities and grandes écoles | `uni` | C501, C502, C503, C504, C505 | yes |
| Supermarkets and hypermarkets | `sup` | B104, B105 | no |
| Bakeries | `bak` | B207 | no |
| Post offices and relays | `pos` | A206, A207, A208 | yes |
| Train stations | `sta` | E107, E108, E109 | yes |
| Swimming pools | `pool` | F101 | yes |
| Cinemas | `cin` | F303 | yes |
| Libraries | `lib` | F307 | yes |

- **What a dot carries** (layer `places` of `overlays.pmtiles`): `k` the kind, `n` the name for the kinds marked "yes" above, `c` how many facilities of the kind share that exact position (only when 2 or more: they are collapsed into one dot), `a` = 1 when INSEE marks the position approximate (quality "M": the street is only probable, or the point can be 500 m or more off, but still in the right commune). The place card says "Position approximate" for those.
- **What is left out**: rows in partial diffusion (INSEE's `STATUT_DIFFUSION = P`, published without full detail) never become a dot; nor do facilities without valid coordinates or outside metropolitan France and Corsica. Nothing else of a row (address, SIRET number, capacity) leaves the build.
- **Names**: kept only for public-facing institutions (hospitals, schools, post offices, stations, pools, cinemas, libraries), in title case and cut at 60 characters. Doctors, dentists, pharmacies, crèches, supermarkets and bakeries never carry a name, because the name of a practice or a shop is often a person's. No individual is named anywhere.
- **Zoom**: dots appear by zoom so the national view stays readable: hospitals from zoom 6, universities and stations from 7, collèges, lycées, pools and cinemas from 8, supermarkets and libraries from 9, the rest from 10.
- **Limits**: the BPE says a facility exists, not that it takes new patients or pupils, nor its opening hours. **Swimming pools** include private ones (fitness clubs, for example), because the source cannot tell public pools from private ones. A missing dot is not proof that there is no such place.

### Seismic zone lines

**In plain words**: lines where the regulatory seismic zone rises, drawn from the zone of each commune.

- **What is drawn** (layer `seismic`, property `z`): for each zone from 2 to 5, the boundary of the area made of the communes in that zone or above. `z` is the zone the ground rises to across the line. Stretches along the coast and the national border are left out, since the zone does not change there. In metropolitan France only lines into zones 2, 3 and 4 occur.
- **Source**: the commune zoning of Géorisques described under Seismic zone (`sz`), on the IGN commune outlines. Licence Ouverte.
- **Limits**: the line follows commune boundaries because the zoning is set per commune; it is not a fault line and does not describe your plot. Like the zone itself, it does not replace the legal *état des risques* (ERRIAL).

### Risk lines for flood, clay, radon and cavities

**In plain words**: lines where the commune-level value of one of these four risks rises to a level, drawn like the seismic zone lines.

- **What is drawn** (layer `risk` of `overlays.pmtiles`, properties `r` and `z`): `r` is the risk (`flood`, `clay`, `radon` or `cavities`) and `z` the level the value rises to across the line. For each level, the line is the boundary of the area made of the communes whose value is that level or above, from the commune values described in the Risks section (`fl`, `cl`, `rn`, `cv`). The levels are flood stage 1, 2 and 3; clay class 1, 2 and 3; radon category 2 and 3 (category 1, "low potential", covers most of the Massif central and Brittany and is not drawn); and for cavities 1, 5 and 25 known. A heavier line is a higher level. Stretches along the coast and the national border are left out, since the value does not change there. Clay and cavity lines start at zoom 7: both are scattered over many small groups of communes, and in the country view they only made noise. The legend names each level with the class names of the details panel.
- **No data**: a commune with no value for a risk is unknown, never a lower class: no line is drawn along it, and no line is not proof of safety.
- **Limits**: the values are per commune, so a line follows commune borders and is never the edge of a flood zone, a clay area or a cavity; a commune at the edge of a line may be only partly affected. The inventory of cavities is incomplete. These stay screening indicators: none replaces the ERRIAL. They are no longer offered as colours; they remain filters and are listed in the details panel.

## Filters

A filter keeps the communes whose value is within the limit you set: at most a value (for example a hospital within 15 km), at least a value (sunshine, fibre), or between two values (altitude, rent). Communes that do not meet every active filter are greyed out. A commune with no value for an active criterion does not match it: an unknown is never counted as a pass.

## Two indicators at once

Under the list of colours you can add a second indicator, chosen among the colours (risks and distances are filters and overlays, not second indicators), shown in one of two ways:

- **Crossed colours.** Each indicator is cut into three tiers (low, middle, high) made of whole classes of its own legend, for example under 1,500, 1,500 to 3,500 and 3,500 €/m² or more for price, under 300, 300 to 1,000 and 1,000 m or more for altitude. Each commune then takes one of nine colours, read from the 3 x 3 key: rows are the second indicator, columns the first. It answers questions such as "where is the price low and the sunshine high".
- **Discs.** The colours keep the first indicator, and a disc of three sizes shows the tier of the second.

How to read them, and their limits:

- **Tiers are coarse.** Two communes in the same tier can differ a lot (a 1,600 and a 3,400 €/m² commune share a tier), and the crossed colours hide that variation. The details panel always gives the exact figures of every indicator.
- **No ranking.** Crossed colours show two indicators side by side; they are not a score and nothing is weighted.
- **Missing values stay missing.** A commune lacking either value is drawn as "no data" in crossed colours and gets no disc: an unknown is never shown as low.
- **Rough estimates.** In crossed colours a hatch means at least one of the two figures is a rough estimate (price from fewer than 10 sales, rent from few listings); the details panel says which. A rough estimate shown as a disc is an open ring.
- **Discs thin out when zoomed out.** Where communes are too small to hold a disc each, overlapping discs are left out; from zoom 9 every commune with a value has its disc. A missing disc at a wide view therefore does not mean missing data.
- Filters keep working on top of both views.

## Not covered by any indicator

- **Energy performance (DPE)** of homes, building age or condition.
- **Risk at the plot or address**: every risk indicator is per commune. The legal risk statement (ERRIAL) and the Géorisques address search remain the references.
- **Travel times**, public-transport frequency and commuting: distances are straight lines.
- Noise, air quality, mobile coverage, school results and future projects (urban plans, infrastructure).
- **Hot days around 2050**: listed in the app but not produced yet (see Climate).

## Known limits

- A median over few sales can be a single sale's price. That is why thin samples are hatched.
- Sale prices are not asking prices and not valuations. The map is not an estimate of any property.
- Averages hide variation inside large communes.
- Prices lag the market by up to a semester plus the time notaries take to file.

## Quality gate

Before tiles are published, `pipeline/check_tiles.py` checks them: 34,000+ communes, 90+ départements, at least 90 % of communes priced, all 20 Paris arrondissements between 7,000 and 16,000 €/m², Creuse median of commune medians under 1,500 €/m², départements 57, 67 and 68 marked no-coverage, and no well-sampled commune under 300 €/m². Each indicator is checked too: every value within a plausible range, a minimum share of communes covered (for example 99 % for flood, clay, radon and fibre, 98 % for rent and land tax), and spot values read by hand in the source for known communes (Tours and Orléans approved flood plans, Mont Blanc relief, Paris-Montsouris sunshine, Lièpvre's measured 0 % fibre, among others). A failing gate stops publication.
