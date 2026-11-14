# Méthode : le prix au m² et les autres indicateurs

Ce que montre la carte, comment c'est calculé, et ce qu'elle ne peut pas dire. Le code est dans `pipeline/` ; la boîte de dialogue « Sources et limites » de l'application en donne un résumé.

## Source

Les « Demandes de valeurs foncières » (DVF) de la DGFiP, via le fichier géolocalisé d'Etalab : cinq ans de ventes notariées (Licence Ouverte v2.0). Les données sont actualisées en avril et en octobre, avec environ un semestre de retard. Les contours des communes viennent de l'IGN (Admin Express, Licence Ouverte v2.0).

D'après les conditions d'utilisation de la DGFiP, la réutilisation ne doit pas permettre de ré-identifier des personnes et les données ne doivent pas être indexables par les moteurs de recherche. La carte ne publie donc que des **agrégats par commune** : aucune vente individuelle n'apparaît dans les tuiles, le dépôt de code ou une page.

## Quelles ventes sont retenues

Pour chaque vente (mutation) :

1. La nature est une vente simple (« Vente »). Les ventes en l'état futur d'achèvement (VEFA), échanges, adjudications et expropriations sont écartés.
2. La vente contient exactement un logement, maison ou appartement. Un logement est identifié par sa parcelle, son type, sa surface bâtie, son nombre de pièces et le numéro de son premier lot, car la source répète une ligne par nature de culture. Les ventes de plusieurs logements sont écartées, pas découpées.
3. Aucun local commercial ou industriel dans la même vente. Caves, parkings et terrains nus sont ignorés.
4. Prix strictement positif, surface bâtie d'au moins 9 m², et prix au m² entre 200 et 30 000 € (un garde-fou grossier contre les erreurs de saisie, pas une règle d'évaluation).

Prix au m² = valeur de la vente ÷ surface réelle bâtie. Pour une maison, la valeur inclut le terrain : une maison avec un grand jardin affiche donc un prix au m² plus élevé que la même maison sur une petite parcelle.

## Ce qui est affiché pour une zone

- La **médiane** du prix au m², pour tous les logements, les maisons ou les appartements.
- La **fenêtre** : les 36 mois qui se terminent à la vente la plus récente du fichier. Une commune avec moins de 10 ventes sur 36 mois utilise 60 mois si cela donne davantage de ventes, et le panneau l'indique (« Période élargie à 60 mois »).
- Le **nombre de ventes** qui fonde la médiane, et la période.
- Les **médianes annuelles** de 2021 à 2025 (tous logements), tracées seulement pour les années avec au moins 5 ventes.
- La **fiabilité**, d'après le nombre de ventes : 30 ou plus est solide, de 10 à 29 assez solide, de 1 à 9 est *indicatif* et dessiné en hachures, 0 signifie qu'aucune vente n'est retenue et se dessine avec des points.

## Ce qui n'est pas couvert

- **L'Alsace-Moselle (départements 57, 67, 68) et Mayotte** : ces ventes ne sont pas dans la base DVF (elles relèvent d'un autre registre foncier). Elles sont dessinées en hachures croisées et signalées « Hors base DVF ». Une donnée absente n'est jamais présentée comme un prix bas.
- **Les autres départements d'outre-mer** sont dans la base DVF mais ne figurent pas sur la carte pour l'instant.
- **Paris, Lyon, Marseille** apparaissent par arrondissement, car c'est ainsi que la base DVF les décrit. Chercher la ville sélectionne l'arrondissement situé au centre de la carte.
- **Communes fusionnées** : la base DVF utilise encore certains codes d'avant fusion. Ils sont rattachés à la commune actuelle grâce à la table des communes anciennes de l'IGN ; la construction échoue si plus de 0,5 % des ventes ne trouvent pas de commune.

## Règles communes aux autres indicateurs

