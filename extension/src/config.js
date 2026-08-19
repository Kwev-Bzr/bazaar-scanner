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
