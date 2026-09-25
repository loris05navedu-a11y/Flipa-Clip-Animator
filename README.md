# Frameloom — animation 2D image par image

Frameloom est une application complète d'animation 2D image par image pour **Android**
(tablettes en priorité, téléphones aussi) qui fonctionne également dans un navigateur récent.
On y dessine chaque image, on empile des calques, on règle la timeline, on ajoute du son,
puis on exporte en vidéo, en GIF ou en images. Tout fonctionne **hors ligne**, sans compte,
sans publicité et sans fonctionnalité bloquée.

> Interface, code, logo et icône d'application sont originaux. Les icônes d'interface viennent de
> Lucide (licence ISC) et les polices sont sous licence SIL OFL.

## Fonctionnalités principales

- **Projets** : préréglages (HD, Full HD, 4K, 9:16, 4:5, carrés…), taille/FPS/durée/fond/transparence, projets récents avec miniatures, corbeille, versions, fichier `.frameloom`.
- **Canevas** : zoom, déplacement, rotation (souris, molette, gestes à deux doigts), plein écran, grille, règles, guides, magnétisme, symétries (verticale, horizontale, quadruple, radiale).
- **Dessin** : pinceau, crayon, stylo (14 pinceaux intégrés, éditeur complet, pinceaux personnalisés), pression du stylet, stabilisation, lissage, gomme (main levée / zone), formes, remplissage, pipette, texte.
- **Sélection / transformation** : rectangle, lasso, baguette magique ; déplacer, redimensionner, pivoter, retourner, incliner, copier/couper/coller/dupliquer, déplacer vers un autre calque.
- **Calques** : opacité, 13 modes de fusion, verrou, visibilité, réorganisation, fusion, duplication.
- **Timeline** : frames avec durée d'exposition, sélection multiple, glisser-déplacer, copier/coller de frames, lignes de calques, pistes audio avec waveform, lecture/pause/arrêt/boucle/vitesse, onion skin configurable.
- **Audio** : plusieurs pistes, rognage, découpe, volume, muet, synchronisation.
- **Import** : images, séquences d'images, vidéos (conversion en frames), audio, images de référence, projets.
- **Export** : MP4, WebM, GIF, PNG, séquence PNG (.zip), planche de sprites, fichier projet — résolution, FPS, qualité, transparence, plage, audio, estimation de taille.
- **Sauvegarde** : manuelle, automatique (30 s / 60 s / 5 min), récupération après crash, versions.
- **Paramètres** : langue FR/EN, thème clair/sombre, taille des boutons, disposition gaucher/droitier, gestes, raccourcis clavier personnalisables, mémoire, stockage.

La liste complète avec l'état réel de chaque fonction est dans **[FEATURES.md](FEATURES.md)**.

## Installer l'APK

1. Copiez `releases/Frameloom-1.0.0.apk` sur l'appareil Android (7.0 ou plus récent).
2. Ouvrez-le et autorisez l'installation depuis cette source si Android le demande.
3. Lancez **Frameloom**.

Aucune permission n'est demandée à l'utilisateur : les fichiers sont choisis avec le sélecteur
système et les exports sont enregistrés par le sélecteur de documents ou dans la galerie.

## Développement

Prérequis : Node.js 22+, npm. Pour l'APK : JDK 21 et le SDK Android (plateforme 36, build-tools 36).

```bash
npm install          # dépendances
npm run dev          # application sur http://127.0.0.1:5173 (rechargement à chaud)
npm run typecheck    # vérification TypeScript
npm test             # tests unitaires (Vitest)
npm run build        # build web de production dans dist/
npx playwright test  # tests de bout en bout (lance le build en aperçu sur :4173)
```

> Les tests E2E utilisent le Chromium indiqué par `PW_CHROMIUM` (par défaut celui du conteneur
> de développement). Sur une autre machine : `npx playwright install chromium` puis
> `PW_CHROMIUM=$(node -e "console.log(require('@playwright/test').chromium.executablePath())") npx playwright test`.

### Construire l'APK

```bash
echo "sdk.dir=$ANDROID_HOME" > android/local.properties   # une seule fois
npm run apk
# → android/app/build/outputs/apk/release/app-release.apk
```

`npm run apk` enchaîne : build web → `cap sync android` → `./gradlew assembleRelease`.

### Signature de l'APK

