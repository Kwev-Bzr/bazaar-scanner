# Bazaar Scanner - description technique

Version 3.0 - mise à jour du 12 octobre 2026

Ce document décrit exactement ce que l'outil lit dans le jeu, ce qu'il en fait,
et ce qu'il n'atteint pas.

Il est là pour ceux qui veulent vérifier par eux-mêmes, que ce soit un
streamer qui se demande ce qui tourne sur sa machine ou un développeur du jeu.

An English version is in [TECHNICAL-DISCLOSURE.md](TECHNICAL-DISCLOSURE.md).

## En une phrase

Un mod BepInEx en lecture seule relève une fois par seconde ce qui est affiché
à l'écran du streamer, et le transmet à une extension Twitch pour que ses
spectateurs puissent lire la description traduite des cartes qu'ils voient
déjà.

## Aucune donnée conservée

Bazaar Scanner ne garde rien sur personne. Je n'ai aucun serveur qui
enregistre quoi que ce soit, aucune base de données, aucun outil de
statistiques, et je ne vends ni ne partage aucune donnée. Le but est
d'afficher des cartes, pas de suivre des joueurs.

Concrètement :

- **Les spectateurs** : l'extension ne connaît pas leur identité Twitch et ne
  leur envoie rien. Seules leurs préférences d'affichage (langue, taille,
  thème…) restent dans leur propre navigateur.
- **Les streamers** : le relais qui délivre le jeton Twitch le calcule à la
  volée et ne l'enregistre nulle part. Il n'a ni base de données ni journal.
  Tout ce qui est écrit l'est sur le PC du streamer (réglages de
  l'application, historique de la partie en cours, fichiers du mod dans le
  dossier du jeu), et rien de tout cela ne quitte sa machine.
- **Les parties** : le message envoyé sur Twitch est diffusé en direct aux
  spectateurs, puis remplacé par le suivant. Je n'en garde aucune copie, et
  aucun historique de partie n'est constitué ailleurs que chez le streamer.

Les fiches et les illustrations sont servies par Cloudflare, qui peut tenir
ses propres journaux techniques comme tout hébergeur. Ces requêtes ne portent
aucun identifiant : elles demandent une carte, pas une personne.

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

- `Data.Run.Player.Hand` : le plateau du joueur
- `Data.Run.Player.Stash` : sa réserve, y compris quand le coffre est fermé
- `Data.Run.Player.Skills` : ses talents
- `Data.Run.Player.Hero` : son héros
- `Data.Run.Player.Socket` : les effets d'emplacement
- `Data.Run.Opponent` : ce qui fait face au joueur, et les talents de
  l'adversaire en combat
- le nombre de victoires, le prestige restant et son maximum, le jour en
  cours et le mode de la partie (normal, classé ou tournoi), affichés en
  permanence à l'écran du jeu
- `Application.version` : le numéro de version du jeu, lu une fois au
  lancement pour la page Diagnostic de l'application. Il n'est jamais envoyé
  à Twitch.

Au menu principal, le jeu garde la dernière partie en mémoire, mais son héros
y vaut « Common ». L'application tient cet état pour « hors partie » : elle
n'envoie alors ni jour ni compteurs, et l'extension masque le compteur de
victoires et les zones d'aide.

### La bande d'en face

Le mod relève ce qui fait face au joueur : le plateau de l'adversaire pendant
un combat, ses talents, les objets proposés par une boutique, les choix d'un
événement. Tout cela est affiché à l'écran du streamer au moment où c'est lu :
le mod ne révèle rien qu'un spectateur ne puisse voir en regardant le stream.

Rien n'est lu qui soit caché au joueur : ni la main de l'adversaire avant
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
| `Attributes` : `CritChance`, `Multicast`, `CooldownMax`, `AmmoMax` | chance de critique, Multicast, délai d'activation et munitions actuels |
| `Tags` (comparés à ceux du modèle) | tags gagnés en partie |
| `Quests` | avancement des quêtes de l'exemplaire |
| valeurs de l'infobulle | les nombres que l'infobulle du jeu affiche |

### Nouveau en 3.0 : les valeurs actuelles des cartes

Une carte change au fil d'une partie : ses dégâts montent, sa chance de
critique aussi, une quête avance, certains objets gagnent ou perdent du
Multicast en combat. Le jeu affiche ces valeurs dans l'infobulle de la carte,
quand le streamer la survole.

