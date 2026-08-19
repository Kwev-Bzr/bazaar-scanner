/* ============================================================================
   BAZAAR SCANNER — logique de l'extension

   Ce qu'il se passe, dans l'ordre :
     1. Twitch nous autorise et nous donne l'identifiant de la chaîne.
     2. On écoute le canal de diffusion : server.js y envoie l'état du plateau
        une fois par seconde environ.
     3. À chaque état reçu, on redessine les zones de survol et on précharge
        en tâche de fond les fiches des objets qu'on ne connaît pas encore.
     4. Au survol d'une zone, la fiche est déjà en mémoire : affichage instantané.

   Mode développement : ouvrir viewer.html?dev=1 active un faux Twitch.
   ========================================================================= */

(function () {
  'use strict';

  var CFG = window.BAZAAR_CONFIG;
  var DEV = new URLSearchParams(location.search).has('dev');

  /* --- langue d'affichage -----------------------------------------------
     Trois sources, par ordre de priorité :
       1. le choix explicite du spectateur, conservé d'une session à l'autre
       2. la langue de son compte Twitch, fournie par le contexte
       3. la valeur par défaut de config.js
     Chaque spectateur décide donc pour lui-même : deux personnes qui regardent
     le même stream peuvent lire les cartes dans deux langues différentes.
     --------------------------------------------------------------------- */

  /* --- version des données ----------------------------------------------
     Les fiches et les images sont mises en cache très longtemps par le
     navigateur, sinon chaque spectateur les retéléchargerait sans cesse. Mais
     après un patch du jeu, une carte MODIFIÉE garderait son ancien contenu :
     même adresse, donc même entrée de cache.

     index.json porte un numéro de version qui change à chaque export. On
     l'ajoute en suffixe de chaque adresse : le contenu périmé devient
     inatteignable sans qu'on ait à renommer quoi que ce soit.

     C'est la seule chose qu'on ne pourrait plus corriger après la revue
     Twitch, l'archive validée étant figée. D'où sa présence dès maintenant.
     --------------------------------------------------------------------- */

  window.BAZAAR_SUFFIXE_CACHE = '';

  // Promesse résolue dès que la version est connue. L'abonnement au canal
  // Twitch ne l'attend PAS : le faire dépendre d'une requête réseau retarderait
  // la réception du plateau, et un réseau bloqué empêcherait toute connexion.
  // Seule la récupération des fiches patiente, le temps de connaître le suffixe.
  var versionPrete = null;

  // Langues réellement publiées, découvertes dans index.json. Les garder hors
  // de l'archive validée par Twitch permet d'en ajouter une par simple
  // publication de données, sans repasser par une revue.
  var languesPubliees = null;
  var nomsPublies = null;
  // Libellés et glossaires par langue, publiés dans index.json.
  var libellesPublies = null;

  function chargerVersion() {
    return fetch(CFG.DATA_BASE_URL + '/index.json', { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (idx) {
        if (!idx) return;
        if (idx.version) window.BAZAAR_SUFFIXE_CACHE = '?v=' + idx.version;

        var dispo = Object.keys(idx.langs || {}).filter(function (l) {
          var e = idx.langs[l];
          return e && (e.items > 0 || e.skills > 0);   // ignore une langue vide
        });
        libellesPublies = idx.libelles || null;
        appliquerLangueAuRendu();

        if (dispo.length) {
          languesPubliees = dispo;
          nomsPublies = idx.noms_langues || null;
          reconstruireSelecteur();

          /* Le choix du spectateur est relu MAINTENANT. Au chargement, il était
             validé contre la liste de secours de config.js — deux langues
             seulement — donc un choix comme l'allemand était rejeté et le
             spectateur repassait en français à chaque visite. Maintenant que la
             vraie liste est connue, son choix redevient valable. */
          var memo = langueMemorisee();
          if (memo && memo !== langue) changerLangue(memo);
          else if (dispo.indexOf(langue) < 0) changerLangue(dispo[0]);

          appliquerLangueAuRendu();
        }
      })
      .catch(function () { /* sans index, on retombe sur config.js */ });
  }

  var CLE_LANGUE = 'bazaar-scanner-langue';

  /* Ordre d'affichage, le même que dans l'application compagnon : le streamer
     et ses spectateurs voient ainsi la même liste. Une langue qui n'y figure
     pas — ajoutée plus tard côté données — est placée à la fin plutôt
     qu'écartée. */
  /* Le russe, l'ukrainien et le japonais sont absents : le jeu ne publie leurs
     traductions que sur sa branche de test, sous accord de confidentialité.
     Une langue non exportée n'apparaît de toute façon pas — cette liste ne fait
     que fixer l'ordre — mais autant ne pas la mentionner du tout. */
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

  // Le rendu généré depuis overlay.html lit cette variable pour savoir s'il
  // doit traduire les libellés et les mots-clés. Sans elle, une fiche anglaise
  // s'afficherait avec « Actif », « Petit », « Délai d'Activation ».
  function appliquerLangueAuRendu() {
    window.BAZAAR_LANGUE = langue;
    // Les libellés suivent la langue choisie. En anglais il n'y en a pas :
    // le jeu est natif, le rendu laisse passer les valeurs d'origine.
    window.BAZAAR_LIBELLES = (libellesPublies && libellesPublies[langue]) || null;
  }
  appliquerLangueAuRendu();

  function changerLangue(l) {
    if (l === langue || languesDisponibles().indexOf(l) < 0) return;
    langue = l;
    appliquerLangueAuRendu();
    memoriserLangue(l);
    cache.clear();               // les fiches en cache sont dans l'autre langue
    inflight.clear();
    prechargerTout();
    if (hovered) paint(hovered.id, hovered.talent);
  }

  var elCard     = document.getElementById('card');
  var elHotspots = document.getElementById('hotspots');
  var elPanel    = document.getElementById('card-panel');
  var elStatus   = document.getElementById('status');
  var elRoot     = document.getElementById('root');

  var board     = [];        // objets du plateau, dernier état reçu
  var skills    = [];        // talents, dernier état reçu

  /* --- cadre du jeu dans l'image ----------------------------------------
     Toutes les coordonnées d'emplacements sont exprimées en pourcentage du
     JEU, pas du lecteur. Or le jeu n'occupe pas forcément tout le cadre : une
     webcam, une bordure, un jeu en fenêtré le décalent et le rétrécissent.

     Le streamer délimite donc une fois pour toutes le rectangle où se trouve
     son jeu, et ce rectangle voyage avec l'état du plateau. Un seul réglage
     recale l'ensemble — les dix emplacements comme les soixante positions de
     talents — puisque tous sont relatifs au même repère.

     Par défaut, le jeu occupe tout : la transformation est alors neutre.
     --------------------------------------------------------------------- */

  var CADRE_PLEIN = { l: 0, t: 0, w: 100, h: 100 };
  var cadre = CADRE_PLEIN;

  function versX(x)      { return cadre.l + x * cadre.w / 100; }
  function versY(y)      { return cadre.t + y * cadre.h / 100; }
  function versLargeur(w) { return w * cadre.w / 100; }
  function versHauteur(h) { return h * cadre.h / 100; }
  var cache     = new Map(); // clé "langue|id" -> fiche, ou null si introuvable
  var inflight  = new Set(); // clés en cours de téléchargement
  var hovered   = null;      // { id, talent } actuellement survolé

  /* --- mise à l'échelle de la carte ------------------------------------
     La carte est dessinée pour 483 px de large sur un canvas 1920. Le lecteur
     Twitch, lui, va de la petite vignette au plein écran 4K. On redimensionne
     donc proportionnellement à sa largeur réelle, sinon la carte paraît
     minuscule en grand écran et envahissante en petit.
     --------------------------------------------------------------------- */

  var LARGEUR_REFERENCE = 1920;

  function ajusterEchelle() {
    if (!elCard) return;
    var facteur = (window.innerWidth / LARGEUR_REFERENCE) * (CFG.CARD_SCALE || 1);
    // Bornes de sécurité : illisible en dessous, absurde au-dessus.
    facteur = Math.max(0.5, Math.min(3, facteur));
    elCard.style.transform = 'scale(' + facteur.toFixed(3) + ')';
  }

  window.addEventListener('resize', ajusterEchelle);

  /* --- utilitaires ---------------------------------------------------- */

  // Bandeau d'état, visible en mode développement ET quand DEBUG_HOTSPOTS est
  // actif : sans lui, une extension qui fonctionne et une extension morte se
  // ressemblent exactement tant que la souris n'est pas sur un objet.
  function log(msg) {
    if (!DEV && !CFG.DEBUG_HOTSPOTS) return;
    elStatus.classList.remove('hidden');
    elStatus.textContent = msg;
  }

  /* --- récupération des fiches ---------------------------------------- */

  // Objets et talents sont publiés dans deux dossiers distincts par
  // export-cards.js. On retient le type au moment où on connaît la provenance.
  function cardUrl(id, estTalent) {
    return CFG.DATA_BASE_URL + '/' + (estTalent ? 'skills' : 'cards')
         + '/' + langue + '/' + encodeURIComponent(id) + '.json';
  }

  function cle(id) { return langue + '|' + id; }

  // Certaines cartes n'existent que dans une langue : celles que le mod a
  // extraites en jeu parce qu'elles sont absentes de GameData.db n'ont de fiche
  // que dans la langue où elles ont été rencontrées. Plutôt que d'afficher un
  // message d'erreur, on sert alors la carte dans l'autre langue disponible.
  /* Ordre de repli quand une carte manque dans la langue demandée — cas des
     cartes trop récentes pour la base du jeu, qui n'existent que dans la langue
     à laquelle le streamer joue.

     L'ANGLAIS D'ABORD, délibérément. Il est la langue d'origine du jeu et la
     seule que la plupart des joueurs de The Bazaar reconnaîtront, ne serait-ce
     que pour identifier la carte. Servir du français à un spectateur allemand,
     ce que faisait l'ordre précédent, n'aide personne. */
  function languesDeRepli(depuis) {
    var toutes = languesDisponibles();
    var ordre = [];
    if (depuis !== 'en' && toutes.indexOf('en') >= 0) ordre.push('en');
    toutes.forEach(function (l) {
      if (l !== depuis && ordre.indexOf(l) < 0) ordre.push(l);
    });
    return ordre;
  }

  /* Les fiches arrivent par PAQUETS de seize, découpés selon le premier
     caractère du TemplateId. Une fiche par requête aurait dépassé la limite de
     fichiers de l'hébergeur ; un fichier unique par langue aurait coûté
     plusieurs mégaoctets avant la première carte.

     On met en cache le paquet entier : survoler une deuxième carte du même
     paquet ne coûte plus rien. */

  var paquets = new Map();        // « langue|paquet » → promesse de contenu

  function nomPaquet(id) {
    var c = String(id).toLowerCase().replace(/[^0-9a-f]/g, '').charAt(0);
    return c || '0';
  }

  function chargerPaquet(l, estTalent, id) {
    var p = nomPaquet(id);
    var k = l + '|' + (estTalent ? 's' : 'c') + '|' + p;
    if (paquets.has(k)) return paquets.get(k);

    var url = CFG.DATA_BASE_URL + '/' + (estTalent ? 'skills' : 'cards')
            + '/' + l + '/' + p + '.json' + window.BAZAAR_SUFFIXE_CACHE;

    var promesse = fetch(url)
      .then(function (r) { return r.ok ? r.json() : Promise.reject(new Error(r.status)); })
      .catch(function (e) {
        // Un paquet manquant ne doit pas rester en cache : la langue suivante
        // doit pouvoir être tentée, et un rechargement doit pouvoir réussir.
        paquets.delete(k);
        throw e;
      });

    paquets.set(k, promesse);
    return promesse;
  }

  function fetchCard(id, estTalent) {
    var k = cle(id);
    if (cache.has(k) || inflight.has(k)) return;
    inflight.add(k);
    var langueDemandee = langue;

    function essayer(langues) {
      if (!langues.length) return Promise.reject(new Error('épuisé'));
      var l = langues[0];
      return chargerPaquet(l, estTalent, id)
        .then(function (contenu) {
          var carte = contenu && contenu[id];
          // Le paquet existe mais pas la carte : c'est le cas d'une carte
          // absente de cette langue, il faut essayer la suivante.
          if (!carte) throw new Error('absente');
          return carte;
        })
        .catch(function () { return essayer(langues.slice(1)); });
    }

    (versionPrete || Promise.resolve())
      .then(function () {
        return essayer([langueDemandee].concat(languesDeRepli(langueDemandee)));
      })
      .then(function (card) {
        cache.set(langueDemandee + '|' + id, card);
      })
      .catch(function () {
        // En dev, on fabrique une fiche bidon pour pouvoir travailler la mise
        // en page sans avoir publié la moindre donnée.
        cache.set(langueDemandee + '|' + id, DEV ? mockCard(id) : null);
      })
      .finally(function () {
        inflight.delete(langueDemandee + '|' + id);
        // La fiche peut arriver pendant le survol, ou après un changement de
        // langue : on ne redessine que si elle correspond à ce qui est affiché.
        if (hovered && hovered.id === id && langueDemandee === langue) {
          paint(id, hovered.talent);
        }
      });
  }

  // Fiche factice au format attendu par showItem(), pour travailler la mise en
  // page sans avoir publié la moindre donnée.
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

  /* --- zones de survol ------------------------------------------------ */

  // Les coordonnées reçues sont relatives au jeu ; on les projette dans le
  // cadre du lecteur avant de poser la zone.
  function zone(gauche, haut, largeur, hauteur, id, etiquette, estTalent) {
    var el = document.createElement('div');
    el.className = 'hotspot';
    el.dataset.slot = etiquette;
    el.style.left   = versX(gauche) + '%';
    el.style.top    = versY(haut) + '%';
    el.style.width  = versLargeur(largeur) + '%';
    el.style.height = versHauteur(hauteur) + '%';
    el.addEventListener('mouseenter', function () { show(id, estTalent); });
    el.addEventListener('mouseleave', hide);
    elHotspots.appendChild(el);
  }

  // La disposition des talents dépend de leur nombre : le jeu ajoute une rangée
  // à 6, 12 et 18, et rétrécit les emplacements à chaque fois.
  function dispositionTalents(nombre) {
    var L = CFG.SKILL_LAYOUTS || [];
    for (var i = 0; i < L.length; i++) if (nombre <= L[i].max) return L[i];
    return L[L.length - 1];   // au-delà du maximum connu, on garde la dernière
  }

  function buildHotspots() {
    elHotspots.textContent = '';

    // ── Objets : une bande régulière de N cases ──────────────────────────
    var B = CFG.BOARD;
    var slotW = B.width / B.slots;

    board.forEach(function (it) {
      zone(B.left + it.s * slotW, B.top, slotW * (it.n || 1), B.height,
           it.id, 'O' + it.s, false);
    });

    // ── Talents : emplacements relevés, centrés sur leur position ────────
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

    elRoot.classList.toggle('debug', !!CFG.DEBUG_HOTSPOTS);
  }

  /* --- sélecteur de langue ---------------------------------------------
     Placé dans la fiche elle-même plutôt qu'en permanence sur la vidéo : il
     n'apparaît qu'au survol d'une carte, et n'encombre jamais l'image.
     --------------------------------------------------------------------- */

  var elLangues = null;

  // Noms natifs, pour que l'ajout d'une langue ne demande aucune modification
  // du code. index.json peut fournir « noms_langues » pour compléter la liste.
  var NOMS_LANGUE = {
    fr: 'Français',  en: 'English',   es: 'Español',   de: 'Deutsch',
    it: 'Italiano',  pt: 'Português', nl: 'Nederlands', pl: 'Polski',
    tr: 'Türkçe',    sv: 'Svenska',   da: 'Dansk',     no: 'Norsk',
    fi: 'Suomi',     cs: 'Čeština',   hu: 'Magyar',    ro: 'Română',
    el: 'Ελληνικά',  ar: 'العربية',    he: 'עברית',      hi: 'हिन्दी',
    th: 'ไทย',        vi: 'Tiếng Việt', id: 'Bahasa Indonesia',
    ko: '한국어',     zh: '中文',      'zh-tw': '繁體中文',
  };

  // Planète en fil de fer. Dessinée en SVG plutôt qu'en image : nette à toutes
  // les tailles, et elle hérite de la couleur du texte.
  var PLANETE =
    '<svg viewBox="0 0 24 24" width="21" height="21" fill="none" ' +
    'stroke="currentColor" stroke-width="1.35">' +
    '<circle cx="12" cy="12" r="9"/>' +
    '<ellipse cx="12" cy="12" rx="4" ry="9"/>' +
    '<path d="M3.2 9h17.6M3.2 15h17.6"/></svg>';

  function construireSelecteur() {
    if (elLangues) return elLangues;

    elLangues = document.createElement('div');
    elLangues.id = 'lang-switch';

    var bouton = document.createElement('button');
    bouton.type = 'button';
    bouton.className = 'globe';
    bouton.innerHTML = PLANETE;
    // « Language » en anglais quelle que soit la langue : c'est le mot qu'un
    // spectateur perdu dans une langue qu'il ne lit pas reconnaîtra.
    bouton.title = 'Language';
    bouton.addEventListener('click', function (ev) {
      ev.stopPropagation();
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

  // Reconstruit le sélecteur quand la liste des langues change en cours de
  // route, l'index arrivant après le premier rendu.
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

  // Visible seulement quand le lecteur montre ses propres contrôles, c'est-à-dire
  // quand le spectateur bouge la souris sur la vidéo. Le reste du temps, rien
  // ne traîne à l'écran.
  function montrerSelecteur(visible) {
    if (!elLangues) return;
    elLangues.classList.toggle('visible', !!visible);
    if (!visible) elLangues.classList.remove('deplie');
  }

  /* --- affichage ------------------------------------------------------ */

  function show(id, estTalent) {
    hovered = { id: id, talent: !!estTalent };
    fetchCard(id, estTalent);
    paint(id, estTalent);
  }

  function paint(id, estTalent) {
    var card = cache.get(cle(id));

    // Le sélecteur doit rester accessible même quand la fiche manque, sinon on
    // ne pourrait pas repasser dans l'autre langue depuis une carte absente.
    function afficher() {
      elPanel.classList.remove('hidden');
    }

    if (!cache.has(cle(id))) {          // fiche pas encore arrivée
      afficher();
      return;
    }
    if (card === null) {                // fiche introuvable
      window.showError('Fiche indisponible');
      afficher();
      return;
    }

    // On complète la fiche statique avec ce que seul l'état du plateau sait :
    // la qualité réellement possédée et l'enchantement réellement appliqué.
    var source = estTalent ? skills : board;
    var live = source.filter(function (i) { return i.id === id; })[0] || {};

    window.showItem(Object.assign({ found: true }, card, {
      isSkill:             !!estTalent,
      currentTier:         live.q || card.tier,
      enchantmentName:     live.e || null,
      enchantmentTooltips: live.e ? (card.enchantments && card.enchantments[live.e]) || [] : [],
      size:                card.size
    }));

    afficher();
  }

  function hide() {
    hovered = null;
    elPanel.classList.add('hidden');
  }

  function prechargerTout() {
    board.forEach(function (it) { fetchCard(it.id, false); });
    skills.forEach(function (sk) { fetchCard(sk.id, true); });
  }

  /* --- réception de l'état du plateau --------------------------------- */

  function applyBoard(msg) {
    if (!msg || !Array.isArray(msg.b)) return;
    board  = msg.b;
    skills = Array.isArray(msg.k) ? msg.k : [];

    // Cadre transmis par le streamer, absent tant qu'il n'a pas calibré.
    var c = msg.c;
    cadre = (Array.isArray(c) && c.length === 4 && c[2] > 0 && c[3] > 0)
      ? { l: c[0], t: c[1], w: c[2], h: c[3] }
      : CADRE_PLEIN;

    buildHotspots();

    prechargerTout();   // au survol, tout est déjà en mémoire

    var present = hovered && board.concat(skills).some(function (i) {
      return i.id === hovered.id;
    });
    if (hovered && !present) hide();

    log(board.length + ' objet(s), ' + skills.length + ' talent(s)');
  }

  /* --- branchement Twitch --------------------------------------------- */

  function connectTwitch() {
    var T = window.Twitch && window.Twitch.ext;
    if (!T) { log('helper Twitch absent'); return; }

    log('en attente de Twitch\u2026');
    T.onAuthorized(function () { log('connecté, en attente du plateau\u2026'); });

    // Le contexte Twitch expose la langue du compte du spectateur. On s'en sert
    // comme valeur par défaut, sauf s'il a déjà fait un choix explicite.
    T.onContext && T.onContext(function (ctx) {
      if (!ctx) return;

      // Twitch signale l'apparition de ses propres contrôles : c'est le moment
      // exact où le spectateur regarde le bas du lecteur.
      if ('arePlayerControlsVisible' in ctx) montrerSelecteur(ctx.arePlayerControlsVisible);

      if (langueMemorisee() || !ctx.language) return;
      var l = String(ctx.language).slice(0, 2).toLowerCase();
      if (l !== langue && languesDisponibles().indexOf(l) >= 0) {
        langue = l;
        appliquerLangueAuRendu();
        cache.clear(); inflight.clear();
        prechargerTout();
        majSelecteur();
        if (hovered) paint(hovered.id, hovered.talent);
      }
    });

    T.listen('broadcast', function (target, contentType, message) {
      try { applyBoard(JSON.parse(message)); }
      catch (e) { log('message illisible'); }
    });
    log('abonné au canal, en attente du plateau\u2026');

    T.onError && T.onError(function (e) { log('erreur : ' + e); });
  }

  /* --- branchement mode développement --------------------------------- */

  function connectDev() {
    log('mode développement');

    // L'outil de calibrage (dev/harness.html) pilote cette page par postMessage.
    window.addEventListener('message', function (ev) {
      var d = ev.data;
      if (!d || typeof d !== 'object') return;

      if (d.type === 'board')  applyBoard(d.payload);
      if (d.type === 'config') {
        Object.assign(CFG.BOARD, d.payload.BOARD || {});
        if ('DEBUG_HOTSPOTS' in d.payload) CFG.DEBUG_HOTSPOTS = d.payload.DEBUG_HOTSPOTS;
        if ('SKILL_SCALE'    in d.payload) CFG.SKILL_SCALE    = d.payload.SKILL_SCALE;
        buildHotspots();
      }
    });

    // Plateau de démonstration au démarrage.
    // Identifiants de démonstration : remplacés par de vrais TemplateId dès
    // que l'outil de calibrage en pousse, ou par les fiches réelles en ligne.
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

  /* --- démarrage ------------------------------------------------------ */

  ajusterEchelle();
  construireSelecteur();
  majSelecteur();
  buildHotspots();

  versionPrete = chargerVersion();
  if (DEV) connectDev(); else connectTwitch();
})();
