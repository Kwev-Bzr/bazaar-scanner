# Bazaar Scanner — description technique

Document destiné aux développeurs de The Bazaar. Il décrit exactement ce que
l'outil lit dans le jeu, ce qu'il en fait, et ce qu'il n'atteint pas.

## En une phrase

Un mod BepInEx en lecture seule relève une fois par seconde la composition du
plateau **du joueur qui streame**, et la transmet à un overlay pour que ses
spectateurs puissent consulter la description traduite des objets qu'ils voient
déjà à l'écran.

## Architecture

Trois composants :

1. **Mod BepInEx** (`BazaarScannerBridge`, C#, BepInEx 5.4.23.5) chargé dans le
   processus du jeu. Écrit un fichier JSON sur le disque local.
2. **Application locale** (Node.js) qui lit ce fichier et sert un overlay OBS.
3. **Extension Twitch** qui affiche la fiche d'un objet quand un spectateur
   passe la souris dessus dans le lecteur vidéo.

## Ce que le mod lit dans le jeu

Une méthode `Update()` de MonoBehaviour, cadencée à **une lecture par seconde**.

### Points d'accès

- `Data.Run.Player.Hand` — le plateau du joueur local
- `Data.Run.Player.Skills` — ses talents
- `Data.Run.Player.Hero` — son héros

### Champs relevés, par carte

| Champ | Origine |
|---|---|
| `Template.Id` | identifiant de la carte |
| `Template.InternalName` | nom interne |
| `Template.Localization.Title` | titre localisé |
| `Size`, `Tier`, `Enchantment` | état de l'exemplaire possédé |
| `Socket` | position sur le plateau |
| `Template.ArtKey` | référence de l'illustration |

### Définitions de cartes

À la première rencontre d'une carte, le mod sérialise son `Template`
(localisation, tooltips, capacités) dans un fichier local, pour disposer du
texte des cartes trop récentes pour la base embarquée. C'est du **contenu
statique**, identique pour tous les joueurs, pas de l'information de partie.

### Base de données

L'application extrait `TheBazaar_Data/StreamingAssets/GameData.db.zip`, livré
avec le jeu, vers son propre dossier, et l'ouvre en **lecture seule** (SQLite).
Le fichier du jeu n'est jamais modifié.

## Ce que le mod NE fait PAS

- **Aucune écriture dans le jeu.** Pas de modification de mémoire, pas
  d'altération d'état, pas de valeur renvoyée au jeu.
- **Aucun patch de code.** Pas de Harmony, aucun hook sur la logique de jeu.
  Uniquement de la lecture par réflexion sur des objets déjà instanciés.
- **Aucune interception réseau.** Pas de lecture de paquets, pas de proxy.
- **Aucune donnée de l'adversaire n'est lue ni transmise.** Le mod n'accède
  qu'à `Data.Run.Player` ; rien dans le code ne parcourt ni n'inspecte les
  objets liés à l'adversaire ou à la boutique.
- **Aucune information cachée.** Tout ce qui est relevé est déjà affiché à
  l'écran du joueur, donc déjà visible par ses spectateurs.
- **Aucune automatisation.** Le mod n'envoie aucune entrée au jeu, ne clique
  pas, ne recommande aucun coup.

## Ce qui sort de la machine du joueur

Une fois par seconde au maximum, un message d'environ 1 à 2 Ko est envoyé à
l'API Twitch, contenant uniquement :

```json
{"v":1,"lang":"fr","b":[{"s":0,"n":2,"id":"<TemplateId>","e":"Golden","q":"Gold"}],
 "k":[{"s":0,"id":"<TemplateId>","q":"Diamond"}]}
```

Soit : position, taille, identifiant, enchantement et qualité — pour le plateau
et les talents du streamer uniquement. Aucune donnée personnelle, aucune donnée
de partie autre que ce qui est déjà à l'écran.

Les descriptions de cartes sont servies séparément depuis un hébergement
statique public. Elles sont dérivées de `GameData.db` et d'une traduction
française réalisée par l'auteur.

## Diffusion

L'outil est distribué aux streamers sous forme d'installateur Windows. Le mod
est compilé par l'auteur. L'extension Twitch est actuellement en test privé.

## Questions posées aux développeurs

1. Cette lecture du plateau du joueur local pose-t-elle un problème au regard
   de vos règles ?
2. La rediffusion des illustrations de cartes et de descriptions traduites
   appelle-t-elle des conditions particulières de votre part ?
3. Y a-t-il un cadre existant pour les outils communautaires que nous devrions
   respecter ?
