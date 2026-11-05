# Méthode : le prix au m²

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

## Zone sismique

La zone sismique réglementaire de chaque commune (de 1, très faible, à 5, forte, décret 2010-1255) d'après l'API Géorisques. Les arrondissements de Paris, Lyon et Marseille prennent la zone de leur ville. Les rares communes inconnues de l'API prennent la zone la plus élevée de leurs voisines. En France métropolitaine, seules les zones 1 à 4 existent. Il s'agit d'un zonage réglementaire pour les règles de construction, pas d'une prévision, et il est indicatif : il ne remplace pas l'état des risques (ERRIAL) d'un bien.

## Distances aux services

Pour chaque commune, la distance à vol d'oiseau en mètres, arrondie à 100 m, entre un point situé dans la commune (pas son centre) et l'équipement le plus proche de chaque type en France métropolitaine, d'après la base permanente des équipements de l'Insee (BPE 2025) : hôpitaux de court séjour (D101), médecins généralistes (D265), écoles primaires (C108 et C109), supermarchés et hypermarchés (B105, B104), boulangeries (B207) et piscines (F101).

Les équipements dont la position est approximative (en général à moins de 500 m près) sont conservés ; seuls ceux sans coordonnées sont écartés. Ce ne sont pas des temps de trajet, les équipements situés à l'étranger sont ignorés, un seul point représente toute la commune, et les chiffres masquent les écarts à l'intérieur des grandes communes.

## Filtres

Un filtre conserve les communes dont la valeur est inférieure ou égale à la limite choisie (par exemple un hôpital à moins de 15 km). Les communes qui ne remplissent pas tous les filtres actifs sont grisées. Une commune sans valeur pour un critère actif ne le remplit pas : une donnée inconnue n'est jamais comptée comme satisfaite.

## Limites connues

- Une médiane sur peu de ventes peut être le prix d'une seule vente. C'est pourquoi les faibles échantillons sont hachurés.
- Les prix de vente ne sont ni des prix d'annonce ni des estimations. La carte n'estime aucun bien.
- Une moyenne par commune masque les écarts à l'intérieur des grandes communes.
- Les prix retardent sur le marché d'un semestre, plus le délai de dépôt chez les notaires.

## Contrôle qualité

Avant publication, `pipeline/check_tiles.py` vérifie les tuiles : plus de 34 000 communes, plus de 90 départements, au moins 90 % des communes avec un prix, les 20 arrondissements de Paris entre 7 000 et 16 000 €/m², une médiane des médianes de la Creuse sous 1 500 €/m², les départements 57, 67 et 68 marqués hors couverture, et aucune commune bien échantillonnée sous 300 €/m². Un contrôle en échec bloque la publication.
