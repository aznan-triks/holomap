type: audit
init: light
Terminé quand : chaque cause racine ci-dessous est confirmée par fichier + ligne, avec citation du code
État actuel observé : confirmé — voir "### État cible"
Ressources consultées : mount.js (ordre du pipeline), layout.js (computePositions, partition, seedTerminals, createTerrainConfirmer), terrain.js (createTerrain, ensureCell), render.js (appel de terrain.createTerrain)
Décision : audit seul — aucun code modifié dans cette session
Valeurs fixes introduites : 0
Périmètre — IN : placement des villes/points (layout.js), construction du relief terre/eau (terrain.js), ordre d'appel du pipeline (mount.js, render.js)
Périmètre — OUT : rendu visuel du relief lui-même (render.js drawing), classification des notes (classify.js), poids (weigh.js)

> Note de process : l'investigation a été menée via 2 agents Explore en parallèle (§3bis étapes 1+2 combinées, sur consigne explicite utilisateur d'exécuter en multi-agentique avant toute rédaction). Ce fichier est directement l'archive finale (§3bis étape 3) plutôt qu'un plan d'audit suivi d'une exécution séparée.

### État cible (invariants à vérifier)
- Un point (ville/port/aéroport) ne doit jamais être dessiné en dehors du polygone de terrain effectivement utilisé pour le rendu.
- Le relief utilisé pour valider un point doit être calculé à la même résolution que celui utilisé pour le dessiner.

### Patterns à grep
- `createTerrainConfirmer` — layout.js:1057
- `REF_TERRAIN_SIZES` — layout.js:1056
- `station:` — layout.js:1345
- `terrain.createTerrain` — render.js:776
- `computePositions` — layout.js:449

### Fichiers hors-scope
- render.js (dessin du relief) — la faute n'est pas dans le tracé, mais dans les données placées avant que le tracé n'existe.
- classify.js / weigh.js — n'interviennent pas dans le positionnement géographique des points.

---

## Constat — cause racine confirmée

**Symptôme signalé** : des points (villes, ports) apparaissent visuellement sur l'eau au lieu d'être sur la terre.

**Ordre réel du pipeline** (mount.js:18-39) :
1. `layout.computePositions` (mount.js:30) — place les points, **aucune vérification vs relief** (layout.js:449-528 ; commentaire ligne 441-444 : « plus aucun clamp, pas de vérification vs le relief »).
2. `layout.partition` (mount.js:31) — construit une grille fine (2px) qui sert de définition **provisoire** terre/eau.
3. `layout.seedTerminals` (mount.js:34) — place ports/aéroports, avec une confirmation partielle contre le relief (voir plus bas).
4. Le **vrai** relief (maillage Voronoi, ~17× plus grossier que la grille fine) n'est construit qu'à `render.js:776`, dans `render.mount()`, donc **après** toutes les étapes ci-dessus, à une taille de canvas alors connue — mais que le pipeline de modèle, lui, ignore.

**Deux géographies différentes empilées** (le code le documente déjà lui-même, layout.js:1026-1055) : la grille fine qui sert au placement, et le maillage terrain réel qui sert au dessin, ne sont pas le même relief. Un point valide sur l'une peut tomber en mer sur l'autre.

**Le correctif partiel existant est insuffisant** :
- `createTerrainConfirmer` (layout.js:1057-1083) revérifie les points contre le maillage terrain réel, mais seulement à 3 tailles de canvas **fixes et arbitraires** (`REF_TERRAIN_SIZES`, layout.js:1056 : 900×560, 1400×900, 1900×1150) — la vraie taille du canvas utilisateur n'est jamais connue à cet instant du pipeline (commentaire layout.js:1041-1055 l'admet).
- Cette confirmation n'est appliquée qu'aux **ports et aéroports** (layout.js:1261) et aux lumières de ville (`seedLights`, layout.js:1112/1139).
- **La ville elle-même (`station`, layout.js:1345) n'est jamais confirmée** — elle recopie brut la position issue de `computePositions`, qui elle-même n'a aucune vérification terrain (point 1 ci-dessus).

**Cause racine** : le pipeline calcule les positions des points avant que le relief de référence n'existe, puis reconstruit ce relief plus tard à une résolution différente sans jamais revalider tous les points contre lui. Le seul garde-fou existant est un rattrapage approximatif, partiel (pas la station elle-même), et imprécis (tailles de référence fixes ≠ taille réelle).