- **Une valeur par commune** (par arrondissement à Paris, Lyon et Marseille). Rien sur la carte ne décrit une rue, un immeuble ou une parcelle.
- **Une donnée inconnue est absente, jamais 0.** Quand une source n'a pas de chiffre pour une commune, la commune n'a simplement pas de valeur : elle est dessinée dans la couleur « Pas de donnée », sa fiche omet la ligne, et elle ne remplit jamais un filtre. Un 0 sur la carte est une mesure (par exemple « aucune cavité recensée »).
- **Communes fusionnées** : elles reprennent les valeurs de leurs communes anciennes quand la source les décrit encore séparément. Pour les risques, la valeur la plus élevée l'emporte ; la règle des autres indicateurs est donnée dans leur section.
- **Éditions.** Certaines sources sont figées dans le code (la BPE, la carte des argiles, le trimestre fibre, les éditions délinquance et loyers) : passer à une édition plus récente est un changement délibéré, revérifié sur des valeurs témoins. Les autres sont lues au moment de la construction (GASPAR, radon, fiches climatologiques, services d'altimétrie, dernière année fiscale). Dans tous les cas, l'édition ou la date de téléchargement et une empreinte sont inscrites dans le manifeste de construction.
- **France métropolitaine et Corse uniquement**, comme la carte des prix.

## Risques : zone sismique, inondation, argiles, radon, cavités

Ce sont des indicateurs de repérage. Ils disent si une question mérite d'être posée pour une commune, pas quelle est la réponse pour un logement donné. Ils sont proposés comme filtres, figurent dans la fiche du lieu et se dessinent en calques (voir Calques) ; ce ne sont pas des couleurs de la carte. Aucun ne remplace l'état des risques réglementaire (ERRIAL) joint à une vente ou à un bail, et aucun ne décrit votre parcelle.

### Zone sismique

La zone sismique réglementaire de chaque commune (propriété `sz`, de 1, très faible, à 5, forte, décret 2010-1255) d'après l'API Géorisques. Les arrondissements de Paris, Lyon et Marseille prennent la zone de leur ville. Les rares communes inconnues de l'API prennent la zone la plus élevée de leurs voisines. En France métropolitaine, seules les zones 1 à 4 existent. Il s'agit d'un zonage réglementaire pour les règles de construction, pas d'une prévision, et il est indicatif : il ne remplace pas l'état des risques (ERRIAL) d'un bien.

### Inondation

**En clair** : jusqu'où l'État est allé dans la prise en compte du risque d'inondation dans la commune, de « rien de recensé » à « un plan de prévention approuvé ».

- **Ce qui est mesuré** (propriété `fl`) : l'étape la plus avancée atteinte dans la commune. Tous les types d'inondation comptent, submersion marine comprise ; les plans annulés, abrogés ou déprescrits sont ignorés.
  - **3** : un plan de prévention du risque inondation (PPRi, ou PPRL pour la submersion marine) est opposable : approuvé, ou appliqué par anticipation ;
  - **2** : un tel plan est prescrit (lancé, pas encore approuvé) ;
  - **1** : des zones inondables sont cartographiées dans un atlas des zones inondables (AZI), ou l'inondation figure pour la commune dans le dossier départemental des risques majeurs (DDRM) ;
  - **0** : la commune est connue de GASPAR et rien de ce qui précède n'y est recensé.
- **Source** : GASPAR (gestion assistée des procédures administratives relatives aux risques), ministère de la Transition écologique / Géorisques, fichier `gaspar.zip` ; l'édition est la date figurant dans ses noms de fichiers, inscrite dans le manifeste de construction. Licence Ouverte v2.0.
- **Donnée inconnue** : une commune absente de toutes les tables de GASPAR n'a pas de valeur. Les arrondissements de Paris, Lyon et Marseille prennent la valeur de leur ville quand GASPAR ne connaît que la ville.
- **Limites** : c'est l'état des procédures pour toute la commune, pas la hauteur d'eau à une adresse. Une commune dotée d'un plan approuvé peut avoir la plupart de ses logements loin de la zone inondable ; un 0 n'est pas une preuve d'absence de risque, il signifie que rien n'est recensé.

### Argiles (retrait-gonflement)

**En clair** : si des sols argileux, qui gonflent à l'humidité et se rétractent en période de sécheresse au point de fissurer les maisons, couvrent une grande partie de la commune.

- **Ce qui est mesuré** (propriété `cl`) : le niveau d'exposition le plus élevé qui, avec les niveaux supérieurs, couvre **au moins un quart (25 %)** de la surface de la commune : **0** a priori nul (pas d'argile cartographiée), **1** faible, **2** moyen, **3** fort. Exemple : 20 % en fort et 10 % en moyen donnent 2.
- **Source** : BRGM, « Retrait-gonflement des argiles, carte d'exposition 2026 » (arrêté du 9 janvier 2026), un fichier par département publié sur Géorisques (fichiers datés du 2025-11-28). Licence Ouverte v2.0, telle qu'indiquée sur georisques.gouv.fr.
- **Donnée inconnue** : la ville de Paris n'est pas couverte par la carte du BRGM, ses 20 arrondissements n'ont donc pas de valeur.
- **Limites** : une commune classée 1 peut contenir des rues très exposées couvrant moins d'un quart de sa surface, et inversement. L'exposition d'une parcelle se lit sur la carte du BRGM elle-même ; c'est l'étude de sol exigée avant de construire qui fait foi.

### Radon

**En clair** : la probabilité que le sol de la commune libère du radon, un gaz radioactif naturel qui peut s'accumuler dans les logements.