Pour que la fiche montre la même chose, le mod lit la chance de critique, le
Multicast, le délai d'activation et les munitions dans les attributs de la carte, l'avancement de ses quêtes, et les
nombres de son infobulle. Pour ces derniers, il appelle les fonctions par
lesquelles le jeu prépare lui-même cette infobulle
(`CardTooltipData.CreateCardTooltipData`, puis `Resolve()` sur chaque valeur),
et ne garde que les nombres obtenus. Ces fonctions construisent un texte ; elles
ne modifient ni la carte ni la partie.

Ce sont exactement les valeurs que le joueur voit en survolant la carte en jeu.

Les choix d'un événement fonctionnent un peu autrement : leur valeur dépend de
la partie, comme « gagnez 2 de prestige pour chaque combat contre un joueur
perdu cette partie ». Pour ceux-là, le mod calcule la valeur comme le jeu, à
partir du même compteur de partie que le jeu utilise pour cette infobulle (ici,
les combats perdus contre des joueurs), multiplié par le nombre écrit sur la
carte. Il ne fait que lire ce compteur.

### Définitions de cartes

Pour régénérer les fiches après une mise à jour du jeu, j'utilise une routine
qui parcourt le catalogue du jeu et enregistre le texte de chaque carte dans un
fichier local.

Elle n'existe que dans ma propre version de développement du mod. **Le mod
distribué aux streamers ne la contient pas**, pas plus que les sondes de
diagnostic dont je me sers pendant le développement.

Le contenu ainsi relevé est **statique**, identique pour tous les joueurs, et
non de l'information de partie.

### Base de données

L'outil extrait `TheBazaar_Data/StreamingAssets/GameData.db.zip`, livré avec le
jeu, vers son propre dossier, et l'ouvre en **lecture seule** (SQLite). Le
fichier du jeu n'est jamais modifié.

## Ce que le mod ne fait pas

- **Il n'écrit rien dans le jeu.** Ni la mémoire ni l'état de la partie ne
  sont modifiés, et aucune valeur n'est renvoyée au jeu.
- **Il ne patche aucun code.** Pas d'Harmony ni de hook sur la logique de jeu :
  seulement de la lecture par réflexion, et l'appel des fonctions qui
  préparent les infobulles, décrit plus haut.
- **Il n'intercepte pas le réseau**, ne lit aucun paquet et ne passe par aucun
  proxy.
- **Il ne lit rien de caché.** Tout ce qu'il relève est déjà affiché à l'écran
  du joueur, ou dans l'infobulle qu'il obtient en survolant une carte.
- **Il n'agit pas à la place du joueur.** Il n'envoie aucune entrée au jeu, ne
  clique nulle part et ne conseille aucun coup.
- **Il reste dans son dossier.** Les fichiers qu'il produit sont tous dans
  `BepInEx/plugins/BazaarScannerBridge/`.
- **Sa charge ne grossit pas avec le temps.** Il ne garde en mémoire que la
  lecture en cours, et limite ce qu'il écrit dans le journal de BepInEx : une
  erreur qui se répète n'y figure que trois fois, puis une fois sur deux cents.

## Ce qui sort de la machine du streamer

Une fois par seconde au maximum, un message de 5 Ko au plus est diffusé sur le
canal Twitch de la chaîne. Inchangé, il est renvoyé toutes les deux secondes,
pour les spectateurs qui arrivent en cours de route :

```json
{"v":4,"lang":"fr","h":"Vanessa",
 "b":[{"s":0,"n":2,"id":"1a2b3c4d","e":"Golden","q":"G",
       "cc":25,"mc":2,"qp":"3/5","jv":"a1=12"}],
 "k":[{"s":0,"id":"5e6f7a8b","q":"D"}],
 "r":[{"s":0,"id":"9c0d1e2f","q":"S"}],
 "f":[{"s":3,"n":2,"id":"3a4b5c6d","e":"Shiny"}],
 "vi":5,"pr":15,"px":20,"m":"r","j":9,"hj":"vdvvdvvv",
 "d":300}
```

