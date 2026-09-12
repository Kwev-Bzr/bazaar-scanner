# Bazaar Scanner

Une extension Twitch pour [The Bazaar](https://playthebazaar.com). Les
spectateurs survolent une carte du plateau et lisent sa description complète,
dans leur langue. Un outil de recherche leur donne accès à tout le catalogue,
que la carte soit à l'écran ou non.

Disponible en français, anglais, allemand, espagnol, italien, portugais,
coréen et chinois.

**[Télécharger l'installateur →](https://github.com/Kwev-Bzr/bazaar-scanner/releases)**

## Pourquoi

Les spectateurs passent la moitié du stream à demander ce que font les objets.
Cela coupe le streamer dans son élan et laisse les nouveaux venus de côté. Le
survol répond à la question sans que personne ait à la poser.

## Pour les streamers

Lance l'installateur. Il met en place l'application compagnon et le mod, en
trouvant ton dossier de jeu tout seul. Ouvre ensuite Bazaar Scanner, clique sur
**Se connecter avec Twitch**, et active l'extension sur ta chaîne.

Si le jeu n'occupe pas toute ta scène OBS, sers-toi de **Calibrer** pour que
les zones de survol correspondent à ta mise en page. Tu peux aussi déclarer le
délai de ta diffusion, afin que les cartes restent en phase avec ce que voient
tes spectateurs.

L'emplacement, la taille, la teinte et la police appartiennent à chaque
spectateur, qui les règle depuis le menu de l'extension.

L'application doit tourner pendant ton stream : l'extension n'affiche que ce
qu'elle lui envoie, et rien du tout quand elle est fermée.

## Pour les spectateurs

Le survol d'une carte ouvre sa fiche : description traduite, valeurs par
palier, mots-clés colorés, variantes d'enchantement.

Trois boutons en bas à droite du lecteur :

- la **loupe** cherche dans tout le catalogue, avec filtres par héros, type de
  carte, taille, rareté et effet ;
- le menu **options** règle l'emplacement de la fiche, sa taille, sa teinte et
  sa police ;
- le **globe** change la langue d'affichage.

Ces préférences sont conservées dans le navigateur et suivent le spectateur
d'une chaîne à l'autre.

## Ce que le mod fait, et ne fait pas

L'extension a besoin de savoir ce qui est sur le plateau, et seul le jeu le
sait. Un mod BepInEx le lui fournit.

Une fois par seconde, il relève par réflexion le plateau du streamer, sa
réserve, ses talents et son héros, ainsi que la bande d'en face — le plateau
de l'adversaire pendant un combat, et les cartes proposées par une boutique ou
un événement. Il les écrit dans un fichier JSON, que l'application diffuse.
Rien d'autre n'est lu.

La lecture de la bande d'en face est nouvelle en 2.0 ; la version 1.0.0 ne
lisait que le côté du streamer. Tout ce qui est relevé est à l'écran du
streamer au moment où c'est lu : les spectateurs ne voient rien qu'ils ne
verraient en regardant le stream. Les cartes encore cachées au joueur — une
main non révélée, un coffre non ouvert — ne sont pas lues.

Il n'écrit **pas** dans le jeu, ne modifie aucun code, n'accroche pas la
logique de jeu, n'intercepte aucun trafic réseau et n'envoie aucune entrée.

Le mod contient une routine supplémentaire, **inactive par défaut**, qui
énumère le catalogue du jeu. Elle ne s'exécute que si un fichier vide nommé
`extraire-catalogue` est placé à côté de la DLL, ce que l'installateur ne fait
jamais. Elle sert à l'auteur pour régénérer les fiches après une mise à jour
du jeu ; les streamers n'en ont aucun usage, et elle reste dormante sur leur
machine.

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

Le message envoyé à Twitch porte les positions et les identifiants des cartes,
l'endroit où se trouve le jeu dans la scène du streamer, et le délai de
diffusion qu'il a déclaré :

```json
{"v":2,"lang":"fr","b":[{"s":0,"n":2,"id":"a05d23cb-...","e":"Golden","q":"Gold"}],
 "k":[{"s":0,"id":"73722d74-...","q":"Diamond"}],"d":30}
```

Les descriptions et les illustrations sont récupérées par l'extension depuis un
hébergement statique, pas par l'application. C'est ce qui garde l'application
légère et la bande passante quasi nulle : le même message sert un spectateur ou
trente mille, puisque Twitch se charge de la diffusion.

## Les délais

Le plateau adverse est retenu dix secondes à compter du début d'un combat entre
joueurs, et deux secondes contre un monstre. Tout le reste — plateau, réserve,
talents, boutiques, événements — part sans retard, puisque c'est déjà à
l'écran.

Un streamer qui diffuse en différé déclare son délai dans l'application, et
celui-ci s'ajoute à la retenue.

## Le relais, et pourquoi il existe

Une extension Twitch n'a qu'un seul secret de signature. Si la copie de chaque
streamer signait ses propres messages, ce secret devrait être livré dans
l'exécutable — et un exécutable se décompile. N'importe qui pourrait alors
diffuser de faux plateaux sur la chaîne de n'importe qui.

Le secret vit donc dans un Cloudflare Worker. Les streamers s'authentifient
auprès de Twitch, le relais dérive un jeton personnel de leur identifiant de
chaîne par HMAC, et rend un jeton Twitch valable vingt-cinq minutes.
L'application dialogue ensuite directement avec Twitch.

Aucune base de données : les jetons sont dérivés, pas stockés, et le relais les
recalcule pour les vérifier. Trois appels par heure et par streamer, ce qui
loge plusieurs milliers d'utilisateurs dans l'offre gratuite de Cloudflare.

## Vie privée

L'extension ne collecte rien sur les spectateurs. Aucun traqueur, aucun cookie
publicitaire, aucune demande d'identité. La seule chose conservée dans le
navigateur d'un spectateur, ce sont ses préférences d'affichage : langue,
emplacement, taille, teinte, police, et le fait qu'il ait vu le message
d'accueil.

L'application envoie le plateau et rien d'autre — ni état de combat, ni points
de vie, ni ressources, ni donnée personnelle. Son autorisation Twitch identifie
la chaîne et peut être révoquée à tout moment depuis les paramètres du compte.

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
tenus hors de ce dépôt — rien n'est lu sur la machine d'un spectateur ni d'un
streamer.

## À propos

Bazaar Scanner est un projet communautaire indépendant, réalisé avec l'accord
des développeurs du jeu. Il n'a aucun lien officiel avec Tempo Storm ni avec
Twitch.

## Licence

MIT. Voir [LICENSE](LICENSE).