- **Ce qui est mesuré** (propriété `rn`) : la catégorie de potentiel radon de la commune selon l'arrêté du 27 juin 2018 : **1** faible, **2** faible mais avec des facteurs géologiques pouvant faciliter le transfert du gaz vers les bâtiments, **3** significatif sur au moins une partie de la commune.
- **Source** : ASNR (ex-IRSN), « Connaître le potentiel radon de ma commune », sur data.gouv.fr ; la date de la ressource est inscrite dans le manifeste de construction. Licence Ouverte v1.0.
- **Donnée inconnue** : les communes absentes du fichier n'ont pas de valeur ; les arrondissements prennent la catégorie de leur ville quand seule la ville figure.
- **Limites** : la catégorie décrit la géologie, pas un logement. Seule une mesure dans le logement donne l'exposition réelle.

### Cavités souterraines

**En clair** : combien d'anciennes carrières, caves, ouvrages souterrains ou cavités naturelles sont connus dans la commune.

- **Ce qui est mesuré** (propriété `cv`) : le nombre de cavités recensées par l'inventaire du BRGM (BDCavités) pour la commune. Une cavité est rattachée par le code commune saisi dans l'inventaire, par sa commune actuelle après une fusion, ou à défaut par ses coordonnées.
- **Source** : BRGM / Géorisques, « Inventaire des cavités souterraines (BDCavités) », un export par département. Licence Ouverte v2.0, telle qu'indiquée sur georisques.gouv.fr.
- **Donnée inconnue** : l'inventaire n'est pas publié sur Géorisques pour Paris et les départements franciliens 78, 91, 92, 93, 94 et 95, ni pour un département dont l'export est vide : ces communes n'ont pas de valeur, et non 0. Quand une fiche de Paris, Lyon ou Marseille n'a pas de coordonnées, elle ne peut pas être placée dans un arrondissement et les arrondissements de cette ville restent sans valeur.
- **Limites** : l'inventaire est incomplet et inégal selon les départements ; **0 veut dire aucune cavité recensée, pas aucune cavité**. Un nombre ne dit rien de la taille, de la profondeur ni d'un éventuel comblement.

## Altitude et relief

**En clair** : à quelle hauteur se trouve le bourg, et à quel point la commune est vallonnée.

- **Altitude** (propriété `alt`, en mètres) : altitude du sol au chef-lieu de la commune (là où se trouvent la mairie et le bourg principal), d'après les points de chef-lieu de l'IGN ADMIN EXPRESS, même édition que les contours. Une commune sans chef-lieu (les « villages morts » inhabités de la Meuse), ou dont le point n'a pas de valeur de terrain, utilise le point situé dans son contour qui sert aux distances.
- **Dénivelé** (propriété `rel`, en mètres) : altitude la plus haute moins la plus basse parmi les mailles de 25 m dont le centre est dans la commune.
- **Source** : IGN RGE ALTI (modèle numérique de terrain, altitudes NGF), lu par l'API d'altimétrie de la Géoplateforme (altitude) et son service raster WMS-R (dénivelé). Licence Ouverte v2.0. La date d'interrogation est inscrite dans le manifeste de construction.
- **Donnée inconnue** : l'altitude est absente quand aucun point de référence n'a de valeur de terrain ; le dénivelé est absent quand moins de 16 mailles (1 ha) tombent dans la commune.
- **Limites** : dans une grande commune de montagne, l'altitude du bourg dit peu de chose de ses hameaux. La maille de 25 m écrête légèrement sommets et gorges (le mont Blanc y mesure 4 775 m au lieu de 4 806 m) : le dénivelé est un peu sous-estimé. Les contours des communes sont simplifiés, donc des mailles le long d'une limite peuvent appartenir à une voisine. Le dénivelé n'est pas la pente de votre terrain.

## Climat : ensoleillement et jours de chaleur

**En clair** : à quel point le secteur a été ensoleillé et chaud en moyenne sur 1991-2020, estimé à partir des stations météo les plus proches.

- **Ce qui est mesuré** :
  - **Ensoleillement** (propriété `sun`) : durée moyenne annuelle d'insolation, en heures, arrondie à 10 h ;
  - **Jours de chaleur** (propriété `hot`) : nombre moyen de jours par an où la température maximale atteint 30 °C ou plus, arrondi au jour.