L'APK de release est signé avec la clé `android/frameloom-release.jks` décrite dans
`android/keystore.properties`. Cette clé est **volontairement versionnée** pour que chaque build
soit signé de la même manière et que les mises à jour s'installent par-dessus la version
précédente. **Avant toute publication sur un store, générez votre propre clé**
(`keytool -genkeypair …`), gardez-la secrète et mettez à jour `keystore.properties`.

## Architecture

Résumé (détails dans **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)**) :

- **TypeScript + React + Canvas 2D**, empaqueté en APK natif avec **Capacitor 8** ; WebCodecs pour la vidéo, Web Audio pour le son, IndexedDB pour le stockage.
- `src/core` : logique pure et testée (modèle, historique, remplissage, géométrie, format de fichier).
- `src/engine` : moteur graphique (cels, pinceaux, outils, rendu, lecture, audio, export).
- `src/editor` : session d'édition, commandes annulables, sélection, contrôleur d'actions.
- `src/ui` : écrans et composants ; `src/i18n` : français et anglais.
- `android/` : projet Android + plugin natif `FrameloomFiles` (enregistrer sous / galerie).

## Structure des fichiers

```
├── src/
│   ├── app/          démarrage, navigation, thème, services
│   ├── core/         modèle, historique, raster, couleurs, géométrie, format .frameloom
│   ├── editor/       EditorSession, commandes, sélection, presse-papiers, raccourcis
│   ├── engine/       CelStore, pinceaux, outils, Viewport, Player, audio, export
│   ├── i18n/         fr.ts, en.ts
│   ├── platform/     intégration Android (fichiers, partage, cycle de vie)
│   ├── storage/      IndexedDB, paramètres
│   ├── styles/       CSS (design system, accueil, éditeur)
│   └── ui/           accueil, éditeur, paramètres, aide, composants
├── tests/unit/       tests Vitest
├── tests/e2e/        tests Playwright
├── android/          projet Android (Capacitor)
├── docs/             ARCHITECTURE.md, FORMAT.md
├── releases/         APK prêt à installer
├── FEATURES.md       état de chaque fonctionnalité
└── README.md
```

## Format des projets

Un projet est un document JSON (calques, frames, cels, audio, références, palettes, réglages)
plus des médias immuables (PNG des cels, audio, références). Dans l'application il vit dans
IndexedDB (avec révisions et copie de secours) ; exporté, c'est une archive `.frameloom` (ZIP).
Spécification complète : **[docs/FORMAT.md](docs/FORMAT.md)**.

## Limites connues

- **Tests sur appareil** : l'application a été développée et testée automatiquement dans Chromium
  (même moteur que la WebView Android), et l'APK a été construit et vérifié (signature, manifeste,
  contenu), mais il n'a pas pu être lancé sur un téléphone ou un émulateur dans l'environnement de
  développement (pas de virtualisation disponible). Merci de signaler tout comportement propre à un
  appareil.
- **MP4** : dépend des encodeurs vidéo de l'appareil — H.264 sur la quasi-totalité des Android ;
  sinon H.265, VP9 ou AV1 dans le conteneur MP4 (l'application l'indique avant l'export).
  L'audio est en AAC quand l'appareil sait l'encoder, sinon en Opus.
- **Transparence vidéo** : WebM avec alpha uniquement si l'encodeur le permet ; utilisez le GIF,
  le PNG ou la séquence PNG pour de la transparence garantie.
- **Texte** : modifiable jusqu'à sa validation, puis converti en pixels.
- **Transformation libre** : affine (échelles, rotation, inclinaison), pas de perspective.
- **Redimensionnement du canevas** : non annulable (confirmation demandée, historique vidé).
- **Emplacement des projets** : stockage privé de l'application ; utilisez l'export `.frameloom`
  ou « Sauvegarder tous les projets » pour les copier ailleurs.
- **Import vidéo** : extraction image par image (recherche) ; lent pour de très longues vidéos.
- **Règles** : masquées quand la vue est pivotée.

## Feuille de route

- Pinceaux à texture personnalisée (import d'images de pointe).
- Calques de texte et vectoriels restant modifiables.
- Déformation en perspective et maillage.
- Génération des miniatures dans un Worker (OffscreenCanvas).
- Interpolation automatique de mouvement (« tweening ») pour les objets transformés.
- Export APNG / WebP animé.
- Version iOS (Capacitor iOS) après tests sur appareil.

## Licences des composants

React, Capacitor, Zustand, fflate, gifenc, mp4-muxer, webm-muxer (MIT) · Lucide (ISC) ·
Inter, Lora, Fredoka, Bangers, Caveat, Permanent Marker, Roboto Mono (SIL OFL 1.1).
