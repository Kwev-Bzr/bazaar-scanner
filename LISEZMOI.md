# Bazaar Scanner

Une extension Twitch pour [The Bazaar](https://playthebazaar.com). Les
spectateurs survolent une carte du plateau et lisent sa description complète,
dans leur langue. Un outil de recherche leur donne accès à tout le catalogue,
que la carte soit à l'écran ou non.

Disponible en français, anglais, allemand, espagnol, italien, portugais,
coréen et chinois.

**[Télécharger l'installateur →](https://github.com/Kwev-Bzr/bazaar-scanner/releases)**

## Pourquoi

Sur mes streams, les spectateurs demandaient sans arrêt ce que fait tel ou tel
objet. Répondre à chaque fois casse le rythme de la partie, et les nouveaux
venus se retrouvent perdus. Avec l'extension, il leur suffit de survoler la
carte.

## Pour les streamers

Lancez l'installateur. Il met en place l'application compagnon et le mod, en
trouvant votre dossier de jeu tout seul. Ouvrez ensuite Bazaar Scanner : au
premier lancement, la fenêtre vous propose de vous connecter à Twitch. Activez
enfin l'extension sur votre chaîne.

La fenêtre de l'application montre, page **Partie**, ce que vos spectateurs
peuvent survoler : le résumé de la partie, ce qui vous fait face, votre
plateau, votre réserve, vos talents, et un journal de partie. Le menu de
gauche mène aux réglages :

- **Cadrage**, si le jeu n'occupe pas toute votre scène OBS, pour que les
  zones de survol correspondent à votre mise en page ;
- **Délai**, si un tournoi impose un délai de diffusion. En diffusion normale,
  rien à régler : l'extension suit le lecteur de chaque spectateur ;
- **Diagnostic**, pour tout vérifier d'un coup d'œil, et copier le tout en
  texte quand vous demandez de l'aide.

Un voyant paraît en bas à gauche quand une nouvelle version est publiée.

L'emplacement, la taille, le thème et la police appartiennent à chaque
spectateur, qui les règle depuis le menu de l'extension.

L'application doit tourner pendant votre stream : l'extension n'affiche que ce
qu'elle lui envoie, et rien du tout quand elle est fermée.

## Pour les spectateurs

Le survol d'une carte ouvre sa fiche : description traduite, valeurs par
palier ou celles de la partie en cours, mots-clés colorés, variantes
d'enchantement. Un clic l'épingle, avec un bouton par enchantement.

Un tiroir montre la réserve du streamer, et une rangée en haut ou en bas de la vidéo le
résultat de chaque jour de la partie. Le survol du compteur de victoires, de la
jauge de prestige, du revenu ou de la banque les explique avec le texte du jeu.

Deux boutons en bas à droite du lecteur :

- la **loupe** cherche dans tout le catalogue, y compris dans le texte des
  cartes, avec filtres par héros, type de carte, taille, rareté et effet ;
- le menu **options** règle la langue d'affichage, le thème, l'emplacement de
  la fiche, sa taille et sa police, le tiroir de la réserve et le compteur de
  victoires.

Ces préférences sont conservées dans le navigateur et suivent le spectateur
d'une chaîne à l'autre.

## Ce que le mod fait, et ne fait pas

L'extension a besoin de savoir ce qui est sur le plateau, et seul le jeu le
sait. Un mod BepInEx le lui fournit.

Une fois par seconde, il relève par réflexion le plateau du streamer, sa
réserve, ses talents et son héros, ainsi que la bande d'en face : le plateau
de l'adversaire pendant un combat, et les cartes proposées par une boutique ou
un événement. Il les écrit dans un fichier JSON, que l'application diffuse.
Rien d'autre n'est lu.

La lecture de la bande d'en face est nouvelle en 2.0 ; la version 1.0.0 ne
lisait que le côté du streamer. Tout ce qui est relevé est à l'écran du
streamer au moment où c'est lu : les spectateurs ne voient rien qu'ils ne
verraient en regardant le stream. Les cartes encore cachées au joueur, comme une main non révélée ou un coffre
non ouvert, ne sont pas lues.

Il n'écrit **pas** dans le jeu, ne modifie aucun code, n'accroche pas la
logique de jeu, n'intercepte aucun trafic réseau et n'envoie aucune entrée.

Pour régénérer les fiches après une mise à jour du jeu, j'utilise une routine
qui énumère le catalogue du jeu. Elle n'existe que dans ma version de
développement : le mod distribué aux streamers ne la contient pas. Dans le code
source, elle est rangée avec mes sondes de diagnostic derrière le symbole de
compilation `SONDES`, que la version distribuée ne définit pas.

La description technique complète est dans
[docs/DIVULGATION-TECHNIQUE.md](docs/DIVULGATION-TECHNIQUE.md).

## Comment ça marche

```
The Bazaar                    le jeu
    |
    |  lecture seule par réflexion, une fois par seconde
    v
Mod BepInEx  ------------->  board_state.json      sur le disque du streamer
    |
    v
Application  ------------->  Twitch PubSub          identifiants seuls, ~1 Ko/s
    |                              |
    |  demande un jeton            v
    |  court, 3x par heure    Extension              dans le lecteur du spectateur
    v                              |
Relais (Cloudflare Worker)         |  récupère textes et illustrations
                                   v
                          Hébergement statique
```

Le message envoyé à Twitch porte les positions, les identifiants raccourcis et
la rareté des cartes, les compteurs que le jeu affiche en permanence
(victoires, prestige, jour, résultat de chaque jour), l'endroit où se trouve le
jeu dans la scène du streamer, et le délai de tournoi qu'il a déclaré :

```json
{"v":4,"lang":"fr","h":"Vanessa","b":[{"s":0,"n":2,"id":"a05d23cb","e":"Golden","q":"G"}],
 "k":[{"s":0,"id":"73722d74","q":"D"}],"vi":5,"pr":15,"j":9,"hj":"vdvvdvvv"}
```

Les descriptions et les illustrations sont récupérées par l'extension depuis un
hébergement statique, pas par l'application. L'application reste
ainsi légère et ne consomme presque pas de bande passante, puisque Twitch
transmet le même message à tous les spectateurs, qu'ils soient dix ou trente
mille.

## Les délais

Le plateau adverse est retenu dix secondes à compter du début d'un combat entre
joueurs, et deux secondes contre un monstre. Tout le reste (plateau, réserve,
talents, boutiques, événements) part sans retard, puisque c'est déjà à
l'écran.

L'extension attend en outre le retard propre au lecteur de chaque spectateur :
une carte ne paraît jamais avant d'être visible dans sa vidéo. Pour un tournoi,
le streamer peut régler un délai dans l'application, appliqué avant tout
envoi.

## Le relais, et pourquoi il existe

Une extension Twitch n'a qu'un seul secret de signature. Si la copie de chaque
streamer signait ses propres messages, ce secret devrait être livré dans
l'exécutable, et un exécutable se décompile. N'importe qui pourrait alors
diffuser de faux plateaux sur la chaîne de n'importe qui.

Le secret vit donc dans un Cloudflare Worker. Les streamers s'authentifient
auprès de Twitch, le relais dérive un jeton personnel de leur identifiant de
chaîne par HMAC, et rend un jeton Twitch valable vingt-cinq minutes.
L'application dialogue ensuite directement avec Twitch.

Il n'y a pas de base de données. Les jetons sont dérivés plutôt que stockés,
et le relais les recalcule pour les vérifier. Chaque streamer fait environ
trois appels par heure au relais, si bien que l'offre gratuite de Cloudflare
suffit pour plusieurs milliers d'utilisateurs.

## Vie privée

L'extension ne collecte rien sur les spectateurs. Elle n'utilise ni traqueur
ni cookie publicitaire, et ne leur demande jamais leur identité Twitch. Leur
navigateur garde seulement leurs préférences d'affichage (langue,
emplacement, taille, thème, police, tiroir de la réserve, compteur de
victoires) et le fait qu'ils aient vu le message d'accueil.

L'application n'envoie que la composition de la partie. Les points de vie,
l'or, l'état des combats et les données personnelles ne partent jamais. Son
autorisation Twitch identifie la chaîne, et vous pouvez la révoquer à tout
moment depuis les paramètres de votre compte Twitch.

Texte complet : [politique de confidentialité](https://bazaar-scanner.pages.dev/confidentialite.html)
· [conditions d'utilisation](https://bazaar-scanner.pages.dev/cgu.html)

## Organisation

```
mod/          greffon BepInEx (C#)
app/          application compagnon (Node, empaquetée en un seul .exe)
relay/        Cloudflare Worker
extension/    extension Twitch ; src/ est engendré depuis overlay.html
docs/         divulgation technique, confidentialité, conditions
```

L'application compagnon se construit en l'exécutable que livre l'installateur,
de sorte que n'importe qui peut la reconstruire depuis ces sources et comparer :

```
cd app && bash build.sh
```

The English version of this file is [README.md](README.md).

## Données du jeu

Les descriptions de cartes, les traductions et les illustrations appartiennent
à l'éditeur du jeu et ne sont pas redistribuées ici.

L'extension les récupère depuis un hébergement statique. Ces pages sont
engendrées à l'avance depuis une installation locale du jeu, par des outils
tenus hors de ce dépôt : rien n'est lu sur la machine d'un spectateur ni d'un
streamer.

## À propos

Bazaar Scanner est un projet communautaire indépendant, réalisé avec l'accord
des développeurs du jeu. Il n'a aucun lien officiel avec Tempo Storm ni avec
Twitch.

## Licence

MIT. Voir [LICENSE](LICENSE).
