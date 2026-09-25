# Format de projet Frameloom

Frameloom stocke les projets de deux façons, avec **le même document JSON** :

1. **Stockage interne** (IndexedDB de l'application, hors ligne) — utilisé au quotidien ;
2. **Fichier `.frameloom`** (archive ZIP) — pour sauvegarder, partager ou transférer un projet.

## 1. Le document (`project.json`)

Validé strictement à chaque chargement (`validateSavedProject`, `src/core/model/project.ts`) :
les champs inconnus sont ignorés, les nombres sont bornés, les références cassées
sont réparées et un fichier invalide produit une erreur typée (`ProjectFormatError`)
traduite en message clair pour l'utilisateur.

```jsonc
{
  "format": "frameloom-project",
  "formatVersion": 1,
  "id": "p…",                    // identifiant du projet
  "name": "Ma balle",
  "width": 1280, "height": 720,  // taille du canevas (16 – 4096 px)
  "fps": 12,                     // 1 – 60
  "background": { "color": "#ffffff", "transparent": false },
  "layers": [                    // du bas vers le haut
    { "id": "l…", "name": "Calque 1", "visible": true, "locked": false,
      "opacity": 1, "blendMode": "normal" }   // normal | multiply | screen | overlay | darken | lighten | add | color-dodge | color-burn | hard-light | soft-light | difference | erase
  ],
  "frames": [
    { "id": "f…", "hold": 1,     // durée d'exposition en « tics » (1 tic = 1/fps s)
      "cels": { "<layerId>": "<celId>" } }     // absence = cel vide
  ],
  "cels": {                      // image de chaque cel, recadrée à son contenu
    "<celId>": { "key": "a…", "x": 10, "y": 20, "w": 300, "h": 180 }   // key = PNG, null = vide
  },
  "audio": [                     // pistes audio
    { "id": "at…", "name": "Piste 1", "volume": 1, "muted": false,
      "clips": [ { "id": "ac…", "name": "musique.mp3", "assetKey": "a…", "mime": "audio/mpeg",
                   "start": 0.5,          // position sur la timeline (s)
                   "offset": 1.2,         // début du rognage dans le son (s)
                   "duration": 3.0,       // durée jouée (s)
                   "sourceDuration": 10.4, "volume": 1, "muted": false } ] }
  ],
  "references": [                // images de référence (jamais dessinées dans les calques)
    { "id": "r…", "name": "modele.jpg", "assetKey": "a…", "mime": "image/jpeg",
      "naturalWidth": 800, "naturalHeight": 600, "x": 640, "y": 360, "scale": 0.5, "rotation": 0,
      "opacity": 0.5, "visible": true, "locked": false, "placement": "below", "exportable": false }
  ],
  "palettes": [ { "id": "pal…", "name": "Projet", "colors": ["#rrggbbaa", "…"] } ],
  "brushes": [ /* copie des pinceaux personnalisés de l'utilisateur */ ],
  "view": {                      // réglages d'affichage enregistrés avec le projet
    "grid": { "enabled": false, "size": 64, "color": "#4f7cff", "opacity": 0.25, "snap": false },
    "rulers": false, "guides": [ { "id": "g…", "axis": "x", "pos": 640 } ],
    "guidesVisible": true, "snapGuides": true,
    "symmetry": { "mode": "off", "segments": 6, "cx": 640, "cy": 360, "mirror": true, "visible": true },
    "onion": { "enabled": true, "before": 1, "after": 0, "opacity": 0.35, "falloff": 0.6, "tint": true,
               "colorBefore": "#ff3b5c", "colorAfter": "#1fbf75", "allLayers": true, "loop": false },
    "referencesVisible": true
  },
  "createdAt": 1727250000000, "modifiedAt": 1727250000000
}
```

## 2. Le fichier `.frameloom` (ZIP)

```
project.json            le document ci-dessus (compressé)
manifest.json           { app, formatVersion, exportedAt, assets: { key: { path, mime } } }
cels/<key>.png          une image PNG par cel non vide (recadrée à son contenu)
audio/<key>.<ext>       fichiers audio d'origine (mp3, wav, m4a, ogg…)
references/<key>.<ext>  images de référence d'origine
thumbnail.png           miniature (facultative)
```

* Les médias sont stockés **sans recompression** (déjà compressés) ; le JSON est compressé.
* À l'import : seuls ces chemins sont extraits (aucun chemin arbitraire, aucun exécutable),
  la taille décompressée totale est limitée (protection « zip bomb »), et une image
  manquante transforme simplement le cel en cel vide.

## 3. Stockage interne (IndexedDB `frameloom`)

| Magasin    | Contenu |
|------------|---------|
| `meta`     | fiche d'accueil de chaque projet (nom, taille, nb d'images, FPS, durée, dates, révision, miniature, date de mise à la corbeille) |
| `docs`     | **révisions** enregistrées du document (`<projectId>:<rev>`) — chaque enregistrement manuel crée une version ; les N dernières sont conservées (réglable) |
| `blobs`    | médias immuables (`<projectId>/<key>`) : PNG des cels, audio, références, miniatures |
| `recovery` | copie de secours écrite par la **sauvegarde automatique** (jamais par-dessus le projet) |
| `kv`       | divers |

**Sûreté des sauvegardes** : les médias sont écrits d'abord, puis le document et la fiche
sont validés dans **une seule transaction**. Si l'application est tuée au milieu d'une
sauvegarde, la version précédente reste intacte ; les médias orphelins sont nettoyés
ensuite (`gc`). Les médias étant immuables, les versions et la copie de secours
partagent les mêmes fichiers sans duplication.