- **Source** : Météo-France, « Fiches climatologiques » sur data.gouv.fr (une fiche par station avec ses statistiques 1991-2020, rééditée chaque mois ; les dates des fiches sont inscrites dans le manifeste de construction). Licence Ouverte v2.0. La valeur d'une station n'est utilisée que si sa période de statistiques est comprise dans 1991-2020 et couvre au moins 25 ans : une série courte et récente surestimerait les jours de chaleur dans un climat qui se réchauffe. Les altitudes des points cibles viennent de l'IGN RGE ALTI.
- **Comment une commune obtient une valeur** : le climat se mesure aux stations, pas dans les communes, donc chaque valeur est une **interpolation**. Le point cible est le chef-lieu (à défaut le point intérieur). La valeur est une moyenne pondérée par l'inverse du carré de la distance des **5 stations les plus proches** situées à moins de **80 km pour l'ensoleillement** (les stations y sont environ dix fois moins nombreuses) et **50 km pour les jours de chaleur**. La distance tient compte de l'altitude : chaque centaine de mètres de différence d'altitude pèse comme 20 km de distance horizontale, pour privilégier les stations situées à une hauteur proche. Aucune correction de température selon l'altitude n'est appliquée aux valeurs.
- **Distance à la station** (propriété `cd`) : la distance horizontale en km entre le point cible et la station utilisée la plus proche (la plus grande des deux quand les deux valeurs existent). La fiche l'affiche à côté des valeurs climatiques : plus elle est grande, plus l'estimation est grossière.
- **Donnée inconnue** : sans station utilisable dans le rayon, la valeur est absente. C'est fréquent dans les départements de montagne (l'ensoleillement manque par exemple pour la plus grande partie de la Corse). Dans la construction nationale du 2026-11-06, l'ensoleillement couvrait 94,7 % des communes et les jours de chaleur 99,6 %.
- **Limites** : une tendance régionale, pas l'ombre de votre rue ni le microclimat d'une vallée. Ce sont des moyennes passées, pas une projection.

**À venir : jours de chaleur vers 2050.** L'application propose déjà un thème « Jours de chaleur vers 2050 » (propriété `h50`), pour une France réchauffée de 2,7 °C selon la trajectoire de réchauffement de référence (TRACC). La donnée **n'est pas encore produite** : les fichiers de Météo-France ne sont publiés que dans un format d'archive que la construction ne peut pas encore télécharger. D'ici là, toutes les communes affichent « Pas de donnée » pour ce thème et un filtre sur ce critère ne retient aucune commune.

## Distances aux services

Pour chaque commune, la distance à vol d'oiseau en mètres, arrondie à 100 m, entre un point situé dans la commune (pas son centre) et l'équipement le plus proche de chaque type en France métropolitaine et en Corse, d'après la base permanente des équipements de l'Insee (BPE 2025, géographie au 2025-01-01). Elles sont proposées comme filtres et figurent dans la fiche du lieu ; les équipements eux-mêmes peuvent s'afficher en points (voir Calques). Les types d'équipements (codes BPE) sont :

