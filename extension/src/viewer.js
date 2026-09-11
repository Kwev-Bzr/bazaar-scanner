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

  /* Bascule vers une autre langue. Les trois caches sont vidés : les fiches,
     les requêtes en cours et les paquets téléchargés, ces derniers étant
     indexés par langue. Commune aux deux chemins qui changent de langue. */
  function appliquerLangue(l) {
    langue = l;
    appliquerLangueAuRendu();

    /* Les libellés du menu sont posés à sa construction : il faut le refaire
       pour qu'ils suivent la nouvelle langue. */
    if (elOptions) {
      var etaitVisible = elOptions.classList.contains('visible');
      construireOptions();
      if (etaitVisible) elOptions.classList.add('visible');
    }

    // Le rappel affiché se retraduit sur place.
    
    if (tutoEnCours) montrerTuto(true);

    // L'infobulle du globe est traduite elle aussi.
    if (elLangues) {
      var b = elLangues.querySelector('button.globe');
      if (b) b.title = trad(TITRE_GLOBE) + ' / Language';
    }
    cache.clear();
    inflight.clear();
    paquets.clear();
    prechargerTout();
    if (hovered) paint(hovered.id, hovered.talent);
  }

  function changerLangue(l) {
    if (l === langue || languesDisponibles().indexOf(l) < 0) return;
    memoriserLangue(l);
    appliquerLangue(l);

    // Le rappel reparaît une fois, dans la langue qu'il vient de choisir.
    peutEtreTuto('bazaar-tuto-langue');
  }

  var elCard     = document.getElementById('card');

  var elHotspots = document.getElementById('hotspots');

  // Ce qui fait face au joueur : plateau adverse, boutique, événement, ou
  // réserve quand elle est ouverte.
  var enFace = [], faceTalents = [], faceCentree = false;
  var elStatus   = document.getElementById('status');
  var elRoot     = document.getElementById('root');

  var elPanel    = document.getElementById('card-panel');

  /* Mode d'affichage de la fiche : au curseur, ou dans un coin fixe.

     Le STREAMER le choisit, et son choix arrive dans le message. Le SPECTATEUR
     pourra le remplacer depuis son menu Options — son réglage vit dans son
     navigateur et l'emporte, comme pour la langue. */
  var SUIVI_CURSEUR = false;

  function appliquerMode() {
    /* Le spectateur peut choisir le curseur ou l'un des deux coins ; à défaut,
       c'est le réglage du streamer qui s'applique. */
    var voulu = modeMemorise() || coin;
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

  /* Corps du texte : le streamer donne le défaut, le spectateur le remplace. */
  var TAILLES = ['s', 'm', 'l'];
  var tailleStreamer = 'm';

  /* Teinte de la fiche : un choix purement personnel, qui ne concerne donc que
     le spectateur — le streamer n'a rien à dire sur les goûts de son public. */
  var THEMES = ['noir', 'bleu', 'rouge', 'violet', 'miel', 'emeraude'];

  function appliquerTheme() {
    var t = memoire('bazaar-theme-fiche');
    if (THEMES.indexOf(t) >= 0) elRoot.setAttribute('data-theme', t);
    else elRoot.removeAttribute('data-theme');
  }

  function appliquerTaille() {
    var t = tailleMemorisee() || tailleStreamer;
    if (TAILLES.indexOf(t) < 0) t = 'm';
    if (t === 'm') elRoot.removeAttribute('data-taille');
    else elRoot.setAttribute('data-taille', t);
    ajusterEchelle();
  }

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

  /* Coin d'affichage de la fiche : haut gauche ou haut droite. Transmis avec le
     plateau — c'est une préférence de mise en scène, propre à chaque chaîne,
     pas un réglage du spectateur.

     Le bas est exclu : les contrôles de Twitch y apparaissent au survol. */
  // « curseur » n'est pas un coin, mais il arrive par le même champ : sans lui
  // dans cette liste, le message serait rejeté et le mode retomberait en 'hg'.
  var COINS = ['hg', 'hd', 'curseur'];
  var coin = 'hg';

  function appliquerCoin() {
    if (coin === 'hg' || coin === 'curseur') elRoot.removeAttribute('data-coin');
    else elRoot.setAttribute('data-coin', coin);

    /* L'origine de la mise à l'échelle est posée EN LIGNE, pas en CSS : la
       feuille engendrée depuis overlay.html en fixe une, et selon l'ordre de
       chargement elle l'emportait.

       Sans cela, la carte se réduisait depuis son coin gauche : sa boîte
       gardait 483 px de large alors que la carte visible en faisait moins, et
       la différence apparaissait comme une marge droite deux fois trop grande. */
    if (elCard) elCard.style.transformOrigin = (coin === 'hd') ? 'top right' : 'top left';
  }

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

  /* Le corps du texte passe par cette mise à l'échelle : la feuille engendrée
     fixe ses tailles en pixels, un « font-size » hérité n'y changerait rien. */
  var FACTEUR_TAILLE = { s: 0.85, m: 1, l: 1.2 };

  function ajusterEchelle() {
    if (!elCard) return;
    var t = elRoot.getAttribute('data-taille') || 'm';
    var facteur = (window.innerWidth / LARGEUR_REFERENCE)
                * (CFG.CARD_SCALE || 1)
                * (FACTEUR_TAILLE[t] || 1);
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

  /* Trois catalogues : objets, talents et rencontres — marchands,
     adversaires, choix d'événement. On passe le nom plutôt qu'un booléen,
     qui n'en distinguerait que deux. */
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
        // Un paquet manquant ne doit pas rester en cache : la langue suivante
        // doit pouvoir être tentée, et un rechargement doit pouvoir réussir.
        paquets.delete(k);
        throw e;
      });

    paquets.set(k, promesse);
    return promesse;
  }

  function fetchCard(id, estTalent, estRencontre) {
    var catalogue = catalogueDe(estTalent, estRencontre);
    var k = cle(id);
    if (cache.has(k) || inflight.has(k)) return;
    inflight.add(k);
    var langueDemandee = langue;

    function essayer(langues) {
      if (!langues.length) return Promise.reject(new Error('épuisé'));
      var l = langues[0];
      return chargerPaquet(l, catalogue, id)
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
          if (hovered.combat) show(id, false, true, hovered.combat);
          else paint(id, hovered.talent);
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
  /* Les zones sont réutilisées d'un message à l'autre, jamais détruites :
     retirer du DOM l'élément sous la souris déclencherait « mouseleave » et
     fermerait la fiche. La bande d'en face étant réécrite chaque seconde en
     combat, la reconstruction serait constamment visible. */
  var zonesExistantes = {};   // étiquette → élément
  var zonesVues = null;       // étiquettes utilisées par le message courant

  function zone(gauche, haut, largeur, hauteur, id, etiquette, estTalent,
                estRencontre, combat, effetEmplacement) {
    var el = zonesExistantes[etiquette];
    if (el) {
      // Même emplacement : on met à jour sans toucher au DOM alentour.
      zonesVues[etiquette] = 1;
      el.style.left   = versX(gauche) + '%';
      el.style.top    = versY(haut) + '%';
      el.style.width  = versLargeur(largeur) + '%';
      el.style.height = versHauteur(hauteur) + '%';
      el.__id = id;
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
    // Les écouteurs lisent la carte COURANTE de la zone, pas celle qu'elle
    // portait à sa création : une zone réutilisée reste juste.
    el.addEventListener('mouseenter', function (ev) {
      show(el.__id, el.__talent, el.__rencontre, el.__combat, el.__socket);
      suivre(ev);
    });

    /* La fiche suit le pointeur tant qu'il reste sur la zone : sans cela elle
       resterait figée là où il est entré, et masquerait ce qu'il survole
       ensuite. */
    el.addEventListener('mousemove', suivre);
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
    zonesVues = {};

    // ── Objets : une bande régulière de N cases ──────────────────────────
    var B = CFG.BOARD;
    var slotW = B.width / B.slots;

    board.forEach(function (it) {
      zone(B.left + it.s * slotW, B.top, slotW * (it.n || 1), B.height,
           it.id, 'O' + it.s, false, false, null, it.se || null);
    });

    /* ── En face : plateau adverse, boutique, événement ou réserve ────────

       Ces cartes occupent une bande de dix emplacements, de même étendue
       horizontale que le plateau du joueur — seule la hauteur diffère.

       Deux régimes, selon la situation :

       • plateau adverse et réserve suivent réellement les emplacements ;
       • une boutique CENTRE ses cartes tout en les numérotant 0, 1, 2. Pour
         elle seule, l'abscisse voyage dans le message, et une carte de
         rencontre — le portrait de l'adversaire, un choix d'événement — vit
         plus haut, dans sa propre bande. */
    /* Une rencontre porte sa propre étiquette : elle est numérotée sur les
       mêmes emplacements que les objets, et les deux se confondraient. */
    var etiquetteDe = function (it) {
      return (it.r ? 'FR' : 'F') + it.s;
    };

    var C = CFG.CARTES;
    if (C && enFace.length) {
      var slotC = C.width / C.slots;
      enFace.forEach(function (it) {
        var R = it.r ? CFG.RENCONTRE : null;      // rencontre : bande du dessus
        var haut = R ? R.top : C.top;
        var hauteur = R ? R.height : C.height;

        // Une rencontre porte toujours sa position, même en combat.
        if (typeof it.x === 'number' && (faceCentree || it.r)) {
          // Le jeu donne le CENTRE : on décale d'une demi-largeur.
          var larg = (typeof it.w === 'number') ? it.w : slotC * (it.n || 1);

          /* La hauteur réelle l'emporte sur la bande fixe quand elle est
             transmise : trois choix d'événement se disposent en quinconce, et
             aucune bande ne peut les décrire tous les trois. */
          var hy = (typeof it.y === 'number') ? it.y : null;
          var hh = (typeof it.h === 'number') ? it.h : hauteur;
          var top = (hy !== null) ? hy - hh / 2 : haut;

          zone(it.x - larg / 2, top, larg, hh, it.id, etiquetteDe(it),
               it.k === 's', it.k === 'e',
               it.vs ? { vs: it.vs, nm: it.nm } : null);
        } else {
          zone(C.left + it.s * slotC, haut, slotC * (it.n || 1), hauteur,
               it.id, etiquetteDe(it), it.k === 's', it.k === 'e',
               it.vs ? { vs: it.vs, nm: it.nm } : null);
        }
      });
    }

    /* ── Talents de l'adversaire ──────────────────────────────────────────

       Deux dispositions, deux règles.

       Jusqu'à cinq talents, ils forment deux triangles dont le milieu est plus
       bas : cette forme est CONSERVÉE en face, simplement remontée. Une
       symétrie l'inverserait et placerait le milieu plus haut.

       Au-delà, ils s'organisent en rangées ; là, c'est bien une symétrie
       axiale : la rangée du haut chez le joueur devient celle du bas chez
       l'adversaire. */
    if (faceTalents.length) {
      var da = dispositionTalents(faceTalents.length);
      var fa = CFG.SKILL_SCALE || 1;
      var wa = da.w * fa, ha = da.h * fa;
      var parRangees = (da !== (CFG.SKILL_LAYOUTS || [])[0]);

      faceTalents.forEach(function (sk) {
        var pa = da.slots[sk.s];
        if (!pa) return;
        var y = parRangees
          ? (100 - pa[1])
          : (pa[1] - CFG.TALENTS_ADVERSES_DECALAGE);
        zone(pa[0] - wa / 2, y - ha / 2, wa, ha, sk.id, 'FT' + sk.s, true);
      });
    }

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

    /* Les zones devenues inutiles sont retirées — une carte vendue, une
       boutique quittée. Celles qui restent n'ont pas bougé du DOM, donc le
       survol en cours n'est pas interrompu. */
    Object.keys(zonesExistantes).forEach(function (cle) {
      if (zonesVues[cle]) return;
      var mort = zonesExistantes[cle];
      if (mort.parentNode) mort.parentNode.removeChild(mort);
      delete zonesExistantes[cle];
    });

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
    // Plus de taille en pixels : la feuille de style la fait suivre le bouton.
    '<svg viewBox="0 0 24 24" fill="none" ' +
    'stroke="currentColor" stroke-width="1.35">' +
    '<circle cx="12" cy="12" r="9"/>' +
    '<ellipse cx="12" cy="12" rx="4" ry="9"/>' +
    '<path d="M3.2 9h17.6M3.2 15h17.6"/></svg>';

  /* --- première visite --------------------------------------------------
     Un spectateur qui arrive ignore que l'extension existe. Une indication
     discrète le lui apprend, une fois.

     Elle REPARAÎT au premier changement de langue : montrée en anglais à
     quelqu'un qui lit le coréen, elle n'aurait rien appris, et il n'aurait pas
     eu le temps de changer de langue avant qu'elle ne disparaisse. */

  var TUTO = {
    fr: ['Survole une carte pour voir sa description.',
         'Personnalise l\u2019affichage avec le menu, en bas à droite.',
         'Change de langue avec le globe, juste en dessous.'],
    en: ['Hover a card to see its description.',
         'Customize the display with the menu button, bottom right.',
         'Change language with the globe, just below it.'],
    de: ['Fahre über eine Karte, um ihre Beschreibung zu sehen.',
         'Passe die Anzeige über das Menü unten rechts an.',
         'Wechsle die Sprache über den Globus direkt darunter.'],
    es: ['Pasa el cursor sobre una carta para ver su descripción.',
         'Personaliza la visualización con el menú, abajo a la derecha.',
         'Cambia de idioma con el globo, justo debajo.'],
    it: ['Passa il cursore su una carta per vederne la descrizione.',
         'Personalizza la visualizzazione con il menu, in basso a destra.',
         'Cambia lingua con il globo, subito sotto.'],
    pt: ['Passa o cursor sobre uma carta para ver a descrição.',
         'Personaliza a exibição no menu, em baixo à direita.',
         'Muda de idioma no globo, logo abaixo.'],
    ko: ['카드에 마우스를 올리면 설명이 표시됩니다.',
         '오른쪽 아래 메뉴 버튼에서 표시 방식을 원하는 대로 바꿀 수 있습니다.',
         '바로 아래 지구본에서 언어를 바꿀 수 있습니다.'],
    zh: ['将鼠标移到卡牌上即可查看说明。',
         '右下角的菜单按钮可以自定义显示方式。',
         '齿轮下方的地球图标可以切换语言。'],
  };

  var TUTO_MS = 7000;
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

    var lignes = document.createElement('div');
    lignes.className = 'lignes';
    (trad(TUTO) || []).forEach(function (t) {
      var l = document.createElement('div');
      l.textContent = t;
      lignes.appendChild(l);
    });
    elTuto.appendChild(lignes);

    // Une croix pour l'écarter tout de suite, plutôt que d'attendre.
    var croix = document.createElement('button');
    croix.type = 'button';
    croix.className = 'fermer';
    croix.textContent = '\u00D7';
    croix.title = 'OK';
    croix.addEventListener('click', function (ev) {
      ev.stopPropagation();
      cacherTuto();
    });
    elTuto.appendChild(croix);

    elTuto.classList.add('visible');
    if (tutoMinuteur) clearTimeout(tutoMinuteur);
    tutoMinuteur = setTimeout(cacherTuto, TUTO_MS);
  }

  function cacherTuto() {
    if (tutoMinuteur) { clearTimeout(tutoMinuteur); tutoMinuteur = null; }
    if (elTuto) elTuto.classList.remove('visible');
    tutoEnCours = false;
  }

  /* Deux occasions, et deux seulement : la toute première visite, puis le
     premier changement de langue. */
  function peutEtreTuto(cle) {
    if (memoire(cle)) return;
    retenir(cle, '1');
    montrerTuto();
  }

  /* --- menu du spectateur ----------------------------------------------
     Une roue crantée au-dessus du globe. Elle ouvre deux réglages : où la
     fiche s'affiche, et le corps de son texte.

     Le streamer donne les défauts ; ce que le spectateur choisit ici vit dans
     son navigateur et l'emporte. « Auto » revient au choix du streamer. */

  var elOptions = null;

  /* Trois lignes plutôt qu'une roue crantée : le jeu en affiche déjà une, tout
     près, et les deux se confondaient. */
  var ROUE =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
    'stroke-width="1.9" stroke-linecap="round">' +
    '<path d="M4.5 7.5h15M4.5 12h15M4.5 16.5h15"/></svg>';

  var LIB_OPTIONS = {
    fr: { place: 'Emplacement', taille: 'Taille du texte', auto: 'Défaut',
          curseur: 'Souris', hg: 'Coin sup. gauche', hd: 'Coin sup. droit',
          s: 'Petit', m: 'Moyen', l: 'Grand', tuto: 'Revoir l\u2019aide' },
    en: { place: 'Placement', taille: 'Text size', auto: 'Default',
          curseur: 'Cursor', hg: 'Top left', hd: 'Top right',
          s: 'Small', m: 'Medium', l: 'Large', tuto: 'Show help again' },
    de: { place: 'Position', taille: 'Schriftgröße', auto: 'Standard',
          curseur: 'Maus', hg: 'Oben links', hd: 'Oben rechts',
          s: 'Klein', m: 'Mittel', l: 'Groß', tuto: 'Hilfe erneut zeigen' },
    es: { place: 'Posición', taille: 'Tamaño', auto: 'Predeterminado',
          curseur: 'Cursor', hg: 'Arriba izq.', hd: 'Arriba dcha.',
          s: 'Pequeño', m: 'Medio', l: 'Grande', tuto: 'Ver la ayuda' },
    it: { place: 'Posizione', taille: 'Dimensione', auto: 'Predefinito',
          curseur: 'Cursore', hg: 'In alto a sx', hd: 'In alto a dx',
          s: 'Piccolo', m: 'Medio', l: 'Grande', tuto: 'Rivedi l\u2019aiuto' },
    pt: { place: 'Posição', taille: 'Tamanho', auto: 'Padrão',
          curseur: 'Cursor', hg: 'Sup. esquerdo', hd: 'Sup. direito',
          s: 'Pequeno', m: 'Médio', l: 'Grande', tuto: 'Ver a ajuda' },
    ko: { place: '위치', taille: '글자 크기', auto: '기본값',
          curseur: '마우스', hg: '왼쪽 위', hd: '오른쪽 위',
          s: '작게', m: '보통', l: '크게', tuto: '도움말 다시 보기' },
    zh: { place: '位置', taille: '字号', auto: '默认',
          curseur: '鼠标', hg: '左上角', hd: '右上角',
          s: '小', m: '中', l: '大', tuto: '再次显示提示' },
  };

  var TITRE_GLOBE = {
    fr: 'Langue', en: 'Language', de: 'Sprache', es: 'Idioma',
    it: 'Lingua', pt: 'Idioma', ko: '언어', zh: '语言',
  };

  var TITRE_OPTIONS = {
    fr: 'Options', en: 'Options', de: 'Optionen', es: 'Opciones',
    it: 'Opzioni', pt: 'Opções', ko: '설정', zh: '设置',
  };

  /* « Alba » et « Pulsar » sont des noms propres et restent intacts ; le reste
     se traduit. « Alba » est un hommage : le traduire le ferait disparaître. */
  /* Six teintes, traduites. Seul « Alba » traverse les langues intact : c'est
     un prénom, et le traduire le ferait disparaître. */
  var LIB_THEMES = {
    fr: { titre: 'Couleur', noir: 'Noir de Poix', bleu: 'Bleu de Minuit',
          rouge: 'Passion Cramoisie', violet: 'Pulsar Violet',
          miel: 'Miel d\u2019Alba', emeraude: 'Émeraude Profonde' },
    en: { titre: 'Colour', noir: 'Pitch Black', bleu: 'Midnight Blue',
          rouge: 'Crimson Passion', violet: 'Purple Pulsar',
          miel: 'Honey Alba', emeraude: 'Deep Emerald' },
    de: { titre: 'Farbe', noir: 'Pechschwarz', bleu: 'Mitternachtsblau',
          rouge: 'Karmesinrote Leidenschaft', violet: 'Violetter Pulsar',
          miel: 'Alba-Honig', emeraude: 'Tiefes Smaragd' },
    es: { titre: 'Color', noir: 'Negro Azabache', bleu: 'Azul Medianoche',
          rouge: 'Pasión Carmesí', violet: 'Púrpura Pulsar',
          miel: 'Miel de Alba', emeraude: 'Esmeralda Profunda' },
    it: { titre: 'Colore', noir: 'Nero Pece', bleu: 'Blu Mezzanotte',
          rouge: 'Passione Cremisi', violet: 'Pulsar Viola',
          miel: 'Miele di Alba', emeraude: 'Smeraldo Profondo' },
    pt: { titre: 'Cor', noir: 'Negro Profundo', bleu: 'Azul da Meia-Noite',
          rouge: 'Paixão Carmesim', violet: 'Pulsar Roxo',
          miel: 'Mel de Alba', emeraude: 'Esmeralda Profunda' },
    ko: { titre: '색상', noir: '칠흑', bleu: '한밤의 파랑',
          rouge: '진홍의 열정', violet: '보랏빛 펄사',
          miel: 'Alba의 꿀', emeraude: '깊은 에메랄드' },
    zh: { titre: '颜色', noir: '漆黑', bleu: '午夜蓝',
          rouge: '绯红激情', violet: '紫色脉冲星',
          miel: 'Alba 之蜜', emeraude: '深邃翠绿' },
  };

  function libTheme(cle) {
    var t = LIB_THEMES[langue] || LIB_THEMES.en;
    return t[cle] || LIB_THEMES.en[cle];
  }

  function libOpt(cle) {
    var t = LIB_OPTIONS[langue] || LIB_OPTIONS.en;
    return t[cle] || LIB_OPTIONS.en[cle];
  }

  function construireOptions() {
    if (elOptions) { elOptions.remove(); elOptions = null; }

    elOptions = document.createElement('div');
    elOptions.id = 'viewer-options';

    var bouton = document.createElement('button');
    bouton.type = 'button';
    bouton.className = 'roue';
    bouton.innerHTML = ROUE;
    bouton.title = trad(TITRE_OPTIONS);
    bouton.addEventListener('click', function (ev) {
      ev.stopPropagation();
      elOptions.classList.toggle('deplie');
    });
    elOptions.appendChild(bouton);

    var panneau = document.createElement('div');
    panneau.className = 'menu';

    panneau.appendChild(groupeOptions(libOpt('place'), 'bazaar-mode-fiche',
      [['', libOpt('auto')], ['curseur', libOpt('curseur')],
       ['hg', libOpt('hg')], ['hd', libOpt('hd')]],
      function () { appliquerMode(); }));

    panneau.appendChild(groupeOptions(libOpt('taille'), 'bazaar-taille-fiche',
      [['', libOpt('auto')], ['s', libOpt('s')], ['m', libOpt('m')], ['l', libOpt('l')]],
      function () { appliquerTaille(); }));

    panneau.appendChild(groupeOptions(libTheme('titre'), 'bazaar-theme-fiche',
      [['', libOpt('auto')], ['noir', libTheme('noir')], ['bleu', libTheme('bleu')],
       ['rouge', libTheme('rouge')], ['violet', libTheme('violet')],
       ['miel', libTheme('miel')], ['emeraude', libTheme('emeraude')]],
      function () { appliquerTheme(); }));

    // Revoir le rappel : utile à qui l'a écarté trop vite.
    var gTuto = document.createElement('div');
    gTuto.className = 'groupe';
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
    gTuto.appendChild(bTuto);
    panneau.appendChild(gTuto);

    elOptions.appendChild(panneau);
    elRoot.appendChild(elOptions);
    return elOptions;
  }

  function groupeOptions(titre, cle, choix, apres) {
    var g = document.createElement('div');
    g.className = 'groupe';

    var t = document.createElement('div');
    t.className = 'titre';
    t.textContent = titre;
    g.appendChild(t);

    choix.forEach(function (paire) {
      var b = document.createElement('button');
      b.type = 'button';
      b.textContent = paire[1];
      b.dataset.valeur = paire[0];
      b.classList.toggle('actif', (memoire(cle) || '') === paire[0]);
      b.addEventListener('click', function (ev) {
        ev.stopPropagation();
        // « Auto » efface le choix : le réglage du streamer reprend la main.
        if (paire[0]) retenir(cle, paire[0]);
        else { try { window.localStorage.removeItem(cle); } catch (e) { /* refusé */ } }
        [].forEach.call(g.querySelectorAll('button'), function (autre) {
          autre.classList.toggle('actif', autre === b);
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
    /* Traduit, avec « Language » en repli : le mot anglais reste reconnaissable
       pour un spectateur tombé sur une langue qu'il ne lit pas. */
    bouton.title = trad(TITRE_GLOBE) + ' / Language';
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
  function montrerOptions(visible) {
    var el = elOptions || construireOptions();
    el.classList.toggle('visible', !!visible);
    if (!visible) el.classList.remove('deplie');
  }

  function montrerSelecteur(visible) {
    if (!elLangues) return;
    elLangues.classList.toggle('visible', !!visible);
    if (!visible) elLangues.classList.remove('deplie');
  }

  /* --- affichage ------------------------------------------------------ */

  /* Fiche de repli : un TITRE et un CORPS distincts.

     « showError » posait le message entier en guise de titre et imposait un
     corps sans rapport. On compose donc les deux nous-mêmes, ici plutôt que
     dans le fichier engendré, qui serait écrasé à la prochaine construction. */
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

  /* En PVP, le jeu ne donne pas le pseudonyme de l'adversaire : « Viper » est
     le nom interne de la rencontre, pas celui du joueur. Mieux vaut dire de
     quoi il s'agit que d'afficher un nom trompeur. */
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

  function trad(table) { return table[langue] || table.en; }

  /* Affiche une fiche minimale : un titre, une ligne de texte.
     Sert au repli comme aux rencontres sans description publiée. */
  function ficheSimple(titre, texte) {
    if (typeof window.showError !== 'function') return;
    window.showError(titre);

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

  /* Placement de la fiche AU CURSEUR.

     Elle se pose en bas à droite du pointeur, et bascule de l'autre côté quand
     elle dépasserait — à droite près du bord, vers le haut près du bas. Le
     calcul se fait après le rendu, la taille de la fiche dépendant de son
     contenu. */
  var DECALAGE = 14;              // pixels entre le curseur et la fiche
  var dernierPointeur = null;     // pour replacer la fiche après son rendu

  function suivre(ev) {
    if (!SUIVI_CURSEUR) return;
    var r = elRoot.getBoundingClientRect();
    dernierPointeur = { x: ev.clientX - r.left, y: ev.clientY - r.top };
    placerAuCurseur(dernierPointeur.x, dernierPointeur.y);
  }

  function placerAuCurseur(x, y) {
    if (!SUIVI_CURSEUR || !elPanel) return;

    var cadreR = elRoot.getBoundingClientRect();

    /* On mesure la CARTE, pas le panneau : la carte est réduite par une
       transformation, tandis que le panneau garde sa taille de mise en page —
       483 px de large. */
    var f = (elCard || elPanel).getBoundingClientRect();

    /* Le sens vertical suit la moitié d'écran survolée : la fiche couvre
       ainsi la zone vide plutôt que le plateau. */
    var versLeHaut = (y > cadreR.height / 2);
    var ly = versLeHaut ? (y - DECALAGE - f.height) : (y + DECALAGE);

    // À défaut de place dans le sens voulu, on prend l'autre.
    if (ly < 0) ly = y + DECALAGE;
    if (ly + f.height > cadreR.height) ly = Math.max(0, y - DECALAGE - f.height);

    /* L'horizontale, elle, reste à DROITE par défaut : on ne bascule à gauche
       que faute de place. */
    var lx = x + DECALAGE;
    if (lx + f.width > cadreR.width) lx = Math.max(0, x - DECALAGE - f.width);

    elPanel.style.transform = 'translate(' + Math.round(lx) + 'px,'
                                          + Math.round(ly) + 'px)';
  }

  function show(id, estTalent, estRencontre, combat, effetEmplacement) {
    hovered = { id: id, talent: !!estTalent, rencontre: !!estRencontre,
                combat: combat || null, socket: effetEmplacement || null };

    /* Un combat se compose sur place : « PVP » ou « PVE » en titre, le nom de
       l'adversaire dessous. Rien à chercher au catalogue, ces cartes n'y sont
       pas — et « Inconnu » n'apprenait rien au spectateur. */
    if (combat) {
      elPanel.classList.remove('hidden');

      if (combat.vs === 'pvp') {
        ficheSimple('PVP', trad(AUTRE_JOUEUR));
        return;
      }

      /* En PVE, le nom du monstre est publié et TRADUIT dans le catalogue des
         rencontres. Le nom transmis par l'application reste en anglais : on ne
         s'en sert qu'en attendant la fiche. */
      var fiche = cache.get(cle(id));
      ficheSimple('PVE', (fiche && fiche.name) || combat.nm || '');
      if (!fiche) fetchCard(id, false, true);
      return;
    }

    fetchCard(id, estTalent, estRencontre);
    paint(id, estTalent);
  }

  function paint(id, estTalent) {
    var card = cache.get(cle(id));

    // Le sélecteur doit rester accessible même quand la fiche manque, sinon on
    // ne pourrait pas repasser dans l'autre langue depuis une carte absente.
    function afficher() {
      elPanel.classList.remove('hidden');

      /* La fiche change de taille selon son contenu : sans ce replacement, la
         bascule près des bords se calculerait sur l'ancienne taille et la
         fiche déborderait du lecteur. */
      if (SUIVI_CURSEUR && dernierPointeur) {
        placerAuCurseur(dernierPointeur.x, dernierPointeur.y);
      }
    }

    if (!cache.has(cle(id))) {          // fiche pas encore arrivée
      afficher();
      return;
    }
    if (card === null) {                // fiche introuvable
      // Aucune fiche publiée pour cette carte : on le dit plutôt que de
      // laisser croire à une panne.
      ficheSimple(trad(INCONNU), trad(INDISPONIBLE));
      afficher();
      return;
    }

    // On complète la fiche statique avec ce que seul l'état du plateau sait :
    // la qualité réellement possédée et l'enchantement réellement appliqué.
    var source = estTalent ? skills : board;
    var live = source.filter(function (i) { return i.id === id; })[0] || {};

    window.showItem(Object.assign({ found: true }, card, {
      // Effet de l'emplacement occupé, quand il y en a un.
      socketEffect:        hovered && hovered.socket,
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
    enFace.forEach(function (it) {
      if (it.vs) return;                 // combat : composé sur place
      fetchCard(it.id, it.k === 's', it.k === 'e');
    });
    faceTalents.forEach(function (sk) { fetchCard(sk.id, true); });
  }

  /* --- réception de l'état du plateau --------------------------------- */

  /* --- retard anti-divulgation -----------------------------------------

     Le flux vidéo arrive chez le spectateur avec quelques secondes de retard,
     alors que le message du streamer, lui, est immédiat. Sans attendre,
     l'extension révélerait le plateau avant que la vidéo ne le montre.

     Deux secondes suffisent d'ordinaire. Le DÉBUT d'un combat PVP demande
     davantage : y découvrir le plateau adverse en avance gâcherait la
     rencontre. Les messages sont donc mis en file et appliqués dans l'ordre,
     chacun à son échéance. */

  var RETARD_MS = (CFG.RETARD_MS !== undefined) ? CFG.RETARD_MS : 2000;
  var RETARD_PVP_MS = (CFG.RETARD_PVP_MS !== undefined) ? CFG.RETARD_PVP_MS : 10000;

  /* Le message le plus récent est retenu, puis appliqué dès qu'il a l'âge
     voulu. Un examen périodique remplace la chaîne de minuteurs : celle-ci
     reportait l'échéance de chaque message sur le précédent, si bien qu'avec
     un message par seconde le retard s'allongeait indéfiniment.

     Ici rien ne s'accumule — un message plus frais remplace simplement celui
     qui attendait, et l'affichage reste exactement en retard du délai voulu. */

  var enAttente = null;          // { msg, echeance }
  var horlogeRetard = null;
  var pvpPrecedent = false;

  /* Le long délai se déclenche quand le PLATEAU ADVERSE apparaît, pas quand
     le portrait s'affiche.

     Le portrait est visible dès la sélection de l'adversaire, bien avant le
     combat : compter à partir de là laissait le délai s'écouler avant que les
     objets ne se révèlent. Ce sont eux qu'il s'agit de retenir. */
  function plateauAdverse(msg) {
    if (!msg || !Array.isArray(msg.f)) return false;
    var pvp = msg.f.some(function (it) { return it.vs === 'pvp'; });
    var objets = msg.f.some(function (it) { return !it.r; });
    return pvp && objets;
  }

  function recevoir(msg) {
    if (!msg || !Array.isArray(msg.b)) return;

    var pvp = plateauAdverse(msg);
    var debutPvp = pvp && !pvpPrecedent;
    pvpPrecedent = pvp;

    var retard = debutPvp ? RETARD_PVP_MS : RETARD_MS;
    if (!retard) { applyBoard(msg); return; }

    /* L'échéance du message EN ATTENTE ne bouge pas : seul son contenu est
       remplacé par le plus frais. La reporter à chaque arrivée l'éloignait
       indéfiniment, puisque les messages arrivent plus vite que le délai. */
    if (enAttente) enAttente.msg = msg;
    else enAttente = { msg: msg, echeance: Date.now() + retard };

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

  function applyBoard(msg) {
    if (!msg || !Array.isArray(msg.b)) return;
    board  = msg.b;
    skills = Array.isArray(msg.k) ? msg.k : [];

    /* Les rangées d'en face, absentes du message la plupart du temps.

       « f » sert tour à tour au plateau adverse, à la boutique et aux choix
       d'événement ; « r » à la réserve. Les deux occupent la MÊME bande à
       l'écran, le panneau de la réserve recouvrant le plateau d'en face : on
       n'en affiche donc jamais qu'une, la réserve l'emportant. */
    var reserve = Array.isArray(msg.r) ? msg.r : [];
    enFace       = reserve.length ? reserve : (Array.isArray(msg.f) ? msg.f : []);
    faceCentree  = !reserve.length && !!msg.fc;
    faceTalents  = Array.isArray(msg.fk) ? msg.fk : [];

    // Cadre transmis par le streamer, absent tant qu'il n'a pas calibré.
    var c = msg.c;
    cadre = (Array.isArray(c) && c.length === 4 && c[2] > 0 && c[3] > 0)
      ? { l: c[0], t: c[1], w: c[2], h: c[3] }
      : CADRE_PLEIN;

    // Un coin inconnu retombe en haut à gauche plutôt que de casser la mise
    // en page.
    coin = (COINS.indexOf(msg.p) >= 0) ? msg.p : 'hg';
    appliquerCoin();
    appliquerMode();

    tailleStreamer = (TAILLES.indexOf(msg.t) >= 0) ? msg.t : 'm';
    appliquerTaille();
    appliquerTheme();

    buildHotspots();

    // Première visite : on attend d'avoir un plateau, sans quoi le rappel
    // parlerait de cartes qui ne sont pas encore là.
    if (board.length || enFace.length) peutEtreTuto('bazaar-tuto-vu');

    prechargerTout();   // au survol, tout est déjà en mémoire

    /* La fiche se ferme si la carte survolée a quitté le plateau — vendue,
       détruite. Toutes les rangées comptent : en omettre une reviendrait à
       fermer la fiche à chaque message pour les cartes qu'elle contient. */
    var toutes = board.concat(skills, enFace, faceTalents);
    var present = hovered && toutes.some(function (i) {
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
      if ('arePlayerControlsVisible' in ctx) {
        montrerSelecteur(ctx.arePlayerControlsVisible);
        montrerOptions(ctx.arePlayerControlsVisible);
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

  /* --- branchement mode développement --------------------------------- */

  function connectDev() {
    log('mode développement');

    // L'outil de calibrage (dev/harness.html) pilote cette page par postMessage.
    window.addEventListener('message', function (ev) {
      var d = ev.data;
      if (!d || typeof d !== 'object') return;

      // Le harnais de calibrage est local : aucun retard, sans quoi il serait
      // pénible à régler.
      if (d.type === 'board')  applyBoard(d.payload);
      if (d.type === 'config') {
        Object.assign(CFG.BOARD, d.payload.BOARD || {});
        if ('DEBUG_HOTSPOTS' in d.payload) CFG.DEBUG_HOTSPOTS = d.payload.DEBUG_HOTSPOTS;
        if ('SKILL_SCALE'    in d.payload) CFG.SKILL_SCALE    = d.payload.SKILL_SCALE;
        buildHotspots();

    // Première visite : on attend d'avoir un plateau, sans quoi le rappel
    // parlerait de cartes qui ne sont pas encore là.
    if (board.length || enFace.length) peutEtreTuto('bazaar-tuto-vu');
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
