# Fonctionnalités de Frameloom — état réel

Légende : ✅ terminé et testé · 🟡 partiellement terminé (limite expliquée) · 🔴 non implémenté

> Vérifié par 43 tests unitaires et 23 tests de bout en bout exécutés sur l'application réelle
> (Chromium, même moteur que la WebView Android). L'APK n'a pas pu être lancé sur un appareil ou
> un émulateur dans l'environnement de développement (pas de virtualisation disponible) : voir
> « Limites » dans le README.

## Accueil et projets
| Fonction | État |
|---|---|
| Nouveau projet (nom, largeur, hauteur, FPS, durée ↔ nombre d'images, fond, transparence, orientation) | ✅ |
| Préréglages (vidéo HD/Full HD/SD/4K, formats sociaux 9:16, 4:5, 16:9, carrés, petit) + personnalisé | ✅ |
| Projets récents : miniature, nom, dimensions, nb d'images, FPS, durée, date de modification | ✅ |
| Ouvrir / importer un fichier `.frameloom` | ✅ |
| Importer image / séquence / vidéo → nouveau projet à la bonne taille | ✅ |
| Renommer, dupliquer, exporter le fichier projet, supprimer | ✅ |
| Corbeille (restauration, suppression définitive, vidage, purge auto à 30 jours) | ✅ |
| Versions enregistrées (ouvrir une ancienne version) | ✅ |
| Paramètres du projet modifiables après création (nom, FPS, fond, taille du canevas avec mise à l'échelle ou ancrage) | ✅ (le redimensionnement vide l'historique d'annulation) |
| Recherche de projets | ✅ |

## Canevas
| Fonction | État |
|---|---|
| Zoom, déplacement, rotation, réinitialisation, ajuster à l'écran, taille réelle | ✅ |
| Gestes : pincer, glisser et pivoter à deux doigts ; tape à 2/3 doigts configurable | ✅ |
| Plein écran (interface masquée + barre d'état Android masquée) | ✅ |
| Grille (taille, couleur, opacité, magnétisme) | ✅ |
| Règles horizontale/verticale, guides (depuis les règles ou le panneau), magnétisme | ✅ (règles masquées si la vue est pivotée) |
| Damier de transparence, couleur de fond personnalisée | ✅ |
| Rejet de la paume (stylet seul, ou doigts ignorés 3 s après usage du stylet) | ✅ |
| Rendu fluide (recomposition partielle, événements coalescés) | ✅ |

## Dessin
| Fonction | État |
|---|---|
| Pinceau, crayon, stylo (14 préréglages intégrés) | ✅ |
| Taille, opacité, flux, dureté, espacement, lissage, stabilisation, pression (taille/opacité), sensibilité, taille mini, effilement, forme/angle/aplatissement de pointe, grain, variations, anticrénelage | ✅ |
| Créer / modifier / dupliquer / renommer / supprimer / réinitialiser un pinceau, aperçu du trait | ✅ |
| Pinceaux personnalisés sauvegardés (globalement et copiés dans le projet) | ✅ |
| Gomme avec réglages propres (taille, opacité, dureté, forme, lissage, stabilisation) | ✅ |
| Effacement de zone (rectangle, lasso) et effacement du calque | ✅ |
| Formes : ligne, rectangle (coins arrondis), ellipse, polygone, étoile, flèche ; contour/remplissage, depuis le centre, contraintes | ✅ |
| Remplissage (tolérance, contigu ou global, tous calques, extension anti-halo, respect de la sélection) | ✅ |
| Pipette (outil, appui long avec un pinceau, Alt) | ✅ |
| Symétrie verticale, horizontale, quadruple, radiale (+ miroir) avec centre déplaçable | ✅ (pinceaux, gomme, formes) |

## Couleurs
| Fonction | État |
|---|---|
| Roue chromatique + carré TSV, sliders TSV / RVB / TSL, HEX, alpha | ✅ |
| Couleurs principale/secondaire, échange | ✅ |
| Couleurs récentes | ✅ |
| Palettes globales et palettes du projet : créer, renommer, supprimer, ajouter/retirer des couleurs | ✅ |

## Sélection et transformation
| Fonction | État |
|---|---|
| Rectangle, lasso, baguette magique (par couleur, contiguë ou globale) ; nouvelle/ajout/soustraction/intersection | ✅ |
| Déplacer (glisser dans la sélection), redimensionner, pivoter, retourner H/V | ✅ |
| Copier, couper, coller, dupliquer, effacer, remplir, inverser, tout sélectionner | ✅ |
| Déplacer la sélection vers un autre calque | ✅ |
| Poignées de transformation, valeurs numériques (X, Y, échelles, angle, inclinaison) | ✅ |
| Transformation libre | 🟡 affine (échelles indépendantes + rotation + inclinaison) ; pas de déformation en perspective |
| Transparence préservée | ✅ |

## Calques
| Fonction | État |
|---|---|
| Créer, supprimer, renommer, dupliquer, réorganiser (glisser ou boutons), fusionner vers le bas | ✅ |
| Masquer, verrouiller, opacité | ✅ |
| Modes de fusion : normal, multiply, screen, overlay, darken, lighten, add, color dodge/burn, hard/soft light, difference, erase | ✅ |
| Intégration timeline (lignes de calques) | ✅ |

## Timeline et animation
| Fonction | État |
|---|---|
| Miniatures, numéros, durée, calque, image active, tête de lecture, défilement | ✅ |
| Créer, insérer, dupliquer, supprimer, déplacer (glisser), réordonner, inverser | ✅ |
| Sélection multiple (Maj, Ctrl ou mode sélection multiple), copier/coller/déplacer/supprimer plusieurs frames | ✅ |
| Durée d'exposition par frame, FPS modifiable | ✅ |
| Lecture, pause, arrêt, première/dernière, précédente/suivante, boucle, vitesse | ✅ |
| Virtualisation (centaines/milliers de frames) | ✅ |
| Onion skin : avant/après, nombre, opacité, atténuation, teintes, tous calques ou calque actif, boucle | ✅ |

## Audio
| Fonction | État |
|---|---|
| Import (MP3, WAV, M4A/AAC, OGG/Opus, FLAC — selon les décodeurs de l'appareil) | ✅ |
| Plusieurs pistes, volume/muet par piste et par clip | ✅ |
| Déplacement, rognage des extrémités, découpe à la tête de lecture, suppression, écoute | ✅ |
| Waveform, synchronisation avec les frames (magnétisme sur les images) | ✅ |

## Import
| Fonction | État |
|---|---|
| Image (nouveau calque ou objet à transformer), glisser-déposer | ✅ |
| Séquence d'images (tri naturel, une image par frame) | ✅ |
| Vidéo → frames : FPS, résolution, adaptation, plage temporelle, conserver l'audio, destination | ✅ (extraction par recherche d'image : lente pour de longues vidéos) |
| Audio, image de référence, projet `.frameloom` | ✅ |

## Texte
| Fonction | État |
|---|---|
| Saisie multi-lignes, 7 polices libres intégrées + polices système, taille, gras, italique, alignement, interligne, espacement, couleur/transparence, contour, ombre | ✅ |
| Position précise, rotation, mise à l'échelle, inclinaison | ✅ |
| Réédition du texte | 🟡 possible jusqu'à la validation ; le texte devient ensuite des pixels |

## Références
| Fonction | État |
|---|---|
| Import, déplacement, redimensionnement, rotation, opacité, verrouillage, masquage, dessous/dessus | ✅ |
| Exclues de l'export sauf demande explicite | ✅ |

## Undo / Redo
| Fonction | État |
|---|---|
| Dessin, gomme, formes, remplissage, sélection, transformation, texte, import, frames, calques, audio, références, palettes du projet, paramètres du projet | ✅ |
| Changements de couleur et de taille dans l'historique (désactivable) | ✅ |
| Budget de pas et de mémoire, fusion des modifications rapides | ✅ |
| Redimensionnement du canevas | 🟡 non annulable (confirmation + historique vidé) |

## Lecture / aperçu
| Fonction | État |
|---|---|
| Lecture, pause, boucle, vitesses 0,25× / 0,5× / 1× / 2× / 4×, depuis le début ou l'image courante, image par image, plein écran, audio synchronisé | ✅ |

## Export
| Fonction | État |
|---|---|
| MP4 | ✅ H.264 si l'appareil sait l'encoder (quasi tous les Android), sinon H.265/VP9/AV1 dans un MP4 ; audio AAC ou Opus |
| WebM (VP9/VP8 + Opus) | ✅ |
| GIF animé (encodé dans un Worker, durées d'exposition respectées, transparence 1 bit, boucle) | ✅ |
| PNG (image courante), séquence PNG (.zip), planche de sprites | ✅ |
| Fichier projet `.frameloom` | ✅ |
| Résolution, FPS, qualité, transparence, plage, audio, références, estimation de taille | ✅ |
| Transparence en WebM | 🟡 seulement si l'encodeur de l'appareil gère l'alpha (rare) |
| Enregistrer sous… (sélecteur système), partager, galerie (Android 10+), téléchargement (web) | ✅ |
| Jamais d'écrasement du projet | ✅ |

## Sauvegarde
| Fonction | État |
|---|---|
| Format natif documenté (docs/FORMAT.md) | ✅ |
| Sauvegarde manuelle (Ctrl+S), détection des modifications non enregistrées | ✅ |
| Sauvegarde automatique 30 s / 60 s / 5 min / désactivée, jamais pendant un trait | ✅ |
| Récupération après crash (Restaurer / Ignorer / Supprimer) | ✅ |
| Système de versions | ✅ |
| Sauvegarde interrompue sans perte de la version précédente | ✅ |

## Paramètres
| Fonction | État |
|---|---|
| Général : langue (FR/EN), thème clair/sombre/système, autosave, démarrage | ✅ |
| Dessin : taille par défaut, lissage, stabilisation, pression, stylet seul, historique | ✅ |
| Animation : FPS par défaut, onion skin, lecture auto, boucle | ✅ |
| Interface : taille des boutons, disposition droitier/gaucher, timeline, mode compact, infobulles, animations réduites, gestes | ✅ |
| Export : qualité, résolution par défaut | ✅ |
| Stockage : espace utilisé, versions conservées, mémoire max, nettoyage du cache, protection du stockage, sauvegarde de tous les projets | ✅ |
| Emplacement des projets | 🟡 stockage privé de l'application (non déplaçable) ; export du fichier projet / sauvegarde .zip pour copier ailleurs |
| Raccourcis clavier personnalisables (détection de conflits) | ✅ |

## Interface, accessibilité, erreurs
| Fonction | État |
|---|---|
| Tablette paysage (outils / canevas / panneaux / timeline), portrait, téléphone, desktop | ✅ |
| Panneaux redimensionnables (panneau latéral, timeline), repliables | ✅ |
| Mode sombre | ✅ |
| Boutons tactiles réglables, contraste, libellés accessibles (aria), focus visible, taille d'interface | ✅ |
| Lecteurs d'écran | 🟡 commandes étiquetées ; le contenu dessiné n'est évidemment pas décrit |
| Messages d'erreur compréhensibles + « Voir les détails techniques » | ✅ |
| Bouton retour Android (dialogues → panneaux → éditeur) | ✅ |

## Performances
| Fonction | État |
|---|---|
| Chargement à la demande, cache LRU sous budget, cels recadrés, libération mémoire | ✅ |
| Miniatures basse résolution générées en temps libre | 🟡 sur le thread principal par petites tranches (pas dans un Worker) |
| Export non bloquant et annulable | ✅ |
| Rendu GPU | 🟡 Canvas 2D accéléré par le GPU de la WebView (pas de moteur WebGL dédié) |
