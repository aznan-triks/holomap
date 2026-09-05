# Changelog

Format inspired by [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.1.1] — 2026-09-05

### Corrigé

- **Humanisé** : dans la fiche flottante d'une note (vue réseau), cliquer sur la fiche centrale ne
  faisait plus rien de cohérent — le clic retombait sur ce qu'il y avait dessous, sur la carte
  principale. Les villes et ports pouvaient aussi apparaître visuellement posés sur l'eau au lieu
  d'être sur la terre.
- **Technique** :
  - `src/render.js` — la carte centrale (note ciblée) de la vue réseau, dessinée par `card(cx, cy,
    focus, true, ...)`, n'était jamais poussée dans le registre de hit-test `anim.network.cards`
    contrairement aux cartes voisines. Ajout de l'enregistrement manquant (même condition
    `k > 0.85`, `hot` laissé à `false` — pas de changement visuel, uniquement le hit-test).
  - `src/layout.js` — `seedTerminals` écrivait `station` brut depuis `n.v` (position issue de
    `computePositions`), sans jamais la confirmer contre le maillage terrain réel, contrairement
    aux ports/aéroports/lumières (`createTerrainConfirmer`, déjà en place depuis une session
    antérieure). Ajout d'un suivi du meilleur candidat confirmé le plus proche de `n.v` pendant le
    balayage de grille existant, utilisé en repli si `n.v` lui-même ne confirme pas.
  - `test/test-layout.mjs` — nouvelles assertions : mismatch de la station sous 5 % (mesuré 2/58
    en configuration brute pré-fix), et non-collision de la station avec son propre aéroport/port
    une fois le repli réellement exercé (sous vrai terrain).
  - Audits archivés : `audits/AUDIT_hitbox-carte-reseau.md`, `audits/AUDIT_points-hors-terrain.md`.
