# Bazaar Scanner — description technique

Ce document décrit exactement ce que l'outil lit dans le jeu, ce qu'il en fait,
et ce qu'il n'atteint pas.

Il s'adresse à qui veut vérifier par lui-même : un streamer soucieux de ce qui
tourne sur sa machine, un développeur du jeu, ou quiconque relit le code.

An English version is in [TECHNICAL-DISCLOSURE.md](TECHNICAL-DISCLOSURE.md).

## En une phrase

Un mod BepInEx en lecture seule relève une fois par seconde ce qui est affiché
à l'écran du streamer, et le transmet à une extension Twitch pour que ses
spectateurs puissent lire la description traduite des cartes qu'ils voient
déjà.

## Architecture

Trois composants :

1. **Mod BepInEx** (`BazaarScannerBridge`, C#, BepInEx 5.4.23.5), chargé dans
   le processus du jeu. Écrit un fichier JSON dans son propre dossier.
2. **Application compagnon** (Node.js), qui lit ce fichier et le diffuse sur
   le canal Twitch de la chaîne.
3. **Extension Twitch**, qui affiche la fiche d'une carte quand un spectateur
   passe la souris dessus dans le lecteur vidéo.

## Ce que le mod lit dans le jeu

Une méthode `Update()` de MonoBehaviour, cadencée à **une lecture par seconde**,
par réflexion sur des objets déjà instanciés.

### Points d'accès

- `Data.Run.Player.Hand` — le plateau du joueur
- `Data.Run.Player.Stash` — sa réserve
- `Data.Run.Player.Skills` — ses talents
- `Data.Run.Player.Hero` — son héros
- `Data.Run.Player.Socket` — les effets d'emplacement
- `Data.Run.Opponent` — ce qui fait face au joueur

### La bande d'en face

Depuis la version 2.0, le mod relève aussi ce qui fait face au joueur : le
plateau de l'adversaire pendant un combat, les objets proposés par une
boutique, les choix d'un événement.

**C'est un changement par rapport à la version 1.0, qui ne lisait que le
joueur.** Tout cela est affiché à l'écran du streamer au moment où c'est lu :
le mod ne révèle rien qu'un spectateur ne puisse voir en regardant le stream.

Rien n'est lu qui soit caché au joueur — ni la main de l'adversaire avant
qu'elle ne se révèle, ni le contenu d'un coffre non ouvert, ni l'issue d'un
combat en cours.

L'extension retient par ailleurs le plateau adverse pendant dix secondes au
début d'un combat entre joueurs, et deux secondes contre un monstre, afin que
la diffusion ne devance pas ce que voient les spectateurs.

### Champs relevés, par carte

| Champ | Origine |
|---|---|
| `Template.Id` | identifiant de la carte |
| `Template.InternalName` | nom interne |
| `Template.Localization.Title` | titre localisé |
| `Size`, `Tier`, `Enchantment` | état de l'exemplaire |
| `Socket` | position |
| `Template.ArtKey` | référence de l'illustration |
| `SocketEffects` | notes, fourneau, glacière |

### Définitions de cartes

Le mod contient une routine **inactive par défaut** qui énumère le catalogue
du jeu et sérialise le texte de chaque carte dans un fichier local.

Elle ne s'exécute que si un fichier vide nommé `extraire-catalogue` est placé
à côté de la DLL, ce que l'installateur ne fait jamais. Elle sert à
l'auteur de l'outil pour régénérer les fiches après une mise à jour du jeu ;
elle n'a aucune utilité pour un streamer et reste dormante sur sa machine.

Le contenu ainsi relevé est **statique** — identique pour tous les joueurs —
et non de l'information de partie.

### Base de données

L'outil extrait `TheBazaar_Data/StreamingAssets/GameData.db.zip`, livré avec le
jeu, vers son propre dossier, et l'ouvre en **lecture seule** (SQLite). Le
fichier du jeu n'est jamais modifié.

## Ce que le mod NE fait PAS

- **Aucune écriture dans le jeu.** Pas de modification de mémoire, pas
  d'altération d'état, pas de valeur renvoyée au jeu.
- **Aucun patch de code.** Pas de Harmony, aucun hook sur la logique de jeu.
  Uniquement de la lecture par réflexion.
- **Aucune interception réseau.** Pas de lecture de paquets, pas de proxy.
- **Aucune information cachée.** Tout ce qui est relevé est déjà affiché à
  l'écran du joueur, donc déjà visible par ses spectateurs.
- **Aucune automatisation.** Le mod n'envoie aucune entrée au jeu, ne clique
  pas, ne recommande aucun coup.
- **Aucune écriture hors de son dossier.** Les deux fichiers qu'il produit
  vivent dans `BepInEx/plugins/BazaarScannerBridge/`.

## Ce qui sort de la machine du streamer

Une fois par seconde au maximum, un message d'environ 2 à 4 Ko est diffusé sur
le canal Twitch de la chaîne :

```json
{"v":2,"lang":"fr",
 "b":[{"s":0,"n":2,"id":"<TemplateId>","e":"Golden","q":"Gold"}],
 "k":[{"s":0,"id":"<TemplateId>","q":"Diamond"}],
 "f":[{"s":3,"n":2,"id":"<TemplateId>"}],
 "d":30}
```

Soit : position, taille, identifiant, enchantement et qualité, pour le plateau,
la réserve, les talents et la bande d'en face ; plus le délai de diffusion que
le streamer a déclaré.

Aucun état de combat, aucun point de vie, aucune ressource, aucune donnée
personnelle.

Les descriptions et les illustrations sont servies séparément depuis un
hébergement statique public. Elles sont dérivées de `GameData.db`, donc des
données du jeu lui-même.

## Diffusion

L'outil est distribué aux streamers sous forme d'installateur Windows. Le mod
est compilé par l'auteur. L'extension Twitch est publiée et soumise à la revue
de Twitch à chaque version.

Le code de l'ensemble — mod, application, extension, relais — est public :
https://github.com/Kwev-Bzr/bazaar-scanner

## Contact

Toute question ou objection de la part des développeurs du jeu sera traitée
sans délai, y compris le retrait d'une fonction qui poserait problème.