| Équipement | Propriété | Codes BPE |
| --- | --- | --- |
| Hôpital (court séjour) | `d_hos` | D101 |
| Médecin généraliste | `d_gp` | D265 |
| Pharmacie (propharmacies comprises) | `d_pha` | D307 |
| Dentiste | `d_den` | D277 |
| Crèche (établissement d'accueil du jeune enfant ou micro-crèche) | `d_cre` | D502, D509 |
| École primaire | `d_sch` | C108, C109 |
| Collège | `d_col` | C201 |
| Lycée (général, technologique, professionnel, agricole, et leurs sections générales et professionnelles) | `d_lyc` | C301, C302, C303, C304, C305 |
| Supermarché ou hypermarché | `d_sup` | B104, B105 |
| Boulangerie | `d_bak` | B207 |
| Bureau de poste (bureau de poste, relais poste, agence postale) | `d_pos` | A206, A207, A208 |
| Piscine | `d_pool` | F101 |
| Gare (gare de voyageurs SNCF d'intérêt national, régional ou local) | `d_gar` | E107, E108, E109 |

Les lieux d'accueil enfants-parents et les relais petite enfance (D503, D504) n'assurent pas de garde et sont écartés. Les équipements dont la position est approximative (qualité « M » de l'Insee : rue seulement probable, ou point pouvant être à 500 m ou plus, mais toujours dans la bonne commune) sont conservés ; seuls ceux sans coordonnées valides sont écartés.

- **Donnée inconnue** : chaque commune a une distance pour chaque type, puisque chaque type existe dans la BPE.
- **Limites** : ce ne sont pas des temps de trajet ; une rivière, une autoroute ou une montagne peuvent rallonger beaucoup le trajet réel. Un seul point représente toute la commune, et les chiffres masquent les écarts à l'intérieur des grandes communes. Les équipements situés à l'étranger sont ignorés, ce qui allonge les distances près des frontières. La BPE dit qu'un équipement existe, pas qu'il accepte de nouveaux patients ou élèves, ni à quelle fréquence les trains s'arrêtent en gare.

## Internet : fibre

**En clair** : la part des logements et locaux professionnels de la commune où un abonnement à la fibre jusqu'à l'abonné peut être souscrit.

- **Ce qui est mesuré** (propriété `fb`, en %) : locaux éligibles à la fibre jusqu'à l'abonné (FttH) ÷ ensemble des locaux (logements et locaux professionnels) de la base des bâtiments de l'Arcep, arrondi au pour cent. 0 et 100 signifient exactement aucun et exactement tous ; une part qui s'arrondirait à 0 ou 100 sans l'être exactement est affichée 1 ou 99.
- **Source** : Arcep, statistiques communales de « Ma connexion internet », **2e trimestre 2026** (données au 2026-06-30). Paris, Lyon et Marseille n'y sont publiées que pour la ville entière, donc leurs arrondissements utilisent l'observatoire des déploiements FttH de l'Arcep (cartefibre) du même trimestre : locaux raccordables ÷ estimation des locaux. Les deux publications concordent à 0,4 point près pour les trois villes. Licence Ouverte v2.0.
- **Donnée inconnue** : une commune sans aucun local dans la source (villages inhabités, ou commune rétablie après une fusion dont les locaux sont encore comptés dans l'ancienne commune fusionnée) n'a pas de valeur ; 7 communes métropolitaines au 2e trimestre 2026. Une commune fusionnée dont les communes anciennes sont encore des lignes séparées reprend la somme de leurs locaux.
- **Limites** : éligible ne veut dire ni abonné, ni débit garanti, ni raccordement gratuit : le dernier tronçon jusqu'au logement peut rester à construire. Le chiffre ne dit rien de la couverture mobile ni des autres technologies.

## Délinquance enregistrée (sur demande)

**En clair** : combien de violences et de cambriolages de logements la police et la gendarmerie ont enregistrés, rapportés à la taille de la commune. Ces thèmes sont **masqués par défaut** : ils n'apparaissent qu'après avoir coché « Afficher la délinquance enregistrée ». Ce choix reste dans votre navigateur et n'est jamais transmis ; ces thèmes et filtres ne sont jamais comptés dans les statistiques d'utilisation.

- **Ce qui est mesuré**, chaque fois comme la moyenne des taux annuels sur les **3 dernières années de la base (2023-2025)**, à une décimale :
  - **Violences** (propriété `cr_v`) : victimes de violences physiques enregistrées (intrafamiliales et hors cadre familial) et de violences sexuelles, pour 1 000 habitants par an. Les vols avec armes et vols violents ne sont pas inclus : le SSMSI les compte en infractions, pas en victimes, et déconseille d'additionner des indicateurs d'unités différentes ;
  - **Cambriolages** (propriété `cr_b`) : cambriolages de logements enregistrés pour 1 000 logements par an (logements du recensement de l'Insee, résidences secondaires et logements vacants compris), le dénominateur de la base elle-même.
- **Source** : SSMSI (service statistique du ministère de l'Intérieur), « Base statistique communale de la délinquance enregistrée par la police et la gendarmerie nationales », édition de juillet 2026 (années 2016-2025, géographie au 2026-01-01). Licence Ouverte v2.0. Les faits sont comptés au lieu de commission. Les arrondissements de Paris, Lyon et Marseille ont leurs propres lignes.
- **Donnée inconnue** : le SSMSI ne diffuse pas les communes qui n'ont pas enregistré plus de 5 faits sur 3 années successives (secret statistique) ; une valeur n'est affichée que si tous les chiffres qui la fondent sont diffusés pour chacune des 3 années. En outre, aucune valeur n'est affichée pour les communes de moins de **1 000 habitants** : leurs taux varient sur un ou deux faits. Les communes non diffusées n'ont pas de valeur, jamais 0. Un 0 publié est un vrai zéro sur 3 ans.
- **Limites** : **des faits enregistrés ne sont pas la délinquance réelle**. Les chiffres dépendent autant de la propension des victimes à porter plainte et de l'activité des services que de la délinquance elle-même, et ils ne disent rien du risque pour une personne donnée. Les taux par habitant surestiment les lieux dont la population de jour dépasse de loin les résidents (centres-villes, zones commerciales, gares, stations touristiques).

## Coût du logement : loyer et taxe foncière

### Loyer indicatif

**En clair** : le loyer auquel un logement type est proposé dans les annonces de la commune, par m² et par mois.

- **Ce qui est mesuré** (propriété `rt`, en €/m²/mois, à une décimale) : le loyer d'annonce prédit, charges comprises, non meublé, pour un appartement de référence (52 m²) et une maison de référence (92 m²) loués au 3e trimestre 2025. La source n'a pas de chiffre « tous logements » : la carte pondère les prédictions appartement et maison par le nombre d'annonces de chaque type dans la commune elle-même (poids égaux en l'absence d'annonce).
- **Fiabilité** (propriété `rtq`), selon les conseils de la source elle-même : **1 fragile** quand le R² ajusté du modèle est inférieur à 0,5, ou que la commune compte moins de 30 annonces, ou que l'intervalle de prédiction à 95 % est plus large que le loyer lui-même ; **3 solide** avec au moins 100 annonces dans la commune (estimation à l'échelle communale), un R² d'au moins 0,5 et un intervalle ne dépassant pas 70 % du loyer ; **2** sinon. La fiabilité de `rt` est la plus faible parmi les estimations qui portent au moins un quart de son poids. Les valeurs fragiles sont hachurées sur la carte et signalées « estimation fragile » dans la fiche.
- **Source** : « Carte des loyers » 2025 (ministère chargé du logement / ANIL, data.gouv.fr), à partir des annonces leboncoin et SeLoger 2019-2025, communes au 2025-01-01. Licence Ouverte v2.0. Mention obligatoire : « Estimations ANIL, à partir des données du Groupe SeLoger et de leboncoin ».
- **Donnée inconnue** : une commune sans prédiction n'a pas de valeur. Une commune fusionnée dont les communes anciennes figurent encore séparément reprend leur loyer pondéré par les annonces.
- **Limites** : **des loyers d'annonce, pas des baux signés**, et une estimation par modèle, pas le loyer d'un logement donné. Sous 100 annonces, l'estimation s'appuie sur un territoire plus large que la commune.

### Taux de taxe foncière

**En clair** : le taux total de taxe foncière sur les propriétés bâties voté pour la commune, en pourcentage.

- **Ce qui est mesuré** (propriété `tf`, en %, à une décimale) : le taux global de taxe foncière bâtie de la DGFiP, somme du taux voté par la commune (qui comprend depuis 2021 l'ancien taux départemental), des syndicats de communes, de l'intercommunalité, des taxes spéciales d'équipement, de la TASARIF en Île-de-France et de la GEMAPI. Non compris : la taxe d'enlèvement des ordures ménagères (TEOM), les frais de gestion de l'État ajoutés à l'avis, et les taux de lissage des communes nouvelles en cours de convergence (le taux voté est affiché).
- **Source** : DGFiP, « Fiscalité locale des particuliers » sur data.economie.gouv.fr, issu du REI (fichier de recensement des éléments d'imposition), dernière année disponible (2025 lors de la vérification du 2026-11-06). Licence Ouverte v2.0.
- **Donnée inconnue** : une commune fusionnée reprend le taux de ses communes anciennes seulement s'il est identique pour toutes à une décimale près ; sinon elle n'a pas de valeur. Les arrondissements de Paris, Lyon et Marseille prennent le taux unique de leur ville.
- **Limites** : **le taux n'est pas le montant de l'impôt**. Il s'applique à une base (la moitié de la valeur locative cadastrale) propre à chaque logement : deux logements de la même commune peuvent payer des montants très différents.

## Calques : lignes de risque et lieux

Les calques se dessinent par-dessus la couleur choisie, et on peut en afficher autant qu'on veut. Aucun n'est affiché par défaut. Un calque absent des données chargées n'est pas proposé. Les calques s'activent dans l'onglet Calques et sont rappelés dans la légende ; ils font partie du lien (`ov=` dans l'adresse).

### Lieux

**En clair** : où se trouvent les hôpitaux, médecins, écoles, commerces, gares, piscines, cinémas et bibliothèques, un point par lieu.

- **Source** : la base permanente des équipements de l'Insee (BPE 2025, géographie au 2025-01-01), le même fichier que pour les distances ci-dessus, à la position propre de chaque équipement. Licence Ouverte v2.0. Les types et leurs codes BPE :

| Calque | `k` | Codes BPE | Nom affiché |
| --- | --- | --- | --- |
| Hôpitaux et cliniques (court séjour) | `hos` | D101 | oui |
| Médecins généralistes | `gp` | D265 | non |
| Pharmacies | `pha` | D307 | non |
| Chirurgiens-dentistes | `den` | D277 | non |
| Crèches et micro-crèches | `cre` | D502, D509 | non |
| Écoles maternelles | `mat` | C107 | oui |
| Écoles élémentaires et primaires | `pri` | C108, C109 | oui |
| Collèges | `col` | C201 | oui |
| Lycées | `lyc` | C301, C302, C303, C304, C305 | oui |
| Universités et grandes écoles | `uni` | C501, C502, C503, C504, C505 | oui |
| Supermarchés et hypermarchés | `sup` | B104, B105 | non |
| Boulangeries | `bak` | B207 | non |
| Bureaux et relais de poste | `pos` | A206, A207, A208 | oui |
| Gares | `sta` | E107, E108, E109 | oui |
| Piscines | `pool` | F101 | oui |
| Cinémas | `cin` | F303 | oui |
| Bibliothèques | `lib` | F307 | oui |

- **Ce que porte un point** (couche `places` de `overlays.pmtiles`) : `k` le type, `n` le nom pour les types marqués « oui » ci-dessus, `c` le nombre d'équipements du type à cette position exacte (seulement à partir de 2 : ils sont regroupés en un seul point), `a` = 1 quand l'Insee qualifie la position d'approximative (qualité « M » : la rue n'est que probable, ou le point peut être décalé de 500 m ou plus, mais dans la bonne commune). La fiche du lieu indique alors « Position approximative ».
- **Ce qui est écarté** : les lignes en diffusion partielle (`STATUT_DIFFUSION = P` de l'Insee, publiées sans tout le détail) ne deviennent jamais un point ; pas plus que les équipements sans coordonnées valides ou hors de France métropolitaine et de Corse. Rien d'autre d'une ligne (adresse, numéro SIRET, capacité) ne sort du calcul.
- **Noms** : gardés seulement pour les établissements ouverts au public (hôpitaux, écoles, bureaux de poste, gares, piscines, cinémas, bibliothèques), avec majuscules initiales et coupés à 60 caractères. Médecins, dentistes, pharmacies, crèches, supermarchés et boulangeries n'ont jamais de nom, car le nom d'un cabinet ou d'un commerce est souvent celui d'une personne. Aucune personne n'est nommée nulle part.
- **Zoom** : les points apparaissent selon le zoom pour que la vue nationale reste lisible : hôpitaux dès le zoom 6, universités et gares dès 7, collèges, lycées, piscines et cinémas dès 8, supermarchés et bibliothèques dès 9, le reste dès 10.
- **Limites** : la BPE dit qu'un équipement existe, pas qu'il accepte de nouveaux patients ou élèves, ni ses horaires. Les **piscines** comprennent des piscines privées (de salles de sport, par exemple), car la source ne distingue pas les publiques des privées. Un point absent ne prouve pas qu'il n'y a pas de tel lieu.

### Limites des zones sismiques

**En clair** : des lignes là où la zone sismique réglementaire augmente, tracées d'après la zone de chaque commune.

- **Ce qui est tracé** (couche `seismic`, propriété `z`) : pour chaque zone de 2 à 5, la limite de l'ensemble des communes classées dans cette zone ou au-dessus. `z` est la zone atteinte en franchissant la ligne. Les tronçons le long des côtes et de la frontière sont omis, car la zone n'y change pas. En France métropolitaine, seules des lignes vers les zones 2, 3 et 4 existent.
- **Source** : le zonage par commune de Géorisques décrit sous Zone sismique (`sz`), sur les contours de communes de l'IGN. Licence Ouverte.
- **Limites** : la ligne suit les limites communales parce que le zonage est fixé par commune ; ce n'est pas une faille et elle ne décrit pas votre parcelle. Comme la zone elle-même, elle ne remplace pas l'état des risques réglementaire (ERRIAL).

### Lignes de risque : inondation, argiles, radon et cavités

**En clair** : des lignes là où la valeur communale d'un de ces quatre risques passe à un niveau, tracées comme les limites des zones sismiques.

- **Ce qui est tracé** (couche `risk` de `overlays.pmtiles`, propriétés `r` et `z`) : `r` est le risque (`flood`, `clay`, `radon` ou `cavities`) et `z` le niveau atteint en franchissant la ligne. Pour chaque niveau, la ligne est la limite de l'ensemble des communes dont la valeur est à ce niveau ou au-dessus, d'après les valeurs communales décrites dans la partie Risques (`fl`, `cl`, `rn`, `cv`). Les niveaux sont l'étape 1, 2 et 3 pour l'inondation ; la classe 1, 2 et 3 pour les argiles ; la catégorie 2 et 3 pour le radon (la catégorie 1, « potentiel faible », couvre l'essentiel du Massif central et de la Bretagne et n'est pas tracée) ; et 1, 5 et 25 cavités recensées. Plus la ligne est épaisse, plus le niveau est haut. Les tronçons le long des côtes et de la frontière sont omis, car la valeur n'y change pas. La légende nomme chaque niveau avec les noms de classes de la fiche du lieu.
- **Sans donnée** : une commune sans valeur pour un risque est inconnue, jamais une classe plus basse : aucune ligne n'est tracée le long de celle-ci, et l'absence de ligne ne prouve pas l'absence de risque.
- **Limites** : les valeurs sont communales, donc une ligne suit les limites des communes et n'est jamais le bord d'une zone inondable, d'une zone argileuse ou d'une cavité ; une commune au bord d'une ligne peut n'être touchée qu'en partie. L'inventaire des cavités est incomplet. Ce sont des indicateurs de repérage : aucun ne remplace l'ERRIAL. Ils ne sont plus proposés comme couleurs ; ils restent des filtres et figurent dans la fiche du lieu.

## Filtres

Un filtre conserve les communes dont la valeur respecte la limite choisie : au plus une valeur (par exemple un hôpital à moins de 15 km), au moins une valeur (ensoleillement, fibre), ou entre deux valeurs (altitude, loyer). Les communes qui ne remplissent pas tous les filtres actifs sont grisées. Une commune sans valeur pour un critère actif ne le remplit pas : une donnée inconnue n'est jamais comptée comme satisfaite.

## Deux indicateurs à la fois

Sous la liste des couleurs, vous pouvez ajouter un second indicateur, choisi parmi les couleurs (risques et distances sont des filtres et des calques, pas des seconds indicateurs), montré de l'une de deux façons :

- **Couleurs croisées.** Chaque indicateur est découpé en trois tranches (bas, moyen, haut) faites de classes entières de sa propre légende, par exemple moins de 1 500, de 1 500 à 3 500 et 3 500 €/m² ou plus pour le prix, moins de 300, de 300 à 1 000 et 1 000 m ou plus pour l'altitude. Chaque commune prend alors l'une de neuf couleurs, lue dans la grille 3 x 3 : les lignes donnent le second indicateur, les colonnes le premier. Elle répond à des questions comme « où le prix est-il bas et l'ensoleillement fort ».
- **Disques.** Les couleurs gardent le premier indicateur, et un disque de trois tailles montre la tranche du second.

Comment les lire, et leurs limites :

- **Les tranches sont larges.** Deux communes d'une même tranche peuvent beaucoup différer (une commune à 1 600 et une à 3 400 €/m² sont dans la même tranche), et les couleurs croisées masquent cet écart. La fiche du lieu donne toujours les chiffres exacts de chaque indicateur.
- **Pas de classement.** Les couleurs croisées montrent deux indicateurs côte à côte ; ce n'est pas une note et rien n'est pondéré.
- **Une donnée absente reste absente.** Une commune à qui il manque l'une des deux valeurs est dessinée « pas de donnée » en couleurs croisées et n'a pas de disque : une inconnue n'est jamais montrée comme basse.
- **Estimations fragiles.** En couleurs croisées, un hachurage signifie qu'au moins un des deux chiffres est fragile (prix sur moins de 10 ventes, loyer sur peu d'annonces) ; la fiche du lieu précise lequel. Une estimation fragile montrée en disque est un anneau ouvert.
- **Les disques s'éclaircissent en vue large.** Là où les communes sont trop petites pour porter chacune un disque, les disques qui se chevauchent sont omis ; à partir du zoom 9, chaque commune qui a une valeur a son disque. Un disque absent en vue large ne veut donc pas dire une donnée absente.
- Les filtres continuent de s'appliquer aux deux vues.

## Ce qu'aucun indicateur ne couvre

- La **performance énergétique (DPE)** des logements, leur âge ou leur état.
- **Le risque à la parcelle ou à l'adresse** : tous les indicateurs de risque sont communaux. L'état des risques réglementaire (ERRIAL) et la recherche par adresse de Géorisques restent les références.
- **Les temps de trajet**, la fréquence des transports en commun et les déplacements domicile-travail : les distances sont à vol d'oiseau.
- Le bruit, la qualité de l'air, la couverture mobile, les résultats scolaires et les projets à venir (urbanisme, infrastructures).
- **Les jours de chaleur vers 2050** : proposés dans l'application mais pas encore produits (voir Climat).

## Limites connues

- Une médiane sur peu de ventes peut être le prix d'une seule vente. C'est pourquoi les faibles échantillons sont hachurés.
- Les prix de vente ne sont ni des prix d'annonce ni des estimations. La carte n'estime aucun bien.
- Une moyenne par commune masque les écarts à l'intérieur des grandes communes.
- Les prix retardent sur le marché d'un semestre, plus le délai de dépôt chez les notaires.

## Contrôle qualité

Avant publication, `pipeline/check_tiles.py` vérifie les tuiles : plus de 34 000 communes, plus de 90 départements, au moins 90 % des communes avec un prix, les 20 arrondissements de Paris entre 7 000 et 16 000 €/m², une médiane des médianes de la Creuse sous 1 500 €/m², les départements 57, 67 et 68 marqués hors couverture, et aucune commune bien échantillonnée sous 300 €/m². Chaque indicateur est aussi contrôlé : toutes les valeurs dans une plage plausible, une part minimale de communes couvertes (par exemple 99 % pour l'inondation, les argiles, le radon et la fibre, 98 % pour le loyer et la taxe foncière), et des valeurs témoins relevées à la main dans la source pour des communes connues (plans inondation approuvés de Tours et d'Orléans, dénivelé du mont Blanc, ensoleillement de Paris-Montsouris, 0 % de fibre mesuré à Lièpvre, entre autres). Un contrôle en échec bloque la publication.
