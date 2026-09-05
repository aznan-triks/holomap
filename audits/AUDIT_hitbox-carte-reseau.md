type: audit
init: light
Terminé quand : la cause racine est confirmée par fichier + ligne, avec citation du code
État actuel observé : confirmé — voir "### État cible"
Ressources consultées : render.js (network(), card(), cardAt(), listeners mousemove/click) — investigation initiale par agent Explore (chemin clic/survol/zoom général : aucune désynchronisation trouvée) puis lecture directe ciblée sur "carte réseau" après clarification utilisateur (élément = fiche flottante réseau, symptôme = présent dès l'ouverture, pas lié au zoom/pan/resize)
Décision : audit seul — aucun code modifié dans cette session
Valeurs fixes introduites : 0
Périmètre — IN : registre de hitbox des cartes du graphe réseau (`anim.network.cards`), fonction `card()`, fonction `cardAt()`, listeners mousemove/click associés
Périmètre — OUT : hitbox des villes/territoires sur la carte principale (confirmée saine par l'agent Explore : projection live, pas de cache obsolète), menu clic-droit (`actions.js`, module DORMANT, hors scope par consigne existante — cf. CONTEXT.md §9)

> Note de process : audit exécuté directement en lecture ciblée (§3bis étapes 1+2 combinées) après clarification utilisateur par question à choix. Ce fichier est directement l'archive finale (§3bis étape 3).

### État cible (invariants à vérifier)
- Chaque carte visuellement dessinée dans la vue réseau (fiche flottante) doit avoir une entrée correspondante dans le registre de hit-test, avec les mêmes bornes que celles dessinées.

### Patterns à grep
- `anim.network.cards` — render.js:1624, 1781, 2934
- `function card(` — render.js:1690
- `function cardAt(` — render.js:2933
- `card(cx, cy, focus, true` — render.js:1783

### Fichiers hors-scope
- layout.js / terrain.js — sans rapport, domaine du deuxième bug (voir AUDIT_points-hors-terrain.md).
- actions.js — module dormant, non appelé, hors scope (CONTEXT.md §9).

---

## Constat — cause racine confirmée

**Symptôme signalé** : dans la carte réseau (fiche flottante qui s'ouvre au clic/zoom sur une note), une hitbox ne suit pas les bords de ce qui est affiché — présent dès l'ouverture, indépendant du zoom/pan/resize.

**Ce qui fonctionne** : les cartes des notes voisines (autour du centre) sont correctement enregistrées. À chaque frame, `network()` vide le registre (render.js:1624 `anim.network.cards = []`) puis, pour chaque voisin suffisamment déployé (`k > 0.85`), pousse sa boîte exacte (`bx, by, w, h`, les mêmes valeurs que celles utilisées pour `fillRect`/`strokeRect`) dans `anim.network.cards` (render.js:1781). `cardAt()` (render.js:2933-2939) compare ensuite `e.offsetX/e.offsetY` à ces mêmes bornes — cohérent.

**La faille** : la carte **centrale** (celle de la note actuellement ciblée, la plus grande, dessinée en dernier) est produite par un appel séparé :
```
card(cx, cy, focus, true, ease(progress(t, anim.network.t0, F.unfold)), false);   // render.js:1783
```
Contrairement à l'appel des voisins trois lignes plus haut (render.js:1772-1781), **le retour de cet appel n'est jamais poussé dans `anim.network.cards`**. Cette carte centrale est donc visible à l'écran (bordure, titre, badge de liens) mais **n'a aucune entrée dans le registre de hit-test**.

**Conséquence observable** : un clic ou survol à l'intérieur des bords visibles de la fiche centrale ne trouve rien dans `cardAt()` → le code retombe sur le test de la carte du dessous (`noteAtMap`, render.js:2975-2976 / 2992-2993), c'est-à-dire le territoire de la carte principale qui se trouve géométriquement sous la fiche. Vu de l'utilisateur, la fiche a une hitbox qui ne correspond pas à ses propres bords — elle réagit comme si la zone cliquable appartenait à autre chose.

**Cause racine** : oubli d'enregistrement — la carte centrale (`focus: true`) suit un chemin de dessin dupliqué par rapport aux cartes voisines, et ce chemin dupliqué n'a pas répliqué la ligne d'enregistrement dans `anim.network.cards`.
