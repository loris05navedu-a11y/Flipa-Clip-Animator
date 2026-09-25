# Architecture de Frameloom

## Choix de la plateforme

| Contrainte | Décision |
|---|---|
| Application mobile Android, prioritairement tablette | APK natif via **Capacitor 8** (WebView Chromium système, accélérée GPU) |
| Performances graphiques | **Canvas 2D** (accéléré GPU dans Chrome/WebView), composition au pixel près, recomposition partielle pendant le dessin |
| Vidéo / audio | **WebCodecs** (encodeurs matériels MediaCodec sur Android), **Web Audio** (décodage, lecture synchronisée, mixage hors-ligne) |
| Stockage hors ligne | **IndexedDB** (projets, révisions, médias immuables, copies de secours) |
| Testabilité sans émulateur (environnement sans KVM) | Le même code tourne dans Chromium : tests E2E Playwright sur l'application réelle |
| Web / desktop (priorité 3) | Le même build fonctionne dans un navigateur récent |

Pile : TypeScript strict, React 19, Zustand (état d'interface), Vite, Vitest, Playwright.
Aucun code ni asset propriétaire : icônes Lucide (ISC), polices SIL OFL, logo et interface originaux.

## Couches

```
src/
  core/        logique pure, sans DOM, testée unitairement
    model/       types du document, fabrique, validation, opérations frames/calques, timing
    history/     annulation/rétablissement (budget pas + mémoire, fusion des actions rapides)
    raster/      remplissage par diffusion, baguette magique, dilatation, bornes alpha
    color/       conversions RGB/HSV/HSL/HEX
    geometry/    matrices affines, transformations libres, symétries
    format/      lecture/écriture du fichier .frameloom (ZIP)
  storage/     IndexedDB (ProjectRepository), paramètres persistés
  engine/      moteur graphique (DOM/canvas)
    CelStore       pixels des cels : décodage à la demande, LRU sous budget, encodage PNG recadré
    brush/         pointes, préréglages, moteur de trait (Stroke)
    tools/         outils (pinceau/crayon/stylo/gomme, formes, remplissage, pipette, sélection,
                   transformation, texte, référence, main) + gizmo de transformation
    Viewport       vue (zoom/pan/rotation), composition, onion skin, grille, guides, règles, symétrie
    Player         lecture temps réel synchronisée à l'audio
    Thumbnails     miniatures basse résolution générées en temps libre
    audio/         AudioEngine (Web Audio)
    export/        MP4/WebM (WebCodecs + muxers), GIF (Web Worker), PNG, séquences, planches
  editor/      session d'édition (EditorSession), commandes annulables, sélection, presse-papiers,
               contrôleur (actions partagées boutons/raccourcis/gestes), raccourcis
  platform/    Capacitor : fichiers, partage, galerie, cycle de vie (pause → sauvegarde de secours)
  ui/          React : accueil, éditeur (barre, rail d'outils, canevas, panneaux, timeline, dialogues),
               paramètres, aide, composants réutilisables
  i18n/        français (par défaut) et anglais
android/       projet Android (Capacitor) + plugin natif FrameloomFiles (SAF / MediaStore)
```

## Modèle de données

* Un **projet** = des **calques** (globaux) × des **frames** (images) ; l'intersection est un **cel**.
* Les frames référencent des cels par identifiant ; les pixels vivent hors du document,
  dans le `CelStore`. Le document est donc un petit objet JSON immuable : chaque modification
  structurelle remplace des tableaux, ce qui rend l'annulation triviale et économe.
* Chaque frame a une **durée d'exposition** (`hold`, en tics de 1/FPS s).

## Rendu

* Le `Viewport` compose la frame **à la résolution du document** dans un canevas de travail :
  fond → références « dessous » → onion skin teinté → calques (opacité + mode de fusion) avec le
  contenu flottant (sélection/texte en cours) inséré au bon calque → références « dessus ».
  Les calques sous le calque actif sont mis en cache ; pendant un trait, seul le rectangle
  modifié est recomposé. L'écran affiche ensuite ce canevas avec la transformation de vue.
* Les modes de fusion utilisent les opérateurs de composition natifs du Canvas 2D ; l'export
  utilise exactement la même fonction de composition (`composeFrame`), donc le rendu exporté est
  identique à l'écran.

## Moteur de trait

Pointeur (événements coalescés, pression) → stabilisateur « fil tendu » → lissage exponentiel →
courbes quadratiques par les milieux → touches espacées selon la taille → symétries.
Les touches s'accumulent dans un tampon à pleine force, puis le tampon est composé sur un
instantané du calque avec l'opacité du trait (pas de surcharge là où le trait se recroise),
masqué par la sélection et texturé par le grain. L'instantané fournit l'image « avant » de
l'annulation : seul le rectangle modifié est conservé (« patch »).

## Mémoire et gros projets

* Les cels sont chargés **à la demande** : un cel enregistré n'est qu'une référence vers un PNG.
* Décodés en `ImageBitmap` **recadrés** pour l'affichage ; un canevas pleine taille n'est créé que
  lorsqu'on dessine dessus.
* Un **LRU** borne la mémoire décodée (budget réglable, défaut selon la RAM de l'appareil) ;
  les cels modifiés sont d'abord encodés en PNG (asynchrone) puis libérés — rien n'est perdu.
* Les cels autour de l'image courante (onion skin) sont épinglés ; la lecture décode en avance.
* Les imports massifs (vidéo, séquences) encodent et libèrent au fil de l'eau.
* L'historique a un budget de pas **et** de mémoire ; les étapes les plus anciennes sont libérées.
* Test automatisé : 40 images Full HD (≈ 330 Mo décodées) restent sous un budget de 128 Mo.

## Sauvegarde

* **Manuelle** : encodage des cels modifiés → médias immuables → nouvelle révision (transaction).
* **Automatique** (30 s / 60 s / 5 min / désactivée) : copie de secours séparée, jamais écrite
  pendant un trait, jamais par-dessus le projet. Déclenchée aussi quand l'app passe en arrière-plan.
* **Récupération** : au démarrage, toute copie de secours non écartée est proposée
  (Restaurer / Ignorer / Supprimer).
* **Versions** : chaque enregistrement est une révision restaurable (N dernières conservées).

## Sécurité et confidentialité

* Aucune donnée n'est envoyée : Content-Security-Policy stricte (`default-src 'self'`) qui interdit
  toute requête vers une autre origine ; aucune analytique.
* Aucune permission demandée à l'utilisateur : sélecteur de fichiers système, enregistrement par
  le sélecteur de documents (SAF) ou MediaStore (Android 10+).
* Fichiers importés : décodés comme médias uniquement ; les projets importés sont validés
  (schéma, bornes, chemins ZIP autorisés, taille décompressée maximale).

## Tests

* `tests/unit` (Vitest) : modèle, timing, opérations, historique, remplissage, couleurs, géométrie,
  stockage IndexedDB (révisions, récupération, corbeille, GC, sauvegarde interrompue, 600 frames),
  format de fichier (aller-retour, fichier corrompu, chemins malveillants), clés i18n.
* `tests/e2e` (Playwright, application réelle) : cycle de vie, frames, calques, outils, sélection,
  texte, onion skin, tous les exports, imports image/audio/vidéo/projet, récupération après crash,
  corbeille, versions, paramètres, projet lourd (40 images Full HD sous budget mémoire).
