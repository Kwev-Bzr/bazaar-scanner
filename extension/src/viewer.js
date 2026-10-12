(function () {
  'use strict';

  var CFG = window.BAZAAR_CONFIG;
  var DEV = new URLSearchParams(location.search).has('dev');

  window.BAZAAR_SUFFIXE_CACHE = '';

  var versionPrete = null;

  var languesPubliees = null;
  var nomsPublies = null;
  var libellesPublies = null;

  function chargerVersion() {
    /* L'index allégé d'abord, sans les listes d'identifiants qui ne servent
       qu'aux outils : il pèse une fraction de l'index complet, et toutes les
       fiches attendent qu'il soit là. L'index complet reste le repli, tant
       que les données publiées n'ont pas la version allégée. */
    var lire = function (nom) {
      return fetch(CFG.DATA_BASE_URL + '/' + nom, { cache: 'no-store' })
        .then(function (r) { return r.ok ? r.json() : null; })
        .catch(function () { return null; });
    };
    return lire('index-extension.json')
      .then(function (idx) { return idx || lire('index.json'); })
      .then(function (idx) {
        if (!idx) return;
        if (idx.version) window.BAZAAR_SUFFIXE_CACHE = '?v=' + idx.version;

        var dispo = Object.keys(idx.langs || {}).filter(function (l) {
          var e = idx.langs[l];
          return e && (e.items > 0 || e.skills > 0);   // ignore une langue vide
        });
        libellesPublies = idx.libelles || null;
        mecaniquesPubliees = idx.mecaniques || null;
        appliquerLangueAuRendu();

        if (dispo.length) {
          languesPubliees = dispo;
          nomsPublies = idx.noms_langues || null;
          interfacePubliee = idx.interface || null;

          /* La géométrie publiée l'emporte sur celle du code. Une mise à jour
             du jeu qui déplacerait une rangée se corrige alors en republiant
             les données, sans téléverser l'extension ni redistribuer
             l'application. */
          appliquerGeometrie(idx.geometrie);

          /* Un héros nouveau reçoit sa couleur et son thème par les données
             publiées, sans téléverser l'extension. */
          integrerHerosPublies(idx.heros, idx.noms_themes, idx.sans_theme);

          /* Polices, défauts du menu, réglages fins des thèmes, durée du
             guide, ordre du menu : tout ce que « presentation.json » publie.
             Ce ne sont que des valeurs : rien n'est chargé d'ailleurs. */
          integrerPresentation(idx.presentation);

          /* Raretés, icônes : tout ce qui ne dépend pas de la langue. */
          if (idx.couleurs_raretes) window.BAZAAR_RARETES = idx.couleurs_raretes;
          integrerIcones(idx.icones);
          window.BAZAAR_DECALAGES = idx.decalages_icones || null;
          brancherIconesPng(idx.icones_png);
          if (Array.isArray(idx.familles_icone_mot)) FAMILLES_ICONE_MOT = idx.familles_icone_mot;
          window.BAZAAR_FORMES_SANS_ICONE = idx.formes_sans_icone || null;
          window.BAZAAR_MODE_ICONES = idx.mode_icones || null;
          window.BAZAAR_MAJUSCULE_MOTS = Array.isArray(idx.majuscule_mots_cles)
            ? idx.majuscule_mots_cles : null;
          window.BAZAAR_FAMILLES_SANS_ICONE_MOT = idx.familles_sans_icone_mot || null;
          window.BAZAAR_PAIRES_ICONE = idx.paires_icone || null;
          if (idx.icones_familles) Object.assign(ICONE_PAR_FAMILLE, idx.icones_familles);
          if (idx.icones_enchantements) Object.assign(ICONE_ENCHANT, idx.icones_enchantements);
          appliquerTheme();
          appliquerMode();
          appliquerTaille();
          appliquerPolice();

          reconstruireSelecteur();

          var memo = langueMemorisee();
          if (memo && memo !== langue) changerLangue(memo);
          else if (dispo.indexOf(langue) < 0) changerLangue(dispo[0]);

          appliquerLangueAuRendu();

          /* Le sélecteur est bâti AVANT que la langue mémorisée ne soit
             appliquée : sans ce rappel, il cochait celle du départ. */
          majSelecteur();

          /* Les panneaux peuvent avoir été bâtis avant l'arrivée de l'index :
             ils portent alors les libellés du code plutôt que ceux publiés.
             On les refait pour qu'ils en profitent. */
          if (elOptions) {
            var vuOpt = elOptions.classList.contains('visible');
            construireOptions();
            if (vuOpt) elOptions.classList.add('visible');
          }
          if (elRecherche) {
            var vuRech = elRecherche.classList.contains('visible');
            construireRecherche();
            if (vuRech) elRecherche.classList.add('visible');
          }
        }
      })
      .catch(function () { /* sans index, on retombe sur config.js */ });
  }

  var CLE_LANGUE = 'bazaar-scanner-langue';

  var ORDRE = ['en', 'fr', 'de', 'es', 'it', 'pt', 'ko', 'zh'];

  function ordonner(langues) {
    var connues = ORDRE.filter(function (l) { return langues.indexOf(l) >= 0; });
    var autres  = langues.filter(function (l) { return ORDRE.indexOf(l) < 0; }).sort();
    return connues.concat(autres);
  }

  function languesDisponibles() {
    if (languesPubliees && languesPubliees.length) return ordonner(languesPubliees);
    return ordonner((CFG.LANGS && CFG.LANGS.length) ? CFG.LANGS : ['fr', 'en']);
  }

  function nomLangue(l) {
    return (nomsPublies && nomsPublies[l]) || NOMS_LANGUE[l] || l.toUpperCase();
  }

  function langueMemorisee() {
    try {
      var v = window.localStorage.getItem(CLE_LANGUE);
      return languesDisponibles().indexOf(v) >= 0 ? v : null;
    } catch (e) { return null; }   // stockage refusé : on s'en passe
  }

  function memoriserLangue(l) {
    try { window.localStorage.setItem(CLE_LANGUE, l); } catch (e) { /* tant pis */ }
  }

  var langue = langueMemorisee() || CFG.LANG || 'fr';

  function appliquerLangueAuRendu() {
    window.BAZAAR_LANGUE = langue;
    window.BAZAAR_LIBELLES = (libellesPublies && libellesPublies[langue]) || null;
  }
  appliquerLangueAuRendu();

  function appliquerLangue(l) {
    langue = l;
    appliquerLangueAuRendu();

    /* L'alerte de version, si elle est affichée, suit la langue. */
    if (elVersion) {
      var texteAlerte = elVersion.querySelector('span');
      if (texteAlerte) texteAlerte.textContent = trad(APP_ANCIENNE, 'appAncienne');
    }

    if (elOptions) {
      var etaitVisible = elOptions.classList.contains('visible');
      var etaitOuvert = elOptions.classList.contains('deplie');
      construireOptions();
      if (etaitVisible) elOptions.classList.add('visible');
      /* La langue se choisit dans le menu : il reste ouvert. */
      if (etaitOuvert) elOptions.classList.add('deplie');
    }

    if (elRecherche) {
      var vu = elRecherche.classList.contains('visible');
      var ouvert = elRecherche.classList.contains('deplie');

      /* Les filtres retenus valent pour une langue : les boutons sont
         reconstruits, donc les conserver laisserait une sélection invisible
         mais agissante. */
      filtres.h.clear();
      filtres.t.clear();
      filtres.k.clear();
      filtres.g.clear();
      filtres.z.clear();
      filtres.q.clear();
      /* La fiche ouverte, elle, revient dans la nouvelle langue : on compare
         ainsi une même carte d'une langue à l'autre. */
      choixAReprendre = choix;
      choix = null;

      indexRecherche = null;          // l'index est propre à chaque langue
      construireRecherche();
      if (vu) elRecherche.classList.add('visible');

      // Le panneau reste ouvert : changer de langue n'a pas à le fermer.
      if (ouvert) {
        elRecherche.classList.add('deplie');
        chargerIndexRecherche().then(function () {
          poserFiltres();
          rafraichirResultats();
          reprendreChoix();
        });
      }
    }

    
    if (tutoEnCours) montrerTuto(true);

    if (elLangues) {
      var b = elLangues.querySelector('button.globe');
      if (b) b.title = trad(TITRE_GLOBE, 'titreGlobe') + ' / Language';
    }
    cache.clear();
    inflight.clear();
    paquets.clear();
    prechargerTout();
    majTiroirReserve();
    if (hovered) paint(hovered.id, hovered.talent);
  }

  function changerLangue(l) {
    if (l === langue || languesDisponibles().indexOf(l) < 0) return;
    memoriserLangue(l);
    appliquerLangue(l);

    peutEtreTuto('bazaar-tuto-langue');
  }

  var elCard     = document.getElementById('card');

  /* La fiche épinglée : figée au clic, avec ses boutons d'enchantement. Tant
     qu'elle l'est, aucune autre ne s'affiche, et un clic au-dehors la lève. */
  var epinglee = null;

  /* La hauteur de la colonne d'enchantements, figée à l'épinglage. */
  var hauteurColonne = null;

  /* Vrai quand le contenu de la fiche a changé et que sa hauteur est donc à
     remesurer. */
  var aRemesurer = true;

  var elHotspots = document.getElementById('hotspots');

  var enFace = [], faceTalents = [], faceCentree = false;

  /* La réserve du joueur, affichée dans son tiroir. Le mod la lit en
     permanence depuis run.Player.Stash, coffre ouvert ou non. */
  var reserve = [];

  /* Le héros joué, transmis par l'application : le tiroir en prend la couleur
     sous le thème « par héros ». Sans lui, il suivait la dernière fiche lue. */
  var heroJoue = '';
  var modeClasse = false;           // partie classée : « m: 'r' » dans le message
  var modeTournoi = false;          // tournoi : « m: 't' »
  var jourPartie = null;            // le jour en cours (« j »)
  var histoirePartie = '';          // un résultat par jour joué (« hj ») : v, d, r

  /* Les mécaniques expliquées au survol : compteur de victoires et jauge de
     prestige. Leurs textes sont ceux des infobulles du jeu, publiés avec les
     données (index.json, « mecaniques »), par langue. Leurs zones, en
     pourcentage du jeu, ont été mesurées sur une capture de 2560 × 1440 :
     victoires 205 × 76 à (280, 561), prestige 205 × 63 à (280, 821). La
     géométrie publiée peut les corriger (« MECANIQUES »). */
  var mecaniquesPubliees = null;
  var MECANIQUES_DEFAUT = {
    victoires: { left: 10.9375, top: 38.9583, width: 8.0078, height: 5.2778 },
    prestige:  { left: 10.9375, top: 57.0139, width: 8.0078, height: 4.3750 },
    /* Revenu 120 × 40 à (1773, 1070), la banque juste à sa droite, 150 × 40. */
    revenu:    { left: 69.2578, top: 74.3056, width: 4.6875, height: 2.7778 },
    banque:    { left: 73.9453, top: 74.3056, width: 5.8594, height: 2.7778 },
  };
  var MECANIQUES_ORDRE = ['victoires', 'prestige', 'revenu', 'banque'];

  /* Le nombre de victoires et le prestige, tels que le jeu les affiche en
     permanence, reçus avec le plateau. */
  var compteurs = { vi: null, pr: null, px: null };

  function texteMecanique(nom) {
    var parLangue = mecaniquesPubliees
      && (mecaniquesPubliees[langue] || mecaniquesPubliees.en);
    if (!parLangue) return null;
    if (nom === 'victoires' && modeClasse && parLangue.victoiresClasse) return parLangue.victoiresClasse;
    return parLangue[nom] || null;
  }

  function estMecanique(id) { return String(id || '').indexOf('meca:') === 0; }

  /* La réserve « Neutre » : les couleurs d'origine de la fiche, celles d'un
     objet partagé entre plusieurs héros (overlay.css, #card). */
  var NEUTRE_RESERVE = {
    cadre: '#7a4e28',
    fond: 'linear-gradient(155deg, #1c0f06 0%, #2c1808 55%, #1c0f06 100%)'
  };

  function couleurReserveNeutre() {
    return (memoire('bazaar-reserve-couleur') || 'theme') === 'neutre';
  }
  var elStatus   = document.getElementById('status');
  var elRoot     = document.getElementById('root');

  var elPanel    = document.getElementById('card-panel');

  var SUIVI_CURSEUR = false;

  /* Sans choix mémorisé, la fiche suit la souris et le texte reste moyen.
     Le streamer ne décide plus de ces deux réglages : ils appartiennent au
     spectateur, qui n'a donc pas besoin d'une entrée « Défaut ». */
  function appliquerMode() {
    // Le streamer ne choisit plus l'emplacement : à défaut, la souris.
    var voulu = modeMemorise() || DEFAUTS['bazaar-mode-fiche'] || 'curseur';
    SUIVI_CURSEUR = (voulu === 'curseur');

    if (SUIVI_CURSEUR) {
      elRoot.setAttribute('data-suivi', '1');
      elRoot.removeAttribute('data-coin');
    } else {
      elRoot.removeAttribute('data-suivi');
      if (elPanel) elPanel.style.transform = '';
      if (voulu === 'hd') elRoot.setAttribute('data-coin', 'hd');
      else elRoot.removeAttribute('data-coin');
      if (elCard) elCard.style.transformOrigin = (voulu === 'hd') ? 'top right' : 'top left';
    }
  }

  function modeMemorise() { return memoire('bazaar-mode-fiche'); }
  function tailleMemorisee() { return memoire('bazaar-taille-fiche'); }

  function memoire(cle) {
    try { return window.localStorage.getItem(cle) || null; }
    catch (e) { return null; }
  }

  function retenir(cle, valeur) {
    try { window.localStorage.setItem(cle, valeur); } catch (e) { /* refusé */ }
  }

  var TAILLES = ['xs', 's', 'm', 'l', 'x'];
  var tailleStreamer = 'm';   // conservé : d'anciennes applications l'envoient

  /* Un thème par héros. « heros » n'en est pas un : il suit le héros joué,
     et sert de défaut. */
  var THEMES = ['heros', 'vanessa', 'pygmalien', 'dooley', 'mak',
                'stelle', 'jules', 'karnok', 'dragons', 'cuir'];

  /* « Cuir commun » : toujours le brun d'origine de la fiche, celui
     des objets partagés entre plusieurs héros, quel que soit l'objet. Sans
     teinte : la fiche garde simplement son aspect de départ. */
  var THEME_NEUTRE = 'cuir';
  var BRUN_CUIR = '#7a4e28';

  /* La teinte propre à chaque héros, pour le thème « Par héros ». Un objet
     qui appartient à plusieurs d'entre eux, ou à aucun, garde le thème par
     défaut : aucune couleur ne le représenterait mieux qu'une autre. */
  var TEINTE_HEROS = {
    Vanessa:   '#a92322',
    Pygmalien: '#2b60b0',
    Dooley:    '#e19a08',
    Mak:       '#accf54',
    Stelle:    '#efdd19',
    Jules:     '#aa33dd',
    Karnok:    '#00967d',
    Hero8:     '#2ec4ff',
  };

  /* La clarté minimale du texte sur le bouton. Un seuil plus bas laissait
     Vanessa, Pyg et Jules trop sombres. */
  var SEUIL_LISIBLE = 0.76;

  /* Éclaircit une teinte jusqu'à ce qu'elle se lise sur un fond sombre. Une
     couleur de héros peut être très foncée, et le texte s'y perdait. */
  function eclaircirPourLire(couleur) {
    var m = String(couleur).match(/^#([0-9a-f]{6})$/i);
    if (!m) return couleur;

    var n = parseInt(m[1], 16);
    var r = (n >> 16) & 255, v = (n >> 8) & 255, b = n & 255;

    var clarte = (0.2126 * r + 0.7152 * v + 0.0722 * b) / 255;
    if (clarte >= SEUIL_LISIBLE) return couleur;

    /* On tire vers le blanc juste ce qu'il faut. */
    var part = Math.min(0.9, (SEUIL_LISIBLE - clarte) / (1 - clarte));
    return melange(couleur, 255, part);
  }

  /* Éclaircit ou assombrit une teinte : la bordure garde la couleur pleine,
     le fond en est une version très sombre. */
  function melange(hex, vers, part) {
    var n = parseInt(hex.slice(1), 16);
    var r = (n >> 16) & 255, v = (n >> 8) & 255, b = n & 255;
    var c = function (x) { return Math.round(x + (vers - x) * part); };
    return 'rgb(' + c(r) + ',' + c(v) + ',' + c(b) + ')';
  }

  /* Pose la teinte du héros sur la fiche du plateau, ou l'efface. */
  var herosAffiches = null;      // ceux de la fiche affichée, pour la reteindre
  function teinterParHeros(heros) {
    herosAffiches = heros || null;
    teinterFiche(elCard, heros);
  }

  /* ── Les héros publiés ───────────────────────────────────────────────────

     Les huit héros connus sont écrits plus haut. Un héros nouveau arrive par
     « index.json », sous la forme { "Hero9": "#rrggbb" } : il reçoit alors sa
     teinte pour le thème « Défaut », et un thème à son nom dans le menu.

     Rien n'est retiré : une teinte publiée pour un héros connu remplace
     simplement celle du code, ce qui permet aussi d'en corriger une. */
  /* La teinte d'une carte sous « Défaut », selon ses héros.

     Un seul héros : sa couleur. Plusieurs, comme les colis : la clé
     « Multiple » de heros.json. Tant qu'elle garde sa valeur d'origine, le
     liseré de la fiche d'origine, la carte garde exactement son aspect
     d'origine ; une autre valeur la fait peindre comme les autres. */
  var MULTIPLE_ORIGINE = '#7a4e28';

  function teinteDesHeros(heros) {
    var liste = Array.isArray(heros) ? heros : [];
    if (liste.length === 1) return { hero: liste[0], teinte: TEINTE_HEROS[liste[0]] || null };
    if (liste.length > 1) {
      var t = TEINTE_HEROS.Multiple;
      if (t && String(t).toLowerCase() !== MULTIPLE_ORIGINE) return { hero: 'Multiple', teinte: t };
    }
    return { hero: null, teinte: null };
  }

  /* Les noms de thème publiés, par clé de heros.json puis par langue. */
  var NOMS_THEMES = {};

  /* Chaque couleur de heros.json donne une teinte et, sauf exception, un thème.
     Une clé n'a pas besoin d'être un héros du jeu : « Royal » fait un thème
     de plus. « Common » colore les objets communs sous « Défaut » ; il n'a pas
     de thème s'il figure dans « sans_theme ». */
  function integrerHerosPublies(publies, noms, sansTheme) {
    if (noms && typeof noms === 'object') NOMS_THEMES = noms;
    if (!publies || typeof publies !== 'object') return;
    var exclus = Array.isArray(sansTheme) ? sansTheme : [];

    Object.keys(publies).forEach(function (hero) {
      var teinte = publies[hero];
      if (!/^#[0-9a-f]{6}$/i.test(String(teinte))) return;

      TEINTE_HEROS[hero] = teinte;
      if (exclus.indexOf(hero) >= 0) return;

      /* Le thème d'un héros connu garde sa clé historique, « dragons » pour
         Hero8 ; une clé nouvelle prend son nom en minuscules. */
      var cle = CLE_THEME_DE[hero] || String(hero).toLowerCase();
      TEINTE_THEME[cle] = teinte;
      if (THEMES.indexOf(cle) < 0) THEMES.push(cle);
      HERO_DU_THEME[cle] = hero;
    });
  }

  /* ── Les icônes publiées ────────────────────────────────────────────────

     Les dessins d'origine sont dans la page. Un mécanisme nouveau peut
     arriver avec le sien : publié dans « mots-cles.json » sous « icones »,
     { "id": "<path d='…'/>" } pour un cadre de 18 sur 18, il rejoint les
     autres sans téléverser.

     Le dessin est relu et seuls les éléments de forme sont repris, sans
     script ni attribut d'événement : ce qui est publié reste du dessin. */
  var FORMES = ['path', 'circle', 'ellipse', 'rect', 'polygon', 'polyline', 'line', 'g'];
  var ATTRIBUTS = ['d', 'cx', 'cy', 'r', 'rx', 'ry', 'x', 'y', 'width', 'height',
                   'points', 'x1', 'y1', 'x2', 'y2', 'transform', 'fill-rule',
                   'clip-rule', 'opacity', 'fill-opacity'];

  function copierForme(source, cible) {
    for (var n = 0; n < source.children.length; n++) {
      var el = source.children[n];
      var nom = el.tagName.toLowerCase();
      if (FORMES.indexOf(nom) < 0) continue;

      var copie = document.createElementNS('http://www.w3.org/2000/svg', nom);
      ATTRIBUTS.forEach(function (a) {
        if (el.hasAttribute(a)) copie.setAttribute(a, el.getAttribute(a));
      });
      copierForme(el, copie);
      cible.appendChild(copie);
    }
  }

  function integrerIcones(publiees) {
    if (!publiees || typeof publiees !== 'object') return;
    var defs = document.querySelector('#kw-sprites defs');
    if (!defs || !window.DOMParser) return;

    Object.keys(publiees).forEach(function (id) {
      if (!/^[a-z0-9_-]+$/i.test(id)) return;

      var doc = new window.DOMParser().parseFromString(
        '<svg xmlns="http://www.w3.org/2000/svg">' + String(publiees[id]) + '</svg>',
        'image/svg+xml');
      if (doc.querySelector('parsererror')) return;

      var groupe = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      groupe.setAttribute('id', id);
      groupe.setAttribute('fill', 'currentColor');
      copierForme(doc.documentElement, groupe);
      if (!groupe.children.length) return;

      /* Un dessin publié pour une icône existante la remplace : c'est ainsi
         qu'on en corrige une. Les autres restent intactes. */
      var ancien = document.getElementById(id);
      if (ancien && ancien.parentNode === defs) defs.replaceChild(groupe, ancien);
      else defs.appendChild(groupe);
    });
  }

  /* Le héros que représente chaque thème, et l'inverse. */
  var CLE_THEME_DE = {
    Vanessa: 'vanessa', Pygmalien: 'pygmalien', Dooley: 'dooley', Mak: 'mak',
    Stelle: 'stelle', Jules: 'jules', Karnok: 'karnok', Hero8: 'dragons',
  };
  var HERO_DU_THEME = {};
  Object.keys(CLE_THEME_DE).forEach(function (h) { HERO_DU_THEME[CLE_THEME_DE[h]] = h; });

  /* Le nom d'un thème : son libellé s'il en a un, sinon le nom du héros. Un
     héros nouveau a ainsi un thème lisible sans qu'on écrive de traduction. */
  function nomDeTheme(cle) {
    /* D'abord le nom publié dans heros.json, dans la langue courante, puis
       celui du code, puis le nom du héros. */
    var hero = HERO_DU_THEME[cle] || cle;
    var publie = NOMS_THEMES[hero];
    if (publie && (publie[langue] || publie.en)) return publie[langue] || publie.en;

    var l = libTheme(cle);
    if (l && l !== cle) return l;
    return nomDeHeros(hero);
  }

  /* Pose un fond, un liseré et une lueur bâtis sur une teinte. */
  /* La clarté perçue d'une couleur, de 0 à 100, qu'elle soit écrite en
     #rrggbb ou en rgb(). */
  function clartePercue(couleur) {
    var v = /^#([0-9a-f]{6})$/i.exec(couleur);
    var c = v ? [parseInt(v[1].slice(0, 2), 16), parseInt(v[1].slice(2, 4), 16), parseInt(v[1].slice(4), 16)]
              : (String(couleur).match(/\d+/g) || [0, 0, 0]).slice(0, 3).map(Number);
    var lin = c.map(function (x) {
      x /= 255;
      return x > 0.04045 ? Math.pow((x + 0.055) / 1.055, 2.4) : x / 12.92;
    });
    var Y = 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
    return 116 * (Y > 0.008856 ? Math.cbrt(Y) : 7.787 * Y + 16 / 116) - 16;
  }

  /* Le centre du dégradé est choisi pour que l'écart avec le bord SE VOIE
     autant sur toutes les teintes. Une proportion fixe le rendait presque
     invisible sur les teintes sombres, Vanessa ou Jules. */
  var ECART_DEGRADE = 15;

  /* Les réglages fins des thèmes. « presentation.json » peut les remplacer,
     clé par clé, sans téléverser l'extension. */
  var REGLAGES_THEMES = {
    jaune_de: 48, jaune_a: 72, teinte_or: 45, saturation_min: 0.4,
    clarte_noms_menu: 58,
  };

  /* Deux teintes en demandent moins : le rouge de Vanessa saturait vite, et
     Pyg doit rester un bleu de nuit, sans quoi il se rapprochait des Dragons. */
  var ECART_PAR_HEROS = { Vanessa: 11, Pygmalien: 8.5 };

  /* Un jaune assombri devient vert olive : c'est la couleur elle-même, non un
     réglage. Pour qu'un fond sombre reste doré, la teinte d'un jaune vif est
     tirée vers l'or avant d'être assombrie. La couleur d'accent, elle, reste
     celle choisie. Vaut pour tout jaune, pas seulement celui de Stelle. */
  function fondDeTeinte(couleur) {
    var m = /^#([0-9a-f]{6})$/i.exec(couleur);
    if (!m) return couleur;
    var n = parseInt(m[1], 16);
    var r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
    var max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
    var l = (max + min) / 2, s = d ? d / (1 - Math.abs(2 * l - 1)) : 0;
    var R = REGLAGES_THEMES;
    if (!d || s < R.saturation_min) return couleur;
    var h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h = (h * 60 + 360) % 360;
    if (h < R.jaune_de || h > R.jaune_a) return couleur;

    /* Même clarté et même saturation, teinte de l'or (45 par défaut). La
       teinte cible reste entre le rouge et le jaune : au-delà, la formule
       ci-dessous ne vaudrait plus. */
    var cible = Math.max(0, Math.min(60, R.teinte_or));
    var c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs((cible / 60) % 2 - 1)), o = l - c / 2;
    var vers = function (v) { return ('0' + Math.round((v + o) * 255).toString(16)).slice(-2); };
    return '#' + vers(c) + vers(x) + vers(0);
  }

  function appliquerTeinte(el, teinteChoisie, hero) {
    /* Le fond part de sa version dorée ; le liseré et la lueur aussi, un jaune
       assombri tirant au vert. Les lignes, claires, gardent la couleur choisie. */
    var teinte = fondDeTeinte(teinteChoisie);
    var sombre = melange(teinte, 0, 0.88);
    var p = 0.88, clarteBord = clartePercue(sombre);
    var ecart = (hero && ECART_PAR_HEROS[hero]) || ECART_DEGRADE;
    while (p > 0.25 && clartePercue(melange(teinte, 0, p)) - clarteBord < ecart) p -= 0.02;
    var creux  = melange(teinte, 0, p);

    el.style.background = 'linear-gradient(155deg, ' + sombre + ' 0%, '
      + creux + ' 55%, ' + sombre + ' 100%)';
    el.style.borderColor = teinte;
    /* La teinte claire, pour les pastilles du délai et des munitions. */
    el.style.setProperty('--teinte-fiche', teinteChoisie);
    /* Les icônes des pastilles mêlent cette teinte à du blanc. Le bleu de Pyg
       et le violet de Jules, sombres, demandent plus de blanc pour rester
       lisibles ; les autres gardent leur couleur. */
    el.style.setProperty('--part-teinte-icone',
      (hero === 'Pygmalien' || hero === 'Jules') ? '55%' : '80%');
    el.style.boxShadow = '0 0 0 1px ' + melange(teinte, 0, 0.7)
      + ', 0 0 41px ' + melange(teinte, 0, 0.55)
      + ', inset 0 1px 0 rgba(255, 255, 255, .06)';

    /* Les deux lignes suivent, dans la couleur choisie. */
    var degrade = 'linear-gradient(90deg,transparent,' + melange(teinteChoisie, 0, 0.25)
      + ' 15%,' + melange(teinteChoisie, 255, 0.35) + ' 50%,'
      + melange(teinteChoisie, 0, 0.25) + ' 85%,transparent)';

    ['.top-bar', '.bottom-bar'].forEach(function (sel) {
      var ligne = el.querySelector(sel);
      if (ligne) ligne.style.background = degrade;
    });
  }

  /* Les thèmes nommés et leur teinte : la même table que les héros, par le
     nom du thème. */
  var TEINTE_THEME = {
    vanessa: TEINTE_HEROS.Vanessa, pygmalien: TEINTE_HEROS.Pygmalien,
    dooley:  TEINTE_HEROS.Dooley,  mak:       TEINTE_HEROS.Mak,
    stelle:  TEINTE_HEROS.Stelle,  jules:     TEINTE_HEROS.Jules,
    karnok:  TEINTE_HEROS.Karnok,  dragons:   TEINTE_HEROS.Hero8,
  };

  function teinterApercu(el, heros) {
    if (!el) return;

    var theme = elRoot.getAttribute('data-theme') || 'heros';
    var teinte = TEINTE_THEME[theme] || null;

    if (!teinte && theme !== THEME_NEUTRE) {
      /* Thème « Défaut » : la couleur du héros de l'objet, ou celle de
         « Multiple » s'il en a plusieurs. */
      teinte = teinteDesHeros(heros).teinte;
    }

    if (!teinte) {
      el.style.removeProperty('background');
      el.style.removeProperty('border-color');
      el.style.removeProperty('box-shadow');
      el.style.removeProperty('--teinte-fiche');
      el.style.removeProperty('--part-teinte-icone');
      return;
    }

    appliquerTeinte(el, teinte, theme === 'heros'
      ? teinteDesHeros(heros).hero
      : (HERO_DU_THEME[theme] || null));
  }

  /* La même chose sur n'importe quelle fiche : celle du plateau, ou l'aperçu
     de la recherche. */
  function teinterFiche(elCard, heros) {
    if (!elCard) return;

    var theme = elRoot.getAttribute('data-theme') || 'heros';
    var teinte = null, hero = null;

    if (theme === 'heros') {
      var choix = teinteDesHeros(heros);
      hero = choix.hero;
      teinte = choix.teinte;
    } else {
      /* Tous les thèmes de héros sont peints d'après la couleur publiée dans
         heros.json, comme « Défaut » : une seule couleur par héros, qui vaut
         partout. La feuille de style n'en garde qu'un repli, le temps que les
         données arrivent. */
      hero = HERO_DU_THEME[theme] || null;
      teinte = TEINTE_THEME[theme] || null;
    }

    if (!teinte) {
      elCard.style.removeProperty('background');
      elCard.style.removeProperty('border-color');
      elCard.style.removeProperty('box-shadow');
      elCard.style.removeProperty('--teinte-fiche');
      elCard.style.removeProperty('--part-teinte-icone');
      ['.top-bar', '.bottom-bar'].forEach(function (sel) {
        var el = elCard.querySelector(sel);
        if (el) el.style.removeProperty('background');
      });
      return;
    }

    appliquerTeinte(elCard, teinte, hero);

    /* Les deux lignes, en haut et en bas : sans règle de thème pour
       « Défaut », elles restaient dorées. */
    var degrade = 'linear-gradient(90deg,transparent,' + melange(teinte, 0, 0.25)
      + ' 15%,' + melange(teinte, 255, 0.35) + ' 50%,'
      + melange(teinte, 0, 0.25) + ' 85%,transparent)';

    ['.top-bar', '.bottom-bar'].forEach(function (sel) {
      var el = elCard.querySelector(sel);
      if (el) el.style.background = degrade;
    });
  }

  function appliquerPolice() {
    var p = memoire('bazaar-police-fiche');
    /* La police étroite n'existe plus : qui l'avait choisie revient à celle
       par défaut. */
    if (p === 'etroite') {
      try { window.localStorage.removeItem('bazaar-police-fiche'); } catch (e) { /* refusé */ }
      p = null;
    }
    if (!p) p = DEFAUTS['bazaar-police-fiche'] || '';

    /* Une police inconnue - retirée des données, ou publiée mais pas encore
       arrivée - laisse la police d'origine, sans effacer le choix : il
       s'appliquera dès que la liste publiée la fera connaître. */
    var pol = p ? policeDe(p) : null;
    var st = elRoot.style;
    if (pol) {
      elRoot.setAttribute('data-police', p);
      st.setProperty('--police', pol.famille);
      if (pol.espacement) st.setProperty('--police-espacement', pol.espacement);
      else st.removeProperty('--police-espacement');
      if (pol.majuscules) st.setProperty('--police-casse', 'uppercase');
      else st.removeProperty('--police-casse');
      if (pol.synthese === false) st.setProperty('--police-synthese', 'none');
      else st.removeProperty('--police-synthese');
    } else {
      elRoot.removeAttribute('data-police');
      ['--police', '--police-espacement', '--police-casse', '--police-synthese']
        .forEach(function (v) { st.removeProperty(v); });
    }
  }


  function appliquerTheme() {
    var t = memoire('bazaar-theme-fiche');

    /* Les palettes d'autrefois n'existent plus : un spectateur qui en avait
       choisi une bascule sur le défaut, et son choix est réécrit.

       Seules ELLES sont visées. Un thème inconnu peut être celui d'un héros
       publié dont l'index n'est pas encore arrivé : le réécrire ferait
       perdre ce choix à chaque chargement. Il s'applique dès que les données
       le font connaître. */
    var ANCIENNES = ['noir', 'bleu', 'rouge', 'violet', 'miel', 'emeraude'];
    if (!t || ANCIENNES.indexOf(t) >= 0) {
      t = DEFAUTS['bazaar-theme-fiche'];
      retenir('bazaar-theme-fiche', t);
    }
    elRoot.setAttribute('data-theme', t);
    majTeinteMenus();

    /* La fiche affichée suit le nouveau thème sans attendre la suivante.
       Avec les héros de ce qu'elle MONTRE, non ceux de la carte en cache :
       cette fonction tourne à chaque message, et une fiche PVE (neutre)
       prenait alors la couleur de la fiche du monstre, beige « Commun ». */
    teinterParHeros(hovered ? herosAffiches : null);
  }

  /* Cette fonction tourne à chaque message. Elle remettait la fiche à son
     échelle pleine, et une description trop longue, réduite pour tenir à
     l'écran, redevenait trop grande au message suivant, quelques secondes
     plus tard. Elle ne touche plus à l'échelle que si la taille change, et
     refait alors aussi la réduction. */
  var tailleAppliquee = null;
  function appliquerTaille() {
    // Ni la taille : à défaut, moyen.
    var t = tailleMemorisee() || DEFAUTS['bazaar-taille-fiche'] || 'm';
    if (TAILLES.indexOf(t) < 0) t = 'm';
    if (t === tailleAppliquee) return;
    tailleAppliquee = t;
    if (t === 'm') elRoot.removeAttribute('data-taille');
    else elRoot.setAttribute('data-taille', t);

    reajusterFiche();
    // L'aperçu de la recherche suit la même taille, même s'il est déjà affiché.
    ajusterApercu();
  }

  var board     = [];        // objets du plateau, dernier état reçu
  var skills    = [];        // talents, dernier état reçu

  var CADRE_PLEIN = { l: 0, t: 0, w: 100, h: 100 };
  var cadre = CADRE_PLEIN;

  var COINS = ['hg', 'hd', 'curseur'];
  var coin = 'hg';

  function appliquerCoin() {
    if (coin === 'hg' || coin === 'curseur') elRoot.removeAttribute('data-coin');
    else elRoot.setAttribute('data-coin', coin);

    if (elCard) elCard.style.transformOrigin = (coin === 'hd') ? 'top right' : 'top left';
  }

  function versX(x)      { return cadre.l + x * cadre.w / 100; }
  function versY(y)      { return cadre.t + y * cadre.h / 100; }
  function versLargeur(w) { return w * cadre.w / 100; }
  function versHauteur(h) { return h * cadre.h / 100; }
  var cache     = new Map(); // clé "langue|id" -> fiche, ou null si introuvable
  var inflight  = new Set(); // clés en cours de téléchargement
  var hovered   = null;      // { id, talent } actuellement survolé

  var LARGEUR_REFERENCE = 1920;

  var FACTEUR_TAILLE = { xs: 0.72, s: 0.85, m: 1, l: 1.2, x: 1.4 };

  /* L'échelle suit la taille du lecteur.

     J'avais tenté de la figer sur la largeur hors plein écran, pour éviter
     que les fiches ne grossissent à la bascule. La détection du plein écran
     se trompait dans l'iframe de l'extension, et tout restait figé sur une
     largeur mesurée trop tôt : les fiches devenaient minuscules.

     Mieux vaut le comportement d'origine, quitte à régler la taille à la
     main en plein écran. */
  function ajusterEchelle() {
    if (!elCard) return;
    var t = elRoot.getAttribute('data-taille') || 'm';
    var facteur = (window.innerWidth / LARGEUR_REFERENCE)
                * (CFG.CARD_SCALE || 1)
                * (FACTEUR_TAILLE[t] || 1);
    facteur = Math.max(0.5, Math.min(3, facteur));
    elCard.style.transform = 'scale(' + facteur.toFixed(3) + ')';
    calerTitres();
    return facteur;
  }

  /* Réduit la fiche d'autant, en partant de l'échelle courante. Sert lorsque
     la description est trop longue pour l'écran. */
  function reduirePour(rapport) {
    if (!elCard) return;
    var actuel = parseFloat(
      (elCard.style.transform.match(/scale\(([\d.]+)\)/) || [])[1]) || 1;
    elCard.style.transform = 'scale(' + (actuel * rapport).toFixed(3) + ')';
    calerTitres();
  }

  /* L'aperçu de la recherche suit la même échelle que la fiche survolée : un
     facteur fixe la rendait démesurée sur un petit lecteur. La colonne étant
     plus étroite que la vidéo, on la réduit d'autant. */
  function ajusterApercu() {
    if (!elRecherche) return;
    var hote = elRecherche.querySelector('.apercu .fiche');
    if (!hote) return;

    var t = elRoot.getAttribute('data-taille') || 'm';
    var facteur = (window.innerWidth / LARGEUR_REFERENCE)
                * (CFG.CARD_SCALE || 1)
                * (FACTEUR_TAILLE[t] || 1)
                * 0.9;

    facteur = Math.max(0.4, Math.min(2, facteur));

    /* Jamais plus large que la colonne. Le panneau plafonne à 1 100 pixels
       quand la fiche, elle, grandit avec l'écran : en plein écran sur un
       grand moniteur, en taille de texte maximale, elle débordait des deux
       côtés. La mise à l'échelle ne change pas la place qu'occupe la fiche :
       on mesure donc sa largeur réelle, hors échelle. */
    var colonne = elRecherche.__apercu;
    var largeur = hote.offsetWidth;
    if (colonne && largeur > 0) {
      var dispo = colonne.clientWidth - 12;
      if (dispo > 0) facteur = Math.min(facteur, dispo / largeur);
    }
    hote.style.transform = 'scale(' + facteur.toFixed(3) + ')';

    /* La hauteur gagnée ou perdue à l'échelle, rendue à la colonne : sans
       cela, le bas d'une fiche agrandie ne se laissait pas atteindre en
       faisant défiler, et une fiche réduite laissait un vide dessous. */
    hote.style.marginBottom = Math.round(hote.offsetHeight * (facteur - 1)) + 'px';
  }

  /* L'échelle de la fiche, puis la réduction d'une description trop longue,
     et le placement qui en dépend. Fiche cachée : l'échelle seule, la
     réduction se fera à son prochain affichage. */
  function reajusterFiche() {
    if (elPanel && elCard && !elPanel.classList.contains('hidden')) {
      aRemesurer = true;
      ajusterHauteur();
      if (SUIVI_CURSEUR && dernierPointeur) placerAuCurseur(dernierPointeur.x, dernierPointeur.y);
    } else {
      ajusterEchelle();
      aRemesurer = true;
    }
  }

  window.addEventListener('resize', function () {
    reajusterFiche();
    ajusterApercu();
  });

  function log(msg) {
    if (!DEV && !CFG.DEBUG_HOTSPOTS) return;
    elStatus.classList.remove('hidden');
    elStatus.textContent = msg;
  }



  function cle(id) { return langue + '|' + id; }

  function languesDeRepli(depuis) {
    var toutes = languesDisponibles();
    var ordre = [];
    if (depuis !== 'en' && toutes.indexOf('en') >= 0) ordre.push('en');
    toutes.forEach(function (l) {
      if (l !== depuis && ordre.indexOf(l) < 0) ordre.push(l);
    });
    return ordre;
  }

  var paquets = new Map();        // « langue|paquet » → promesse de contenu

  function nomPaquet(id) {
    var c = String(id).toLowerCase().replace(/[^0-9a-f]/g, '').charAt(0);
    return c || '0';
  }

  function catalogueDe(estTalent, estRencontre) {
    return estRencontre ? 'encounters' : (estTalent ? 'skills' : 'cards');
  }

  function chargerPaquet(l, catalogue, id) {
    var p = nomPaquet(id);
    var k = l + '|' + catalogue + '|' + p;
    if (paquets.has(k)) return paquets.get(k);

    var url = CFG.DATA_BASE_URL + '/' + catalogue
            + '/' + l + '/' + p + '.json' + window.BAZAAR_SUFFIXE_CACHE;

    var promesse = fetch(url)
      .then(function (r) { return r.ok ? r.json() : Promise.reject(new Error(r.status)); })
      .catch(function (e) {
        paquets.delete(k);
        throw e;
      });

    paquets.set(k, promesse);
    return promesse;
  }

  /* Les demandes en cours, par clé. Elles permettent d'ATTENDRE une fiche au
     lieu d'interroger le cache à répétition : la scrutation laissait l'aperçu
     sur « Chargement… » quand la promesse aboutissait entre deux réveils. */
  var promesses = new Map();

  /* Une carte retrouvée d'après le DÉBUT de son identifiant. L'application
     n'envoie plus que ses huit premiers caractères, sans tirets : un
     identifiant complet pèse 36 caractères, et quarante talents à deux
     joueurs suffisaient à approcher la limite du message. Huit caractères
     ne confondent aucune des cartes du jeu ; l'export le vérifie. */
  function parDebut(contenu, debut) {
    var d = String(debut || '').toLowerCase();
    if (d.length < 6 || d.indexOf('-') >= 0) return null;
    var cles = Object.keys(contenu);
    for (var n = 0; n < cles.length; n++) {
      if (cles[n].replace(/-/g, '').toLowerCase().indexOf(d) === 0) return contenu[cles[n]];
    }
    return null;
  }

  function fetchCard(id, estTalent, estRencontre) {
    var catalogue = catalogueDe(estTalent, estRencontre);
    var k = cle(id);
    if (cache.has(k)) return Promise.resolve(cache.get(k));
    if (promesses.has(k)) return promesses.get(k);
    inflight.add(k);
    var langueDemandee = langue;

    function essayer(langues) {
      if (!langues.length) return Promise.reject(new Error('épuisé'));
      var l = langues[0];
      return chargerPaquet(l, catalogue, id)
        .then(function (contenu) {
          var carte = contenu && (contenu[id] || parDebut(contenu, id));
          if (!carte) throw new Error('absente');
          prechargerImage(carte);
          return carte;
        })
        .catch(function () { return essayer(langues.slice(1)); });
    }

    var promesse = (versionPrete || Promise.resolve())
      .then(function () {
        return essayer([langueDemandee].concat(languesDeRepli(langueDemandee)));
      })
      .then(function (card) {
        cache.set(langueDemandee + '|' + id, card);
        return card;
      })
      .catch(function () {
        var repli = DEV ? mockCard(id) : null;
        cache.set(langueDemandee + '|' + id, repli);
        return repli;
      })
      .finally(function () {
        inflight.delete(langueDemandee + '|' + id);
        promesses.delete(langueDemandee + '|' + id);
        if (hovered && hovered.id === id && langueDemandee === langue) {
          if (hovered.combat) show(id, false, true, hovered.combat);
          else paint(id, hovered.talent);
        }
      });

    promesses.set(k, promesse);
    return promesse;
  }

  function mockCard(id) {
    return {
      templateId: id,
      name: 'Objet de démonstration',
      tier: 'Gold',
      size: 'Medium',
      tags: ['Weapon', 'Tool'],
      heroes: ['Vanessa'],
      image: null,
      cooldowns: 5,
      ammo: null,
      multicast: null,
      quests: [],
      enchantments: {},
      tooltips: [
        { text: 'Aucune donnée publiée : ceci est une fiche de démonstration.', type: 'Passive' },
        { text: 'Inflige 40 dégâts.', type: 'Active' }
      ]
    };
  }

  var zonesExistantes = {};   // étiquette → élément
  var zonesVues = null;       // étiquettes utilisées par le message courant

  /* L'étiquette d'une carte, identique à celle que porte sa zone. Elle
     distingue deux exemplaires d'un même objet, que l'identifiant confond. */
  function etiquetteDe(it, rangee) {
    if (rangee === 'plateau') return 'O' + it.s;
    if (rangee === 'talent')  return 'T' + it.s;
    return (it.r ? 'FR' : 'F') + it.s;
  }


  /* ── Le tiroir de la réserve ─────────────────────────────────────────────

     Dix emplacements, toujours : un objet Moyen en occupe deux, un Grand
     trois. La taille d'une case vaut les trois quarts de celle du plateau,
     pour que le tiroir reste discret.

     Le survol d'un objet donne sa fiche, comme sur le plateau. Le bouton
     déplie et replie, sans survol : un tiroir qui s'ouvrirait au passage de
     la souris gênerait le spectateur qui vise une carte du plateau. */
  var EMPLACEMENTS_RESERVE = 10;

  /* La boutonnière, dont la largeur entre dans le calcul de la case. */
  var LARGEUR_BOUTON_TIROIR = 26;

  /* Les proportions de la case, mesurées sur le lecteur de Kwev : son haut à
     1060 sur 1440 de haut, son bord droit à 810 sur 2560 de large.

     « geometrie.json » peut les remplacer par un bloc RESERVE, sans
     téléverser, si le jeu déplace son interface :
       "RESERVE": { "haut": 0.736, "grande": 0.316, "petite": 0.196 } */
  /* Le BORD HAUT DU RUBAN déroulé, mesuré sur un écran de 1440 de haut :
     « milieu » pour les positions du milieu, à 895 ; « basDroite » pour la
     position en bas à droite, à 1115, plus bas que celle de gauche pour
     laisser voir l'argent et les revenus du joueur. */
  /* La petite taille, élargie de vingt pixels sur un écran de 2560 : la
     hauteur suit, les cases gardant le rapport des illustrations. */
  var RESERVE_DEFAUT = { haut: 1060 / 1440, grande: 810 / 2560, petite: ((810 * 0.62) + 20) / 2560,
                         milieu: 895 / 1440, basDroite: 1115 / 1440 };

  /* La position choisie par le spectateur : en bas à gauche ou à droite, en
     grand ; au milieu à gauche ou à droite, en petit, pour ne cacher ni la
     caméra du streamer ni son argent. */
  var POSITIONS_RESERVE = ['bg', 'mg', 'md', 'bd'];

  function positionReserve() {
    var p = memoire('bazaar-reserve-pos') || DEFAUTS['bazaar-reserve-pos'];
    return POSITIONS_RESERVE.indexOf(p) >= 0 ? p : 'bg';
  }

  /* La taille d'ouverture dépend de la position. */
  function tailleSelonPosition() {
    var p = positionReserve();
    return (p === 'mg' || p === 'md') ? 'petite' : 'moyenne';
  }

  /* Ce que le ruban prend en dehors des cases : son retrait sous le bouton,
     sa marge de fin et son liseré. En petit, sans arrondi, il lui en faut moins. */
  function margesRuban(taille) {
    return taille === 'petite' ? 8 : 14;
  }

  function proportionReserve(cle) {
    var p = CFG.RESERVE && CFG.RESERVE[cle];
    return (typeof p === 'number' && p > 0 && p < 1) ? p : RESERVE_DEFAUT[cle];
  }

  var HAUT_BOUTON = 110 / 1440;

  /* Le rapport d'une illustration : 75 sur 150. */
  var RAPPORT_IMAGE = 150 / 75;

  /* La hauteur d'une case : deux emplacements, PLUS l'espace qui les sépare.
     Un objet moyen couvre deux emplacements et l'espace entre eux ; sans cet
     espace dans la hauteur, il était plus large que haut, et son
     illustration, carrée, paraissait écrasée. Un grand objet retombe alors
     exactement sur son rapport de 3 sur 2. */
  var ESPACE_CASES = 3;
  function hauteurPourLargeur(l) { return Math.round(l * RAPPORT_IMAGE) + ESPACE_CASES; }

  /* La taille du lecteur entre dans l'empreinte : un redimensionnement doit
     refaire le tiroir, un simple message non.

     On lit celle de la fenêtre, et non le cadre : « getBoundingClientRect »
     force le navigateur à recalculer la mise en page, et l'appeler à chaque
     message pour une valeur qui ne bouge presque jamais coûtait cher. */
  function r_largeur() {
    return window.innerWidth + 'x' + window.innerHeight;
  }

  var TAILLE_EN_CASES = { Small: 1, Medium: 2, Large: 3 };



  /* L'empreinte de la réserve : tant qu'elle ne change pas, rien à refaire.
     Reconstruire dix cases et interroger les styles à chaque message, une
     fois par seconde, coûtait une mise en page complète pour rien. */
  var empreinteReserve = null;

  function majTiroirReserve() {
    var tiroir = document.getElementById('tiroir-reserve');
    var contenu = document.getElementById('tiroir-contenu');
    var titre = document.getElementById('tiroir-titre');
    if (!tiroir || !contenu) return;

    /* Hors partie, ou si le spectateur n'en veut pas. */
    var voulu = (memoire('bazaar-reserve') || DEFAUTS['bazaar-reserve']) !== 'non';
    if (!voulu || (!board.length && !reserve.length)) {
      tiroir.classList.add('hidden');
      elRoot.style.setProperty('--decalage-boutons', '0px');
      elRoot.removeAttribute('data-boutons');
      return;
    }
    tiroir.classList.remove('hidden');

    /* Le thème entre dans l'empreinte : en changer doit refaire le cadre,
       sans quoi le tiroir garderait l'ancienne couleur. */
    /* Les fiches arrivent après coup : tant qu'une illustration manque,
       l'empreinte change encore, et le tiroir se refait quand elle est là.
       Sans cela les cases restaient vides pour toujours. */
    var images = reserve.map(function (it) {
      var c = cache.get(cle(it.id));
      return (c && c.image) || '';
    }).join(',');

    /* Ce qui décrit le CONTENU, sans les dimensions. Défini ICI, avant tout
       usage : plus bas, « var » le laissait indéfini au moment de la
       comparaison, les cases étaient donc conservées pour toujours et les
       illustrations n'arrivaient jamais. */
    var signatureCases = JSON.stringify(reserve) + '|' + langue + '|' + images;

    var empreinte = JSON.stringify(reserve) + '|' + langue + '|' + r_largeur()
      + '|' + (elRoot.getAttribute('data-theme') || '') + '|' + images
      + '|' + heroJoue + '|' + etatTiroir + '|' + positionReserve()
      + '|' + couleurReserveNeutre()

    if (empreinte === empreinteReserve) return;
    empreinteReserve = empreinte;

    if (titre) titre.textContent = libRech('reserve');

    /* La couleur du tiroir.

       Sous le thème « par héros », c'est celle du héros JOUÉ, non celle de la
       dernière fiche lue : le tiroir appartient au streamer, pas à la carte
       survolée. Sous un thème fixe, c'est celle de la fiche. */
    var teinte = null;
    var neutre = couleurReserveNeutre();

    if (neutre) {
      teinte = NEUTRE_RESERVE.cadre;
    } else if (elRoot.getAttribute('data-theme') === 'heros') {
      teinte = TEINTE_HEROS[heroJoue] || null;
    }
    if (!teinte && elCard) {
      var vu = window.getComputedStyle(elCard);
      if (vu && vu.borderTopColor) teinte = vu.borderTopColor;
    }

    /* Le fond de la case.

       Sous « par héros », il se bâtit depuis la teinte du héros JOUÉ, comme
       la fiche le fait pour celui d'une carte. Le relire sur la fiche donnait
       le brun par défaut tant qu'aucune carte à héros unique n'avait été
       survolée. */
    var fond = null;

    if (neutre) {
      fond = NEUTRE_RESERVE.fond;
    } else if (elRoot.getAttribute('data-theme') === 'heros' && TEINTE_HEROS[heroJoue]) {
      var t = fondDeTeinte(TEINTE_HEROS[heroJoue]);
      fond = 'linear-gradient(155deg, ' + melange(t, 0, 0.90) + ' 0%, '
           + melange(t, 0, 0.80) + ' 55%, ' + melange(t, 0, 0.90) + ' 100%)';
    } else if (elCard) {
      var styleFiche = window.getComputedStyle(elCard);
      fond = styleFiche.backgroundImage;
      if (!fond || fond === 'none') fond = styleFiche.backgroundColor;
    }

    if (fond) {
      tiroir.style.setProperty('--fond-reserve', fond);

      /* Le bouton a un fond UNI : sur un dégradé, son texte vertical passait
         d'une nuance claire à une sombre et se lisait mal selon le thème et
         la langue. On prend la première couleur du dégradé, la plus sombre,
         où le texte clair ressort le mieux. */
      var uni = /rgba?\([^)]+\)|#[0-9a-f]{6}/i.exec(fond);
      if (uni) tiroir.style.setProperty('--fond-bouton-reserve', uni[0]);
    }

    if (teinte) {
      tiroir.style.setProperty('--cadre-reserve', teinte);
      /* Le bouton porte la couleur en fond, et un texte sombre pour rester
         lisible : un bouton presque noir passait mal sur la vidéo. */
      /* Le liseré prend la teinte ; le TEXTE en prend une version éclaircie,
         sinon il devenait illisible sur les thèmes sombres comme Vanessa ou
         Karnok. */
      var bouton = document.getElementById('tiroir-bouton');
      if (bouton) bouton.style.color = eclaircirPourLire(teinte);
    }

    /* La case reprend les proportions d'un emplacement du plateau, réduites
       d'un quart. Largeur ET hauteur viennent de la géométrie : un
       emplacement n'est pas carré, et n'en prendre que la hauteur écrasait
       les illustrations. */
    var r = elRoot.getBoundingClientRect();
    var B = CFG.BOARD || {};

    /* Les mesures d'un emplacement du plateau, qui donnent la hauteur des
       cases. Leur largeur, elle, vient des proportions mesurées plus bas. */
    var largeurSlot = versLargeur((B.width || 100) / (B.slots || 10)) * r.width / 100;
    var hauteurSlot = versHauteur(B.height || 17) * r.height / 100;

    /* La largeur totale de la case, en proportion de celle du lecteur. La
       valeur vient d'une mesure sur un lecteur de 2560 pixels de large, où le
       bord droit devait tomber à 810.

       On part de la largeur voulue pour en déduire la taille d'un
       emplacement, plutôt que l'inverse : c'est ainsi que la case tombe au
       bon endroit quelle que soit la résolution. */
    function largeurPour(etat) {
      var tot = r.width * proportionReserve(etat === 'petite' ? 'petite' : 'grande');
      var pour = tot - LARGEUR_BOUTON_TIROIR - margesRuban(etat)
               - 3 * (EMPLACEMENTS_RESERVE - 1);
      return Math.max(6, Math.floor(pour / EMPLACEMENTS_RESERVE));
    }

    /* Fermée, la case garde la taille de sa position pendant qu'elle se
       referme : calculée « grande » par défaut, une petite case grandissait
       d'abord avant de se fermer. */
    var tailleEnCours = (etatTiroir === 'fermee') ? tailleSelonPosition() : etatTiroir;
    var totale = r.width * proportionReserve(tailleEnCours === 'petite' ? 'petite' : 'grande');
    var pourCases = totale - LARGEUR_BOUTON_TIROIR - margesRuban(tailleEnCours)
                  - 3 * (EMPLACEMENTS_RESERVE - 1);

    /* Dix arrondis successifs décalaient le bord droit de quelques pixels.
       On pose une largeur de base, et le reste de la division est réparti sur
       les premières cases : le total retombe alors exactement juste. */
    var largeurCase = Math.max(6, Math.floor(pourCases / EMPLACEMENTS_RESERVE));
    var reste = Math.max(0, Math.round(pourCases) - largeurCase * EMPLACEMENTS_RESERVE);

    /* La hauteur suit le rapport des ILLUSTRATIONS, non celui d'un
       emplacement du plateau : une image de fiche fait 75 sur 150, soit le
       double, et la case l'écrasait.

       La case garde EXACTEMENT ce rapport : l'espace qui laisse respirer les
       bordures est pris sous le ruban, non sur les illustrations. */
    var hauteurCase = hauteurPourLargeur(largeurCase);

    /* Le haut de la case, en proportion de la hauteur du lecteur. La valeur
       vient d'une mesure sur un lecteur de 1440 pixels de haut, où le bon
       emplacement se trouvait à 1060 : elle suit donc toute résolution. */
    /* La hauteur selon la position : en bas, à la mesure habituelle ; au
       milieu, le bas de la case sous l'horloge du jeu. Le côté décide de
       l'ancrage et du sens d'ouverture. */
    var pos = positionReserve();
    var hauteurBouton = hauteurPourLargeur(largeurPour('moyenne')) + 4;

    /* Le ruban est centré sur l'onglet, qui garde la hauteur de la grande
       taille : pour placer le BORD HAUT DU RUBAN, on remonte l'ensemble de
       la moitié de l'écart entre les deux. Le ruban mesure la hauteur d'une
       case, plus deux pixels de marge et un de bordure, en haut et en bas. */
    var hauteurRuban = hauteurPourLargeur(largeurPour(tailleSelonPosition())) + 6;
    var marge = Math.max(0, (hauteurBouton - hauteurRuban) / 2);

    var haut;
    if (pos === 'mg' || pos === 'md') {
      haut = Math.round(r.height * proportionReserve('milieu') - marge);
    } else if (pos === 'bd') {
      haut = Math.round(r.height * proportionReserve('basDroite') - marge);
    } else {
      haut = Math.round(r.height * proportionReserve('haut'));
    }
    tiroir.style.top = haut + 'px';
    tiroir.style.transform = 'none';
    tiroir.setAttribute('data-cote', (pos === 'md' || pos === 'bd') ? 'droite' : 'gauche');

    /* En bas à droite, la case occupe le coin des boutons de recherche et
       d'options : ils se placent au-dessus d'elle. Le décalage dépend de la
       POSITION seule, non de l'ouverture : les boutons ne bougent pas quand
       on ouvre ou ferme la case. */
    /* Sur le côté droit, quelle que soit sa hauteur : selon la taille du
       lecteur, la case au milieu à droite pouvait aussi croiser la pile des
       boutons. Dès qu'elles se chevauchent, la pile passe au-dessus de la
       case. Distances mesurées depuis le bas du lecteur. */
    var decalage = 0, enLigne = false;
    if (pos === 'bd' || pos === 'md') {
      var rond = Math.min(64, Math.max(28, 0.049 * window.innerHeight));
      var basBoutons = 0.105 * r.height + 25 + rond + 8;        // bas des options
      var hautPile = basBoutons + rond + 8 + rond;              // haut de la loupe
      var hautCase = r.height - haut;
      var basCase = hautCase - Math.max(hauteurBouton, hauteurRuban);
      if (pos === 'bd') {
        decalage = Math.max(0, Math.ceil(hautCase + 8 - basBoutons));
      } else if (basCase < hautPile + 8 && hautCase > basBoutons - 8) {
        /* Au milieu à droite, la pile DESCEND sous la case : au-dessus, elle
           passait sous le bandeau des extensions de Twitch, en haut du
           lecteur. Elle peut descendre jusqu'à la place du globe, masqué. */
        decalage = Math.max(-(rond + 8), Math.floor(basCase - 8 - hautPile));

        /* Sur un petit lecteur, la pile ne tient pas sous la case, même
           descendue : les deux boutons se mettent alors côte à côte, la loupe
           à gauche de la roue, ce qui ne demande que la hauteur d'un bouton. */
        if (hautPile + decalage > basCase - 8) {
          enLigne = true;
          decalage = Math.max(-(rond + 8), Math.floor(basCase - 8 - (basBoutons + rond)));
        }
      }
    }
    elRoot.style.setProperty('--decalage-boutons', decalage + 'px');
    if (enLigne) elRoot.setAttribute('data-boutons', 'ligne');
    else elRoot.removeAttribute('data-boutons');

    contenu.style.height = hauteurCase + 'px';

    /* L'icône d'enchantement a la même taille sur toutes les cases, réglée
       sur la largeur d'UN emplacement : proportionnelle à la case, elle
       grossissait avec les objets moyens et grands. */
    contenu.style.setProperty('--taille-icone',
      Math.max(10, Math.min(24, Math.round(largeurCase * 0.5))) + 'px');

    /* Le bouton garde la hauteur de la case DÉPLOYÉE EN GRAND, quel que soit
       l'état : ainsi il ne change jamais de taille, et le ruban se centre
       dessus. Son texte suit cette hauteur. */
    var hauteurGrande = hauteurPourLargeur(largeurPour('moyenne')) + 4;

    var bouton = document.getElementById('tiroir-bouton');
    if (bouton) {
      bouton.style.height = hauteurGrande + 'px';
      /* Assez grand pour se lire, assez petit pour tenir sur la tranche. */
      var corps = Math.max(9, Math.min(18, Math.round(hauteurGrande * 0.17)));
      bouton.style.fontSize = corps + 'px';
    }

    /* Si seules les dimensions changent, on redimensionne les cases en place
       plutôt que de les refaire : recréées, elles naissent à leur taille
       finale et l'animation de largeur ne se voyait pas. */
    var dejaLa = contenu.querySelectorAll('.case');
    if (dejaLa.length && contenu.__signature === signatureCases) {
      for (var n = 0; n < dejaLa.length; n++) {
        var cases_ = Number(dejaLa[n].dataset.cases || 1);
        var sup_ = 0;
        for (var q = 0; q < cases_; q++) if (Number(dejaLa[n].dataset.rang) + q < reste) sup_++;
        dejaLa[n].style.width =
          (largeurCase * cases_ + sup_ + 3 * (cases_ - 1)) + 'px';
      }
      return;
    }

    contenu.__signature = signatureCases;
    contenu.innerHTML = '';

    /* Les objets rangés par emplacement, pour que les trous se voient. */
    var parSocket = {};
    reserve.forEach(function (it) { parSocket[it.s] = it; });


    for (var i = 0; i < EMPLACEMENTS_RESERVE; i++) {
      var it = parSocket[i];

      var case_ = document.createElement('div');
      case_.className = 'case' + (it ? '' : ' vide');

      /* Le reste de la division, un pixel à la fois sur les premières. */
      var bonus = (i < reste) ? 1 : 0;
      case_.style.width = (largeurCase + bonus) + 'px';
      case_.dataset.rang = i;
      case_.dataset.cases = 1;

      if (!it) { contenu.appendChild(case_); continue; }

      /* Le mod donne déjà le nombre d'emplacements occupés, comme pour le
         plateau. La taille ne sert que de repli. */
      var cases = it.n || TAILLE_EN_CASES[it.z] || 1;

      /* Un objet large couvre plusieurs emplacements : il récupère leurs
         bonus, pour que la rangée garde sa largeur totale. */
      var sup = 0;
      for (var k = 0; k < cases; k++) if (i + k < reste) sup++;

      case_.style.width = (largeurCase * cases + sup + 3 * (cases - 1)) + 'px';
      case_.dataset.rang = i;
      case_.dataset.cases = cases;

      var carte = cache.get(cle(it.id));
      if (carte && carte.image) {
        case_.style.backgroundImage = 'url("' + CFG.DATA_BASE_URL
          + '/images/' + carte.image + (window.BAZAAR_SUFFIXE_CACHE || '') + '")';
      }

      /* La case se comporte comme une zone du plateau : mêmes champs, donc
         même survol, même épinglage, même panneau d'enchantements. */
      case_.__id = it.id;
      case_.__etiquette = 'reserve-' + it.s;
      case_.__talent = false;
      case_.__rencontre = false;
      case_.__combat = false;
      case_.__socket = it.se || null;

      /* Le cadre dit la rareté, et une pastille l'enchantement : la réserve
         se lit alors comme le plateau. */
      /* Le cadre de rareté, comme sur la fiche : bordure et lueur. La lueur
         est tournée vers l'intérieur, le ruban coupant ce qui dépasse. */
      if (it.q && window.poserCadreRarete) window.poserCadreRarete(case_, it.q, true);

      /* L'enchantement se lit au cadre, non à un nom écrit sur l'objet : le
         texte encombrait l'illustration. */
      if (it.e) {
        case_.setAttribute('data-enchant', it.e);
        case_.__enchant = it.e;

        var pub = (window.BAZAAR_LIBELLES || {}).couleurs_enchantements;
        var teinteEnch = (pub && pub[it.e])
          || (window.ENCHANTMENT_COLORS || {})[it.e] || '';
        if (teinteEnch) {
          case_.style.color = teinteEnch;
          /* La teinte du bandeau dégradé posé en bas de l'illustration. */
          case_.style.setProperty('--teinte-ench', teinteEnch);
        }

        /* L'icône de l'enchantement, au centre du bas de l'illustration. Posée
           seulement si le dessin existe : sinon le bandeau seul suffit. */
        var idIcone = ICONE_ENCHANT[it.e];
        var icone = idIcone && creerIcone(idIcone, 'icone-ench');
        if (icone) {
          /* Le dessin d'origine prend la couleur de l'enchantement, ou de son
             mot-clé pour ceux qui en gardent une propre. L'image du jeu garde
             la sienne, déjà assortie. */
          if (icone.tagName.toLowerCase() === 'svg') {
            var famille = COULEUR_ICONE_ENCHANT[it.e];
            var mots = (window.BAZAAR_LIBELLES || {}).couleurs_mots_cles || {};
            icone.style.color = (famille && mots[famille]) || teinteEnch || '#ffffff';
          }
          case_.appendChild(icone);
        }
      }

      (function (el) {
        el.addEventListener('mouseenter', function (ev) {
          if (epinglee) return;
          show(el.__id, false, false, false, el.__socket, el.__etiquette,
               el.__enchant || null);
          /* Sans cela la fiche restait là où la précédente avait paru. */
          suivre(ev);
        });
        el.addEventListener('mousemove', function (ev) {
          if (!epinglee) suivre(ev);
        });
        el.addEventListener('mouseleave', function () { if (!epinglee) hide(); });
        el.addEventListener('click', function (ev) {
          ev.stopPropagation();
          if (epinglee) { detacher(); return; }
          show(el.__id, false, false, false, el.__socket, el.__etiquette,
               el.__enchant || null);
          epingler(el);
        });
      })(case_);

      contenu.appendChild(case_);

      /* Un objet large couvre plusieurs emplacements : on saute les suivants. */
      i += cases - 1;
    }

    /* Les fiches des objets rangés, préchargées comme celles du plateau. */
    reserve.forEach(function (it) {
      fetchCard(it.id, false);
      (it.se || []).forEach(function (e) { fetchCard(e.i, false, true); });

      /* Et son illustration, retenue en mémoire comme les autres. */
      var c = cache.get(cle(it.id));
      if (c) prechargerImage(c);
    });

    /* Reconstruire les cases détruit celle que la souris survolait. On la
       rétablit, mais seulement si le curseur est bien dans la case : sinon
       l'appel forçait un calcul de mise en page pour rien. */
    if (!epinglee && hovered) montrerCeQuEstSousLeCurseur();
  }

  /* Le passage en plein écran changeait la taille sans que rien ne le dise :
     la case attendait le message suivant, jusqu'à une seconde plus tard. */
  function brancherRedimensionnement() {
    var minuteurs = [];

    /* Le lecteur ne prend pas sa nouvelle taille d'un coup : en plein écran,
       la mise en page se règle sur plusieurs images. On refait donc la case
       à quelques reprises, plutôt qu'une seule fois trop tôt. */
    var refaire = function () {
      minuteurs.forEach(clearTimeout);
      minuteurs = [0, 120, 350, 700].map(function (d) {
        return setTimeout(function () {
          empreinteReserve = null;      // force la reconstruction
          majTiroirReserve();
        }, d);
      });
    };

    window.addEventListener('resize', refaire);
    document.addEventListener('fullscreenchange', refaire);

    /* Twitch signale lui-même les changements de taille, et plus tôt que
       « resize » dans l'iframe d'une extension. Mais il appelle ce rappel
       très souvent, pour la latence et les statistiques de lecture : ne
       réagir qu'à un VRAI changement de résolution, sans quoi la case se
       reconstruisait plusieurs fois par seconde. */
    var T = window.Twitch && window.Twitch.ext;
    if (T && typeof T.onContext === 'function') {
      var derniereResolution = '';
      T.onContext(function (ctx) {
        var res = (ctx && ctx.displayResolution) || '';
        if (res === derniereResolution) return;
        derniereResolution = res;
        refaire();
      });
    }
  }

  function brancherTiroirReserve() {
    brancherRedimensionnement();
    var bouton = document.getElementById('tiroir-bouton');
    var tiroir = document.getElementById('tiroir-reserve');
    if (!bouton || !tiroir) return;

    /* Trois états, qui se suivent au clic : moyenne, fermée, petite, et de
       nouveau moyenne. L'état se retient d'une visite à l'autre. */
    /* Ouverte ou fermée ; la taille d'ouverture vient de la position. Les
       anciens états « petite » et « moyenne » valent « ouverte ». */
    appliquerEtatTiroir(memoire('bazaar-reserve-etat') === 'fermee' ? 'fermee' : tailleSelonPosition());

    /* Le lecteur Twitch prend deux clics rapprochés pour un double-clic et
       bascule en plein écran : on les lui retire tous. */
    ['mousedown', 'dblclick'].forEach(function (nom) {
      bouton.addEventListener(nom, function (ev) {
        ev.preventDefault();
        ev.stopPropagation();
      });
    });

    bouton.addEventListener('click', function (ev) {
      ev.preventDefault();
      ev.stopPropagation();
      /* Deux états : ouverte, à la taille de sa position, ou fermée. */
      var suivant = (etatTiroir === 'fermee') ? tailleSelonPosition() : 'fermee';
      appliquerEtatTiroir(suivant);
      retenir('bazaar-reserve-etat', suivant === 'fermee' ? 'fermee' : 'ouverte');
      majTiroirReserve();
    });
  }

  /* L'état courant de la case réserve. */
  var etatTiroir = 'moyenne';

  function appliquerEtatTiroir(etat) {
    var tiroir = document.getElementById('tiroir-reserve');
    if (!tiroir) return;

    etatTiroir = (etat === 'fermee' || etat === 'petite') ? etat : 'moyenne';
    tiroir.setAttribute('data-etat', etatTiroir);

    if (etatTiroir === 'fermee') {
      tiroir.removeAttribute('data-ouvert');
      return;
    }

    /* On redimensionne AVANT d'ouvrir, et SANS animation : fermée, la case
       gardait la taille de son dernier état, et l'ouverture la montrait
       grande une fraction de seconde avant de la réduire. */
    var etaitFermee = !tiroir.hasAttribute('data-ouvert');
    if (etaitFermee) tiroir.setAttribute('data-sans-anim', '1');

    majTiroirReserve();

    if (etaitFermee) {
      /* Un cycle de rendu pour que les nouvelles tailles soient prises avant
         que l'animation d'ouverture ne reprenne. */
      requestAnimationFrame(function () {
        tiroir.removeAttribute('data-sans-anim');
        tiroir.setAttribute('data-ouvert', '1');
      });
    } else {
      tiroir.setAttribute('data-ouvert', '1');
    }
  }

  function zone(gauche, haut, largeur, hauteur, id, etiquette, estTalent,
                estRencontre, combat, effetEmplacement, enchantement) {
    var el = zonesExistantes[etiquette];
    if (el) {
      zonesVues[etiquette] = 1;
      el.style.left   = versX(gauche) + '%';
      el.style.top    = versY(haut) + '%';
      el.style.width  = versLargeur(largeur) + '%';
      el.style.height = versHauteur(hauteur) + '%';
      el.__id = id;
      el.__etiquette = etiquette;
      el.__enchant = enchantement || null;
      el.__talent = !!estTalent;
      el.__rencontre = !!estRencontre;
      el.__combat = combat || null;
      el.__socket = effetEmplacement || null;
      return;
    }

    el = document.createElement('div');
    el.className = 'hotspot';
    el.dataset.slot = etiquette;
    el.__id = id;
    el.__etiquette = etiquette;
    el.__enchant = enchantement || null;
    el.__talent = !!estTalent;
    el.__rencontre = !!estRencontre;
    el.__combat = combat || null;
    el.__socket = effetEmplacement || null;
    zonesExistantes[etiquette] = el;
    zonesVues[etiquette] = 1;
    el.style.left   = versX(gauche) + '%';
    el.style.top    = versY(haut) + '%';
    el.style.width  = versLargeur(largeur) + '%';
    el.style.height = versHauteur(hauteur) + '%';
    el.addEventListener('mouseenter', function (ev) {
      if (epinglee) return;
      show(el.__id, el.__talent, el.__rencontre, el.__combat, el.__socket,
           el.__etiquette, el.__enchant);
      suivre(ev);
    });

    el.addEventListener('mousemove', function (ev) {
      if (epinglee) return;
      suivre(ev);
    });

    /* Quitter la zone ne ferme plus rien : c'est le mouvement de la souris
       qui décide, où qu'elle aille. Immobile, la fiche reste lisible même
       lorsque la carte a disparu de l'écran. */
    el.addEventListener('click', function (ev) {
      ev.stopPropagation();
      if (epinglee) { detacher(); return; }
      if (estMecanique(el.__id)) return;     // une règle ne s'épingle pas
      show(el.__id, el.__talent, el.__rencontre, el.__combat, el.__socket,
           el.__etiquette, el.__enchant);
      suivre(ev);
      epingler(el);
    });
    elHotspots.appendChild(el);
  }

  function dispositionTalents(nombre) {
    var L = CFG.SKILL_LAYOUTS || [];
    for (var i = 0; i < L.length; i++) if (nombre <= L[i].max) return L[i];
    return L[L.length - 1];   // au-delà du maximum connu, on garde la dernière
  }

  function buildHotspots() {
    zonesVues = {};

    var B = CFG.BOARD;
    var slotW = B.width / B.slots;

    board.forEach(function (it) {
      zone(B.left + it.s * slotW, B.top, slotW * (it.n || 1), B.height,
           it.id, 'O' + it.s, false, false, null, it.se || null, it.e || null);
    });

    var C = CFG.CARTES;
    if (C && enFace.length) {
      var slotC = C.width / C.slots;
      enFace.forEach(function (it) {
        var R = it.r ? CFG.RENCONTRE : null;      // rencontre : bande du dessus
        var haut = R ? R.top : C.top;
        var hauteur = R ? R.height : C.height;

        if (typeof it.x === 'number' && (faceCentree || it.r)) {
          var larg = (typeof it.w === 'number') ? it.w : slotC * (it.n || 1);

          var hy = (typeof it.y === 'number') ? it.y : null;
          var hh = (typeof it.h === 'number') ? it.h : hauteur;
          var top = (hy !== null) ? hy - hh / 2 : haut;

          /* Les effets d'emplacement valent pour l'adversaire comme pour
             soi : le mod les lit des deux côtés, mais ces deux appels les
             laissaient tomber. Un objet adverse posé sur un Sol et un La
             s'affichait donc sans rien en dire. */
          zone(it.x - larg / 2, top, larg, hh, it.id, etiquetteDe(it),
               it.k === 's', it.k === 'e',
               it.vs ? { vs: it.vs, nm: it.nm } : null, it.se || null,
               it.e || null);
        } else {
          zone(C.left + it.s * slotC, haut, slotC * (it.n || 1), hauteur,
               it.id, etiquetteDe(it), it.k === 's', it.k === 'e',
               it.vs ? { vs: it.vs, nm: it.nm } : null, it.se || null,
               it.e || null);
        }
      });
    }

    if (faceTalents.length) {
      var da = dispositionTalents(faceTalents.length);
      var fa = CFG.SKILL_SCALE || 1;
      var wa = da.w * fa, ha = da.h * fa;
      var parRangees = (da !== (CFG.SKILL_LAYOUTS || [])[0]);

      faceTalents.forEach(function (sk) {
        var pa = da.slots[sk.s];
        if (!pa) return;
        var axe = (CFG.TALENTS_ADVERSES_AXE !== undefined)
          ? CFG.TALENTS_ADVERSES_AXE : 50;
        var y = parRangees
          ? (2 * axe - pa[1])
          : (pa[1] - CFG.TALENTS_ADVERSES_DECALAGE);
        zone(pa[0] - wa / 2, y - ha / 2, wa, ha, sk.id, 'FT' + sk.s, true);
      });
    }

    if (skills.length) {
      var d = dispositionTalents(skills.length);
      var f = CFG.SKILL_SCALE || 1;          // ajustement fin de la taille des zones
      var w = d.w * f, h = d.h * f;
      skills.forEach(function (sk) {
        var p = d.slots[sk.s];
        if (!p) return;                      // plus de talents que d'emplacements
        zone(p[0] - w / 2, p[1] - h / 2, w, h, sk.id, 'T' + sk.s, true);
      });
    }

    /* Les mécaniques, pendant une partie, et si leurs textes sont publiés.
       « Une partie » : n'importe quoi de reçu, pas seulement un plateau. Un
       plateau encore vide, en début de partie ou devant un choix de
       rencontres, faisait disparaître les zones. */
    /* Les compteurs n'en font plus partie : le jeu les garde après la
       partie, et les zones restaient au menu. */
    var enPartie = partieEnCours();
    if (enPartie && mecaniquesPubliees) {
      var M = CFG.MECANIQUES || MECANIQUES_DEFAUT;
      MECANIQUES_ORDRE.forEach(function (nom) {
        var g = M[nom] || MECANIQUES_DEFAUT[nom];
        if (!g || !texteMecanique(nom)) return;
        zone(g.left, g.top, g.width, g.height, 'meca:' + nom, 'M-' + nom);
      });
    }

    Object.keys(zonesExistantes).forEach(function (cle) {
      if (zonesVues[cle]) return;
      var mort = zonesExistantes[cle];
      if (mort.parentNode) mort.parentNode.removeChild(mort);
      delete zonesExistantes[cle];
    });

    elRoot.classList.toggle('debug', !!CFG.DEBUG_HOTSPOTS);
  }

  var elLangues = null;

  var NOMS_LANGUE = {
    fr: 'Français',  en: 'English',   es: 'Español',   de: 'Deutsch',
    it: 'Italiano',  pt: 'Português', nl: 'Nederlands', pl: 'Polski',
    tr: 'Türkçe',    sv: 'Svenska',   da: 'Dansk',     no: 'Norsk',
    fi: 'Suomi',     cs: 'Čeština',   hu: 'Magyar',    ro: 'Română',
    el: 'Ελληνικά',  ar: 'العربية',    he: 'עברית',      hi: 'हिन्दी',
    th: 'ไทย',        vi: 'Tiếng Việt', id: 'Bahasa Indonesia',
    ko: '한국어',     zh: '中文',      'zh-tw': '繁體中文',
  };

  var PLANETE =
    '<svg viewBox="0 0 24 24" fill="none" ' +
    'stroke="currentColor" stroke-width="1.35">' +
    '<circle cx="12" cy="12" r="9"/>' +
    '<ellipse cx="12" cy="12" rx="4" ry="9"/>' +
    '<path d="M3.2 9h17.6M3.2 15h17.6"/></svg>';

  /* Le guide du premier lancement : un titre, puis « comment ça marche » en
     trois lignes, une par geste, puis les trois boutons de droite, dans leur
     ordre à l'écran, de haut en bas. */
  var TUTO = {
    fr: {
      titre: "Bazaar Scanner : Guide Rapide",
      comment: "Comment ça marche :",
      lignes: ["Survolez n'importe quel objet ou talent pour obtenir sa description.",
               "Cliquez pour la figer et voir ses enchantements.",
               "Cliquez sur le bouton Réserve, en bas à gauche, pour afficher ou masquer la réserve du streameur."],
      boutons: "Les boutons en bas à droite :",
      legendes: ["Cherchez un objet ou un talent", "Personnalisez l'affichage", "Choisissez votre langue"],
    },
    en: {
      titre: "Bazaar Scanner: Quick Guide",
      comment: "How it works:",
      lignes: ["Hover over any item or skill to see its description.",
               "Click to pin it and see its enchantments.",
               "Click the Stash button, bottom left, to show or hide the streamer's stash."],
      boutons: "The buttons in the bottom-right corner:",
      legendes: ["Search for an item or skill", "Customize the display", "Choose your language"],
    },
    de: {
      titre: "Bazaar Scanner: Kurzanleitung",
      comment: "So funktioniert es:",
      lignes: ["Fahren Sie über einen Gegenstand oder ein Talent, um seine Beschreibung zu sehen.",
               "Klicken Sie, um sie festzuhalten und ihre Verzauberungen zu sehen.",
               "Klicken Sie unten links auf „Lager“, um das Lager des Streamers ein- oder auszublenden."],
      boutons: "Die Schaltflächen unten rechts:",
      legendes: ["Gegenstand oder Talent suchen", "Anzeige anpassen", "Sprache wählen"],
    },
    es: {
      titre: "Bazaar Scanner: Guía rápida",
      comment: "Cómo funciona:",
      lignes: ["Pase el cursor sobre cualquier objeto o habilidad para ver su descripción.",
               "Haga clic para fijarla y ver sus encantamientos.",
               "Haga clic en el botón Reserva, abajo a la izquierda, para mostrar u ocultar la reserva del streamer."],
      boutons: "Los botones de la esquina inferior derecha:",
      legendes: ["Buscar un objeto o habilidad", "Personalizar la vista", "Elegir el idioma"],
    },
    it: {
      titre: "Bazaar Scanner: Guida rapida",
      comment: "Come funziona:",
      lignes: ["Passi il cursore su qualsiasi oggetto o talento per vederne la descrizione.",
               "Clicchi per fissarla e vederne gli incantamenti.",
               "Clicchi sul pulsante Riserva, in basso a sinistra, per mostrare o nascondere la riserva dello streamer."],
      boutons: "I pulsanti in basso a destra:",
      legendes: ["Cerca un oggetto o un talento", "Personalizza la vista", "Scegli la lingua"],
    },
    pt: {
      titre: "Bazaar Scanner: Guia rápido",
      comment: "Como funciona:",
      lignes: ["Passe o mouse sobre qualquer item ou talento para ver sua descrição.",
               "Clique para fixá-la e ver seus encantamentos.",
               "Clique no botão Reserva, no canto inferior esquerdo, para mostrar ou ocultar a reserva do streamer."],
      boutons: "Os botões no canto inferior direito:",
      legendes: ["Buscar um item ou talento", "Personalizar a exibição", "Escolher o idioma"],
    },
    ko: {
      titre: "Bazaar Scanner: 빠른 안내",
      comment: "사용 방법:",
      lignes: ["아이템이나 스킬 위에 마우스를 올리면 설명을 볼 수 있습니다.",
               "클릭하면 고정되어 마법 부여를 확인할 수 있습니다.",
               "왼쪽 아래의 보관함 버튼을 눌러 스트리머의 보관함을 표시하거나 숨길 수 있습니다."],
      boutons: "오른쪽 아래 버튼:",
      legendes: ["아이템·스킬 검색", "표시 설정", "언어 선택"],
    },
    zh: {
      titre: "Bazaar Scanner：快速指南",
      comment: "使用方法：",
      lignes: ["将鼠标悬停在任意物品或技能上即可查看说明。",
               "点击可将其固定并查看附魔。",
               "点击左下角的“储藏”按钮，可显示或隐藏主播的储藏。"],
      boutons: "右下角的按钮：",
      legendes: ["搜索物品或技能", "自定义显示", "选择语言"],
    },
  };



  /* Le guide se referme seul après ce délai, ou à la croix. Il compte deux
     phrases et trois légendes : sept secondes ne laissaient pas le temps de
     tout lire. */
  var TUTO_MS = 20000;
  var elTuto = null;
  var tutoEnCours = false;
  var tutoMinuteur = null;

  function montrerTuto(retraduire) {
    if (tutoEnCours && !retraduire) return;
    tutoEnCours = true;

    if (!elTuto) {
      elTuto = document.createElement('div');
      elTuto.id = 'tuto';
      elRoot.appendChild(elTuto);
    }

    elTuto.textContent = '';

    var corps = document.createElement('div');
    corps.className = 'corps';

    var guide = trad(TUTO, 'tuto') || {};

    /* Une version publiée à l'ancienne, simple liste de phrases, reste
       lisible : elle s'affiche en lignes, sans rangée d'icônes. */
    if (Array.isArray(guide)) guide = { lignes: guide };

    /* Le titre, et à sa droite le choix de la langue : le spectateur qui ne
       lit pas celle-ci peut en changer avant même de lire la suite. */
    var entete = document.createElement('div');
    entete.className = 'entete';
    var titre = document.createElement('div');
    titre.className = 'titre';
    titre.textContent = guide.titre || '';
    entete.appendChild(titre);
    entete.appendChild(boutonsLangues('langues'));
    corps.appendChild(entete);

    /* L'intertitre des gestes. */
    if (guide.comment) {
      var comment = document.createElement('div');
      comment.className = 'ou';
      comment.textContent = guide.comment;
      corps.appendChild(comment);
    }

    var lignes = document.createElement('div');
    lignes.className = 'lignes';
    (guide.lignes || []).forEach(function (t) {
      /* Une ligne laissée vide dans une langue n'y paraît pas. */
      if (typeof t !== 'string' || !t.trim()) return;
      var l = document.createElement('div');
      l.textContent = t;
      lignes.appendChild(l);
    });
    corps.appendChild(lignes);

    /* Les boutons de droite, avec leurs VRAIS dessins, dans leur ordre à
       l'écran, de haut en bas : loupe, options. La langue se choisit
       désormais en haut du guide et dans le menu. */
    if (Array.isArray(guide.legendes) && guide.legendes.length >= 2) {
      /* Où les trouver : ils sont en bas à droite du lecteur. */
      if (guide.boutons) {
        var ou = document.createElement('div');
        ou.className = 'ou';
        ou.textContent = guide.boutons;
        corps.appendChild(ou);
      }

      var rangee = document.createElement('div');
      rangee.className = 'rangee';
      [LOUPE, ROUE].forEach(function (dessin, n) {
        var col = document.createElement('div');
        col.className = 'colonne';
        var ic = document.createElement('div');
        ic.className = 'icone';
        ic.innerHTML = dessin;
        var leg = document.createElement('div');
        leg.className = 'legende';
        leg.textContent = guide.legendes[n];
        col.appendChild(ic);
        col.appendChild(leg);
        rangee.appendChild(col);
      });
      corps.appendChild(rangee);
    }

    elTuto.appendChild(corps);

    /* La croix, entourée d'un cercle qui s'efface dans le sens des aiguilles
       d'une montre : le spectateur voit le temps qui reste avant que le
       guide ne se ferme seul. */
    var croix = document.createElement('button');
    croix.type = 'button';
    croix.className = 'fermer';
    croix.title = 'OK';
    croix.innerHTML = '<svg class="decompte" viewBox="0 0 36 36" aria-hidden="true">'
      + '<circle cx="18" cy="18" r="16" pathLength="100" style="animation-duration:' + TUTO_MS + 'ms"/></svg>'
      + '<span>\u00D7</span>';
    croix.addEventListener('click', function (ev) {
      ev.stopPropagation();
      cacherTuto();
    });
    elTuto.appendChild(croix);

    elTuto.classList.add('visible');
    placerAlerte();
    if (tutoMinuteur) clearTimeout(tutoMinuteur);
    tutoMinuteur = setTimeout(cacherTuto, TUTO_MS);
  }

  function cacherTuto() {
    if (tutoMinuteur) { clearTimeout(tutoMinuteur); tutoMinuteur = null; }
    if (elTuto) elTuto.classList.remove('visible');
    tutoEnCours = false;
    placerAlerte();
  }

  function peutEtreTuto(cle) {
    if (memoire(cle)) return;
    retenir(cle, '1');
    montrerTuto();
  }

  var elOptions = null;

  var ROUE =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
    'stroke-width="1.9" stroke-linecap="round">' +
    '<path d="M4.5 7.5h15M4.5 12h15M4.5 16.5h15"/></svg>';

  var LIB_OPTIONS = {
    fr: { couleurReserve: 'Couleur', couleurTheme: 'Thème', couleurNeutre: 'Neutre', position: "Position", pos_bg: "Bas gauche (grande)", pos_mg: "Milieu gauche (petite)", pos_md: "Milieu droit (petite)", pos_bd: "Bas droit (grande)", impact: "Impact", capitales: "Capitales", comique: "Comique", gothique: "Gothique", langue: "Langue", emplacement: "Emplacement", afficher: "Afficher", on: "Oui", off: "Non", stats: "Stats des objets", global: "Générales", current: "Actuelles", reserve: "Réserve", oui: "Afficher", place: "Description", taille: 'Taille', auto: 'Défaut',
          curseur: 'Souris', hg: 'Coin sup. gauche', hd: 'Coin sup. droit',
          xs: 'Mini', s: 'Petit', m: 'Moyen', l: 'Grand', x: 'Maxi',
          tuto: 'Revoir l\u2019aide', creePar: 'Créé par',
          police: 'Police', lisible: 'Lisible', etroite: 'Étroite', ronde: 'Ronde', fixe: 'Fixe' },
    en: { couleurReserve: 'Color', couleurTheme: 'Theme', couleurNeutre: 'Neutral', position: "Position", pos_bg: "Bottom left (big)", pos_mg: "Middle left (small)", pos_md: "Middle right (small)", pos_bd: "Bottom right (big)", impact: "Impact", capitales: "All caps", comique: "Comic", gothique: "Gothic", langue: "Language", emplacement: "Location", afficher: "Show", on: "On", off: "Off", stats: "Item Stats", global: "Global", current: "Current", reserve: "Stash", oui: "Show", place: "Description", taille: 'Size', auto: 'Default',
          curseur: 'Cursor', hg: 'Top left', hd: 'Top right',
          xs: 'Min', s: 'Small', m: 'Medium', l: 'Large', x: 'Max',
          tuto: 'Show help again', creePar: 'Created by',
          police: 'Font', lisible: 'Readable', etroite: 'Narrow', ronde: 'Rounded', fixe: 'Monospace' },
    de: { couleurReserve: 'Farbe', couleurTheme: 'Thema', couleurNeutre: 'Neutral', position: "Position", pos_bg: "Unten links (groß)", pos_mg: "Mitte links (klein)", pos_md: "Mitte rechts (klein)", pos_bd: "Unten rechts (groß)", impact: "Impact", capitales: "Versalien", comique: "Comic", gothique: "Gotisch", langue: "Sprache", emplacement: "Position", afficher: "Anzeigen", on: "An", off: "Aus", stats: "Gegenstandswerte", global: "Global", current: "Aktuell", reserve: "Lager", oui: "Zeigen", place: "Beschreibung", taille: 'Größe', auto: 'Standard',
          curseur: 'Maus', hg: 'Oben links', hd: 'Oben rechts',
          xs: 'Min', s: 'Klein', m: 'Mittel', l: 'Groß', x: 'Max',
          tuto: 'Hilfe erneut zeigen', creePar: 'Erstellt von',
          police: 'Schrift', lisible: 'Gut lesbar', etroite: 'Schmal', ronde: 'Rund', fixe: 'Feste Breite' },
    es: { couleurReserve: 'Color', couleurTheme: 'Tema', couleurNeutre: 'Neutro', position: "Posición", pos_bg: "Abajo a la izquierda (grande)", pos_mg: "Centro izquierda (pequeña)", pos_md: "Centro derecha (pequeña)", pos_bd: "Abajo a la derecha (grande)", impact: "Impact", capitales: "Mayúsculas", comique: "Cómica", gothique: "Gótica", langue: "Idioma", emplacement: "Ubicación", afficher: "Mostrar", on: "Sí", off: "No", stats: "Estadísticas", global: "Global", current: "Actual", reserve: "Reserva", oui: "Mostrar", place: "Descripción", taille: 'Tamaño', auto: 'Predeterminado',
          curseur: 'Cursor', hg: 'Arriba izq.', hd: 'Arriba dcha.',
          xs: 'Mín', s: 'Pequeño', m: 'Medio', l: 'Grande', x: 'Máx',
          tuto: 'Ver la ayuda', creePar: 'Creado por',
          police: 'Fuente', lisible: 'Legible', etroite: 'Estrecha', ronde: 'Redonda', fixe: 'Monoespaciada' },
    it: { couleurReserve: 'Colore', couleurTheme: 'Tema', couleurNeutre: 'Neutro', position: "Posizione", pos_bg: "In basso a sinistra (grande)", pos_mg: "Al centro a sinistra (piccola)", pos_md: "Al centro a destra (piccola)", pos_bd: "In basso a destra (grande)", impact: "Impact", capitales: "Maiuscole", comique: "Fumetto", gothique: "Gotico", langue: "Lingua", emplacement: "Posizione", afficher: "Mostra", on: "Sì", off: "No", stats: "Statistiche", global: "Globali", current: "Attuali", reserve: "Riserva", oui: "Mostra", place: "Descrizione", taille: 'Dimensione', auto: 'Predefinito',
          curseur: 'Cursore', hg: 'In alto a sx', hd: 'In alto a dx',
          xs: 'Min', s: 'Piccolo', m: 'Medio', l: 'Grande', x: 'Max',
          tuto: 'Rivedi l\u2019aiuto', creePar: 'Creato da',
          police: 'Carattere', lisible: 'Leggibile', etroite: 'Stretto', ronde: 'Tondo', fixe: 'Monospazio' },
    pt: { couleurReserve: 'Cor', couleurTheme: 'Tema', couleurNeutre: 'Neutro', position: "Posição", pos_bg: "Inferior esquerda (grande)", pos_mg: "Centro esquerda (pequena)", pos_md: "Centro direita (pequena)", pos_bd: "Inferior direita (grande)", impact: "Impact", capitales: "Maiúsculas", comique: "Quadrinhos", gothique: "Gótica", langue: "Idioma", emplacement: "Posição", afficher: "Mostrar", on: "Sim", off: "Não", stats: "Estatísticas", global: "Global", current: "Atual", reserve: "Reserva", oui: "Mostrar", place: "Descrição", taille: 'Tamanho', auto: 'Padrão',
          curseur: 'Cursor', hg: 'Sup. esquerdo', hd: 'Sup. direito',
          xs: 'Mín', s: 'Pequeno', m: 'Médio', l: 'Grande', x: 'Máx',
          tuto: 'Ver a ajuda', creePar: 'Criado por',
          police: 'Tipo de letra', lisible: 'Legível', etroite: 'Estreita', ronde: 'Redonda', fixe: 'Monoespaçada' },
    ko: { couleurReserve: '색상', couleurTheme: '테마', couleurNeutre: '중립', position: "위치", pos_bg: "왼쪽 아래 (크게)", pos_mg: "왼쪽 가운데 (작게)", pos_md: "오른쪽 가운데 (작게)", pos_bd: "오른쪽 아래 (크게)", impact: "임팩트", capitales: "대문자", comique: "코믹", gothique: "중세풍", langue: "언어", emplacement: "위치", afficher: "표시", on: "켜기", off: "끄기", stats: "아이템 능력치", global: "전체", current: "현재", reserve: "보관함", oui: "표시", place: "설명", taille: '크기', auto: '기본값',
          curseur: '마우스', hg: '왼쪽 위', hd: '오른쪽 위',
          xs: '아주 작게', s: '작게', m: '보통', l: '크게', x: '최대',
          tuto: '도움말 다시 보기', creePar: '제작',
          police: '글꼴', lisible: '읽기 쉽게', etroite: '좁게', ronde: '둥글게', fixe: '고정폭' },
    zh: { couleurReserve: '颜色', couleurTheme: '主题', couleurNeutre: '中性', position: "位置", pos_bg: "左下（大）", pos_mg: "左中（小）", pos_md: "右中（小）", pos_bd: "右下（大）", impact: "粗黑", capitales: "大写", comique: "漫画", gothique: "哥特体", langue: "语言", emplacement: "位置", afficher: "显示", on: "开", off: "关", stats: "物品属性", global: "全部", current: "当前", reserve: "储藏", oui: "显示", place: "描述", taille: '大小', auto: '默认',
          curseur: '鼠标', hg: '左上角', hd: '右上角',
          xs: '最小', s: '小', m: '中', l: '大', x: '最大',
          tuto: '再次显示提示', creePar: '作者',
          police: '字体', lisible: '易读', etroite: '紧凑', ronde: '圆体', fixe: '等宽' },
  };

  var TITRE_GLOBE = {
    fr: 'Langue', en: 'Language', de: 'Sprache', es: 'Idioma',
    it: 'Lingua', pt: 'Idioma', ko: '언어', zh: '语言',
  };

  var TITRE_OPTIONS = {
    fr: 'Options', en: 'Options', de: 'Optionen', es: 'Opciones',
    it: 'Opzioni', pt: 'Opções', ko: '설정', zh: '设置',
  };

  var LIB_THEMES = {
    fr: { titre: "Thème", heros: "Défaut", vanessa: "Rubis de Vanessa", pygmalien: "Nuit de Pyg", dooley: "Cambouis de Dooley", mak: "Émeraude de Mak", stelle: "Aube de Stelle", jules: "Apéritif de Jules", karnok: "Colère de Karnok", dragons: "Lumière des Dragons", cuir: "Cuir commun", },
    en: { titre: "Theme", heros: "Default", vanessa: "Vanessa's Ruby", pygmalien: "Pyg's Night", dooley: "Dooley's Grease", mak: "Mak's Emerald", stelle: "Stelle's Dawn", jules: "Jules' Aperitif", karnok: "Karnok's Wrath", dragons: "Dragons' Light", cuir: "Common Leather", },
    de: { titre: "Thema", heros: "Standard", vanessa: "Vanessas Rubin", pygmalien: "Pygs Nacht", dooley: "Dooleys Schmiere", mak: "Maks Smaragd", stelle: "Stelles Morgen", jules: "Jules' Aperitif", karnok: "Karnoks Zorn", dragons: "Licht der Drachen", cuir: "Gewöhnliches Leder", },
    es: { titre: "Tema", heros: "Predeterminado", vanessa: "Rubí de Vanessa", pygmalien: "Noche de Pyg", dooley: "Grasa de Dooley", mak: "Esmeralda de Mak", stelle: "Alba de Stelle", jules: "Aperitivo de Jules", karnok: "Ira de Karnok", dragons: "Luz de los Dragones", cuir: "Cuero común", },
    it: { titre: "Tema", heros: "Predefinito", vanessa: "Rubino di Vanessa", pygmalien: "Notte di Pyg", dooley: "Grasso di Dooley", mak: "Smeraldo di Mak", stelle: "Alba di Stelle", jules: "Aperitivo di Jules", karnok: "Ira di Karnok", dragons: "Luce dei Draghi", cuir: "Cuoio comune", },
    pt: { titre: "Tema", heros: "Padrão", vanessa: "Rubi de Vanessa", pygmalien: "Noite de Pyg", dooley: "Graxa de Dooley", mak: "Esmeralda de Mak", stelle: "Alvorada de Stelle", jules: "Aperitivo de Jules", karnok: "Ira de Karnok", dragons: "Luz dos Dragões", cuir: "Couro comum", },
    ko: { titre: "테마", heros: "기본", vanessa: "바네사의 루비", pygmalien: "피그의 밤", dooley: "둘리의 기름", mak: "막의 에메랄드", stelle: "스텔레의 여명", jules: "쥘의 아페리티프", karnok: "카르녹의 분노", dragons: "드래곤의 빛", cuir: "평범한 가죽", },
    zh: { titre: "主题", heros: "默认", vanessa: "瓦妮莎之红宝石", pygmalien: "皮格之夜", dooley: "杜利之油", mak: "马克之翠", stelle: "斯泰尔之曦", jules: "朱尔之饮", karnok: "卡尔诺克之怒", dragons: "巨龙之光", cuir: "普通皮革", },
  };

  function libTheme(cle) { return libelle(LIB_THEMES, 'themes', cle); }

  /* Le compteur de victoires : nom de sa section et ses trois tailles. */
  (function () {
    LIB_OPTIONS.fr.victoires = "Compteur de victoires"; LIB_OPTIONS.fr.bv_s = "Petit"; LIB_OPTIONS.fr.bv_m = "Moyen"; LIB_OPTIONS.fr.bv_l = "Grand";
    LIB_OPTIONS.en.victoires = "Win Count"; LIB_OPTIONS.en.bv_s = "Small"; LIB_OPTIONS.en.bv_m = "Medium"; LIB_OPTIONS.en.bv_l = "Large";
    LIB_OPTIONS.de.victoires = "Siegzähler"; LIB_OPTIONS.de.bv_s = "Klein"; LIB_OPTIONS.de.bv_m = "Mittel"; LIB_OPTIONS.de.bv_l = "Groß";
    LIB_OPTIONS.es.victoires = "Contador de victorias"; LIB_OPTIONS.es.bv_s = "Pequeño"; LIB_OPTIONS.es.bv_m = "Medio"; LIB_OPTIONS.es.bv_l = "Grande";
    LIB_OPTIONS.it.victoires = "Contatore vittorie"; LIB_OPTIONS.it.bv_s = "Piccolo"; LIB_OPTIONS.it.bv_m = "Medio"; LIB_OPTIONS.it.bv_l = "Grande";
    LIB_OPTIONS.pt.victoires = "Contador de vitórias"; LIB_OPTIONS.pt.bv_s = "Pequeno"; LIB_OPTIONS.pt.bv_m = "Médio"; LIB_OPTIONS.pt.bv_l = "Grande";
    LIB_OPTIONS.ko.victoires = "승리 기록"; LIB_OPTIONS.ko.bv_s = "작게"; LIB_OPTIONS.ko.bv_m = "보통"; LIB_OPTIONS.ko.bv_l = "크게";
    LIB_OPTIONS.zh.victoires = "胜场记录"; LIB_OPTIONS.zh.bv_s = "小"; LIB_OPTIONS.zh.bv_m = "中"; LIB_OPTIONS.zh.bv_l = "大";

    /* Sa position : en haut ou en bas de la vidéo. */
    var POSITIONS = {
      fr: ['Haut', 'Bas'],      en: ['Top', 'Bottom'],   de: ['Oben', 'Unten'],
      es: ['Arriba', 'Abajo'],  it: ['In alto', 'In basso'], pt: ['Topo', 'Base'],
      ko: ['위', '아래'],        zh: ['顶部', '底部'],
    };
    Object.keys(POSITIONS).forEach(function (l) {
      LIB_OPTIONS[l].bv_haut = POSITIONS[l][0];
      LIB_OPTIONS[l].bv_bas = POSITIONS[l][1];
    });
  })();

  function libOpt(cle) { return libelle(LIB_OPTIONS, 'options', cle); }

  /* --- recherche ---------------------------------------------------------
     Une loupe au-dessus du menu. Elle ouvre un panneau où le spectateur
     cherche n'importe quelle carte, sans dépendre de ce qui est à l'écran.

     L'index - nom, tags, héros - est publié à part et ne pèse que quelques
     centaines de kilo-octets ; les fiches complètes ne sont chargées qu'à la
     sélection. */

  var elRecherche = null;
  var indexRecherche = null;
  var filtres = { h: new Set(), t: new Set(), k: new Set(), g: new Set(),
                  z: new Set(), q: new Set() };

  var LOUPE =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
    'stroke-width="1.9" stroke-linecap="round">' +
    '<circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5L21 21"/></svg>';

  var LIB_RECHERCHE = {
    fr: { titre: 'Rechercher', champ: 'Nom d\u2019une carte…',
          vide: 'Aucun résultat.', reinit: 'Réinitialiser', sansEnchant: 'Sans', enchantements: 'Enchantement :', chargement: 'Chargement…',
          heros: 'Héros', tags: 'Mots-clés', motsCles: 'Effets',
          objets: 'Objets', talents: 'Talents', genre: 'Types', tailles: 'Tailles', raretes: 'Rareté' , reserve: "Réserve" },
    en: { titre: 'Search', champ: 'Card name…',
          vide: 'No results.', reinit: 'Reset', sansEnchant: 'None', enchantements: 'Enchantment:', chargement: 'Loading…',
          heros: 'Heroes', tags: 'Keywords', motsCles: 'Effects',
          objets: 'Items', talents: 'Skills', genre: 'Types', tailles: 'Sizes', raretes: 'Rarity' , reserve: "Stash" },
    de: { titre: 'Suchen', champ: 'Kartenname…',
          vide: 'Keine Treffer.', reinit: 'Zurücksetzen', sansEnchant: 'Ohne', enchantements: 'Verzauberung:', chargement: 'Lädt…',
          heros: 'Helden', tags: 'Schlüsselwörter', motsCles: 'Effekte',
          objets: 'Gegenstände', talents: 'Talente', genre: 'Typen', tailles: 'Größen', raretes: 'Seltenheit' , reserve: "Lager" },
    es: { titre: 'Buscar', champ: 'Nombre de una carta…',
          vide: 'Sin resultados.', reinit: 'Restablecer', sansEnchant: 'Sin', enchantements: 'Encantamiento:', chargement: 'Cargando…',
          heros: 'Héroes', tags: 'Palabras clave', motsCles: 'Efectos',
          objets: 'Objetos', talents: 'Habilidades', genre: 'Tipos', tailles: 'Tamaños', raretes: 'Rareza' , reserve: "Reserva" },
    it: { titre: 'Cerca', champ: 'Nome di una carta…',
          vide: 'Nessun risultato.', reinit: 'Reimposta', sansEnchant: 'Senza', enchantements: 'Incantesimo:', chargement: 'Caricamento…',
          heros: 'Eroi', tags: 'Parole chiave', motsCles: 'Effetti',
          objets: 'Oggetti', talents: 'Abilità', genre: 'Tipi', tailles: 'Dimensioni', raretes: 'Rarità' , reserve: "Riserva" },
    pt: { titre: 'Pesquisar', champ: 'Nome de uma carta…',
          vide: 'Sem resultados.', reinit: 'Repor', sansEnchant: 'Sem', enchantements: 'Encantamento:', chargement: 'A carregar…',
          heros: 'Heróis', tags: 'Palavras-chave', motsCles: 'Efeitos',
          objets: 'Objetos', talents: 'Habilidades', genre: 'Tipos', tailles: 'Tamanhos', raretes: 'Raridade' , reserve: "Reserva" },
    ko: { titre: '검색', champ: '카드 이름…',
          vide: '결과가 없습니다.', reinit: '초기화', sansEnchant: '없음', enchantements: '마법 부여:', chargement: '불러오는 중…',
          heros: '영웅', tags: '키워드', motsCles: '효과',
          objets: '아이템', talents: '스킬', genre: '유형', tailles: '크기', raretes: '등급' , reserve: "보관함" },
    zh: { titre: '搜索', champ: '卡牌名称…',
          vide: '没有结果。', reinit: '重置', sansEnchant: '无', enchantements: '附魔：', chargement: '加载中…',
          heros: '英雄', tags: '关键词', motsCles: '效果',
          objets: '物品', talents: '技能', genre: '类型', tailles: '尺寸', raretes: '稀有度' , reserve: "储藏" },
  };

  /* « Recherche : » devant le champ, « Résultats » au-dessus de la liste. */
  /* Le texte du champ dit qu'on cherche aussi dans les descriptions. Une
     clé nouvelle, « champTexte » : l'ancienne, « champ », figure dans les
     libellés publiés et y garderait « Nom d'une carte… ». */
  [['fr', 'Recherche :', 'Résultats', 'Nom ou texte d\u2019une carte…'],
   ['en', 'Search:', 'Results', 'Card name or text…'],
   ['de', 'Suche:', 'Ergebnisse', 'Kartenname oder -text…'],
   ['es', 'Búsqueda:', 'Resultados', 'Nombre o texto de una carta…'],
   ['it', 'Ricerca:', 'Risultati', 'Nome o testo di una carta…'],
   ['pt', 'Pesquisa:', 'Resultados', 'Nome ou texto de uma carta…'],
   ['ko', '검색:', '결과', '카드 이름 또는 설명…'],
   ['zh', '搜索：', '结果', '卡牌名称或描述…']].forEach(function (l) {
    if (!LIB_RECHERCHE[l[0]]) return;
    LIB_RECHERCHE[l[0]].etiquetteChamp = l[1];
    LIB_RECHERCHE[l[0]].resultats = l[2];
    LIB_RECHERCHE[l[0]].champTexte = l[3];
  });

  /* Le texte tel qu'on le compare : sans majuscules ni accents, espaces
     resserrés. « brulure » trouve ainsi « Brûlure ». L'export prépare les
     descriptions de la même façon. */
  function pourComparer(t) {
    return String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .normalize('NFC').toLowerCase().replace(/[\u2019\u02bc`\u00b4]/g, "'")
      .replace(/\s+/g, ' ').trim();
  }

  function libRech(cle) { return libelle(LIB_RECHERCHE, 'recherche', cle); }

  /* L'index porte les cartes ET les filtres. Ces derniers viennent des données
     publiées, non du code : un héros ou un type ajouté par une mise à jour du
     jeu apparaît sans qu'il faille soumettre l'extension à Twitch. */
  var filtresPublies = { heros: [], types: [], motsCles: [], tailles: [],
                         raretes: [] };

  function chargerIndexRecherche() {
    if (indexRecherche) return Promise.resolve(indexRecherche);
    return fetch(CFG.DATA_BASE_URL + '/recherche/' + langue + '.json'
                 + (window.BAZAAR_SUFFIXE_CACHE || ''))
      .then(function (r) { return r.json(); })
      .then(function (donnees) {
        // Ancien format : un simple tableau de cartes.
        if (Array.isArray(donnees)) {
          indexRecherche = donnees;
          filtresPublies = { heros: [], types: [], motsCles: [], tailles: [],
                       raretes: [] };
        } else {
          indexRecherche = donnees.cartes || [];
          filtresPublies = {
            heros: donnees.heros || [],
            types: donnees.types || [],
            motsCles: donnees.motsCles || [],
            tailles: donnees.tailles || [],
            raretes: donnees.raretes || [],
          };
        }
        return indexRecherche;
      })
      .catch(function () { return (indexRecherche = []); });
  }

  function construireRecherche() {
    if (elRecherche) { elRecherche.remove(); elRecherche = null; }

    elRecherche = document.createElement('div');
    elRecherche.id = 'viewer-recherche';

    var bouton = document.createElement('button');
    bouton.type = 'button';
    bouton.className = 'loupe';
    bouton.innerHTML = LOUPE;
    bouton.title = libRech('titre');
    bouton.addEventListener('click', function (ev) {
      ev.stopPropagation();
      if (elOptions) elOptions.classList.remove('deplie');
      var ouvert = elRecherche.classList.toggle('deplie');
      if (ouvert) chargerIndexRecherche().then(function () {
        poserFiltres();
        rafraichirResultats();
        reprendreChoix();
        // Le curseur dans le champ : on ouvre la recherche pour chercher.
        var champ = elRecherche.__champ;
        if (champ) { champ.focus(); champ.select(); }
      });
    });
    elRecherche.appendChild(bouton);

    var panneau = document.createElement('div');
    panneau.className = 'panneau';
    panneau.addEventListener('click', function (ev) { ev.stopPropagation(); });

    /* Twitch bascule le plein écran au double clic sur la vidéo. Dans le
       panneau, on l'en empêche : on y clique pour choisir, pas pour changer
       la taille du stream. */
    panneau.addEventListener('dblclick', function (ev) {
      ev.stopPropagation();
      ev.preventDefault();
    });

    // ── barre du haut : champ et réinitialisation ──
    var haut = document.createElement('div');
    haut.className = 'haut';

    var etiquette = document.createElement('label');
    etiquette.className = 'etiquette-champ';
    etiquette.textContent = libRech('etiquetteChamp');
    haut.appendChild(etiquette);

    var champ = document.createElement('input');
    champ.type = 'text';
    champ.className = 'champ';
    champ.id = 'viewer-recherche-champ';
    etiquette.htmlFor = champ.id;
    champ.placeholder = libRech('champTexte');
    champ.addEventListener('input', rafraichirResultats);
    haut.appendChild(champ);

    var reinit = document.createElement('button');
    reinit.type = 'button';
    reinit.className = 'reinit';
    reinit.textContent = libRech('reinit');
    reinit.addEventListener('click', function () {
      champ.value = '';
      filtres.h.clear();
      filtres.t.clear();
      filtres.k.clear();
      filtres.g.clear();
      filtres.z.clear();
      filtres.q.clear();
      [].forEach.call(elRecherche.querySelectorAll('.filtre'), function (b) {
        b.classList.remove('actif');
        b.classList.remove('efface');
      });
      rafraichirResultats();
    });
    haut.appendChild(reinit);

    /* Chaque partie du panneau dans son cadre, comme le menu des options : la
       recherche sur une ligne, son titre à gauche. */
    var blocRecherche = document.createElement('div');
    blocRecherche.className = 'bloc en-ligne';
    etiquette.className = 'etiquette-champ titre-bloc';
    etiquette.textContent = libRech('etiquetteChamp').replace(/\s*[:：]\s*$/, '');
    blocRecherche.appendChild(etiquette);
    blocRecherche.appendChild(haut);
    panneau.appendChild(blocRecherche);

    // ── filtres : héros puis types ──
    var zoneFiltres = document.createElement('div');
    zoneFiltres.className = 'zone-filtres';
    panneau.appendChild(zoneFiltres);

    // ── résultats à gauche, fiche à droite ──
    var corps = document.createElement('div');
    corps.className = 'corps';

    /* La colonne des résultats : son titre, puis la liste qui défile. */
    var colonne = document.createElement('div');
    colonne.className = 'colonne-resultats bloc';
    var titreResultats = document.createElement('div');
    titreResultats.className = 'titre-resultats titre-bloc';
    titreResultats.textContent = libRech('resultats');
    colonne.appendChild(titreResultats);

    var liste = document.createElement('div');
    liste.className = 'liste';
    colonne.appendChild(liste);
    corps.appendChild(colonne);

    var apercu = document.createElement('div');
    apercu.className = 'apercu bloc';
    corps.appendChild(apercu);

    panneau.appendChild(corps);
    elRecherche.appendChild(panneau);
    elRoot.appendChild(elRecherche);

    elRecherche.__filtres = zoneFiltres;
    elRecherche.__champ = champ;
    elRecherche.__liste = liste;
    elRecherche.__apercu = apercu;
    return elRecherche;
  }

  /* Une rangée de filtres. Cliquer en active un ; cliquer à nouveau le
     désactive. Plusieurs filtres se cumulent. */
  /* Une rangée où types et effets se mêlent, chacun gardant son genre. */
  function rangeeMelee(entrees, intitule) {
    var r = document.createElement('div');
    r.className = 'filtres';

    var titre = document.createElement('span');
    titre.className = 'titre';
    titre.textContent = libRech(intitule || 'tags');
    r.appendChild(titre);

    entrees.forEach(function (e) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'filtre'
        + (e.genre === 'k' ? ' ' + e.valeur : '')
        + (e.genre === 'q' ? ' rarete r-' + e.valeur : '');

      b.dataset.genre = e.genre;
      b.dataset.valeur = e.valeur;
      b.textContent = e.nom;

      if (e.genre === 'k') habillerFiltreEffet(b, e.valeur);

      /* La rareté vient de la table commune, publiable : la feuille de style
         n'en garde qu'un repli. */
      if (e.genre === 'q' && window.couleurRarete) {
        var cr = window.couleurRarete(e.valeur);
        if (cr) b.style.color = cr;
      }

      b.addEventListener('click', function () {
        if (filtres[e.genre].has(e.valeur)) filtres[e.genre].delete(e.valeur);
        else filtres[e.genre].add(e.valeur);
        b.classList.toggle('actif', filtres[e.genre].has(e.valeur));
        rafraichirResultats();
      });
      r.appendChild(b);
    });
    return r;
  }


  /* ── Filtres d'effets : teinte et icône ──────────────────────────────────

     La teinte vient des données publiées. Faute de couleur, on retombe sur
     le beige des autres filtres : un bouton noir sur fond noir serait
     invisible, ce qui est arrivé avec les familles détachées en cours de
     route.

     L'icône est celle du mot-clé quand elle existe. Son nom se déduit de la
     famille, à quelques exceptions près, et on ne la pose que si le symbole
     est réellement présent dans la page. */
  /* L'icône de chaque enchantement, pour la case réserve. Les données
     publiées peuvent compléter ou corriger cette table. */
  var ICONE_ENCHANT = {
    Golden: 'gold', Heavy: 'slow', Icy: 'freeze', Turbo: 'haste',
    Shielded: 'shield', Restorative: 'heal', Toxic: 'poison', Fiery: 'burn',
    Shiny: 'multicast', Deadly: 'crit', Obsidian: 'damage', Mossy: 'health',
    Radiant: 'flying',
  };

  /* ── Les icônes du jeu ───────────────────────────────────────────────────

     Les vraies icônes du jeu, en PNG, publiées avec les données dans
     « keywords/ ». Une icône publiée l'emporte sur le dessin SVG de même nom,
     partout : filtres, case réserve, et descriptions des cartes. Une icône
     nouvelle s'ajoute ainsi sans téléverser l'extension.

     Ces icônes ont leurs propres couleurs, celles du jeu : on ne les teint
     pas, ce qui effacerait leurs détails. */
  var ICONES_PNG = {};

  /* Le décalage vertical des icônes dans le texte, réglable sans téléverser.
     « decalages_icones » de mots-cles.json, en PIXELS : 1 descend l'icône
     d'un pixel, -1 la monte d'un pixel, par rapport à la position commune.
     « defaut » déplace toutes celles qui n'ont pas leur propre réglage.

     Un pixel vaut 0,05 em à la taille habituelle du texte : le réglage reste
     juste quand la fiche grandit ou rétrécit. */
  var POSITION_COMMUNE = -0.19;

  function poserDecalage(img, id) {
    var table = window.BAZAAR_DECALAGES;
    if (!table || typeof table !== 'object') return;
    var px = (typeof table[id] === 'number') ? table[id]
           : (typeof table.defaut === 'number') ? table.defaut : null;
    if (px === null) return;
    img.style.verticalAlign = (POSITION_COMMUNE - px * 0.05).toFixed(3) + 'em';
  }

  /* Quelques dessins portent un autre nom que l'icône du jeu. */
  var ALIAS_ICONE = { coins: 'value' };

  function urlIconePng(id) {
    var nom = ALIAS_ICONE[id] || id;
    return ICONES_PNG[nom]
      ? CFG.DATA_BASE_URL + '/keywords/' + nom + '.png' + (window.BAZAAR_SUFFIXE_CACHE || '')
      : null;
  }

  /* Une icône prête à poser : l'image du jeu si elle existe, sinon le dessin
     SVG d'origine, sinon rien. */
  function creerIcone(id, classe) {
    var url = urlIconePng(id);
    if (url) {
      var img = document.createElement('img');
      img.className = classe + ' kw-png';
      img.src = url;
      if (classe === 'kw-icon') poserDecalage(img, ALIAS_ICONE[id] || id);
      img.alt = '';
      img.setAttribute('aria-hidden', 'true');
      img.decoding = 'async';
      img.draggable = false;
      return img;
    }
    if (!document.getElementById(id)) return null;

    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', classe);
    svg.setAttribute('viewBox', '0 0 18 18');
    svg.setAttribute('aria-hidden', 'true');
    var use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    use.setAttribute('href', '#' + id);
    svg.appendChild(use);
    return svg;
  }

  /* Les icônes dessinées ailleurs, dans le texte des cartes notamment, sont
     des SVG qui pointent vers un dessin. On les remplace par l'image du jeu
     au moment où elles paraissent, où qu'elles viennent. */
  /* Une icône ne se sépare jamais de ce qui la suit.

     Elle est enveloppée, avec le premier mot ou élément qui la suit, dans un
     bloc qui ne se coupe pas. Un joint de mot invisible avait été essayé :
     le navigateur coupait quand même après l'image, qu'il traite comme un
     objet à part, et le caractère restait dans le texte copié. */
  var JOINT = '\u2060';

  function lierIcones(racine) {
    if (!racine || !racine.querySelectorAll) return;
    var icones = racine.querySelectorAll('.kw-icon');

    for (var n = 0; n < icones.length; n++) {
      var ic = icones[n];
      var parent = ic.parentNode;
      if (!parent || (parent.classList && parent.classList.contains('kw-lie'))) continue;

      /* Les joints d'une version précédente sont retirés au passage. */
      var suite = ic.nextSibling;
      while (suite && suite.nodeType === 3 && suite.nodeValue.replace(new RegExp(JOINT, 'g'), '') === '') {
        var vide = suite;
        suite = suite.nextSibling;
        parent.removeChild(vide);
      }
      if (suite && suite.nodeType === 3 && suite.nodeValue.charAt(0) === JOINT) {
        suite.nodeValue = suite.nodeValue.replace(new RegExp('^' + JOINT + '+'), '');
      }

      var lien = document.createElement('span');
      lien.className = 'kw-lie';
      parent.insertBefore(lien, ic);
      lien.appendChild(ic);

      if (suite && suite.nodeType === 1) {
        /* Un nombre en gras, ou le premier palier d'une suite « 30 > 60 ». */
        lien.appendChild(suite);
      } else if (suite && suite.nodeType === 3) {
        /* Du texte : on n'emmène que son premier mot, « 20 » dans « 20 Rage ». */
        var m = /^\S+/.exec(suite.nodeValue);
        if (m) {
          lien.appendChild(document.createTextNode(m[0]));
          suite.nodeValue = suite.nodeValue.slice(m[0].length);
        }
      }
    }
  }

  function remplacerIconesDans(racine) {
    if (!racine || !racine.querySelectorAll) return;
    lierIcones(racine);
    var liste = racine.querySelectorAll('svg.kw-icon, svg.icone-ench');
    for (var n = 0; n < liste.length; n++) {
      var svg = liste[n];
      var use = svg.querySelector('use');
      var ref = use && (use.getAttribute('href') || use.getAttribute('xlink:href') || '');
      var idRef = ref && ref.replace(/^#/, '');
      var url = idRef && urlIconePng(idRef);
      if (!url) continue;

      var img = document.createElement('img');
      img.className = (svg.getAttribute('class') || 'kw-icon') + ' kw-png';
      img.src = url;
      if (/\bkw-icon\b/.test(img.className)) poserDecalage(img, ALIAS_ICONE[idRef] || idRef);
      img.alt = '';
      img.setAttribute('aria-hidden', 'true');
      img.decoding = 'async';
      svg.parentNode.replaceChild(img, svg);
    }
    lierIcones(racine);
  }

  /* Ce que le rendu des cartes demande : l'icône d'une famille de mots-clés,
     seulement si elle existe vraiment, en image du jeu ou en dessin. */
  var FAMILLES_ICONE_MOT = null;

  window.BAZAAR_ICONE = {
    famille: function (fam) {
      var id = ICONE_PAR_FAMILLE[fam] || String(fam).replace(/^kw-/, '');
      return (urlIconePng(id) || document.getElementById(id)) ? id : null;
    },
    famillesMot: function () { return FAMILLES_ICONE_MOT; },
    familleDeIcone: function (id) {
      var teintes = (window.BAZAAR_LIBELLES || {}).couleurs_mots_cles || {};
      var nom = ALIAS_ICONE[id] || id;
      var familles = Object.keys(teintes);
      for (var n = 0; n < familles.length; n++) {
        var i = ICONE_PAR_FAMILLE[familles[n]] || familles[n].replace(/^kw-/, '');
        if (i === id || (ALIAS_ICONE[i] || i) === nom) return familles[n];
      }
      return null;
    },
  };

  var observateurIcones = null;

  function brancherIconesPng(liste) {
    ICONES_PNG = {};
    (Array.isArray(liste) ? liste : []).forEach(function (id) {
      if (/^[a-z0-9_-]+$/i.test(id)) ICONES_PNG[id] = 1;
    });
    if (!Object.keys(ICONES_PNG).length) return;

    remplacerIconesDans(document.body);

    /* Un seul observateur pour toute la page : il ne réagit qu'aux ajouts,
       et ne parcourt que ce qui vient d'être ajouté. */
    if (!observateurIcones && window.MutationObserver) {
      observateurIcones = new window.MutationObserver(function (changements) {
        for (var c = 0; c < changements.length; c++) {
          var ajouts = changements[c].addedNodes;
          for (var a = 0; a < ajouts.length; a++) {
            var el = ajouts[a];
            if (el.nodeType !== 1) continue;
            if (el.matches && el.matches('svg.kw-icon, svg.icone-ench')) {
              remplacerIconesDans(el.parentNode);
            } else {
              remplacerIconesDans(el);
            }
          }
        }
      });
      observateurIcones.observe(document.body, { childList: true, subtree: true });
    }
  }

  /* Les icônes qui gardent la couleur de leur mot-clé au lieu de prendre
     celle de l'enchantement : Radieux montre l'icône du vol, dans la couleur
     du vol. */
  var COULEUR_ICONE_ENCHANT = { Radiant: 'kw-fly' };

  var ICONE_PAR_FAMILLE = {
    'kw-fly': 'flying', 'kw-multi': 'multicast', 'kw-value': 'coins',
    'kw-life': 'lifesteal',
  };

  var COULEUR_FILTRE_DEFAUT = '#9a8c74';

  function habillerFiltreEffet(bouton, famille) {
    var teintes = (window.BAZAAR_LIBELLES || {}).couleurs_mots_cles;
    var teinte = (teintes && teintes[famille]) || COULEUR_FILTRE_DEFAUT;
    bouton.style.color = teinte;

    var nom = ICONE_PAR_FAMILLE[famille]
      || String(famille).replace(/^kw-/, '');

    /* L'image du jeu, ou à défaut le dessin d'origine, teint alors de la
       couleur du filtre. Rien si aucun n'existe. */
    var icone = creerIcone(nom, 'kw-icon');
    if (!icone) return;
    if (icone.tagName.toLowerCase() === 'svg') icone.style.color = teinte;

    bouton.insertBefore(icone, bouton.firstChild);
  }

  function rangeeFiltres(genre, valeurs) {
    var r = document.createElement('div');
    r.className = 'filtres';

    var titre = document.createElement('span');
    titre.className = 'titre';
    titre.textContent = libRech(
      genre === 'h' ? 'heros'
      : genre === 'g' ? 'genre'
      : genre === 'k' ? 'motsCles'
      : 'tags');
    r.appendChild(titre);

    valeurs.forEach(function (v) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'filtre';
      b.dataset.genre = genre;
      b.dataset.valeur = v;

      /* Le portrait d'un héros que le rendu ne connaît pas encore se déduit
         de son nom : le fichier suit la même convention. Un héros nouveau
         s'affiche donc sans qu'il faille reconstruire l'extension. */
      var portraits = window.HERO_PORTRAITS || {};
      var portrait = portraits[v]
        || (CFG.DATA_BASE_URL + '/characters/' + v + '_Portrait.png');

      /* Le jeu désigne certains héros par un nom interne, « Hero8 » pour les
         Dragons. Les données publiées portent le vrai nom : sans cela, le
         spectateur voyait « Hero8 » en survolant le portrait, et chaque
         nouveau héros aurait demandé un téléversement. */
      var nomAffiche = nomDeHeros(v);

      if (genre === 'h' && portrait) {
        b.classList.add('portrait');
        var img = document.createElement('img');
        img.src = portrait;
        img.alt = nomAffiche;
        // Sans portrait publié, on retombe sur le nom plutôt qu'un carré vide.
        img.addEventListener('error', function () {
          b.classList.remove('portrait');
          b.textContent = nomAffiche;
        });
        b.appendChild(img);
        b.title = nomAffiche;
      } else if (genre === 'g') {
        b.textContent = libRech(v === 'i' ? 'objets' : 'talents');
      } else if (genre === 'k') {
        var m = filtresPublies.motsCles.filter(function (x) { return x.c === v; })[0];
        b.textContent = (m && m.n) || v;
        habillerFiltreEffet(b, v);
      } else {
        b.textContent = nomDeTag(v);
      }

      b.addEventListener('click', function () {
        var etait = filtres[genre].has(v);

        /* Un objet n'appartient qu'à UN héros : ce filtre est exclusif et
           remplace le précédent. Les types, eux, se cumulent.

           Dans les deux cas, cliquer un filtre déjà retenu le retire. */
        if (genre === 'h' || genre === 'g') filtres[genre].clear();
        else if (etait) filtres[genre].delete(v);

        if (!etait) filtres[genre].add(v);

        /* Seuls les boutons DU MÊME GENRE sont touchés : la rangée des héros
           contient aussi celle du genre de carte, qu'un parcours large
           grisait au passage. */
        [].forEach.call(r.querySelectorAll('.filtre[data-genre="' + genre + '"]'),
          function (autre) {
            var pris = filtres[genre].has(autre.dataset.valeur);
            autre.classList.toggle('actif', pris);
            // Un héros retenu éteint visuellement les autres.
            autre.classList.toggle('efface',
              genre === 'h' && filtres.h.size > 0 && !pris);
          });
        rafraichirResultats();
      });
      r.appendChild(b);
    });
    return r;
  }

  /* Les héros dans l'ordre du jeu, et non celui du fichier de portraits.
     « Pygmalien », « Common » et « Hero8 » sont les noms internes de Pyg, des
     objets communs et du Dragon. Un héros inconnu vient à la fin plutôt que
     de disparaître. */
  /* Publié avec les libellés : un seul endroit à corriger, et sans
     téléverser. La liste en dur ne sert que si rien n'est publié. */
  function ordreHeros() {
    return (window.BAZAAR_LIBELLES || {}).ordre_heros
      || ['Vanessa', 'Pygmalien', 'Dooley', 'Mak', 'Stelle',
          'Jules', 'Karnok', 'Hero8', 'Common'];
  }

  function herosOrdonnes() {
    var connus = Object.keys(window.HERO_PORTRAITS || {});
    var ordonnes = ordreHeros().filter(function (h) { return connus.indexOf(h) >= 0; });
    connus.forEach(function (h) {
      if (ordonnes.indexOf(h) < 0) ordonnes.push(h);
    });
    return ordonnes;
  }

  /* Le nom d'un héros, tel que les données le publient. À défaut, le nom
     interne, qui reste préférable à rien. */
  function nomDeHeros(v) {
    var noms = (window.BAZAAR_LIBELLES || {}).noms_heros;
    return (noms && noms[v]) || v;
  }

  function nomDeTag(v) {
    return window.trad ? window.trad(window.TAG_FR || {}, v, 'tags') : v;
  }

  var TAGS_CONNUS = ['Weapon', 'Tool', 'Food', 'Friend', 'Property', 'Vehicle',
    'Aquatic', 'Core', 'Potion', 'Apparel', 'Dinosaur', 'Dragon', 'Drone',
    'Loot', 'Ray', 'Reagent', 'Relic', 'Tech', 'Toy', 'Trap', 'Instrument'];

  /* Les rangées de filtres, bâties d'après ce que les données annoncent. */
  function poserFiltres() {
    if (!elRecherche || !elRecherche.__filtres) return;
    var zone = elRecherche.__filtres;
    zone.textContent = '';
    /* Les héros d'abord, sur leur propre ligne. */
    zone.appendChild(rangeeFiltres('h', filtresPublies.heros.length
      ? filtresPublies.heros : herosOrdonnes()));

    /* Puis le genre de carte et les tailles, ensemble sur la suivante. */
    var ligneCartes = document.createElement('div');
    ligneCartes.className = 'filtres';

    var genres = rangeeFiltres('g', ['i', 's']);
    genres.classList.add('devant');
    ligneCartes.appendChild(genres);

    if (filtresPublies.tailles.length) {
      var tailles = rangeeMelee(filtresPublies.tailles.map(function (t) {
        return { genre: 'z', valeur: t.c, nom: t.n };
      }), 'tailles');
      tailles.classList.add('devant');
      ligneCartes.appendChild(tailles);
    }

    if (filtresPublies.raretes.length) {
      var raretes = rangeeMelee(filtresPublies.raretes.map(function (r) {
        return { genre: 'q', valeur: r.c, nom: r.n };
      }), 'raretes');
      raretes.classList.add('devant');
      ligneCartes.appendChild(raretes);
    }

    zone.appendChild(ligneCartes);
    /* Types et effets partagent une seule rangée, triée sur les noms
       affichés : le spectateur cherche « Brûlure » sans se demander si c'est
       un type d'objet ou un effet. */
    var types = (filtresPublies.types.length ? filtresPublies.types
      : TAGS_CONNUS.slice()).map(function (v) {
        return { genre: 't', valeur: v, nom: nomDeTag(v) };
      });

    var effets = filtresPublies.motsCles.map(function (m) {
      return { genre: 'k', valeur: m.c, nom: m.n };
    });

    var ensemble = types.concat(effets).sort(function (a, b) {
      return a.nom.localeCompare(b.nom, langue);
    });

    zone.appendChild(rangeeMelee(ensemble));
    encadrerFiltres(zone);
  }

  /* Chaque rangée de filtres dans son cadre, le titre en bandeau à gauche.
     Types, tailles et raretés partagent une ligne, écartés également. Les
     mots-clés, sur plusieurs lignes, n'ont leur titre qu'en encart dans le
     coin : les boutons passent dessous. */
  function encadrerFiltres(zone) {
    var rangs = [].slice.call(zone.children);
    rangs.forEach(function (rang, i) {
      var titre = rang.querySelector(':scope > .titre');
      if (!titre) {
        rang.classList.add('ligne-filtres');
        [].forEach.call(rang.children, encadrer);
        return;
      }
      if (i === rangs.length - 1) { rang.classList.add('cadre-filtre', 'encart'); return; }
      encadrer(rang);
    });

    function encadrer(r) {
      var t = r.querySelector(':scope > .titre');
      if (!t) return;
      r.classList.add('cadre-filtre');
      var choix = document.createElement('div');
      choix.className = 'choix-filtres';
      [].slice.call(r.childNodes).forEach(function (n) { if (n !== t) choix.appendChild(n); });
      r.appendChild(choix);
    }
  }

  function rafraichirResultats() {
    if (!elRecherche || !indexRecherche) return;

    var mot = pourComparer(elRecherche.__champ.value);
    var liste = elRecherche.__liste;
    liste.textContent = '';

    /* Le nom OU la description (« d », préparée par l'export) : un mot cherché
       trouve toutes les cartes qui le contiennent. L'ordre reste celui de
       l'index, alphabétique. Un index d'avant cette version n'a pas de « d » :
       la recherche y reste limitée aux noms. */
    var trouves = indexRecherche.filter(function (e) {
      if (mot) {
        if (e.__n === undefined) e.__n = pourComparer(e.n);
        if (e.__n.indexOf(mot) < 0 && (!e.d || e.d.indexOf(mot) < 0)) return false;
      }
      // Les filtres se CUMULENT : une carte doit porter tout ce qui est coché.
      for (var h of filtres.h) if (!(e.h || []).includes(h)) return false;
      for (var t of filtres.t) if (!(e.t || []).includes(t)) return false;
      for (var k of filtres.k) if (!(e.k || []).includes(k)) return false;
      if (filtres.z.size && !filtres.z.has(e.z)) return false;
      if (filtres.q.size && !filtres.q.has(e.q)) return false;
      // Aucun genre retenu : objets et talents ensemble.
      if (filtres.g.size && !filtres.g.has(e.g)) return false;
      return true;
    });

    if (!trouves.length) {
      var vide = document.createElement('div');
      vide.className = 'vide';
      vide.textContent = libRech('vide');
      liste.appendChild(vide);
      return;
    }

    /* Toute la liste, mais posée par tranches : créer 1 700 boutons d'un coup
       fige la page une fraction de seconde. La première tranche suffit à
       remplir la colonne, le reste arrive pendant que le spectateur lit. */
    var TRANCHE = 120;
    var pose = 0;

    var poser = function () {
      var lot = document.createDocumentFragment();
      var fin = Math.min(pose + TRANCHE, trouves.length);

      for (; pose < fin; pose++) lot.appendChild(bouton(trouves[pose]));
      liste.appendChild(lot);

      /* Une fiche reprise après un changement de langue : sa ligne vient au
         milieu de la liste, une seule fois. */
      if (defilerVersChoix) {
        var marquee = liste.querySelector('.resultat.actif');
        if (marquee) {
          defilerVersChoix = false;
          liste.scrollTop = Math.max(0, marquee.offsetTop - liste.offsetTop
                                        - (liste.clientHeight - marquee.offsetHeight) / 2);
        }
      }

      if (pose < trouves.length) {
        // On rend la main entre deux tranches : le défilement reste fluide.
        (window.requestAnimationFrame || setTimeout)(poser, 0);
      }
    };

    function bouton(e) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'resultat' + (e.g === 's' ? ' talent' : ' objet');
      /* Un rond plein devant un talent, un carré plein devant un objet. */
      var marque = document.createElement('span');
      marque.className = 'marque';
      marque.setAttribute('aria-hidden', 'true');
      b.appendChild(marque);
      b.appendChild(document.createTextNode(e.n));
      /* Le paquet part dès le survol : le clic n'a alors plus rien à
         attendre. Sans effet si la fiche est déjà là. */
      b.addEventListener('mouseenter', function () {
        fetchCard(e.i, e.g === 's', false);
      });

      b.addEventListener('click', function () {
        [].forEach.call(liste.querySelectorAll('.resultat'), function (a) {
          a.classList.toggle('actif', a === b);
        });
        montrerApercu(e);
      });
      /* La fiche affichée garde sa ligne marquée quand la liste se refait. */
      if (choix !== null && e.i === choix) b.classList.add('actif');
      return b;
    }

    poser();
  }

  /* La fiche choisie, rendue dans la colonne de droite. */
  var choix = null;

  /* La fiche ouverte avant un changement de langue, à rouvrir dans la
     nouvelle dès que son index est chargé. */
  var choixAReprendre = null;
  var defilerVersChoix = false;

  function reprendreChoix() {
    if (choixAReprendre === null || !elRecherche) return;
    var id = choixAReprendre;
    choixAReprendre = null;
    var entree = (indexRecherche || []).filter(function (e) { return e.i === id; })[0];
    if (!entree) return;
    montrerApercu(entree);
    /* La liste vient d'être posée sans marque : on la refait, cette fois
       avec la ligne de la fiche, et on l'amène en vue. */
    defilerVersChoix = true;
    rafraichirResultats();
  }

  function nomEnchant(e) {
    return window.trad
      ? window.trad(window.ENCHANT_FR || {}, e, 'enchantements') : e;
  }

  function montrerApercu(entree) {
    var apercu = elRecherche.__apercu;
    var estTalent = entree.g === 's';
    var enchantement = null;
    choix = entree.i;

    var dessiner = function (carte) {
      /* On garde la position de lecture : changer d'enchantement refaisait
         l'aperçu et renvoyait le spectateur tout en haut. */
      var ouEtaitOn = apercu.scrollTop;
      apercu.textContent = '';

      /* Les enchantements de cette carte, s'il y en a. Le premier bouton
         montre l'objet nu. */
      /* Triés sur le nom affiché, dans la langue courante. */
      var noms = Object.keys(carte.enchantments || {}).sort(function (a, b) {
        return nomEnchant(a).localeCompare(nomEnchant(b), langue);
      });
      if (noms.length) {
        var barre = document.createElement('div');
        barre.className = 'enchants';

        var quoi = document.createElement('span');
        quoi.className = 'titre';
        /* En encart, comme les titres des filtres : sans les deux-points. */
        quoi.textContent = libRech('enchantements').replace(/\s*[:：]\s*$/, '');
        barre.appendChild(quoi);

        [null].concat(noms).forEach(function (e) {
          var b = document.createElement('button');
          b.type = 'button';
          b.className = 'ench' + (e === enchantement ? ' actif' : '');
          /* Le rendu tient déjà le glossaire des enchantements et leurs
             teintes : on s'y raccroche plutôt que d'en écrire un second. */
          var lib = document.createElement('span');
          lib.textContent = e ? nomEnchant(e) : libRech('sansEnchant');
          b.appendChild(lib);
          /* La teinte publiée l'emporte : un enchantement ajouté par une mise
             à jour du jeu s'affiche coloré sans téléverser l'extension. */
          if (e) {
            var pub = (window.BAZAAR_LIBELLES || {}).couleurs_enchantements;
            b.style.color = (pub && pub[e])
              || (window.ENCHANTMENT_COLORS || {})[e] || '';
          }
          b.addEventListener('click', function () {
            enchantement = e;
            dessiner(carte);
          });
          barre.appendChild(b);
        });
        apercu.appendChild(barre);
      }

      var hote = document.createElement('div');
      hote.className = 'fiche';
      apercu.appendChild(hote);
      rendreFicheDans(hote, carte, estTalent, enchantement);

      /* L'aperçu est un CLONE de la fiche survolée : il hérite de ses styles
         en ligne, et les règles de thème ne peuvent rien contre eux. On pose
         donc la couleur nous-mêmes, sur la carte interne.

         Sous « Défaut », c'est celle du héros à qui l'objet appartient ; sous
         un thème nommé, celle du thème. */
      teinterApercu(hote.querySelector('#card') || hote, carte.heroes);

      ajusterApercu();

      apercu.scrollTop = ouEtaitOn;
    };

    /* Le paquet pèse quelques centaines de kilo-octets : l'attente se voit.
       On le dit, sinon la colonne reste vide et l'on croit que le clic n'a
       rien fait. */
    apercu.textContent = '';
    var attente = document.createElement('div');
    attente.className = 'vide';
    attente.textContent = libRech('chargement');
    apercu.appendChild(attente);

    Promise.resolve(fetchCard(entree.i, estTalent, false))
      .then(function (carte) {
        // Un autre résultat a pu être choisi entre-temps.
        if (choix !== entree.i) return;
        if (carte) dessiner(carte);
        else attente.textContent = libRech('vide');
      })
      .catch(function () { attente.textContent = libRech('vide'); });
  }



  /* Rend une fiche AILLEURS que dans le panneau habituel.

     Le rendu écrit toujours au même endroit : on le laisse faire, puis on
     recopie le résultat dans l'aperçu et on remet le panneau comme il était.
     Écrire un second rendu aurait dédoublé toute la mise en forme. */
  /* Un enchantement peut fixer le Multicast de la carte : Shiny ramène celui
     de Mecha Dragon à 1, et sa « Répétition 2 » disparaît, comme en jeu. La
     valeur publiée est absolue ; au-dessus de 1, elle remplace celle de base. */
  function selonEnchantement(carte, ench) {
    var t = carte && carte.multicastEnchante;
    if (!ench || !t || typeof t[ench] !== 'number') return {};
    var v = t[ench];
    var aDeBase = carte.multicast !== null && carte.multicast !== undefined
      || (carte.tooltips || []).some(function (x) { return x && x.repli === 'multicast'; });
    if (!aDeBase && v <= 1) return {};
    return {
      tooltips: (carte.tooltips || []).filter(function (x) { return !(x && x.repli === 'multicast'); }),
      multicast: v > 1 ? v : null,
    };
  }

  /* En « Current », le Multicast que le jeu donne en ce moment à
     l'exemplaire remplace celui de la fiche : certains objets en gagnent
     (Anaconda) ou en perdent au fil d'un combat. Au-dessus de 1, la ligne
     montre la valeur ; à 1, elle disparaît, comme en jeu. Sans valeur reçue
     (ancienne application, message allégé), la fiche garde la sienne. Une
     fiche épinglée reste globale. */
  function multicastVivant(carte, live, id) {
    if (window.BAZAAR_STATS !== 'current') return {};
    if (epinglee && epinglee.id === id) return {};
    if (!live || typeof live.mc !== 'number') return {};
    return {
      tooltips: (carte.tooltips || []).filter(function (x) { return !(x && x.repli === 'multicast'); }),
      multicast: live.mc > 1 ? live.mc : null,
    };
  }

  /* En « Current », le délai d'activation et les munitions maximales que le
     jeu donne en ce moment à l'exemplaire : un délai s'allonge ou se réduit
     en combat (Honey Badger, Seashadow). Seulement pour une carte qui en a
     déjà un : un objet passif garde sa fiche telle quelle. */
  function delaisVivants(carte, live, id) {
    if (window.BAZAAR_STATS !== 'current') return {};
    if (epinglee && epinglee.id === id) return {};
    if (!live) return {};
    var r = {};
    var aUnDelai = carte.cooldowns !== null && carte.cooldowns !== undefined;
    if (aUnDelai && typeof live.cd === 'number' && live.cd > 0) r.cooldowns = live.cd;
    var aDesMunitions = carte.ammo !== null && carte.ammo !== undefined;
    if (aDesMunitions && typeof live.am === 'number' && live.am > 0) r.ammo = live.am;
    return r;
  }

  function rendreFicheDans(hote, carte, estTalent, enchantement) {
    if (!elPanel || !elCard) return;

    var etaitCache = elPanel.classList.contains('hidden');

    window.showItem(Object.assign({ found: true }, carte, {
      isSkill: !!estTalent,
      currentTier: carte.tier,
      /* La recherche n'a pas d'objet réel derrière elle : elle montre toujours
         tous les paliers, même en « Current ». */
      statsGlobales: true,
      enchantmentName: enchantement || null,
      enchantmentTooltips: enchantement
        ? ((carte.enchantments && carte.enchantments[enchantement]) || []) : [],
    }, selonEnchantement(carte, enchantement)));

    /* On clone l'ÉLÉMENT, pas son contenu : presque toutes les règles de la
       fiche visent « #card », et une simple copie du contenu perdait sa mise
       en forme. Le clone garde cet identifiant. */
    var copie = elCard.cloneNode(true);

    /* La fiche est invisible tant qu'elle n'a pas la classe « visible » -
       l'animation d'apparition. Le clone n'en hérite pas toujours : on l'y
       force, et on lui retire l'échelle du panneau, qui a la sienne. */
    copie.classList.add('visible');
    copie.classList.remove('hiding');
    copie.style.transform = '';
    copie.style.opacity = '1';

    /* L'illustration est masquée le temps de son chargement, et c'est
       l'ORIGINAL qui sera révélé à l'arrivée - jamais le clone. On le montre
       donc tout de suite : l'image apparaîtra d'elle-même une fois chargée. */
    [].forEach.call(copie.querySelectorAll('img'), function (img) {
      img.style.visibility = '';
    });

    hote.textContent = '';
    hote.appendChild(copie);

    if (etaitCache) elPanel.classList.add('hidden');
  }

  /* Les drapeaux des langues, dessinés : Windows n'affiche pas les émojis
     de drapeaux, et le spectateur n'aurait vu que deux lettres. Simplifiés
     pour tenir dans un rond. Le portugais est celui du Brésil, la langue du
     jeu étant pt-BR. */
  var DRAPEAUX = {
    fr: "<svg viewBox=\"0 0 30 30\" preserveAspectRatio=\"xMidYMid slice\" aria-hidden=\"true\"><rect width=\"10\" height=\"30\" fill=\"#0055a4\"/><rect x=\"10\" width=\"10\" height=\"30\" fill=\"#fff\"/><rect x=\"20\" width=\"10\" height=\"30\" fill=\"#ef4135\"/></svg>",
    it: "<svg viewBox=\"0 0 30 30\" preserveAspectRatio=\"xMidYMid slice\" aria-hidden=\"true\"><rect width=\"10\" height=\"30\" fill=\"#009246\"/><rect x=\"10\" width=\"10\" height=\"30\" fill=\"#fff\"/><rect x=\"20\" width=\"10\" height=\"30\" fill=\"#ce2b37\"/></svg>",
    de: "<svg viewBox=\"0 0 30 30\" preserveAspectRatio=\"xMidYMid slice\" aria-hidden=\"true\"><rect width=\"30\" height=\"10\" fill=\"#000\"/><rect y=\"10\" width=\"30\" height=\"10\" fill=\"#dd0000\"/><rect y=\"20\" width=\"30\" height=\"10\" fill=\"#ffce00\"/></svg>",
    es: "<svg viewBox=\"0 0 30 30\" preserveAspectRatio=\"xMidYMid slice\" aria-hidden=\"true\"><rect width=\"30\" height=\"30\" fill=\"#aa151b\"/><rect y=\"7.5\" width=\"30\" height=\"15\" fill=\"#f1bf00\"/></svg>",
    en: "<svg viewBox=\"0 0 30 30\" preserveAspectRatio=\"xMidYMid slice\" aria-hidden=\"true\"><rect width=\"30\" height=\"30\" fill=\"#012169\"/><path d=\"M0,0L30,30M30,0L0,30\" stroke=\"#fff\" stroke-width=\"6\"/><path d=\"M0,0L30,30M30,0L0,30\" stroke=\"#c8102e\" stroke-width=\"2\"/><path d=\"M15,0V30M0,15H30\" stroke=\"#fff\" stroke-width=\"10\"/><path d=\"M15,0V30M0,15H30\" stroke=\"#c8102e\" stroke-width=\"6\"/></svg>",
    pt: "<svg viewBox=\"0 0 30 30\" preserveAspectRatio=\"xMidYMid slice\" aria-hidden=\"true\"><rect width=\"30\" height=\"30\" fill=\"#009c3b\"/><polygon points=\"15,4 28,15 15,26 2,15\" fill=\"#ffdf00\"/><circle cx=\"15\" cy=\"15\" r=\"6\" fill=\"#002776\"/></svg>",
    ko: "<svg viewBox=\"0 0 30 30\" preserveAspectRatio=\"xMidYMid slice\" aria-hidden=\"true\"><rect width=\"30\" height=\"30\" fill=\"#fff\"/><path d=\"M8,15a7,7 0 0,1 14,0z\" fill=\"#cd2e3a\"/><path d=\"M8,15a7,7 0 0,0 14,0z\" fill=\"#0047a0\"/><g fill=\"#000\"><rect x=\"3\" y=\"4\" width=\"5\" height=\"1.3\" transform=\"rotate(-35 5.5 4.6)\"/><rect x=\"22\" y=\"4\" width=\"5\" height=\"1.3\" transform=\"rotate(35 24.5 4.6)\"/><rect x=\"3\" y=\"25\" width=\"5\" height=\"1.3\" transform=\"rotate(35 5.5 25.6)\"/><rect x=\"22\" y=\"25\" width=\"5\" height=\"1.3\" transform=\"rotate(-35 24.5 25.6)\"/></g></svg>",
    zh: "<svg viewBox=\"0 0 30 30\" preserveAspectRatio=\"xMidYMid slice\" aria-hidden=\"true\"><rect width=\"30\" height=\"30\" fill=\"#de2910\"/><g fill=\"#ffde00\"><polygon points=\"9.00,5.50 10.29,9.22 14.23,9.30 11.09,11.68 12.23,15.45 9.00,13.20 5.77,15.45 6.91,11.68 3.77,9.30 7.71,9.22\"/><polygon points=\"16.80,3.61 16.59,4.74 17.57,5.33 16.43,5.48 16.17,6.59 15.68,5.56 14.54,5.65 15.36,4.86 14.93,3.81 15.93,4.35\"/><polygon points=\"19.28,6.92 19.47,8.05 20.58,8.28 19.57,8.81 19.70,9.94 18.89,9.14 17.85,9.61 18.36,8.59 17.59,7.75 18.72,7.92\"/><polygon points=\"18.72,11.42 19.28,12.42 20.41,12.25 19.64,13.09 20.15,14.11 19.11,13.64 18.30,14.44 18.43,13.31 17.42,12.78 18.53,12.55\"/><polygon points=\"15.20,15.11 16.07,15.85 17.07,15.31 16.64,16.36 17.46,17.15 16.32,17.06 15.83,18.09 15.57,16.98 14.43,16.83 15.41,16.24\"/></g></svg>",
  };

  /* Une rangée de boutons ronds, un par langue, drapeau en fond. Sert au menu
     et au guide du premier lancement. */
  function boutonsLangues(classe) {
    var rang = document.createElement('div');
    rang.className = classe || 'langues';
    languesDisponibles().forEach(function (l) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'drapeau' + (l === langue ? ' actif' : '');
      b.title = nomLangue(l);
      b.dataset.lang = l;
      /* Le drapeau seul : le code par-dessus le masquait, au point de rendre
         ceux de la Corée et de la Chine méconnaissables. Le nom de la langue
         reste en infobulle. */
      b.innerHTML = (DRAPEAUX[l] || '');
      b.setAttribute('aria-label', nomLangue(l));
      b.addEventListener('click', function (ev) {
        ev.stopPropagation();
        changerLangue(l);
        majSelecteur();
      });
      rang.appendChild(b);
    });
    return rang;
  }

  /* Une couleur de thème rendue lisible sur le fond sombre du menu : un bleu
     nuit ou un rouge sombre y disparaissaient. */
  function teinteLisible(t) {
    var m = /^#([0-9a-f]{6})$/i.exec(String(t || ''));
    if (!m) return t || '';
    var n = parseInt(m[1], 16);
    var r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
    var max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
    var h = 0, s = 0, l = (max + min) / 2;
    if (d) {
      s = d / (1 - Math.abs(2 * l - 1));
      h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
      h = (h * 60 + 360) % 360;
    }
    /* On monte la CLARTÉ en gardant teinte et saturation : un rouge reste
       rouge, il ne vire pas au rose comme en le mêlant de blanc. */
    function hsl(l2) {
      var c = (1 - Math.abs(2 * l2 - 1)) * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), o = l2 - c / 2;
      var t3 = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x]
             : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
      return '#' + t3.map(function (v2) {
        return ('0' + Math.round((v2 + o) * 255).toString(16)).slice(-2);
      }).join('');
    }
    var c2 = t;
    while (l < 0.85 && clartePercue(c2) < REGLAGES_THEMES.clarte_noms_menu) { l += 0.03; c2 = hsl(l); }
    return c2;
  }

  /* Une ligne du menu : son intitulé, puis ses choix côte à côte. « decorer »
     habille chaque bouton, pour les tailles, les polices ou les thèmes. */
  function ligneOptions(etiquette, cle, choix, apres, decorer, classe) {
    var ligne = document.createElement('div');
    ligne.className = 'ligne' + (etiquette ? '' : ' pleine');

    if (etiquette) {
      var e = document.createElement('div');
      e.className = 'etiquette';
      e.textContent = etiquette;
      ligne.appendChild(e);
    }

    var rang = document.createElement('div');
    rang.className = classe || 'choix-ligne';

    choix.forEach(function (paire) {
      var b = document.createElement('button');
      b.type = 'button';
      b.dataset.valeur = paire[0];
      b.textContent = paire[1];
      b.classList.toggle('actif', (memoire(cle) || DEFAUTS[cle] || '') === paire[0]);
      if (decorer) decorer(b, paire[0], paire[1]);
      b.addEventListener('click', function (ev) {
        ev.stopPropagation();
        if (paire[0]) retenir(cle, paire[0]);
        else { try { window.localStorage.removeItem(cle); } catch (er) { /* refusé */ } }
        var retenu = paire[0] || DEFAUTS[cle] || '';
        [].forEach.call(rang.querySelectorAll('button'), function (autre) {
          autre.classList.toggle('actif', autre.dataset.valeur === retenu);
        });
        apres();
      });
      rang.appendChild(b);
    });

    ligne.appendChild(rang);
    return ligne;
  }

  function sectionOptions(titre) {
    var s = document.createElement('div');
    s.className = 'section';
    var t = document.createElement('div');
    t.className = 'titre';
    t.textContent = titre;
    s.appendChild(t);
    return s;
  }

  /* Les polices proposées, dans l'ordre du menu. La première, sans clé, est
     celle d'origine : chaque partie de la fiche garde sa police propre.
     « presentation.json » peut remplacer toute la liste.

       famille     la pile CSS, police voulue puis polices de secours. Seules
                   celles déjà chargées par viewer.html, ou présentes sur
                   l'ordinateur du spectateur, s'affichent : rien n'est
                   téléchargé d'ailleurs.
       espacement  l'écart entre les lettres, pour les polices serrées
       majuscules  true pour tout écrire en capitales
       synthese    false pour interdire le faux gras (polices à graisse unique)
       noms        le nom affiché, par langue, pour une police ajoutée */
  var POLICES = [
    { cle: '',          famille: "'Rajdhani', Arial, sans-serif" },
    { cle: 'lisible',   famille: "'Noto Serif', Georgia, serif" },
    { cle: 'ronde',     famille: "'Nunito', 'Segoe UI', sans-serif" },
    { cle: 'fixe',      famille: "'JetBrains Mono', 'Courier New', monospace" },
    { cle: 'comique',   famille: "'Comic Sans MS', 'Comic Neue', cursive" },
    { cle: 'gothique',  famille: "'Grenze Gotisch', 'UnifrakturMaguntia', serif" },
    { cle: 'impact',    famille: "Impact, 'Anton', 'Haettenschweiler', sans-serif",
      espacement: '.03em', synthese: false },
    { cle: 'capitales', famille: "'Bebas Neue', 'Oswald', sans-serif",
      espacement: '.06em', synthese: false, majuscules: true },
  ];

  function policeDe(cle) {
    for (var i = 0; i < POLICES.length; i++) {
      if (POLICES[i].cle === cle) return POLICES[i];
    }
    return null;
  }

  function nomPolice(p) {
    var n = p.noms && (p.noms[langue] || p.noms.en);
    return n || libOpt(p.cle || 'auto') || p.cle;
  }

  /* Chaque police est écrite dans sa propre police, avec ses réglages. */
  function habillerPolice(b, cle) {
    var p = policeDe(cle);
    if (!p) return;
    b.style.fontFamily = p.famille;
    if (p.espacement) b.style.letterSpacing = p.espacement;
    if (p.synthese === false) b.style.fontSynthesis = 'none';
  }

  /* L'ordre du menu : les sections, et les réglages de chacune. Une clé
     absente de la liste publiée disparaît du menu ; une clé inconnue est
     ignorée. */
  var ORDRE_MENU = {
    sections:    ['langue', 'theme', 'description', 'reserve', 'victoires'],
    description: ['stats', 'emplacement', 'taille', 'police'],
    reserve:     ['afficher', 'position', 'couleur'],
    victoires:   ['afficher', 'position', 'taille', 'couleur'],
  };

  function ligneStats() {
    return (ligneOptions(libOpt('stats'), 'bazaar-stats',
      [['current', libOpt('current')], ['global', libOpt('global')]],
      function () { appliquerStats(); }));
  }

  function ligneEmplacement() {
    /* L'emplacement de la description, en schémas : la fiche près du curseur,
       ou dans un coin haut. Le nom reste en infobulle. */
    var FICHES = { curseur: [15.5, 3.5], hg: [1.5, 1.5], hd: [24.5, 1.5] };
    return (ligneOptions(libOpt('emplacement'), 'bazaar-mode-fiche',
      [['curseur', libOpt('curseur')], ['hg', libOpt('hg')], ['hd', libOpt('hd')]],
      function () { appliquerMode(); },
      function (b, m, nom) {
        var f = FICHES[m];
        b.textContent = '';
        b.title = nom;
        b.setAttribute('aria-label', nom);
        b.classList.add('schema');
        b.innerHTML = '<svg viewBox="0 0 32 18" aria-hidden="true">'
          + '<rect x=".5" y=".5" width="31" height="17" rx="1.5" class="ecran"/>'
          + '<rect x="' + f[0] + '" y="' + f[1] + '" width="6" height="8.5" rx=".6" class="zone"/>'
          /* Une flèche de souris classique, la pointe juste à gauche de la
             fiche, comme quand on survole une carte. */
          + (m === 'curseur'
              ? '<path transform="translate(11.2 6.4) scale(.62)" class="zone curseur" '
                + 'd="M0 0 L0 12.6 L3.1 9.7 L5.3 14.6 L7.5 13.6 L5.3 8.8 L9.4 8.8 Z"/>'
              : '')
          + '</svg>';
      }));
  }

  function ligneTaille() {
    /* Les tailles, en « aA » de cinq grandeurs ; le nom reste en infobulle. */
    var TAILLES_AA = { xs: '.62em', s: '.78em', m: '.94em', l: '1.1em', x: '1.26em' };
    return (ligneOptions(libOpt('taille'), 'bazaar-taille-fiche',
      [['xs', libOpt('xs')], ['s', libOpt('s')], ['m', libOpt('m')], ['l', libOpt('l')], ['x', libOpt('x')]],
      function () { appliquerTaille(); },
      function (b, v, nom) {
        b.textContent = '';
        b.title = nom;
        b.classList.add('aa');
        var aa = document.createElement('span');
        aa.textContent = 'aA';
        aa.style.fontSize = TAILLES_AA[v];
        b.appendChild(aa);
      }));
  }

  function lignePolice() {
    return ligneOptions(libOpt('police'), 'bazaar-police-fiche',
      POLICES.map(function (p) { return [p.cle, nomPolice(p)]; }),
      function () { appliquerPolice(); },
      function (b, v) { habillerPolice(b, v); });
  }

  function ligneAfficherReserve() {
    return (ligneOptions(libOpt('afficher'), 'bazaar-reserve',
      [['oui', libOpt('on')], ['non', libOpt('off')]],
      function () { majTiroirReserve(); }));
  }

  /* La couleur du tiroir. « Thème » suit le thème choisi (le héros joué sous
     « par héros ») ; « Neutre » garde le brun des objets partagés, qui ne
     jure avec aucun plateau. */
  function ligneCouleurReserve() {
    return (ligneOptions(libOpt('couleurReserve'), 'bazaar-reserve-couleur',
      [['theme', libOpt('couleurTheme')], ['neutre', libOpt('couleurNeutre')]],
      function () { empreinteReserve = null; majTiroirReserve(); }));
  }

  /* Le compteur de victoires : afficher, taille, couleur. */
  function ligneAfficherVictoires() {
    return ligneOptions(libOpt('afficher'), 'bazaar-victoires',
      [['oui', libOpt('on')], ['non', libOpt('off')]],
      function () { majBarreVictoires(true); });
  }
  function lignePositionVictoires() {
    return ligneOptions(libOpt('position'), 'bazaar-victoires-position',
      [['haut', libOpt('bv_haut')], ['bas', libOpt('bv_bas')]],
      function () { majBarreVictoires(true); });
  }
  function ligneTailleVictoires() {
    return ligneOptions(libOpt('taille'), 'bazaar-victoires-taille',
      [['s', libOpt('bv_s')], ['m', libOpt('bv_m')], ['l', libOpt('bv_l')]],
      function () { majBarreVictoires(true); });
  }
  function ligneCouleurVictoires() {
    return ligneOptions(libOpt('couleurReserve'), 'bazaar-victoires-couleur',
      [['theme', libOpt('couleurTheme')], ['neutre', libOpt('couleurNeutre')]],
      function () { majBarreVictoires(true); });
  }

  function lignePositionReserve() {
    /* La position, en quatre schémas : un petit écran, le plateau, et la case
       réserve à sa place, grande en bas, petite au milieu. Le nom reste en
       infobulle. */
    var ZONES = { bg: [1.5, 13.6, 9, 3], mg: [1.5, 8, 5.6, 2.4], md: [24.9, 8, 5.6, 2.4], bd: [21.5, 13.6, 9, 3] };
    return (ligneOptions(libOpt('position'), 'bazaar-reserve-pos',
      POSITIONS_RESERVE.map(function (p) { return [p, libOpt('pos_' + p)]; }),
      function () { appliquerPositionReserve(); },
      function (b, p, nom) {
        var z = ZONES[p];
        b.textContent = '';
        b.title = nom;
        b.setAttribute('aria-label', nom);
        b.classList.add('schema');
        b.innerHTML = '<svg viewBox="0 0 32 18" aria-hidden="true">'
          + '<rect x=".5" y=".5" width="31" height="17" rx="1.5" class="ecran"/>'
          + '<rect x="9" y="10" width="14" height="4.2" rx=".6" class="plateau"/>'
          + '<rect x="' + z[0] + '" y="' + z[1] + '" width="' + z[2] + '" height="' + z[3] + '" rx=".6" class="zone"/>'
          + '</svg>';
      }));
  }

  function ligneThemes() {
    /* Les thèmes, avec le portrait du héros et le nom dans sa couleur, sur
       deux colonnes remplies de haut en bas. */
    var lt = ligneOptions(null, 'bazaar-theme-fiche',
      THEMES.map(function (cle) {
        return [cle, cle === 'heros' ? libTheme('heros') : nomDeTheme(cle)];
      }),
      function () { appliquerTheme(); },
      function (b, cle, nom) {
        b.textContent = '';
        var hero = HERO_DU_THEME[cle];
        var vignette;
        if (cle === 'heros') {
          /* Le logo de l'extension, livré avec elle : ce thème est le sien.
             À défaut, la pastille aux couleurs des héros. */
          vignette = document.createElement('img');
          vignette.className = 'portrait logo';
          vignette.alt = '';
          vignette.decoding = 'async';
          vignette.src = 'logo.png';
          vignette.onerror = function () {
            var pastille = document.createElement('span');
            pastille.className = 'portrait defaut';
            if (vignette.parentNode) vignette.parentNode.replaceChild(pastille, vignette);
          };
        } else if (cle === THEME_NEUTRE) {
          /* Le logo « Commun », celui des objets partagés, avec la pastille
             brune en repli s'il manque. */
          vignette = document.createElement('img');
          vignette.className = 'portrait';
          vignette.alt = '';
          vignette.decoding = 'async';
          vignette.src = (window.HERO_PORTRAITS || {}).Common
            || (CFG.DATA_BASE_URL + '/characters/Common_Portrait.png');
          vignette.onerror = function () {
            var pastille = document.createElement('span');
            pastille.className = 'portrait';
            pastille.style.background = BRUN_CUIR;
            if (vignette.parentNode) vignette.parentNode.replaceChild(pastille, vignette);
          };
        } else {
          vignette = document.createElement('img');
          vignette.className = 'portrait';
          vignette.alt = '';
          vignette.decoding = 'async';
          vignette.src = (window.HERO_PORTRAITS || {})[hero]
            || (CFG.DATA_BASE_URL + '/characters/' + hero + '_Portrait.png');
          vignette.onerror = function () {
            var pastille = document.createElement('span');
            pastille.className = 'portrait';
            pastille.style.background = TEINTE_THEME[cle] || '#555';
            if (vignette.parentNode) vignette.parentNode.replaceChild(pastille, vignette);
          };
        }
        /* Le portrait seul, le nom au survol : les thèmes tiennent sur une
           ligne, à côté de leur titre, comme les langues. */
        b.title = nom;
        b.setAttribute('aria-label', nom);
        b.appendChild(vignette);
      },
      'themes');
    var grille = lt.querySelector('.themes');
    grille.style.setProperty('--rangs', String(Math.ceil(THEMES.length / 2)));
    return lt;
  }

  function construireOptions() {
    if (elOptions) { elOptions.remove(); elOptions = null; }

    elOptions = document.createElement('div');
    elOptions.id = 'viewer-options';

    var bouton = document.createElement('button');
    bouton.type = 'button';
    bouton.className = 'roue';
    bouton.innerHTML = ROUE;
    bouton.title = trad(TITRE_OPTIONS, 'titreOptions');
    bouton.addEventListener('click', function (ev) {
      ev.stopPropagation();
      // Les deux panneaux se recouvriraient : ouvrir l'un ferme l'autre.
      if (elRecherche) elRecherche.classList.remove('deplie');
      elOptions.classList.toggle('deplie');
    });
    elOptions.appendChild(bouton);

    /* Un menu en sections, une ligne par réglage, lu de haut en bas : la
       langue, la description, la réserve, le thème. */
    var panneau = document.createElement('div');
    panneau.className = 'sections';

    var LIGNES = {
      description: { stats: ligneStats, emplacement: ligneEmplacement,
                     taille: ligneTaille, police: lignePolice },
      reserve:     { afficher: ligneAfficherReserve, position: lignePositionReserve,
                     couleur: ligneCouleurReserve },
      victoires:   { afficher: ligneAfficherVictoires, position: lignePositionVictoires,
                     taille: ligneTailleVictoires, couleur: ligneCouleurVictoires },
    };
    var TITRES = { langue: libOpt('langue'), description: libOpt('place'),
                   reserve: libOpt('reserve'), victoires: libOpt('victoires'),
                   theme: libTheme('titre') };

    /* Une section nouvelle que l'ordre publié ne cite pas encore paraît après
       la réserve, plutôt que de rester invisible. */
    var sections = (ORDRE_MENU.sections || []).slice();
    /* Le thème, réduit à une ligne de portraits, vient juste sous la langue,
       quel que soit l'ordre publié. */
    var iTheme = sections.indexOf('theme');
    var iLangue = sections.indexOf('langue');
    if (iTheme >= 0 && iLangue >= 0) {
      sections.splice(iTheme, 1);
      sections.splice(sections.indexOf('langue') + 1, 0, 'theme');
    }
    if (sections.indexOf('victoires') < 0) {
      var apres = sections.indexOf('reserve');
      sections.splice(apres >= 0 ? apres + 1 : sections.length, 0, 'victoires');
    }
    if (!ORDRE_MENU.victoires) ORDRE_MENU.victoires = ['afficher', 'position', 'taille', 'couleur'];

    sections.forEach(function (nom) {
      if (!TITRES[nom]) return;
      var sec = sectionOptions(TITRES[nom]);
      /* La langue tient sur une ligne : le titre, puis les drapeaux. */
      if (nom === 'langue') { sec.classList.add('en-ligne'); sec.appendChild(boutonsLangues('langues')); }
      else if (nom === 'theme') { sec.classList.add('en-ligne'); sec.appendChild(ligneThemes()); }
      else {
        var ordre = (ORDRE_MENU[nom] || []).slice();
        /* Une ligne nouvelle que l'ordre publié ne cite pas encore paraît à
           la fin de sa section, plutôt que de rester invisible. */
        if (nom === 'reserve' && ordre.indexOf('couleur') < 0) ordre.push('couleur');
        /* La position du compteur, ajoutée après coup : au-dessus de la taille. */
        if (nom === 'victoires' && ordre.indexOf('position') < 0) {
          var iTaille = ordre.indexOf('taille');
          ordre.splice(iTaille >= 0 ? iTaille : ordre.length, 0, 'position');
        }
        ordre.forEach(function (cle) {
          if (LIGNES[nom][cle]) sec.appendChild(LIGNES[nom][cle]());
        });
        if (sec.children.length < 2) return;   // section vidée par les données
      }
      panneau.appendChild(sec);
    });

    /* Sous les colonnes, sur toute la largeur : revoir l'aide et la signature.
       Placé dans une colonne, le bouton d'aide en occupait une entière pour
       lui seul, à côté de listes bien plus hautes. */
    var pied = document.createElement('div');
    pied.className = 'pied';

    var bTuto = document.createElement('button');
    bTuto.type = 'button';
    bTuto.className = 'revoir';
    bTuto.textContent = libOpt('tuto');
    bTuto.addEventListener('click', function (ev) {
      ev.stopPropagation();
      elOptions.classList.remove('deplie');
      cacherTuto();
      montrerTuto();
    });
    pied.appendChild(bTuto);

    var signature = document.createElement('span');
    signature.className = 'signature';
    signature.appendChild(document.createTextNode(libOpt('creePar') + ' '));

    var lien = document.createElement('a');
    lien.href = 'https://www.twitch.tv/kwev';
    lien.target = '_blank';
    lien.rel = 'noopener';
    lien.textContent = 'Kwev';
    lien.addEventListener('click', function (ev) { ev.stopPropagation(); });
    signature.appendChild(lien);
    pied.appendChild(signature);

    var enveloppe = document.createElement('div');
    enveloppe.className = 'menu';
    enveloppe.appendChild(panneau);
    enveloppe.appendChild(pied);

    elOptions.appendChild(enveloppe);
    elRoot.appendChild(elOptions);
    return elOptions;
  }

  /* Le choix qui s'applique quand rien n'est mémorisé. Sans cela, aucun
     bouton n'était encadré à la première ouverture du menu, alors qu'un
     emplacement et une taille étaient bien en vigueur. */
  var DEFAUTS = {
    'bazaar-theme-fiche':   'heros',
    'bazaar-mode-fiche':    'curseur',
    'bazaar-taille-fiche':  'm',
    'bazaar-reserve': 'oui',
    'bazaar-stats': 'current',
    'bazaar-reserve-couleur': 'theme',
    'bazaar-reserve-pos': 'bg',
    'bazaar-victoires': 'oui',
    'bazaar-victoires-taille': 'm',
    'bazaar-victoires-position': 'haut',
    'bazaar-victoires-couleur': 'theme',
    'bazaar-police-fiche': '',
  };

  /* --- La présentation publiée ------------------------------------------
     « presentation.json », publié avec les données, règle ce qui tenait
     jusqu'ici au code : on l'ajuste sans téléverser l'extension. Chaque
     bloc est facultatif, et une valeur invalide est ignorée plutôt que de
     casser l'affichage. */
  var CLES_DEFAUTS = {
    emplacement: 'bazaar-mode-fiche', taille: 'bazaar-taille-fiche',
    police: 'bazaar-police-fiche', stats: 'bazaar-stats',
    reserve: 'bazaar-reserve', position_reserve: 'bazaar-reserve-pos',
    theme: 'bazaar-theme-fiche',
  };

  function nombre(v, min, max) {
    return (typeof v === 'number' && isFinite(v) && v >= min && v <= max) ? v : null;
  }

  function integrerPresentation(p) {
    if (!p || typeof p !== 'object') return;

    /* Les couleurs des étiquettes en haut des fiches : tailles, talent et
       types. Des codes hexadécimaux seulement ; tout le reste est ignoré. */
    if (p.etiquettes && typeof p.etiquettes === 'object') {
      var hex = function (v) { return typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v : null; };
      var table = function (o) {
        var t = {};
        if (o && typeof o === 'object') Object.keys(o).forEach(function (k) {
          if (/^\w+$/.test(k) && hex(o[k])) t[k] = o[k];
        });
        return t;
      };
      window.BAZAAR_ETIQUETTES = {
        tailles: table(p.etiquettes.tailles),
        types: table(p.etiquettes.types),
        talent: hex(p.etiquettes.talent),
      };
    }

    /* Les choix par défaut, pour qui n'a encore rien choisi. */
    if (p.defauts && typeof p.defauts === 'object') {
      Object.keys(CLES_DEFAUTS).forEach(function (k) {
        if (typeof p.defauts[k] === 'string') DEFAUTS[CLES_DEFAUTS[k]] = p.defauts[k];
      });
    }

    /* La liste des polices, entière. On garde la police d'origine en tête
       si la liste publiée l'a oubliée : sans elle, impossible de revenir
       à l'affichage normal. */
    if (Array.isArray(p.polices)) {
      var polices = p.polices.filter(function (x) {
        return x && typeof x.cle === 'string' && typeof x.famille === 'string'
          && /^[\w\s',.\-"]+$/.test(x.famille);
      }).map(function (x) {
        return {
          cle: x.cle, famille: x.famille, noms: x.noms,
          espacement: /^-?\d*\.?\d+(em|px)$/.test(String(x.espacement || '')) ? x.espacement : null,
          majuscules: x.majuscules === true, synthese: x.synthese !== false,
        };
      });
      if (polices.length) {
        if (!polices.some(function (x) { return x.cle === ''; })) polices.unshift(POLICES[0]);
        POLICES = polices;
      }
    }

    /* Les réglages fins des thèmes. */
    var t = p.themes;
    if (t && typeof t === 'object') {
      var e = nombre(t.ecart_degrade, 0, 60);
      if (e !== null) ECART_DEGRADE = e;
      if (t.ecart_par_heros && typeof t.ecart_par_heros === 'object') {
        Object.keys(t.ecart_par_heros).forEach(function (h) {
          var v = nombre(t.ecart_par_heros[h], 0, 60);
          if (v !== null) ECART_PAR_HEROS[h] = v;
        });
      }
      var j = t.jaunes_vers_or;
      if (j === false) { REGLAGES_THEMES.jaune_de = 1; REGLAGES_THEMES.jaune_a = 0; }
      else if (j && typeof j === 'object') {
        var de = nombre(j.teinte_de, 0, 360), a = nombre(j.teinte_a, 0, 360);
        var or = nombre(j.teinte_or, 0, 60), sm = nombre(j.saturation_min, 0, 1);
        if (de !== null) REGLAGES_THEMES.jaune_de = de;
        if (a !== null) REGLAGES_THEMES.jaune_a = a;
        if (or !== null) REGLAGES_THEMES.teinte_or = or;
        if (sm !== null) REGLAGES_THEMES.saturation_min = sm;
      }
      var c = nombre(t.clarte_noms_menu, 0, 100);
      if (c !== null) REGLAGES_THEMES.clarte_noms_menu = c;
    }

    /* Le guide du premier lancement. */
    if (p.guide && typeof p.guide === 'object') {
      var d = nombre(p.guide.duree_secondes, 3, 120);
      if (d !== null) TUTO_MS = d * 1000;
    }

    /* L'ordre du menu. */
    if (p.menu && typeof p.menu === 'object') {
      ['sections', 'description', 'reserve'].forEach(function (k) {
        if (Array.isArray(p.menu[k])) {
          ORDRE_MENU[k] = p.menu[k].filter(function (x) { return typeof x === 'string'; });
        }
      });
    }
  }



  /* Une nouvelle position : la case reprend la taille qui va avec, si elle
     est ouverte, et se replace. */
  function appliquerPositionReserve() {
    if (etatTiroir !== 'fermee') appliquerEtatTiroir(tailleSelonPosition());
    empreinteReserve = null;
    majTiroirReserve();
  }

  /* « Global » montre tous les paliers d'un objet ; « Current » seulement
     celui de sa rareté actuelle. La fiche affichée est refaite aussitôt. */
  function appliquerStats() {
    window.BAZAAR_STATS = memoire('bazaar-stats') || DEFAUTS['bazaar-stats'];
    if (hovered) {
      var h = hovered;
      hovered = null;
      paint(h.id, h.talent);
    }
  }

  /* Une case à cocher, dans le style des boutons du menu : « oui » quand elle
     est cochée, « non » sinon. */
  function caseACocher(libelle, cle, apres) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'bascule';

    var marque = document.createElement('span');
    marque.className = 'coche';

    var texte = document.createElement('span');
    texte.textContent = libelle;

    b.appendChild(texte);
    b.appendChild(marque);

    function peindre() {
      var coche = (memoire(cle) || DEFAUTS[cle]) !== 'non';
      b.classList.toggle('actif', coche);
      b.setAttribute('aria-pressed', coche ? 'true' : 'false');
    }

    b.addEventListener('click', function (ev) {
      ev.stopPropagation();
      var coche = (memoire(cle) || DEFAUTS[cle]) !== 'non';
      retenir(cle, coche ? 'non' : 'oui');
      peindre();
      if (apres) apres();
    });

    peindre();
    return b;
  }

  function groupeOptions(titre, cle, choix, apres) {
    var g = document.createElement('div');
    g.className = 'groupe';

    /* Un titre nul : le groupe sert de sous-bloc, sans en-tête à lui. */
    if (titre) {
      var t = document.createElement('div');
      t.className = 'titre';
      t.textContent = titre;
      g.appendChild(t);
    }

    choix.forEach(function (paire) {
      var b = document.createElement('button');
      b.type = 'button';
      b.textContent = paire[1];
      b.dataset.valeur = paire[0];
      b.classList.toggle('actif',
        (memoire(cle) || DEFAUTS[cle] || '') === paire[0]);
      b.addEventListener('click', function (ev) {
        ev.stopPropagation();
        if (paire[0]) retenir(cle, paire[0]);
        else { try { window.localStorage.removeItem(cle); } catch (e) { /* refusé */ } }

        /* Après un retour au défaut, c'est lui qu'il faut marquer. */
        var retenu = paire[0] || DEFAUTS[cle] || '';
        [].forEach.call(g.querySelectorAll('button'), function (autre) {
          autre.classList.toggle('actif', autre.dataset.valeur === retenu);
        });
        apres();
      });
      g.appendChild(b);
    });
    return g;
  }

  function construireSelecteur() {
    if (elLangues) return elLangues;

    elLangues = document.createElement('div');
    elLangues.id = 'lang-switch';

    var bouton = document.createElement('button');
    bouton.type = 'button';
    bouton.className = 'globe';
    bouton.innerHTML = PLANETE;
    bouton.title = trad(TITRE_GLOBE, 'titreGlobe') + ' / Language';
    bouton.addEventListener('click', function (ev) {
      ev.stopPropagation();
      if (elRecherche) elRecherche.classList.remove('deplie');
      elLangues.classList.toggle('deplie');
    });
    elLangues.appendChild(bouton);

    languesDisponibles().forEach(function (l) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'choix';
      b.textContent = l.toUpperCase();
      b.dataset.lang = l;
      b.title = nomLangue(l);
      b.addEventListener('click', function (ev) {
        ev.stopPropagation();
        changerLangue(l);
        majSelecteur();
        elLangues.classList.remove('deplie');
      });
      elLangues.appendChild(b);
    });

    elRoot.appendChild(elLangues);
    return elLangues;
  }

  function reconstruireSelecteur() {
    if (!elLangues) return;
    var etaitVisible = elLangues.classList.contains('visible');
    elLangues.remove();
    elLangues = null;
    construireSelecteur();
    if (etaitVisible) elLangues.classList.add('visible');
    majSelecteur();
  }

  function majSelecteur() {
    if (!elLangues) return;
    [].forEach.call(elLangues.querySelectorAll('.choix'), function (b) {
      b.classList.toggle('actif', b.dataset.lang === langue);
    });
  }

  /* Le lecteur Twitch prend deux clics rapprochés pour un double-clic et
     bascule en plein écran. Épingler puis libérer une fiche, ouvrir un menu,
     choisir une option : rien de ce qu'on fait dans NOTRE interface ne doit
     le déclencher. On arrête donc ces événements dès qu'ils partent de l'un
     de nos éléments ; un double-clic sur la vidéo elle-même, hors de toute
     zone, garde son effet habituel. Le champ de recherche garde son
     comportement normal, pour qu'on puisse y placer le curseur. */
  ['mousedown', 'dblclick'].forEach(function (nom) {
    elRoot.addEventListener(nom, function (ev) {
      var cible = ev.target;
      if (!cible || cible === elRoot || cible === document.body) return;
      ev.stopPropagation();
      if (!/^(INPUT|TEXTAREA|SELECT)$/.test(cible.tagName)) ev.preventDefault();
    });
  });

  document.addEventListener('click', function (ev) {
    /* Un clic À L'INTÉRIEUR d'un menu, même dans un espace vide entre deux
       boutons, ne ferme rien : il remontait jusqu'ici et passait pour un clic
       à l'extérieur. Seul un clic vraiment hors des menus les referme. */
    var cible = ev && ev.target;
    if (cible && cible.closest
        && cible.closest('#viewer-options, #viewer-recherche, #alerte-version, #tuto, .ench-epingle')) return;

    /* Un clic hors de la fiche épinglée la libère. Ceux qui portent sur
       elle-même ou sur ses boutons d'enchantement n'arrivent pas jusqu'ici :
       elle les retient. */
    detacher();

    if (elRecherche) elRecherche.classList.remove('deplie');
    if (elOptions) {
      elOptions.classList.remove('deplie');
      montrerOptions(elOptions.classList.contains('visible'));
    }
    if (elLangues) elLangues.classList.remove('deplie');
  });

  /* L'interface n'a de sens que si l'application du streamer émet.

     Les boutons suivaient les contrôles du lecteur : ils s'affichaient donc
     même sur une chaîne qui ne joue plus au Bazaar, et le rappel promettait
     des fiches qui ne viendraient jamais. */
  var controlesVisibles = false;
  var derniereReception = 0;
  var SILENCE_MS = 30000;

  function fluxActif() {
    return derniereReception > 0
        && (Date.now() - derniereReception) < SILENCE_MS;
  }

  function majInterface() {
    var montrer = controlesVisibles && fluxActif();
    montrerSelecteur(montrer);
    montrerOptions(montrer);
    montrerRecherche(montrer);

    if (!fluxActif()) {
      // Le rappel n'a plus rien à annoncer : on le retire sans le marquer vu.
      cacherTuto();
      if (elRecherche) elRecherche.classList.remove('deplie');
      if (elOptions) elOptions.classList.remove('deplie');
      if (elLangues) elLangues.classList.remove('deplie');
    }
  }

  // Un silence prolongé fait disparaître l'interface d'elle-même.
  setInterval(majInterface, 5000);

  /* Le plateau aussi. L'application envoie un plateau vide quand le jeu se
     ferme ; mais une application arrêtée net, ou plus ancienne, se tait
     simplement, et le dernier plateau restait affiché indéfiniment.

     Sauf avec un délai de tournoi : les envois y sont espacés par nature, et
     c'est le plateau vide de l'application qui fait foi. */
  var dernierDelai = 0;
  setInterval(function () {
    if (!derniereReception || dernierDelai) return;
    if (Date.now() - derniereReception < SILENCE_MS) return;
    if (!board.length && !skills.length && !reserve.length && !enFace.length && !faceTalents.length) return;
    board = []; skills = []; reserve = []; enFace = []; faceTalents = [];
    dernierSigneDePartie = 0;
    buildHotspots();
    majBarreVictoires();
    majTiroirReserve();
    if (!epinglee) hide();
  }, 5000);

  function montrerRecherche(visible) {
    var el = elRecherche || construireRecherche();
    if (el.classList.contains('deplie')) return;
    el.classList.toggle('visible', !!visible);
  }

  function montrerOptions(visible) {
    var el = elOptions || construireOptions();
    if (el.classList.contains('deplie')) return;
    el.classList.toggle('visible', !!visible);
  }

  function montrerSelecteur(visible) {
    if (elLangues && elLangues.classList.contains('deplie')) return;
    if (!elLangues) return;
    elLangues.classList.toggle('visible', !!visible);
    if (!visible) elLangues.classList.remove('deplie');
  }

  var INCONNU = {
    fr: 'Inconnu',   en: 'Unknown',      de: 'Unbekannt',
    es: 'Desconocido', it: 'Sconosciuto', pt: 'Desconhecido',
    ko: '알 수 없음',  zh: '未知',
  };

  var INDISPONIBLE = {
    fr: 'Description indisponible',
    en: 'No description available',
    de: 'Keine Beschreibung verfügbar',
    es: 'Descripción no disponible',
    it: 'Descrizione non disponibile',
    pt: 'Descrição indisponível',
    ko: '설명을 사용할 수 없습니다',
    zh: '暂无描述',
  };

  var AUTRE_JOUEUR = {
    fr: 'Combat contre un autre joueur',
    en: 'Fight another Player',
    de: 'Kampf gegen einen anderen Spieler',
    es: 'Combate contra otro jugador',
    it: 'Scontro con un altro giocatore',
    pt: 'Combate contra outro jogador',
    ko: '다른 플레이어와의 대전',
    zh: '与其他玩家对战',
  };

  /* Libellés de l'INTERFACE - menu, rappel, recherche - publiés avec les
     données : une langue ajoutée après coup peut ainsi traduire l'extension
     sans qu'il faille la soumettre à Twitch.

     À ne pas confondre avec « libellesPublies », qui porte les glossaires du
     JEU - mots-clés, tags, tailles - et alimente la coloration des fiches.
     Les avoir nommés pareil faisait qu'un écrasait l'autre, et plus aucun
     mot-clé n'était coloré, dans aucune langue. */
  var interfacePubliee = null;

  /* Un libellé, cherché d'abord dans ce qui est publié, puis dans la langue
     du code, puis en anglais.

     La recherche se fait CLÉ PAR CLÉ : une traduction partielle complète les
     libellés existants au lieu de les remplacer, ce qui laisserait des trous
     dans une langue à peine commencée. */
  function libelle(table, nom, cle) {
    var publie = interfacePubliee && interfacePubliee[langue]
      && interfacePubliee[langue][nom];
    if (publie && publie[cle]) return publie[cle];

    var locale = table[langue];
    if (locale && locale[cle]) return locale[cle];
    return table.en[cle];
  }

  function trad(table, nom) {
    var publie = nom && interfacePubliee
      && interfacePubliee[langue] && interfacePubliee[langue][nom];
    var code = table[langue] || table.en;
    if (!publie) return code;

    /* Un guide publié en partie - le seul titre, par exemple - garde le reste
       du code, comme le font les libellés du menu. */
    if (typeof publie === 'object' && !Array.isArray(publie)
        && code && typeof code === 'object' && !Array.isArray(code)) {
      return Object.assign({}, table.en, code, publie);
    }
    return publie;
  }

  /* La fiche d'une mécanique : son nom en titre, sa règle colorée comme une
     description. */
  /* ── Le compteur de victoires ──────────────────────────────────────────
     En haut au centre, contre le bord : une gemme par jour joué, bleue pour
     une victoire, rouge pour une défaite, rouge sombre pour le refus de la
     mort, puis une gemme vide pour le jour en cours. La ligne se construit au
     fil de la partie et disparaît à sa fin. Elle ne capte pas la souris et
     passe sous les fiches, l'index, le menu et le guide. */
  var elBarreVictoires = null;
  var empreinteBarre = null;

  function teinteBarreVictoires() {
    if ((memoire('bazaar-victoires-couleur') || DEFAUTS['bazaar-victoires-couleur']) === 'neutre') {
      return NEUTRE_RESERVE.cadre;
    }
    var theme = elRoot.getAttribute('data-theme') || 'heros';
    if (theme === 'heros') return TEINTE_HEROS[heroJoue] || NEUTRE_RESERVE.cadre;
    if (theme === THEME_NEUTRE) return BRUN_CUIR;
    return TEINTE_THEME[theme] || NEUTRE_RESERVE.cadre;
  }

  /* Le motif de chaque cristal : une des huit variantes de sa texture,
     tirée au hasard, jamais la même que celle de la veille. Tiré une fois par
     jour et gardé : la barre se redessine souvent, et le motif ne doit pas
     changer sous les yeux. Une nouvelle partie, qui recommence au jour 1,
     retire tout. */
  var motifsGemmes = [];
  var dernierJourMotifs = 0;
  var NB_MOTIFS = 8;

  function motifGemme(d) {
    if (jourPartie < dernierJourMotifs) motifsGemmes = [];
    dernierJourMotifs = jourPartie;
    if (motifsGemmes[d] === undefined) {
      var n;
      do { n = Math.floor(Math.random() * NB_MOTIFS); } while (n === motifsGemmes[d - 1]);
      motifsGemmes[d] = n;
    }
    return motifsGemmes[d];
  }

  /* La teinte des deux menus, options et index : celle du thème, comme le
     compteur de victoires. Le texte des titres en est une version lisible. */
  var teinteMenusPosee = null;
  function majTeinteMenus() {
    if (!elRoot) return;
    var teinte;
    /* Appelée dès le premier thème posé, avant que tout soit prêt : sans
       teinte calculable, on garde le doré par défaut de la feuille. */
    try { teinte = teinteBarreVictoires(); } catch (e) { return; }
    if (!teinte) return;
    if (teinte === teinteMenusPosee) return;
    teinteMenusPosee = teinte;
    elRoot.style.setProperty('--teinte-menu', teinte);
    elRoot.style.setProperty('--texte-menu', teinteLisible(teinte));
  }

  function majBarreVictoires(force) {
    var voulu = (memoire('bazaar-victoires') || DEFAUTS['bazaar-victoires']) !== 'non';
    /* Quand on quitte une partie, le jeu garde son compte des jours : il
       ne suffit pas. La barre suit ce qui est à l'écran (voir
       partieEnCours). */
    majTeinteMenus();
    var montrer = voulu && jourPartie && partieEnCours();
    if (!montrer) {
      if (elBarreVictoires) elBarreVictoires.classList.add('hidden');
      empreinteBarre = null;
      return;
    }
    if (!elBarreVictoires) {
      elBarreVictoires = document.createElement('div');
      elBarreVictoires.id = 'barre-victoires';
      elBarreVictoires.setAttribute('aria-hidden', 'true');
      elRoot.appendChild(elBarreVictoires);
    }
    var taille = memoire('bazaar-victoires-taille') || DEFAUTS['bazaar-victoires-taille'];
    var teinte = teinteBarreVictoires();
    var enBas = (memoire('bazaar-victoires-position') || DEFAUTS['bazaar-victoires-position']) === 'bas';
    var empreinte = [jourPartie, histoirePartie, taille, teinte, enBas, window.innerHeight].join('|');
    elBarreVictoires.classList.remove('hidden');
    elBarreVictoires.classList.toggle('bas', enBas);
    if (empreinte === empreinteBarre && !force) return;
    empreinteBarre = empreinte;

    /* La taille suit la hauteur du lecteur, réglée à 720 pixels. */
    var facteur = { s: 0.8, m: 1, l: 1.3 }[taille] || 1;
    var echelle = Math.max(0.6, Math.min(2.2, window.innerHeight / 720));
    elBarreVictoires.style.fontSize = (10 * echelle * facteur).toFixed(2) + 'px';
    elBarreVictoires.style.setProperty('--teinte-barre', teinte);
    elBarreVictoires.style.setProperty('--fond-barre', melange(teinte, 0, 0.86));
    elBarreVictoires.style.setProperty('--bord-barre', melange(teinte, 0, 0.4));
    elBarreVictoires.style.setProperty('--texte-barre', teinteLisible(teinte));

    var html = '';
    for (var d = 1; d <= jourPartie; d++) {
      var r = histoirePartie.charAt(d - 1);
      html += '<div class="jour"><div class="gemme ' + (r || 'vide') + ' m' + motifGemme(d) + '"></div>'
            + '<div class="num">' + d + '</div></div>';
    }
    elBarreVictoires.innerHTML = html;
  }

  window.addEventListener('resize', function () { majBarreVictoires(); majEchelleMenu(); });

  /* L'échelle du menu des options : pleine à partir de 850 pixels de haut,
     réduite en dessous, jamais sous 70 %. À 55 %, le texte tombait à 7 pixels
     sur un petit lecteur ; le menu défile désormais un peu, plutôt. */
  function majEchelleMenu() {
    var e = Math.max(0.7, Math.min(1, window.innerHeight / 850));
    if (elRoot) elRoot.style.setProperty('--echelle-menu', e.toFixed(3));
  }
  majEchelleMenu();

  function echapper(t) {
    return String(t == null ? '' : t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function ficheMecanique(m, nom) {
    ficheSimple(m.titre, '');
    // Pas de trait entre le nom et la règle.
    var entete = document.querySelector('#card .header');
    if (entete) entete.classList.add('sans-filet');
    var t = document.querySelector('#item-body .tooltip-text');

    /* En tournoi, le jeu n'a pas de texte pour les victoires, et celui des
       autres modes (« Remportez 10 victoires… ») pourrait être faux : la fiche
       ne garde que le compte. */
    if (t && nom === 'victoires' && modeTournoi) {
      var ligne = t.closest('.effect-row');
      if (ligne) ligne.remove();
      t = null;
    }
    if (t) {
      var sur = echapper(m.texte);
      /* Victoires et prestige : une phrase par ligne. Le rendu change les
         retours à la ligne en sauts. */
      if (nom === 'victoires' || nom === 'prestige') {
        sur = sur.replace(/([.!?。！？])\s+(?=\S)/g, '$1\n');
      }
      t.innerHTML = (typeof window.colorize === 'function') ? window.colorize(sur) : sur;
    }

    /* Le titre porte la valeur, comme à l'écran du jeu : « Victoires : 3 »,
       « Prestige : 15/20 ». Le modèle vient du jeu, traduit ; sans valeur
       reçue, le titre reste le nom seul. */
    var valeur = nom === 'prestige' ? compteurs.pr
               : (nom === 'victoires' ? compteurs.vi : null);
    var titre = document.getElementById('item-name');
    if (titre && m.etiquette && valeur !== null) {
      var parLangue = mecaniquesPubliees && (mecaniquesPubliees[langue] || mecaniquesPubliees.en) || {};
      var max = compteurs.px !== null ? compteurs.px : parLangue.prestigeMax;
      titre.innerHTML = echapper(m.etiquette)
        .replace('{1}', '<span class="meca-valeur">' + valeur + '</span>')
        .replace('{0}', max != null ? String(max) : '?');
    }
  }

  /* ── L'indice du clic ──────────────────────────────────────────────────
     Tout en haut à droite de la fiche, au-dessus des portraits, sans rien
     déplacer : une souris, puis ce que le clic montre. Une double flèche
     pour les rangs (en mode Actuel, qui n'en montre qu'un), une étoile pour
     les enchantements. Aucun texte, donc rien à traduire. Seulement quand le
     clic apporte quelque chose. */
  var SVG_SOURIS = '<svg viewBox="0 0 12 16" aria-hidden="true"><rect x="1" y="1" width="10" height="14" rx="5" fill="none" stroke="currentColor" stroke-width="1.2"/><path d="M6 1 V7 M1 7 H11" stroke="currentColor" stroke-width="1.1"/><path d="M6 1.6 A4.4 4.4 0 0 0 1.6 6 V7 H6 Z" fill="currentColor"/></svg>';
  var SVG_RANGS = '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2 6.5 L6 2.5 L10 6.5 M2 10.5 L6 6.5 L10 10.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  var SVG_ENCHANT = '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M6 0.5 L7.3 4.7 L11.5 6 L7.3 7.3 L6 11.5 L4.7 7.3 L0.5 6 L4.7 4.7 Z" fill="currentColor"/></svg>';

  function indiceClic() {
    if (!elCard) return null;
    var el = elCard.querySelector('.indice-clic');
    if (!el) {
      el = document.createElement('div');
      el.className = 'indice-clic';
      el.setAttribute('aria-hidden', 'true');
      elCard.appendChild(el);
    }
    return el;
  }

  function poserIndiceClic(card, id, estTalent) {
    var el = indiceClic();
    if (!el) return;
    /* Les talents aussi : sans enchantement, ils n'ont que leurs rangs. */
    var montrer = card && !card.isEncounter
      && !(hovered && hovered.rencontre) && !(epinglee && epinglee.id === id);
    /* Le mode Actuel ne montre que le rang de l'exemplaire : le clic montre
       les autres. Un objet légendaire n'en a pas d'autre. */
    var rangs = montrer && window.BAZAAR_STATS === 'current' && card.tier !== 'Legendary';
    var enchants = montrer && Object.keys(card.enchantments || {}).length > 0;
    if (!rangs && !enchants) { el.style.display = 'none'; return; }
    el.innerHTML = SVG_SOURIS + (rangs ? SVG_RANGS : '') + (enchants ? SVG_ENCHANT : '');
    el.style.display = '';
  }

  function cacherIndiceClic() {
    var el = elCard && elCard.querySelector('.indice-clic');
    if (el) el.style.display = 'none';
  }

  function ficheSimple(titre, texte) {
    if (typeof window.showError !== 'function') return;
    window.showError(titre);
    cacherIndiceClic();

    /* La couleur neutre, et pas celle de la dernière carte survolée ; pas de
       trait sous le titre (PVE, PVP, mécaniques). */
    teinterParHeros(null);
    var entete = document.querySelector('#card .header');
    if (entete) entete.classList.add('sans-filet');

    var corps = document.getElementById('item-body');
    if (!corps) return;
    var ligne = document.createElement('div');
    ligne.className = 'effect-row passive';
    var fleche = document.createElement('span');
    fleche.className = 'effect-arrow';
    fleche.textContent = '\u25B8';
    var txt = document.createElement('div');
    txt.className = 'tooltip-text';
    txt.textContent = texte;
    ligne.appendChild(fleche);
    ligne.appendChild(txt);
    corps.textContent = '';
    corps.appendChild(ligne);
  }

  var DECALAGE = 14;              // pixels entre le curseur et la fiche, en hauteur
  var ECART_HORIZONTAL = 28;      // et sur le côté
  var dernierPointeur = null;     // pour replacer la fiche après son rendu

  function suivre(ev) {
    if (!SUIVI_CURSEUR) return;
    var r = elRoot.getBoundingClientRect();
    dernierPointeur = { x: ev.clientX - r.left, y: ev.clientY - r.top };
    placerAuCurseur(dernierPointeur.x, dernierPointeur.y);
  }

  /* Une fiche plus haute que l'écran serait coupée, où qu'on la pose. On la
     réduit alors juste ce qu'il faut pour qu'elle tienne, plutôt que d'en
     perdre la fin. Les descriptions les plus longues, « Tour Bus » enchanté
     par exemple, sont dans ce cas.

     Vaut pour tous les placements, au curseur comme dans un coin : dans ces
     derniers, rien ne rattrapait le débordement.

     On ne mesure qu'au changement de contenu : le faire à chaque mouvement de
     souris forcerait le navigateur à recalculer la mise en page des dizaines
     de fois par seconde, sur une page qui joue déjà une vidéo. */
  function ajusterHauteur() {
    if (!aRemesurer || !elPanel || !elCard) return;
    aRemesurer = false;

    // On repart de l'échelle voulue, sans quoi chaque passage réduirait
    // la précédente.
    var echelle = ajusterEchelle();

    var place = elRoot.getBoundingClientRect().height - 2 * margeFiche();
    if (place <= 0) return;

    /* On mesure la FICHE, jamais le panneau : celui-ci porte
       « min-height: 100vh », si bien que sa hauteur valait toujours celle de
       l'écran et que la réduction se calculait sur une valeur fausse.

       La colonne d'enchantements est posée en absolu, hors du flux : elle ne
       compte pas dans la hauteur, et sa propre hauteur est bornée à celle de
       la fiche. */
    /* La hauteur de mise en page, multipliée par l'échelle voulue, et non
       la hauteur affichée : la fiche anime son échelle, et la mesurer
       pendant l'animation rendait l'ANCIENNE taille. Au redimensionnement
       du lecteur, une fiche réduite paraissait donc tenir, et reprenait
       sa pleine taille à la fin de l'animation. */
    var hauteur = elCard.offsetHeight * (echelle || 1);
    if (hauteur > place) reduirePour(place / hauteur);
  }

  /* Les titres « Actif », « Passif »... et leur trait d'un pixel, calés sur
     les pixels de l'écran. La fiche est mise à l'échelle et ses lignes de
     texte ont des hauteurs fractionnaires : un titre tombait entre deux
     pixels, son trait s'étalait sur deux lignes et son texte paraissait plus
     gros que celui du titre suivant. On décale chacun de moins d'un pixel,
     tous de la même façon par rapport à la fiche. */
  function calerTitres() {
    if (!elCard) return;
    var titres = elCard.querySelectorAll('.body > .section-label');
    if (!titres.length) return;
    var dpr = window.devicePixelRatio || 1;
    var origine = elCard.getBoundingClientRect().top;
    Array.prototype.forEach.call(titres, function (t) { t.style.top = ''; t.style.transform = ''; });
    Array.prototype.forEach.call(titres, function (t) {
      var r = t.getBoundingClientRect();
      var echelle = t.offsetHeight ? r.height / t.offsetHeight : 1;
      if (!echelle || !isFinite(echelle)) return;
      var trait = r.top + r.height / 2 - 0.5 * echelle - origine;
      var cible = Math.round(trait * dpr) / dpr;
      var ecart = (cible - trait) / echelle;
      /* À l'échelle 1, un décalage de mise en page (« top ») : une
         transformation lissait de nouveau le trait sur deux pixels. Sur une
         fiche mise à l'échelle, au contraire, seule une transformation tombe
         juste, la mise en page étant arrondie avant la mise à l'échelle. */
      if (Math.abs(ecart) <= 0.01) return;
      if (Math.abs(echelle - 1) < 0.01) { t.style.position = 'relative'; t.style.top = ecart.toFixed(3) + 'px'; }
      else t.style.transform = 'translateY(' + ecart.toFixed(3) + 'px)';
    });
  }

  function placerAuCurseur(x, y) {
    if (!SUIVI_CURSEUR || !elPanel) return;

    /* Une fiche épinglée ne suit plus le curseur : elle reste là où le
       spectateur l'a figée. Seule la colonne d'enchantements peut la
       déplacer, et alors dans une courte animation. */
    if (epinglee) return;

    var cadreR = elRoot.getBoundingClientRect();

    var f = (epinglee ? elPanel : (elCard || elPanel)).getBoundingClientRect();

    /* Moitié basse du lecteur : la fiche au-dessus du curseur ; moitié
       haute : en dessous. Le passage de l'un à l'autre ne saute pas : dans
       une bande au milieu du lecteur, la fiche glisse progressivement d'un
       côté à l'autre du curseur. Contre un bord, elle s'arrête à la marge et
       y reste, au lieu de basculer de l'autre côté comme avant. */
    var marge = margeFiche();
    var H = cadreR.height;
    var dessous = y + DECALAGE;                    // fiche sous le curseur
    var dessus = y - DECALAGE - f.height;          // fiche au-dessus
    var debut = H * 0.35, fin = H * 0.65;          // la bande de passage
    var t = Math.min(1, Math.max(0, (y - debut) / (fin - debut)));
    t = t * t * (3 - 2 * t);                       // départ et arrivée en douceur
    var ly = dessous + (dessus - dessous) * t;
    ly = Math.min(ly, H - marge - f.height);
    ly = Math.max(ly, marge);

    /* À côté du curseur, avec assez d'écart pour ne pas toucher la flèche,
       qui s'étend vers la droite. */
    var lx = x + ECART_HORIZONTAL;
    var cote = 'droite';
    if (lx + f.width > cadreR.width) { lx = Math.max(0, x - ECART_HORIZONTAL - f.width); cote = 'gauche'; }

    /* Près du bord droit, la fiche passe à gauche du curseur. Ce passage
       glisse en 0,15 s au lieu de sauter. Seulement lui : le reste du temps,
       la fiche colle au curseur sans retard. Une fiche qui vient d'apparaître
       se pose directement, sans partir de son ancienne place. */
    /* Le glissement ne vaut que pour LA MÊME fiche : passer d'une zone à une
       autre pose la nouvelle directement. Sans cela, quitter une mécanique,
       à fiche étroite, pour un objet, à fiche large, la faisait glisser. */
    var visible = !elPanel.classList.contains('hidden');
    var quelle = hovered ? (hovered.id + '|' + (hovered.etiquette || '')) : null;
    if (quelle !== ficheDuCote) {
      coteFiche = null;
      ficheDuCote = quelle;
      elPanel.style.transition = '';
      clearTimeout(minuterieGlisse);
    }
    if (visible && coteFiche && cote !== coteFiche) {
      elPanel.style.transition = 'transform .15s ease-out';
      clearTimeout(minuterieGlisse);
      minuterieGlisse = setTimeout(function () { elPanel.style.transition = ''; }, 170);
    }
    coteFiche = visible ? cote : null;

    elPanel.style.transform = 'translate(' + Math.round(lx) + 'px,'
                                          + Math.round(ly) + 'px)';
  }
  /* L'écart entre la fiche et les bords haut et bas du lecteur : 2,5 % de sa
     hauteur, 12 pixels au moins (18 en 720p, 27 en 1080p). */
  function margeFiche() {
    var h = elRoot ? elRoot.getBoundingClientRect().height : window.innerHeight;
    return Math.max(12, Math.round(h * 0.025));
  }

  var coteFiche = null;          // côté du curseur où se tient la fiche
  var ficheDuCote = null;        // la fiche pour laquelle ce côté vaut
  var minuterieGlisse = null;

  function ficheEffet(effets) {
    if (!effets || !effets.length) return null;

    return effets.map(function (e) {
      var f = cache.get(cle(e.i));
      if (!f) { fetchCard(e.i, false, true); return { code: e.k || null }; }
      return {
        code: e.k || null,
        nom: String(f.name || '').replace(/\s*\(.*\)\s*$/, ''),
        texte: (f.tooltips && f.tooltips[0] && f.tooltips[0].text) || '',
      };
    });
  }

  function show(id, estTalent, estRencontre, combat, effetEmplacement, etiquette,
                enchantPose) {
    /* Rien de neuf à montrer : on ne refait pas le rendu.

       Sans ce garde-fou, la même fiche était redessinée à chaque message, et
       son illustration rechargée avec elle : une carte déjà vue semblait se
       recharger, et l'ensemble paraissait lourd. */
    var ench = (epinglee && epinglee.id === id)
      ? epinglee.enchant : (enchantPose || null);

    /* Le même emplacement, pas seulement la même carte : deux exemplaires
       côte à côte, l'un enchanté, l'autre non, partagent leur identifiant.
       Passer de l'un à l'autre gardait la fiche du premier. */
    if (hovered && hovered.id === id
        && hovered.etiquette === (etiquette || null)
        && hovered.talent === !!estTalent
        && hovered.rencontre === !!estRencontre
        && hovered.enchant === ench
        && !combat
        && !elPanel.classList.contains('hidden')) {
      return;
    }

    if (estMecanique(id)) {
      hovered = { id: id, talent: false, rencontre: false, combat: null,
                  socket: null, etiquette: etiquette || null, enchant: null };
      paint(id, false);
      return;
    }

    hovered = { id: id, talent: !!estTalent, rencontre: !!estRencontre,
                combat: combat || null, socket: effetEmplacement || null,
                etiquette: etiquette || null,
                /* L'enchantement vient de la fiche épinglée, ou de l'objet
                   survolé quand il en porte un : la case réserve montre alors
                   la description que le streamer a vraiment. */
                enchant: (epinglee && epinglee.id === id)
                  ? epinglee.enchant : (enchantPose || null) };

    if (combat) {
      elPanel.classList.remove('hidden');

      if (combat.vs === 'pvp') {
        ficheSimple('PVP', trad(AUTRE_JOUEUR, 'autreJoueur'));
        return;
      }

      var fiche = cache.get(cle(id));
      ficheSimple('PVE', (fiche && fiche.name) || combat.nm || '');
      if (!fiche) fetchCard(id, false, true);
      return;
    }

    fetchCard(id, estTalent, estRencontre);
    paint(id, estTalent);
  }

  /* L'exemplaire en jeu de la carte survolée, avec ses valeurs vivantes. */
  function exemplaireVivant(id, estTalent) {
    /* On identifie l'exemplaire par son EMPLACEMENT, pas par son identifiant :
       deux copies d'un même objet le partagent, et la première trouvée imposait
       son enchantement à l'autre. */
    var source = estTalent ? skills.concat(faceTalents)
                           : board.concat(enFace, reserve);

    var vise = hovered && hovered.etiquette;

    return source.filter(function (i) {
      if (i.id !== id) return false;
      if (!vise) return true;
      // Une carte peut appartenir à l'une ou l'autre rangée : on essaie les
      // étiquettes possibles plutôt que de deviner sa provenance.
      return etiquetteDe(i, 'plateau') === vise
          || etiquetteDe(i, 'talent') === vise
          || etiquetteDe(i) === vise
          || ('reserve-' + i.s) === vise;
    })[0]
      // Sans étiquette - préchargement, rendu hors survol - on retombe sur
      // le premier exemplaire, ce qui reste juste quand il est unique.
      || source.filter(function (i) { return i.id === id; })[0]
      || {};
  }

  /* Ce qui, dans l'exemplaire en jeu, change la fiche affichée : rareté,
     enchantement, quêtes, valeurs des jetons, critique, emplacement. */
  function signatureVivante(id, estTalent) {
    var v = exemplaireVivant(id, estTalent);
    return JSON.stringify([v.q, v.e, v.qp, v.jv, v.cc, v.mc, v.cd, v.am, v.ta, v.se]);
  }

  function paint(id, estTalent) {
    var card = cache.get(cle(id));

    function afficher() {
      aRemesurer = true;          // le contenu vient de changer
      elPanel.classList.remove('hidden');

      /* Avant le placement : la hauteur retenue décide de la position. */
      ajusterHauteur();
      calerTitres();

      if (SUIVI_CURSEUR && dernierPointeur) {
        placerAuCurseur(dernierPointeur.x, dernierPointeur.y);
      }
    }

    if (estMecanique(id)) {
      var nomMeca = id.slice(5);
      var m = texteMecanique(nomMeca);
      if (m) ficheMecanique(m, nomMeca);
      afficher();
      return;
    }

    /* Fiche pas encore arrivée : rien plutôt que l'ANCIENNE. Afficher le
       panneau tel quel montrait la carte précédente, avec sa couleur, le
       temps que la nouvelle arrive ; on la voyait ensuite changer. La fiche
       paraît d'elle-même à l'arrivée des données. */
    if (!cache.has(cle(id))) {
      elPanel.classList.add('hidden');
      return;
    }
    if (card === null) {                // fiche introuvable
      ficheSimple(trad(INCONNU, 'inconnu'), trad(INDISPONIBLE, 'indisponible'));
      afficher();
      return;
    }

    var live = exemplaireVivant(id, estTalent);

    /* Sur une fiche épinglée, l'enchantement choisi par le spectateur prime
       sur celui que porte l'exemplaire en jeu : c'est tout l'intérêt des
       boutons. Ailleurs, on montre la carte telle qu'elle est. */
    var ench = (hovered && hovered.enchant) || live.e || null;

    window.showItem(Object.assign({ found: true }, card, {
      socketEffect:        ficheEffet((hovered && hovered.socket) || live.se),
      isSkill:             !!estTalent,
      isEncounter:         !!(card.isEncounter || (hovered && hovered.rencontre)),
      currentTier:         live.q || card.tier,
      /* L'avancement réel des quêtes de cet exemplaire, lu par le mod. */
      avancementQuetes:    live.qp || null,
      /* Les valeurs que le jeu donne aux jetons de cet exemplaire. */
      jetonsVivants:       live.jv || null,
      /* Sa chance de critique actuelle. */
      critVivant:          (typeof live.cc === 'number') ? live.cc : null,
      /* Les tags gagnés en partie, montrés en Global comme en Current. */
      tagsAjoutes:         Array.isArray(live.ta) ? live.ta : null,
      /* Une fiche épinglée montre toujours tous ses paliers, même en
         « Current » : on l'épingle pour l'étudier. */
      statsGlobales:       !!(epinglee && epinglee.id === id),
      enchantmentName:     ench,
      enchantmentTooltips: ench ? (card.enchantments && card.enchantments[ench]) || [] : [],
      size:                card.size
    }, selonEnchantement(card, ench), multicastVivant(card, live, id),
       delaisVivants(card, live, id)));

    /* La teinte du héros, quand le spectateur a choisi ce thème. */
    teinterParHeros(card.heroes);

    poserIndiceClic(card, id, estTalent);

    if (hovered && hovered.id === id) hovered.vivant = signatureVivante(id, estTalent);

    afficher();
  }

  function hide() {
    if (epinglee) return;          // une fiche épinglée ne se ferme pas seule
    hovered = null;
    elPanel.classList.add('hidden');
  }

  function detacher() {
    if (!epinglee) return;
    epinglee = null;
    hauteurColonne = null;
    elRoot.removeAttribute('data-epingle');
    hovered = null;
    elPanel.classList.add('hidden');

    /* La barre d'enchantements vit dans le panneau, non dans la fiche :
       masquer le panneau ne la retirait pas, et elle reparaissait au survol
       suivant alors que plus rien n'était épinglé. */
    var barre = elPanel.querySelector('.ench-epingle');
    if (barre) barre.remove();

    montrerCeQuEstSousLeCurseur();
  }

  /* Libérer une fiche alors que la souris est déjà sur une autre carte doit
     montrer celle-ci tout de suite : sans cela il fallait sortir de la zone
     puis y revenir pour réveiller le survol. */
  function montrerCeQuEstSousLeCurseur() {
    if (!derniereSouris) return;

    var el = document.elementFromPoint(derniereSouris.x, derniereSouris.y);
    if (!el || !el.classList) return;

    var estZone = el.classList.contains('hotspot') || el.classList.contains('case');
    if (!estZone || el.__id === undefined) return;

    show(el.__id, el.__talent, el.__rencontre, el.__combat, el.__socket,
         el.__etiquette, el.__enchant || null);

    /* Le point de référence est recalculé depuis la position RÉELLE de la
       souris : garder l'ancien faisait paraître la nouvelle fiche là où se
       trouvait la précédente. */
    var cadreR = elRoot.getBoundingClientRect();
    dernierPointeur = { x: derniereSouris.x - cadreR.left,
                        y: derniereSouris.y - cadreR.top };
    placerAuCurseur(dernierPointeur.x, dernierPointeur.y);
  }

  function epingler(zone) {
    epinglee = {
      /* L'enchantement de l'objet devient celui de la fiche épinglée : son
         bouton paraît donc déjà choisi. */
      enchant: zone.__enchant || null,
      id: zone.__id, talent: zone.__talent, rencontre: zone.__rencontre,
      combat: zone.__combat, socket: zone.__socket, etiquette: zone.__etiquette,
    };
    /* La fiche reçoit alors les clics, qu'elle laisse passer le reste du
       temps pour ne pas gêner le survol des cartes voisines. */
    elRoot.setAttribute('data-epingle', '1');

    /* En « Current », la fiche épinglée passe aussitôt à sa version globale,
       avec tous ses paliers. */
    if (window.BAZAAR_STATS === 'current' && hovered) {
      var h = hovered;
      hovered = null;
      show(h.id, h.talent, h.rencontre, h.combat, h.socket, h.etiquette);
    }
    posesBoutonsEnchant();
  }

  /* Les variantes d'enchantement, sous la fiche épinglée. Le spectateur voit
     ainsi ce que devient l'objet une fois enchanté, sans ouvrir la recherche
     ni perdre de vue le stream. */
  function posesBoutonsEnchant() {
    var ancienne = elPanel.querySelector('.ench-epingle');
    if (ancienne) ancienne.remove();
    if (!epinglee) return;

    var carte = cache.get(cle(epinglee.id));
    var noms = carte && Object.keys(carte.enchantments || {}).sort(function (a, b) {
      return nomEnchant(a).localeCompare(nomEnchant(b), langue);
    });
    if (!noms || !noms.length) return;

    var barre = document.createElement('div');
    barre.className = 'ench-epingle';

    /* Un clic ENTRE deux boutons tombait sur le fond de la colonne, remontait
       jusqu'au document et libérait la fiche. La colonne entière le retient
       désormais. */
    barre.addEventListener('click', function (ev) { ev.stopPropagation(); });

    [null].concat(noms).forEach(function (e) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = (e === epinglee.enchant) ? 'actif' : '';

      var lib = document.createElement('span');
      lib.textContent = e ? nomEnchant(e) : libRech('sansEnchant');
      b.appendChild(lib);

      if (e) {
        var pub = (window.BAZAAR_LIBELLES || {}).couleurs_enchantements;
        b.style.color = (pub && pub[e])
          || (window.ENCHANTMENT_COLORS || {})[e] || '';
      }

      b.addEventListener('click', function (ev) {
        ev.stopPropagation();          // ne pas lever l'épinglage
        epinglee.enchant = e;

        /* La colonne est refaite : on lui rend sa position de défilement,
           sans quoi elle remontait en haut à chaque choix. */
        var barreAvant = elPanel.querySelector('.ench-epingle');
        var defilement = barreAvant ? barreAvant.scrollTop : 0;

        show(epinglee.id, epinglee.talent, epinglee.rencontre,
             epinglee.combat, epinglee.socket, epinglee.etiquette);
        posesBoutonsEnchant();

        var barreApres = elPanel.querySelector('.ench-epingle');
        if (barreApres) barreApres.scrollTop = defilement;

        /* La description vient de changer de longueur : le rendu n'est pas
           encore mesurable, on replace au cycle suivant. */
        requestAnimationFrame(function () {
          aRemesurer = true;
          ajusterHauteur();
          if (dernierPointeur) placerAuCurseur(dernierPointeur.x, dernierPointeur.y);
        });
      });

      barre.appendChild(b);
    });

    /* À droite de la fiche : on l'ajoute APRÈS elle. La poser en premier la
       laissait à gauche malgré le style. */
    elPanel.appendChild(barre);

    /* L'ascenseur prend la couleur du cadre de la fiche. */
    if (elCard) {
      var cadre = window.getComputedStyle(elCard).borderTopColor;
      if (cadre) barre.style.setProperty('--cadre-fiche', cadre);
    }

    /* La colonne se pose au ras du bord droit de la fiche, et ne dépasse
       jamais sa hauteur : au-delà, une seconde colonne se forme.

       On mesure le rendu plutôt que la mise en page : la fiche est mise à
       l'échelle, et sa boîte ne suit pas. */
    if (elCard) {
      var f = elCard.getBoundingClientRect();
      var p = elPanel.getBoundingClientRect();

      if (f.height > 0) {
        /* La hauteur est figée à celle de la fiche AU MOMENT DE L'ÉPINGLAGE :
           choisir un enchantement allonge la description, et laisser la
           colonne grandir avec elle était disgracieux. */
        if (hauteurColonne === null) hauteurColonne = Math.round(f.height);
        barre.style.maxHeight = hauteurColonne + 'px';

        /* Toujours à droite de la fiche. Si elle n'y tient pas, c'est la
           FICHE qui recule vers la gauche, pas la colonne qui change de
           côté : le spectateur garde ses repères. */
        /* La colonne vient d'être posée : sa largeur n'est connue qu'après
           un calcul de mise en page. « offsetWidth » le force, là où
           « getBoundingClientRect » pouvait rendre zéro et faire sous-estimer
           le débordement, laissant les boutons hors de l'écran. */
        var large = barre.offsetWidth || barre.getBoundingClientRect().width || 150;
        var debord = (f.right + 6 + large) - window.innerWidth;
        var aGauche = false;

        /* La fiche ne recule que si l'ensemble déborderait, et le mouvement
           s'anime pour ne pas sauter.

           On mesure la FICHE ET la colonne : épingler une carte déjà proche
           du bord droit faisait sortir l'ensemble de l'écran, la fiche ne se
           replaçant plus une fois figée. */
        /* Deux façons de rester dans l'écran.

           Si nous avons posé la fiche nous-mêmes, au curseur, nous pouvons la
           reculer. Sinon elle est placée par la feuille de style, dans un
           coin : y toucher la faisait partir très loin, car « left » n'a
           alors pas la même origine. Dans ce cas, c'est la colonne qui passe
           à gauche de la fiche. */
        var posePartNous = /px$/.test(elPanel.style.left || '');

        if (debord > 0 && posePartNous) {
          var gauche = parseFloat(elPanel.style.left) || 0;
          elPanel.style.transition = 'left .25s ease, top .25s ease';
          elPanel.style.left = Math.max(0, gauche - debord) + 'px';

          /* La transition ne doit pas gêner le suivi du curseur ensuite. */
          setTimeout(function () { elPanel.style.transition = ''; }, 300);

          f = elCard.getBoundingClientRect();
          p = elPanel.getBoundingClientRect();
          debord = (f.right + 6 + large) - window.innerWidth;
        }

        aGauche = debord > 0;

        /* Et vers le bas, pour la même raison. */
        var basDeTrop = (f.bottom + 6) - window.innerHeight;
        if (basDeTrop > 0 && /px$/.test(elPanel.style.top || '')) {
          var haut = parseFloat(elPanel.style.top) || 0;
          elPanel.style.transition = 'left .25s ease, top .25s ease';
          elPanel.style.top = Math.max(0, haut - basDeTrop) + 'px';
          setTimeout(function () { elPanel.style.transition = ''; }, 300);
        }

        /* À droite par défaut, à gauche quand elle n'y tiendrait pas. */
        barre.style.left = aGauche
          ? Math.round(f.left - p.left - large - 6) + 'px'
          : Math.round(f.right - p.left + 6) + 'px';
      }
    }

    /* La fiche a changé de hauteur : on la replace, sinon elle déborde du bas
       de l'écran quand le spectateur a cliqué près du bord. */
    aRemesurer = true;
    ajusterHauteur();
    if (dernierPointeur) {
      placerAuCurseur(dernierPointeur.x, dernierPointeur.y);
    }
  }

  /* La fiche reste tant que la souris ne bouge pas, et disparaît au premier
     mouvement. Sans cela, elle s'effaçait dès que le curseur quittait la
     zone, ou que la carte quittait l'écran, sans laisser le temps de lire.

     On compare les coordonnées plutôt que de se fier à l'événement seul : le
     navigateur en émet aussi lorsque la page défile sous un curseur immobile. */
  var derniereSouris = null;

  document.addEventListener('mousemove', function (ev) {
    var bouge = !derniereSouris
      || Math.abs(ev.clientX - derniereSouris.x) > 1
      || Math.abs(ev.clientY - derniereSouris.y) > 1;

    derniereSouris = { x: ev.clientX, y: ev.clientY };
    if (!bouge || epinglee) return;

    /* Rien d'affiché : rien à cacher. « elementFromPoint » force le
       navigateur à recalculer la mise en page ; l'appeler à chaque mouvement
       alors qu'aucune fiche n'est visible coûtait cher pour rien. */
    if (!hovered) return;

    /* Sur une zone, le survol réaffiche aussitôt la bonne fiche ; ailleurs,
       la fiche s'efface. */
    var sousLeCurseur = document.elementFromPoint(ev.clientX, ev.clientY);
    if (sousLeCurseur && sousLeCurseur.classList
        && (sousLeCurseur.classList.contains('hotspot')
            /* Les cases du tiroir ne sont pas des zones du plateau, mais le
               survol doit y tenir de la même façon : sans cela la fiche
               s'effaçait aussitôt montrée. */
            || sousLeCurseur.classList.contains('case'))) return;

    hide();
  }, true);

  var imagesDemandees = {};

  function prechargerImage(carte) {
    if (!carte || !carte.image) return;
    var url = CFG.DATA_BASE_URL + '/images/' + carte.image
            + (window.BAZAAR_SUFFIXE_CACHE || '');
    if (imagesDemandees[url]) return;

    /* On GARDE l'objet Image. Sans référence, le ramasse-miettes le libère,
       et le navigateur peut refaire la requête : une illustration déjà vue
       se rechargeait en revenant dessus. */
    var img = new Image();
    img.decoding = 'async';
    img.src = url;
    imagesDemandees[url] = img;

    /* Décodée d'avance : chargée seulement, l'image devait encore être
       décompressée au moment de paraître, d'où le court battement au survol
       d'une carte pourtant déjà vue.

       Au repos du navigateur, pour ne pas disputer le temps de calcul à la
       vidéo au moment où la carte arrive. */
    if (typeof img.decode === 'function') {
      var decoder = function () { img.decode().catch(function () {}); };
      if (window.requestIdleCallback) window.requestIdleCallback(decoder);
      else setTimeout(decoder, 200);
    }
  }

  function prechargerTout() {
    board.forEach(function (it) {
      fetchCard(it.id, false);
      (it.se || []).forEach(function (e) { fetchCard(e.i, false, true); });
    });
    skills.forEach(function (sk) { fetchCard(sk.id, true); });
    enFace.forEach(function (it) {
      if (it.vs) return;                 // combat : composé sur place
      fetchCard(it.id, it.k === 's', it.k === 'e');
      // Les effets d'emplacement adverses ont aussi leur fiche à charger.
      (it.se || []).forEach(function (e) { fetchCard(e.i, false, true); });
    });
    faceTalents.forEach(function (sk) { fetchCard(sk.id, true); });
  }

  /* Sans réglage du streamer, aucun retard sur les affichages ordinaires :
     c'est à lui de déclarer le sien, qui varie du tout au tout selon sa
     latence. Seul le début d'un combat PVP garde une protection propre. */
  /* La latence mesurée pour CE spectateur, en millisecondes. Nulle tant que
     Twitch ne l'a pas communiquée. */
  var latenceSpectateur = 0;

  var RETARD_MS = (CFG.RETARD_MS !== undefined) ? CFG.RETARD_MS : 0;
  var RETARD_PVP_MS = (CFG.RETARD_PVP_MS !== undefined) ? CFG.RETARD_PVP_MS : 10000;

  /* Un combat contre un monstre se dévoile plus vite : son plateau n'est pas
     celui d'un adversaire qui pourrait regarder le stream. */
  var RETARD_PVE_MS = (CFG.RETARD_PVE_MS !== undefined) ? CFG.RETARD_PVE_MS : 2000;

  var enAttente = null;          // { msg, echeance }
  var horlogeRetard = null;

  var attente = null;          // « pvp », « pve », ou rien
  var combatEnCours = false;

  function objetsEnFace(msg) {
    return !!(msg && Array.isArray(msg.f)
      && msg.f.some(function (it) { return !it.r; }));
  }

  /* Rend la sorte de combat qui commence - « pvp », « pve » - ou rien.

     Le portrait arme l'attente ; c'est l'arrivée du plateau adverse, quand le
     joueur a cliqué dessus, qui la déclenche. Les deux sortes suivent le même
     chemin mais ne se mélangent pas : une rencontre PVE ne doit pas hériter du
     long délai réservé aux combats entre joueurs. */
  function debutCombat(msg) {
    if (!msg || !Array.isArray(msg.f) || !msg.f.length) {
      attente = null;
      combatEnCours = false;
      return null;
    }

    /* La sorte annoncée par le portrait, s'il y en a un. */
    var portrait = null;
    msg.f.forEach(function (it) {
      if (it.vs === 'pvp') portrait = 'pvp';
      else if (it.vs === 'pve' && portrait !== 'pvp') portrait = 'pve';
    });

    /* Une rencontre qui n'annonce pas de combat - un événement, une boutique -
       clôt ce qui précédait. Sans ce désarmement, une attente restée en
       suspens s'appliquait au premier événement suivant le combat, qui se
       trouvait retardé de dix secondes. */
    var rencontre = msg.f.some(function (it) { return it.r; });
    if (rencontre && !portrait) {
      attente = null;
      combatEnCours = false;
      return null;
    }

    if (!objetsEnFace(msg)) combatEnCours = false;

    if (portrait) { if (!combatEnCours) attente = portrait; }

    if (attente && objetsEnFace(msg)) {
      var sorte = attente;
      attente = null;
      combatEnCours = true;
      return sorte;
    }

    return null;
  }

  function sansFace(msg) {
    var copie = Object.assign({}, msg);
    delete copie.f; delete copie.fk; delete copie.fc; delete copie.ra;
    return copie;
  }

  function recevoir(msg) {
    if (!msg || !Array.isArray(msg.b)) return;

    var debut = debutCombat(msg);

    /* Le combat est lancé (ses objets adverses arrivent) : la bande d'en face
       se vide tout de suite - portrait « Rencontre PVP », boutique ou réserve
       restée ouverte -, le plateau restant tel quel, et les objets adverses
       paraîtront au terme du délai. Avant le lancement, le portrait reste
       affiché normalement. */
    if (debut && dernierApplique && (dernierApplique.f || dernierApplique.fk || dernierApplique.ra)) {
      applyBoard(sansFace(dernierApplique));
    }

    /* On retient la plus grande des deux valeurs.

       La mesure de Twitch ne couvre que le trajet entre le serveur et ce
       spectateur. Un streamer qui diffuse en différé pour un tournoi ajoute
       son retard AVANT l'envoi à Twitch : la mesure ne le voit pas, et s'y
       fier seul ferait arriver les fiches trop tôt, ce qui est précisément
       ce qu'on cherche à éviter.

       À l'inverse, un spectateur dont la connexion traîne a une latence bien
       supérieure au réglage du streamer, et c'est alors la mesure qui vaut. */
    var reglageStreamer = (typeof msg.d === 'number' && msg.d > 0)
      ? Math.min(msg.d, 86400) * 1000 : 0;

    var delaiStream = Math.max(latenceSpectateur, reglageStreamer);

    var retard = delaiStream
      + (debut === 'pvp' ? RETARD_PVP_MS
       : debut === 'pve' ? RETARD_PVE_MS
       : RETARD_MS);
    /* Un message sans retard propre ne passe pas devant un combat qui attend
       encore sa révélation : il prend sa place dans l'attente. */
    if (!retard && !enAttente) { applyBoard(msg); return; }

    if (!enAttente) {
      enAttente = { msg: msg, echeance: Date.now() + retard };
    } else {
      enAttente.msg = msg;
      if (debut) {
        enAttente.echeance = Math.max(enAttente.echeance, Date.now() + retard);
      }
    }

    if (!horlogeRetard) horlogeRetard = setInterval(examinerRetard, 200);
  }

  function examinerRetard() {
    if (!enAttente) {
      clearInterval(horlogeRetard);
      horlogeRetard = null;
      return;
    }
    if (Date.now() < enAttente.echeance) return;

    var msg = enAttente.msg;
    enAttente = null;
    applyBoard(msg);
  }

  /* Version minimale attendue de l'application compagnon. En deçà, elle
     n'envoie pas tout ce que cette extension sait afficher : la 3 apporte
     l'avancement des quêtes, les valeurs calculées par le jeu, la réserve
     affichée. À relever avec chaque version qui transmet du nouveau, sans
     quoi une ancienne application passe pour à jour. */
  var VERSION_APP_MIN = 3;

  /* L'alerte ne recouvre jamais le guide : sur un petit lecteur, où le guide
     centré s'étend jusqu'à elle, elle descend juste en dessous. Sinon elle
     reste en haut à gauche. */
  function placerAlerte() {
    if (!elVersion) return;
    elVersion.style.top = '';
    if (!elTuto || !elTuto.classList.contains('visible')) return;
    var a = elVersion.getBoundingClientRect(), t = elTuto.getBoundingClientRect();
    var chevauche = a.right > t.left && a.left < t.right && a.bottom > t.top && a.top < t.bottom;
    if (chevauche) {
      var base = elRoot.getBoundingClientRect().top;
      elVersion.style.top = Math.round(t.bottom - base + 8) + 'px';
    }
  }
  window.addEventListener('resize', function () { placerAlerte(); });

  /* La rareté arrive en une lettre, « D » pour Diamond : on la rend en
     toutes lettres dès la réception, pour que tout le reste de l'extension
     n'ait rien à savoir de ce raccourci. */
  var RARETES_COURTES = { B: 'Bronze', S: 'Silver', G: 'Gold', D: 'Diamond', L: 'Legendary' };

  function deplierMessage(msg) {
    if (!msg || typeof msg !== 'object') return msg;
    Object.keys(msg).forEach(function (cle) {
      var liste = msg[cle];
      if (!Array.isArray(liste)) return;
      liste.forEach(function (it) {
        if (it && typeof it.q === 'string' && it.q.length === 1 && RARETES_COURTES[it.q]) {
          it.q = RARETES_COURTES[it.q];
        }
      });
    });
    return msg;
  }

  function verifierVersionApp(msg) {
    var v = (typeof msg.v === 'number') ? msg.v : 1;

    if (v >= VERSION_APP_MIN) {
      if (elVersion) { elVersion.remove(); elVersion = null; }
      return;
    }

    // Écartée par le spectateur : on ne la lui remet pas.
    if (elVersion || versionEcartee) return;

    elVersion = document.createElement('div');
    elVersion.id = 'alerte-version';

    /* Le panneau « Attention », triangle rouge et point d'exclamation. */
    var panneau = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    panneau.setAttribute('class', 'panneau');
    panneau.setAttribute('viewBox', '0 0 24 24');
    panneau.setAttribute('aria-hidden', 'true');
    panneau.innerHTML = '<path class="fond" d="M12 2.2 L23 21.5 H1 Z"/>'
      + '<rect class="signe" x="10.9" y="8.2" width="2.2" height="7.4" rx="1"/>'
      + '<circle class="signe" cx="12" cy="18.3" r="1.35"/>';
    elVersion.appendChild(panneau);

    var texte = document.createElement('span');
    texte.textContent = trad(APP_ANCIENNE, 'appAncienne');
    elVersion.appendChild(texte);

    var croix = document.createElement('button');
    croix.type = 'button';
    croix.className = 'fermer';
    croix.textContent = '\u00D7';
    croix.addEventListener('click', function (ev) {
      ev.stopPropagation();
      versionEcartee = true;
      if (elVersion) { elVersion.remove(); elVersion = null; }
    });
    elVersion.appendChild(croix);

    elRoot.appendChild(elVersion);
    placerAlerte();
  }

  var versionEcartee = false;

  var elVersion = null;

  var APP_ANCIENNE = {
    fr: 'Ce streamer utilise une version obsolète de l\u2019application '
      + 'Bazaar Scanner. Prévenez-le dans le chat : il doit la mettre à jour.',
    en: 'This streamer is running an outdated Bazaar Scanner companion app. '
      + 'Let them know in chat: they need to update it.',
    de: 'Dieser Streamer nutzt eine veraltete Bazaar-Scanner-Companion-App. '
      + 'Sagen Sie ihm im Chat Bescheid: er muss sie aktualisieren.',
    es: 'Este streamer usa una versión desactualizada de la aplicación '
      + 'Bazaar Scanner. Avísele en el chat: debe actualizarla.',
    it: 'Questo streamer usa una versione obsoleta dell\u2019app companion '
      + 'Bazaar Scanner. Lo avvisi in chat: deve aggiornarla.',
    pt: 'Este streamer usa uma versão desatualizada do aplicativo '
      + 'Bazaar Scanner. Avise-o no chat: ele precisa atualizá-la.',
    ko: '이 스트리머는 오래된 Bazaar Scanner 컴패니언 앱을 사용 중입니다. '
      + '채팅으로 앱 업데이트가 필요하다고 알려 주세요.',
    zh: '该主播使用的 Bazaar Scanner 配套应用版本过旧。'
      + '请在聊天中提醒他更新应用。',
  };

  /* Remplace les repères de position par ceux que portent les données. Ne
     touche qu'aux clés présentes : une géométrie partielle est acceptée. */
  function appliquerGeometrie(g) {
    if (!g || typeof g !== 'object') return;

    for (const bloc of ['BOARD', 'CARTES', 'RENCONTRE', 'REPERES', 'RESERVE', 'MECANIQUES']) {
      if (g[bloc] && typeof g[bloc] === 'object') {
        CFG[bloc] = Object.assign({}, CFG[bloc] || {}, g[bloc]);
      }
    }

    for (const val of ['TALENTS_ADVERSES_DECALAGE', 'TALENTS_ADVERSES_AXE',
                       'SKILL_SCALE', 'CARD_SCALE']) {
      if (typeof g[val] === 'number') CFG[val] = g[val];
    }

    if (Array.isArray(g.SKILL_LAYOUTS) && g.SKILL_LAYOUTS.length) {
      CFG.SKILL_LAYOUTS = g.SKILL_LAYOUTS;
    }

    // Les zones déjà posées doivent suivre.
    if (typeof buildHotspots === 'function') buildHotspots();
  }

  var dernierApplique = null;    // le dernier message affiché

  /* Une partie est en cours tant qu'une carte du joueur ou d'en face est à
     l'écran. Au lancement d'une partie, le choix des rencontres suffit, même
     plateau vide. Au retour au menu, tout se vide, alors que le jeu garde son
     compte des jours et des victoires : ces compteurs ne peuvent donc pas
     servir de signe.

     Une courte tolérance évite qu'un écran de transition sans aucune carte
     fasse clignoter la barre et les zones. */
  var TOLERANCE_PARTIE = 3000;
  var dernierSigneDePartie = 0;
  var minuteurPartie = null;
  function signeDePartie() {
    return !!(board.length || skills.length || reserve.length
              || enFace.length || faceTalents.length);
  }
  function partieEnCours() {
    return Date.now() - dernierSigneDePartie < TOLERANCE_PARTIE;
  }
  function suivreSigneDePartie() {
    if (signeDePartie()) { dernierSigneDePartie = Date.now(); return; }
    /* Plus rien à l'écran : on revérifie à la fin de la tolérance, sans
       attendre le message suivant, qui peut tarder. */
    if (!dernierSigneDePartie || minuteurPartie) return;
    var reste = TOLERANCE_PARTIE - (Date.now() - dernierSigneDePartie);
    if (reste <= 0) return;
    minuteurPartie = setTimeout(function () {
      minuteurPartie = null;
      buildHotspots();
      majBarreVictoires();
    }, reste + 50);
  }

  function applyBoard(msg) {
    if (!msg || !Array.isArray(msg.b)) return;
    deplierMessage(msg);
    dernierApplique = msg;
    verifierVersionApp(msg);

    derniereReception = Date.now();
    dernierDelai = (typeof msg.d === 'number' && msg.d > 0) ? msg.d : 0;
    majInterface();
    board  = msg.b;
    skills = Array.isArray(msg.k) ? msg.k : [];

    /* La réserve a son propre tiroir : elle ne remplace plus la bande d'en
       face. Le mod la lit en permanence, coffre fermé compris, de sorte que
       la substitution d'autrefois aurait masqué l'adversaire en continu. */
    reserve = Array.isArray(msg.r) ? msg.r : [];
    heroJoue = (typeof msg.h === 'string') ? msg.h : '';
    modeClasse = (msg.m === 'r');
    modeTournoi = (msg.m === 't');
    jourPartie = Number.isInteger(msg.j) && msg.j > 0 ? msg.j : null;
    histoirePartie = (typeof msg.hj === 'string') ? msg.hj.replace(/[^vdr]/g, '') : '';
    var avantCompteurs = JSON.stringify(compteurs);
    compteurs = {
      vi: Number.isInteger(msg.vi) ? msg.vi : null,
      pr: Number.isInteger(msg.pr) ? msg.pr : null,
      px: Number.isInteger(msg.px) ? msg.px : null,
    };
    /* Un compte qui change sous une souris immobile : la fiche suit. */
    if (hovered && estMecanique(hovered.id) && !elPanel.classList.contains('hidden')
        && JSON.stringify(compteurs) !== avantCompteurs) {
      setTimeout(function () { if (hovered && estMecanique(hovered.id)) paint(hovered.id, false); }, 0);
    }

    /* La bande du haut.

       Coffre ouvert, le jeu y dessine la réserve à la place de l'adversaire :
       les zones de survol suivent, comme avant la case réserve. C'est
       « ra » qui le dit, et lui seul : il reste vide tant que le coffre est
       fermé, là où « r » porte la réserve en permanence et ne dit rien de ce
       qui est à l'écran. */
    var affichee = Array.isArray(msg.ra) ? msg.ra : [];

    enFace       = affichee.length ? affichee : (Array.isArray(msg.f) ? msg.f : []);
    faceCentree  = !affichee.length && !!msg.fc;
    faceTalents  = Array.isArray(msg.fk) ? msg.fk : [];

    var c = msg.c;
    cadre = (Array.isArray(c) && c.length === 4 && c[2] > 0 && c[3] > 0)
      ? { l: c[0], t: c[1], w: c[2], h: c[3] }
      : CADRE_PLEIN;

    coin = (COINS.indexOf(msg.p) >= 0) ? msg.p : 'hg';
    appliquerCoin();
    appliquerMode();

    tailleStreamer = (TAILLES.indexOf(msg.t) >= 0) ? msg.t : 'm';
    appliquerTaille();
    appliquerTheme();
  appliquerPolice();

    suivreSigneDePartie();
    buildHotspots();
    majBarreVictoires();

    if (board.length || enFace.length) peutEtreTuto('bazaar-tuto-vu');

    prechargerTout();   // au survol, tout est déjà en mémoire
    majTiroirReserve();

    /* La réserve en fait partie : sans elle, la fiche d'un objet rangé était
       masquée au message suivant, une seconde après le survol. */
    var toutes = board.concat(skills, enFace, faceTalents, reserve);
    var encoreLa = function () {
      if (!hovered) return false;
      if (estMecanique(hovered.id)) return !!zonesExistantes[hovered.etiquette];
      return toutes.some(function (i) { return i.id === hovered.id; });
    };
    var present = encoreLa();

    /* La carte a changé sous une souris immobile : on montre la NOUVELLE au
       lieu de masquer. Sans cela il fallait sortir de la zone et y revenir
       pour voir l'objet qui venait d'y être posé. */
    if (hovered && !present) {
      if (!epinglee) montrerCeQuEstSousLeCurseur();
      if (hovered && !encoreLa()) hide();
    }

    /* La carte survolée est toujours là, mais ses valeurs ont pu changer
       (rareté, enchantement, jetons, quêtes...) : la fiche se met à jour sans
       qu'il faille bouger la souris. Seulement si quelque chose a changé :
       le message qui revient toutes les deux secondes ne redessine rien. */
    if (hovered && !hovered.combat && !epinglee
        && !elPanel.classList.contains('hidden')
        && cache.get(cle(hovered.id))
        && toutes.some(function (i) { return i.id === hovered.id; })
        && signatureVivante(hovered.id, hovered.talent) !== hovered.vivant) {
      /* Un enchantement reçu pendant le survol remplace celui d'avant. */
      hovered.enchant = exemplaireVivant(hovered.id, hovered.talent).e || null;
      paint(hovered.id, hovered.talent);
    }

    log(board.length + ' objet(s), ' + skills.length + ' talent(s)');
  }

  function connectTwitch() {
    var T = window.Twitch && window.Twitch.ext;
    if (!T) { log('helper Twitch absent'); return; }

    log('en attente de Twitch\u2026');
    T.onAuthorized(function () { log('connecté, en attente du plateau\u2026'); });

    T.onContext && T.onContext(function (ctx) {
      if (!ctx) return;

      /* Twitch donne à chaque spectateur SA latence, en secondes. Elle vaut
         mieux que le réglage unique du streamer, qui ne peut viser qu'une
         moyenne : celui qui regarde avec trente secondes de retard et celui
         qui en a deux reçoivent alors chacun le bon décalage.

         Elle n'est pas toujours fournie. Absente, aberrante ou nulle, on
         retombe sur la valeur du streamer. */
      if (typeof ctx.hlsLatencyBroadcaster === 'number'
          && isFinite(ctx.hlsLatencyBroadcaster)
          && ctx.hlsLatencyBroadcaster > 0
          && ctx.hlsLatencyBroadcaster < 300) {
        latenceSpectateur = ctx.hlsLatencyBroadcaster * 1000;
      }

      if ('arePlayerControlsVisible' in ctx) {
        controlesVisibles = !!ctx.arePlayerControlsVisible;
        majInterface();
      }

      if (langueMemorisee() || !ctx.language) return;
      var l = String(ctx.language).slice(0, 2).toLowerCase();
      if (l !== langue && languesDisponibles().indexOf(l) >= 0) {
        appliquerLangue(l);
        majSelecteur();
      }
    });

    T.listen('broadcast', function (target, contentType, message) {
      try { recevoir(JSON.parse(message)); }
      catch (e) { log('message illisible'); }
    });
    log('abonné au canal, en attente du plateau\u2026');

    T.onError && T.onError(function (e) { log('erreur : ' + e); });
  }

  function connectDev() {
    log('mode développement');

    window.addEventListener('message', function (ev) {
      var d = ev.data;
      if (!d || typeof d !== 'object') return;

      if (d.type === 'board')  applyBoard(d.payload);
      if (d.type === 'config') {
        Object.assign(CFG.BOARD, d.payload.BOARD || {});
        if ('DEBUG_HOTSPOTS' in d.payload) CFG.DEBUG_HOTSPOTS = d.payload.DEBUG_HOTSPOTS;
        if ('SKILL_SCALE'    in d.payload) CFG.SKILL_SCALE    = d.payload.SKILL_SCALE;
        buildHotspots();

    if (board.length || enFace.length) peutEtreTuto('bazaar-tuto-vu');
      }
    });

    applyBoard({
      b: [
        { s: 0, n: 2, id: 'demo-1' },
        { s: 2, n: 1, id: 'demo-2' },
        { s: 3, n: 3, id: 'demo-3', e: 'Golden' },
        { s: 7, n: 2, id: 'demo-4' }
      ],
      k: [
        { s: 0, id: 'demo-t1' }, { s: 1, id: 'demo-t2' },
        { s: 2, id: 'demo-t3' }, { s: 3, id: 'demo-t4' }
      ]
    });
  }

  window.BAZAAR_STATS = memoire('bazaar-stats') || DEFAUTS['bazaar-stats'];
  ajusterEchelle();
  construireSelecteur();
  majSelecteur();
  buildHotspots();
  brancherTiroirReserve();

  versionPrete = chargerVersion();
  if (DEV) connectDev(); else connectTwitch();
})();
