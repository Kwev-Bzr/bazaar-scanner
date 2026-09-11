/* ============================================================================
   CONFIGURATION — c'est le seul fichier que tu auras besoin de modifier
   à la main. Tout le reste est du code.
   ========================================================================= */

window.BAZAAR_CONFIG = {

  // Adresse Cloudflare Pages où sont publiées les fiches (tools/export-cards.js).
  // SANS slash final. Republier avec :
  //   wrangler pages deploy dist --project-name=bazaar-scanner --branch=main
  DATA_BASE_URL: 'https://bazaar-scanner.pages.dev',

  // Langue par défaut, utilisée tant que le spectateur n'a rien choisi et que
  // la langue de son compte Twitch ne correspond à aucune langue disponible.
  LANG: 'fr',

  // Repli uniquement. En fonctionnement normal, la liste des langues est lue
  // dans index.json, donc côté données : ajouter une langue ne demande qu'une
  // republication, sans repasser par la revue Twitch. Cette valeur ne sert que
  // si index.json est injoignable.
  LANGS: ['fr', 'en'],

  // Position du plateau dans l'image du stream, en POURCENTAGE de la vidéo.
  // Calibré le 14/08/2026 par Kwev avec dev/harness.html, sur une capture
  // 2560×1440 en plein cadre. À refaire si la mise en page OBS change.
  BOARD: {
    left:   21.0003,
    top:    52.0036,
    width:  58.2494,
    height: 19.5839,
    slots:  10,
  },

  /* La bande d'en face, et celle des rencontres.

     CARTES — une seule bande accueille TOUT ce qui n'est pas le plateau du
     joueur : le plateau adverse en combat, les objets d'une boutique, et la
     réserve quand elle s'ouvre. Même hauteur, même étendue horizontale, mêmes
     dix emplacements que le plateau.

     Nuance qui compte : le plateau adverse et la réserve occupent réellement
     ces emplacements, alors qu'une boutique CENTRE ses objets tout en les
     numérotant 0, 1, 2. Pour elle seule, les abscisses doivent voyager dans le
     message ; pour les deux autres, la grille suffit.

     RENCONTRE — le portrait de l'adversaire ou le choix d'événement, plus haut
     et plus petit. Une seule carte à la fois, au centre.

     Relevé le 25/08/2026 depuis le jeu, carte par carte et non en résumé : mes
     premières mesures agrégeaient ces deux bandes en un seul chiffre et se
     contredisaient d'une situation à l'autre. */
  CARTES: {
    left:   21.0003,
    top:    29.54,
    width:  58.2494,
    height: 20.37,
    slots:  10,
  },

  RENCONTRE: {
    top:     8.50,
    height: 14.20,
  },

  /* Les talents de l'ADVERSAIRE se déduisent des tiens par symétrie autour du
     milieu de l'écran : une position à y = 82,3 devient y = 100 − 82,3 = 17,7.
     Les abscisses et les tailles ne changent pas.

     Le jeu les trie de la même façon — par rareté, puis par ordre d'obtention —
     et leur disposition suit les mêmes paliers selon leur nombre.

     Dériver plutôt que relever évite un second jeu de mesures, et garantit que
     les deux côtés restent cohérents si l'un d'eux change.

     VÉRIFIÉ le 26/08/2026 sur deux captures 2560×1440 : les talents du joueur
     occupent 80,6 % et 88,2 % de la hauteur, ceux de l'adversaire 19,8 % et
     12,2 % — les compléments à 100 à quatre dixièmes de point près, soit
     l'imprécision d'une lecture à l'écran. Les abscisses sont identiques.

     L'ordre des rangées s'inverse au passage, ce qu'une symétrie produit et
     qu'une coïncidence n'expliquerait pas. */
  /* Les talents de l'adversaire occupent la MÊME disposition que les tiens,
     simplement remontée en haut de l'écran. Pas une symétrie : le décalage
     interne est conservé — le talent du milieu est plus bas des deux côtés.

     Une symétrie l'inversait, et plaçait le milieu plus haut que ses voisins.
     Relevé sur capture avec zones visibles le 28/08/2026 : tes talents à
     82,3 et 88,5 ; ceux de l'adversaire à 12,5 et 18,7. L'écart vaut 69,8
     dans les deux cas. */
  TALENTS_ADVERSES_DECALAGE: 69.8,

  // Emplacements des TALENTS, relevés au pixel près sur des captures 2560×1440.
  // Le jeu change de disposition selon le nombre de talents possédés :
  //   1 à 5   → une ligne en zigzag
  //   6 à 11  → deux rangées
  //   12 à 17 → trois rangées, celle du milieu décalée
  //   18 à 24 → trois rangées de quatre par côté, milieu décalé
  // Les emplacements rétrécissent à mesure que des rangées apparaissent, d'où
  // une largeur et une hauteur propres à chaque disposition.
  // L'ordre est celui du jeu : qualité décroissante, puis ordre d'obtention —
  // Plugin.cs applique déjà ce tri et numérote les Socket en conséquence.
  /* Éléments d'interface TOUJOURS visibles, quel que soit le nombre d'objets
     possédés : le cadran de tour à gauche, les deux extrémités de la barre du
     héros en dessous. Ils ne servent PAS à l'extension — aucune zone de survol
     ne leur correspond — mais à l'outil de calibrage de l'application, où ils
     donnent au streamer des points d'accroche même sur un plateau vide.

     Relevés au pixel sur une capture 2560×1440 en plein écran. Ce sont eux la
     RÉFÉRENCE : c'est BOARD et SKILL_LAYOUTS qui ont été recalés sur eux. */
  REPERES: {
    cercles: [
      { x: 14.297, y: 44.514, w: 1.914, h: 3.403 },
      { x: 16.992, y: 47.708, w: 0.859, h: 1.528 },
      { x: 12.656, y: 47.778, w: 0.859, h: 1.528 },
      { x: 17.031, y: 52.222, w: 0.859, h: 1.528 },
      { x: 12.656, y: 52.292, w: 0.859, h: 1.528 },
      { x: 14.844, y: 54.514, w: 0.859, h: 1.528 },
      { x: 14.922, y: 50.208, w: 0.664, h: 1.181 },
    ],
    equerres: [
      { x: 20.547, y: 72.778, w: 10.703, h: 19.653, coin: 'tr' },
      { x: 68.789, y: 72.708, w: 10.703, h: 19.653, coin: 'tl' },
    ],
  },

  /* Retard anti-divulgation, en millisecondes. Le flux vidéo arrive chez le
     spectateur avec quelques secondes de décalage : appliquer le plateau tout
     de suite le lui révélerait en avance.

     Le début d'un combat PVP demande plus, pour ne pas dévoiler le plateau
     adverse avant la rencontre. Réglables ici, notamment pour les tests. */
  RETARD_MS: 2000,
  RETARD_PVP_MS: 13000,

  /* Axe de la symétrie des talents adverses, au-delà de cinq talents.

     Jusqu'à cinq, ils sont simplement remontés (TALENTS_ADVERSES_DECALAGE).
     Au-delà, ils s'organisent en rangées et c'est une symétrie : la rangée du
     haut chez le joueur devient celle du bas en face.

     Déplacer l'axe de d déplace la rangée de 2d. */
  TALENTS_ADVERSES_AXE: 50.7,

  SKILL_LAYOUTS: [
    // 1 à 5 talents
    { max: 5, w: 3.5311, h: 6.2769, slots: [
      [34.237, 82.3214], [38.1005, 88.528], [41.9058, 82.3214],
      [58.1082, 82.3214], [61.9526, 88.528], [65.7579, 82.3214]
    ] },
    // 6 à 11 talents
    { max: 11, w: 2.7458, h: 4.8819, slots: [
      [33.6876, 81.4838], [38.1397, 81.4838], [42.6128, 81.4838],
      [57.6181, 81.4838], [62.0711, 81.4838], [66.5433, 81.4838],
      [33.6876, 89.0864], [38.1397, 89.0864], [42.6128, 89.0864],
      [57.6181, 89.0864], [62.0711, 89.0864], [66.5433, 89.0864]
    ] },
    // 12 à 17 talents
    { max: 17, w: 2.1974, h: 3.975, slots: [
      [33.2166, 80.4725], [37.042, 80.4725], [41.0039, 80.4725],
      [59.1677, 80.5428], [63.1106, 80.5428], [67.0133, 80.4725],
      [35.1981, 85.2851], [39.0425, 85.2851], [43.0045, 85.2851],
      [57.2847, 85.2851], [61.2075, 85.2851], [65.1302, 85.2148],
      [33.2367, 90.0977], [37.0812, 90.0977], [41.0431, 90.0977],
      [59.2069, 90.167], [63.1297, 90.167], [67.0525, 90.0977]
    ] },
    // 18 à 24 talents
    { max: 24, w: 2.0397, h: 3.6968, slots: [
      [33.0398, 80.2636], [36.1783, 80.2636], [39.2776, 80.2636],
      [42.3377, 80.124], [57.7948, 80.4032], [60.9333, 80.4032],
      [64.0325, 80.4032], [67.0926, 80.2636], [33.785, 85.3544],
      [36.9235, 85.3544], [40.0227, 85.3544], [43.0828, 85.2148],
      [57.0496, 85.4247], [60.1881, 85.4247], [63.2864, 85.4247],
      [66.3465, 85.2851], [33.0398, 90.3759], [36.1783, 90.3759],
      [39.2776, 90.3759], [42.3377, 90.2363], [57.7557, 90.4462],
      [60.8941, 90.4462], [63.9934, 90.4462], [67.0525, 90.3066]
    ] },
  ],

  // Ajustement fin de la taille des zones de survol des talents. 1 = la taille
  // relevée sur les captures. À ne toucher que si le survol accroche mal.
  SKILL_SCALE: 1,

  // Taille de la fiche. 1 = taille d'origine de l'overlay OBS, adaptée
  // automatiquement à la largeur du lecteur. Monte à 1.2 ou 1.3 si tu la
  // trouves encore petite, descends à 0.8 si elle prend trop de place.
  CARD_SCALE: 1,

  // Mettre à true pour voir les rectangles de survol en rouge translucide.
  // À laisser sur false pour la version publiée.
  DEBUG_HOTSPOTS: false
};
