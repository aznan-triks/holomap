type: fix
init: light
Terminé quand :
  - `node scripts/run-tests.mjs` passe intégralement (toutes suites)
  - `npm run build` termine sans erreur
  - render.js : un clic/survol dans les bords de la fiche centrale de la carte réseau est reconnu comme appartenant à cette fiche (registre `anim.network.cards` contient une entrée pour le cœur, pas seulement les voisins)
  - layout.js : `seedTerminals` ne retourne plus jamais une `station` non confirmée par le maillage terrain quand un candidat confirmé existe pour cette note
État actuel observé : causes racines confirmées, voir audits/AUDIT_hitbox-carte-reseau.md et audits/AUDIT_points-hors-terrain.md (validés par l'utilisateur avant ce plan)
Ressources consultées : render.js (network(), card(), cardAt(), anim.network.cards), layout.js (seedTerminals, createTerrainConfirmer, towardCenter), test/test-layout.mjs (section "Stations, ports et airports", mesures de mismatch existantes)
Décision : étend seedTerminals (réutilise createTerrainConfirmer déjà existant) + étend network() (réutilise le même chemin d'enregistrement que les cartes voisines) — aucun nouveau module, aucune nouvelle valeur en dur
Valeurs fixes introduites : 0 (CORE_CARD_I = -2 est un identifiant de registre interne, pas un réglage — analogue au -1 déjà utilisé pour "rien survolé")
Périmètre — IN : src/render.js (fonction network(), registre anim.network.cards), src/layout.js (fonction seedTerminals, calcul de `station`)
Périmètre — OUT : src/layout.js computePositions (replacerait l'ordre du pipeline entier — hors scope, déjà documenté comme limite architecturale acceptée dans layout.js:1040-1055), src/terrain.js, actions.js (dormant)

### Diagnostic
- **Hitbox carte réseau** : la carte centrale (note ciblée) est dessinée par un appel séparé (render.js:1783 avant fix) qui n'était jamais poussé dans `anim.network.cards` contrairement aux cartes voisines (render.js:1781). Cause racine = oubli d'enregistrement, pas un problème de projection/coordonnées.
- **Points hors terrain (station)** : `station` était écrit brut depuis `n.v` (position calculée par `computePositions`, jamais vérifiée contre le relief). Les ports/aéroports/lumières ont déjà un garde-fou (`createTerrainConfirmer`) depuis une session précédente (07/28) ; la station en avait été oubliée.

### Grep global (même bug cherché ailleurs)
- `anim\.network\.cards\.push` — un seul site d'ajout existait avant fix (voisins) ; recherché tout autre endroit qui dessinerait une fiche sans l'enregistrer : aucun trouvé (seul `card()` dessine des fiches réseau, appelé 2 fois dans tout le fichier — voisins + cœur).
- `station:` / `\.station\b` — un seul site d'écriture (`seedTerminals`), pas de duplication ailleurs.
- Recherché d'autres `push`/retours de hit-test similaires (`cardAt`, `noteAtMap`) pour vérifier qu'aucun autre registre de hitbox n'a le même oubli : `noteAtMap` (villes/territoires) confirmé sain par l'agent d'investigation initial (projection recalculée à chaque frame, pas de cache).

### Régression (comportement voisin à ne pas casser)
- `terminals: airport and station at distinct places` et `terminals: no port confused with the station` (test-layout.mjs) — le fallback de station ne réutilise jamais un point déjà choisi comme port/aéroport (critère de sélection différent : plus proche de `n.v`, jamais l'extremum directionnel/côtier utilisé par port/aéroport).
- `terminals: seeded in under 150 ms at mount` — le nouveau test de proximité par cellule réutilise `confirmedByTerrain`, déjà appelé bien plus souvent ailleurs dans la même fonction (jusqu'à ~1000×/note dans `seedLights`) sans dépasser le budget ; à revérifier après coup.
- Comportement quand `terrain` n'est pas fourni (tests existants appellent `seedTerminals(gr, many, REAL)` sans terrain) : `confirmedByTerrain` renvoie alors `() => true`, donc `station` reste exactement `n.v` — comportement identique à avant le fix.
- Carte réseau voisine (hover/dim/click) : chemin de code inchangé, seul un appel supplémentaire est ajouté après elle.

---

## Écarts

- `/code-review` (§7, obligatoire avant bump car diff touche `src/`) a relevé 2 points, corrigés avant le bump :
  1. **Spec — dépassement de périmètre** : le fix hitbox ajoutait un effet visuel de survol (glow) sur la fiche centrale, jamais demandé par le plan ni l'audit. Retiré — `hot` reste `false` comme avant le fix, seul l'enregistrement dans le registre de hit-test a été ajouté.
  2. **Spec — test manquant** : les tests existants "station distincte de l'aéroport/port" tournaient sans module terrain, donc n'exerçaient jamais le nouveau repli. Deux tests ajoutés dans le bloc qui, lui, fournit un vrai terrain.
- Standards : un point relevé sans gravité (léger pattern dupliqué "meilleur candidat par score" en 3 exemplaires dans `seedTerminals`, déjà présent avant ce fix pour 2 des 3) — laissé tel quel, la factorisation est un refacto séparé, hors scope d'un fix.
- Suite de tests (13/13, 119 checks sur layout.js) et build vérifiés après les corrections du code-review.