Soit, pour le plateau (`b`), les talents (`k`), la réserve (`r`) et la bande
d'en face (`f`, `fk`) : la position, la taille, l'identifiant raccourci,
l'enchantement et la rareté de chaque carte ; pour les objets, leur chance de
critique (`cc`), leur Multicast (`mc`), leur délai (`cd`), leurs munitions
(`am`), leurs tags gagnés en partie (`ta`), l'avancement de leurs quêtes (`qp`) et les valeurs de leur infobulle
(`jv`). S'y ajoutent le héros joué (`h`), le nombre de victoires (`vi`), le
prestige restant et son maximum (`pr`, `px`), le mode classé ou tournoi
(`m`), le jour en cours (`j`) et le résultat de chaque jour déjà joué (`hj`, une lettre par
jour : victoire, défaite, refus de la mort), déduit des victoires et du
prestige, la
langue, la place du jeu dans la scène du streamer (`c`), et le délai de
diffusion qu'il a déclaré (`d`).

Les points de vie, les ressources (or, revenu, niveau) et les données
personnelles n'en font pas partie. Le nombre de victoires et le prestige sont ceux que l'écran du jeu
affiche en permanence ; rien n'est dit d'un combat en cours.

Si le streamer règle un délai de tournoi, l'application retient le message
pendant ce délai avant de l'envoyer.

Les descriptions et les illustrations sont servies séparément depuis un
hébergement statique public. Elles sont dérivées de `GameData.db`, donc des
données du jeu lui-même.

Le message est construit au plus court : un identifiant de carte réduit à ses
huit premiers caractères, la rareté en une lettre, la taille et la chance de
critique omises quand elles valent la valeur par défaut. Un message ordinaire
pèse de 1 à 3 Ko.

## Ce que l'extension reçoit d'ailleurs

Hors du message ci-dessus, l'extension ne télécharge que des fichiers publics
et statiques depuis `bazaar-scanner.pages.dev` : les fiches des cartes, leurs
illustrations, et des réglages d'affichage (thèmes, textes de l'interface,
disposition des emplacements, et les textes d'aide du compteur de victoires,
du prestige, du revenu et de la banque, tirés des infobulles du jeu). Ce sont des données JSON et des images ; aucun
code n'est chargé à distance. Les polices viennent de Google Fonts, par un
lien fixe inscrit dans l'extension.

## Ce que l'application fait d'autre

- **Version publiée.** Au lancement, puis toutes les six heures, elle lit
  l'index public de `bazaar-scanner.pages.dev` pour savoir si une version plus
  récente existe. Si c'est le cas, un voyant le signale dans sa fenêtre. Cette
  requête ne porte aucun identifiant.
- **Mise à jour.** Seulement si le streamer clique sur ce voyant et confirme,
  l'application télécharge l'installateur de la dernière version depuis la
  page des versions du dépôt GitHub public. Elle ne le lance que si son
  empreinte SHA-256 est celle publiée avec le numéro de version, et jamais
  pendant que le jeu est ouvert. Windows demande alors l'autorisation
  d'installer, comme pour une installation manuelle. Rien n'est téléchargé ni
  installé sans ce clic.
- **Diagnostic.** Sa page Diagnostic rassemble des informations locales :
  version de la DLL et du jeu, date des fichiers du mod, dernière lecture du
  jeu, état du relais, nombre de messages envoyés et refus éventuels de
  Twitch, poids du dernier message. Rien de tout cela n'est envoyé ; le bouton
  « Copier le diagnostic » le place dans le presse-papiers du streamer, qui
  en fait ce qu'il veut.
- **Fenêtre locale.** Sa fenêtre est une page servie sur `127.0.0.1`.
  Elle n'accepte que les requêtes adressées à cette adresse, et les actions
  qui lisent ou modifient la configuration exigent un secret tiré à chaque
  lancement. L'application s'arrête quand sa dernière fenêtre se ferme.

## Diffusion

L'outil est distribué aux streamers sous forme d'installateur Windows, qui
prend en charge la version Steam du jeu et le client Tempo. Le mod est compilé
par l'auteur. La désinstallation retire le mod des deux. L'extension Twitch est
publiée et soumise à la revue de Twitch à chaque version.

Le code de l'ensemble (mod, application, extension, relais) est public :
https://github.com/Kwev-Bzr/bazaar-scanner

## Contact

Toute question ou objection de la part des développeurs du jeu sera traitée
sans délai, y compris le retrait d'une fonction qui poserait problème.
