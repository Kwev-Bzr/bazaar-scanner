/* FICHIER GÉNÉRÉ par tools/build-extension.js depuis overlay.html.
   Ne PAS modifier à la main : toute modification sera écrasée.
   Modifie overlay.html puis relance le script. */


// (paramètre de durée retiré : c'est le survol qui pilote l'affichage)

const HERO_PORTRAITS = {
  Pygmalien: window.BAZAAR_CONFIG.DATA_BASE_URL + '/characters/Pyg_Portrait.png',
  Vanessa:   window.BAZAAR_CONFIG.DATA_BASE_URL + '/characters/Vanessa_Portrait.png',
  Stelle:    window.BAZAAR_CONFIG.DATA_BASE_URL + '/characters/Stelle_Portrait.png',
  Dooley:    window.BAZAAR_CONFIG.DATA_BASE_URL + '/characters/Dooley_Portrait.png',
  Jules:     window.BAZAAR_CONFIG.DATA_BASE_URL + '/characters/Jules_Portrait.png',
  Mak:       window.BAZAAR_CONFIG.DATA_BASE_URL + '/characters/Mak_Portrait.png',
  Karnok:    window.BAZAAR_CONFIG.DATA_BASE_URL + '/characters/Karnok_Portrait.png',
  Common:    window.BAZAAR_CONFIG.DATA_BASE_URL + '/characters/Common_Portrait.png',
  Hero8:     window.BAZAAR_CONFIG.DATA_BASE_URL + '/characters/Dragons_Portrait.png',
};
const HERO_INITIAL = { Pygmalien:'P', Vanessa:'V', Stelle:'S', Dooley:'D', Jules:'J', Mak:'M', Karnok:'K', Hero8:'D' };

/* Un héros que la table ne connaît pas - ajouté par une mise à jour du jeu -
   voit son portrait déduit de son nom, comme le fait la recherche. Sans ce
   repli, il faudrait téléverser l'extension à chaque nouveau héros. */
function portraitHeros(nom) {
  if (!nom) return null;
  if (HERO_PORTRAITS[nom]) return HERO_PORTRAITS[nom];
  return window.BAZAAR_CONFIG.DATA_BASE_URL + '/characters/' + nom + '_Portrait.png';
}

/* Les couleurs de rareté, en UN seul endroit. Il en existait trois copies
   dans ce fichier, et une quatrième dans la case réserve, qui ne
   s'accordaient même pas : le bronze valait #e08830 ici, #cd7f32 là.

   Les données publiées peuvent les remplacer, sans téléverser. */
var COULEURS_RARETE_DEFAUT = {
  Bronze: '#a0714f', Silver: '#d0d0d0', Gold: '#f0c060',
  Diamond: '#a8d8f8', Legendary: '#f08040',
};

/* La fiche affichée est celle d'une rencontre (événement, marchand,
   monstre) : sa description s'intitule « Effet », sans filet au-dessus. */
let __rencontre = false;

/* Le palier à montrer seul, en mode « Current » ; nul en mode « Global ». */
let __palier = null;

/* L'avancement réel des quêtes de l'objet affiché, [[avancement, cible], …],
   dans l'ordre de ses quêtes. Nul pour une carte sans exemplaire réel, comme
   une carte cherchée. */
let __avancement = null;

/* Les valeurs que le jeu donne aux jetons de l'exemplaire réel, « a1=6;a1.mod=3 »
   reçu du mod, rendues en { "aura.1": 6, "aura.1.mod": 3 }. */
let __jetons = null;

/* La chance de critique actuelle de l'exemplaire réel, lue par le mod. */
let __crit = null;

/* Le mot du critique, dans la forme que colore déjà la famille kw-crit. */
const MOT_CRIT = {
  fr: 'Chances de Crit', en: 'Crit Chance', de: 'Krit-Chance', es: 'Prob. de crítico',
  it: 'Prob. di critico', pt: 'Chance de crítico', ko: '치명타 확률', zh: '暴击率',
};
function motCrit() {
  const p = publies();
  return (p && p.l && p.l.crit) || MOT_CRIT[langueActive()] || MOT_CRIT.en;
}
let __tierVivant = null;

function lireJetons(texte) {
  if (!texte) return null;
  const r = {};
  String(texte).split(';').forEach(p => {
    const i = p.lastIndexOf('=');
    if (i <= 0) return;
    const cle = p.slice(0, i).replace(/^a/, 'aura.').replace(/^b/, 'ability.');
    const v = parseFloat(p.slice(i + 1));
    if (!isNaN(v)) r[cle] = v;
  });
  return Object.keys(r).length ? r : null;
}

const UNITE_SECONDE = /^\s*(seconds?|secondes?|Sekunden?|segundos?|second[oi]|초|秒)/i;

/* Une valeur de DURÉE (Charge, Slow, Haste, Freeze, délai) : le jeu la donne
   en millisecondes. On la reconnaît à l'icône qui la précède, ou au mot
   « seconde(s) » qui la suit. Une comparaison avec la valeur publiée ne
   suffisait pas : dès que la durée changeait en combat, « Charge 2 »
   devenait « Charge 2000 ». */
const ICONES_DUREE = /#(charge|slow|haste|freeze|cooldown)$/;

function estUneDuree(premier, dernier) {
  const avant = premier.previousSibling;
  if (avant && avant.nodeType === 1 && avant.tagName && avant.tagName.toLowerCase() === 'svg') {
    const use = avant.querySelector && avant.querySelector('use');
    const lien = use && (use.getAttribute('href') || use.getAttribute('xlink:href'));
    if (lien && ICONES_DUREE.test(lien)) return true;
  }
  let suite = dernier.nextSibling;
  if (!suite && dernier.parentNode && /kw-sec/.test(dernier.parentNode.getAttribute('class') || '')) {
    suite = dernier.parentNode.nextSibling;
  }
  if (suite && suite.nodeType === 3 && UNITE_SECONDE.test(suite.nodeValue)) return true;
  /* Le mot accordable, publié dans sa propre balise : « 1 <span data-sg>second</span> ». */
  if (suite && suite.nodeType === 3 && !suite.nodeValue.trim()) suite = suite.nextSibling;
  return !!(suite && suite.nodeType === 1 && UNITE_SECONDE.test(suite.textContent || ''));
}

function formaterNombre(v) {
  return Number.isInteger(v) ? String(v) : String(Math.round(v * 10) / 10);
}

/* Place la valeur du jeu à la place de la valeur publiée, jeton par jeton.
   - un « - » (data-vide), valeur qui dépend de la partie : toujours ;
   - en « Current » : toutes, la valeur du jeu tenant compte de la partie ;
   - en « Global » : seulement les « - » ; les paliers restent. */
function appliquerJetons(racine, jetons) {
  if (!jetons) return;

  /* Sans égard à la casse : le texte du jeu écrit parfois « {custom_0} » quand
     l'attribut s'appelle « Custom_0 ». */
  const parCle = {};
  Object.entries(jetons).forEach(([k, v]) => { parCle[k.toLowerCase()] = v; });

  const vus = new Set();
  {
    for (const debut of Array.from(racine.querySelectorAll('[data-jeton]'))) {
      if (vus.has(debut)) continue;
      const expr = debut.getAttribute('data-jeton');
      const brut = parCle[String(expr).toLowerCase()];
      if (brut === undefined) continue;
      const groupe = [debut];
      let n = debut.nextSibling;
      while (n && n.nodeType === 1 && /sep-palier/.test(n.getAttribute('class') || '')
             && n.nextSibling && n.nextSibling.nodeType === 1
             && n.nextSibling.getAttribute('data-jeton') === expr) {
        groupe.push(n, n.nextSibling);
        n = n.nextSibling.nextSibling;
      }
      groupe.forEach(g => vus.add(g));

      const valeurs = groupe.filter(g => g.hasAttribute('data-jeton'));
      const vide = debut.hasAttribute('data-vide');
      const pourcent = valeurs.some(g => /%/.test(g.textContent));
      let vivant = brut;

      let statique = null;
      if (!vide) {
        const paires = valeurs.map(g => [g.getAttribute('data-tier') || __tierVivant || 'Bronze', g]);
        const p = valeurDuPalier(paires, __tierVivant || paires[0][0]);
        statique = parseFloat(String(p[1].textContent).replace(',', '.'));
        /* Une durée arrive en millisecondes. */
        if (vivant >= 100 && !pourcent
            && (estUneDuree(groupe[0], groupe[groupe.length - 1])
                || (!isNaN(statique) && Math.abs(vivant / 1000 - statique) < 0.01))) vivant /= 1000;
      } else {
        if (vivant >= 100 && estUneDuree(groupe[0], groupe[groupe.length - 1])) vivant /= 1000;
      }

      /* En Global, seules les valeurs à remplir le sont : une valeur
         ordinaire, même augmentée pendant la partie, garde ses paliers. C'est
         l'export qui distingue les valeurs dépendant de la partie, en les
         publiant « - ». En Current, tout prend la valeur du jeu. */
      const remplacer = vide || !!__palier;
      if (!remplacer) continue;

      const b = document.createElement('b');
      b.setAttribute('data-jeton', expr);
      b.setAttribute(debut.hasAttribute('data-compte') ? 'data-compte' : 'data-fixe', '1');
      b.textContent = formaterNombre(vivant) + (pourcent ? '%' : '');
      debut.parentNode.insertBefore(b, groupe[0]);
      groupe.forEach(g => g.remove());
    }
  }
}

function lireAvancement(texte) {
  if (!texte) return null;
  const r = String(texte).split(',').map(x => x.split('/').map(n => parseInt(n, 10) || 0));
  return r.length ? r : null;
}

/* L'ordre des raretés, pour retomber sur le palier inférieur le plus proche
   quand une valeur ne connaît pas exactement celui de l'objet. */
function rangRarete(t) {
  const publiees = window.BAZAAR_RARETES ? Object.keys(window.BAZAAR_RARETES) : [];
  const ordre = publiees.length ? publiees : ['Bronze', 'Silver', 'Gold', 'Diamond', 'Legendary'];
  const i = ordre.indexOf(t);
  return i < 0 ? 99 : i;
}

/* La valeur d'un palier dans une liste [[palier, valeur], …] : le palier
   exact, sinon le plus proche en dessous, sinon le premier. */
function valeurDuPalier(paires, palier) {
  const exact = paires.find(p => p[0] === palier);
  if (exact) return exact;
  const r = rangRarete(palier);
  const dessous = paires.filter(p => rangRarete(p[0]) <= r);
  return dessous.length ? dessous[dessous.length - 1] : paires[0];
}

function couleurDeFamille(fam) {
  return (((window.BAZAAR_LIBELLES || {}).couleurs_mots_cles) || {})[fam] || '';
}

/* La famille du mot-clé auquel appartient un nombre : celle de l'icône qui le
   précède, sinon celle du mot-clé qui le suit ou le précède de près. */
function familleDuNombre(el) {
  /* Un nombre entre crochets, « [6] », ne prend la couleur d'aucun mot-clé
     VOISIN : chez Arms Race, il prenait celle de « Weapon », écrit juste
     avant les crochets. Il ne se colore que si un mot-clé ou une icône figure
     avec lui entre les crochets. */
  const avantTexte = el.previousSibling, apresTexte = el.nextSibling;
  if (avantTexte && avantTexte.nodeType === 3 && /\[\s*$/.test(avantTexte.nodeValue)
      && apresTexte && apresTexte.nodeType === 3 && /^\s*%?\s*\]/.test(apresTexte.nodeValue)) {
    return null;
  }

  let p = el.previousSibling;
  while (p && p.nodeType === 3 && !p.nodeValue.trim()) p = p.previousSibling;
  if (p && p.nodeType === 1) {
    const use = p.querySelector && p.querySelector('use');
    const ref = use ? (use.getAttribute('href') || '') : '';
    const src = p.tagName === 'IMG' ? (p.getAttribute('src') || '') : '';
    const id = ref ? ref.replace(/^#/, '') : (/\/keywords\/([a-z0-9_-]+)\.png/.exec(src) || [])[1];
    const I = window.BAZAAR_ICONE;
    if (id && I && I.familleDeIcone) {
      const f = I.familleDeIcone(id);
      if (f) return f;
    }
  }
  for (const voisin of [el.nextSibling, el.previousSibling]) {
    let v = voisin;
    const sens = voisin === el.nextSibling ? 'nextSibling' : 'previousSibling';
    for (let pas = 0; v && pas < 3; pas++, v = v[sens]) {
      if (v.nodeType === 3 && v.nodeValue.trim().length > 12) break;
      const cls = v.nodeType === 1 && (v.getAttribute('class') || '');
      const m = cls && /^(kw-[a-z0-9-]+)/.exec(cls);
      if (m && m[1] !== 'kw-icon' && m[1] !== 'kw-png') return m[1];
    }
  }
  return null;
}

/* Réduit chaque suite de paliers « 5 > 10 > 20 > 40 » à la valeur du palier
   actuel, colorée comme son mot-clé. */
function ramenerAuPalier(racine, palier) {
  const vus = new Set();
  for (const debut of Array.from(racine.querySelectorAll('span[data-tier]'))) {
    if (vus.has(debut)) continue;

    const suite = [debut];
    let n = debut.nextSibling;
    while (n && n.nodeType === 1 && /sep-palier/.test(n.getAttribute('class') || '')
           && n.nextSibling && n.nextSibling.nodeType === 1 && n.nextSibling.hasAttribute('data-tier')) {
      suite.push(n, n.nextSibling);
      n = n.nextSibling.nextSibling;
    }
    suite.forEach(s => vus.add(s));

    const valeurs = suite.filter(s => s.hasAttribute('data-tier'));
    const choisie = valeurDuPalier(valeurs.map(s => [s.getAttribute('data-tier'), s]), palier)[1];
    suite.forEach(s => { if (s !== choisie) s.remove(); });

    /* Un compte, comme le nombre de cibles, reste blanc : ce n'est pas une
       puissance. Les autres valeurs prennent la couleur de leur mot-clé. */
    choisie.style.color = choisie.hasAttribute('data-compte')
      ? '' : couleurDeFamille(familleDuNombre(choisie));
  }

  /* Les valeurs fixes, la même à tous les paliers, blanches en « Global »,
     prennent elles aussi la couleur de leur mot-clé. */
  for (const b of Array.from(racine.querySelectorAll('b[data-fixe]'))) {
    const c = couleurDeFamille(familleDuNombre(b));
    if (c) b.style.color = c;
  }

  /* Un nombre écrit en toutes lettres n'est coloré que s'il suit DIRECTEMENT
     l'icône d'un mot-clé : « [Ralentissement] 1 second ». Aucun autre nombre
     n'est touché, ni « 1 item », ni une quantité ordinaire. */
  for (const ic of Array.from(racine.querySelectorAll('svg.kw-icon, img.kw-icon'))) {
    const t = ic.nextSibling;
    if (!t || t.nodeType !== 3) continue;
    const m = /^(\s*)([+\-\u2212]?\d[\d,.]*%?)/.exec(t.nodeValue);
    if (!m) continue;

    const nombre = document.createElement('b');
    nombre.textContent = m[2];
    ic.parentNode.insertBefore(nombre, t);
    if (m[1]) ic.parentNode.insertBefore(document.createTextNode(m[1]), nombre);
    t.nodeValue = t.nodeValue.slice(m[0].length);

    const c = couleurDeFamille(familleDuNombre(nombre));
    if (c) nombre.style.color = c;
  }
}

function couleurRarete(tier) {
  var publiees = window.BAZAAR_RARETES;
  return (publiees && publiees[tier]) || COULEURS_RARETE_DEFAUT[tier] || null;
}

/* Une couleur #rrggbb rendue transparente, pour les lueurs. */
function teinteTransparente(hexa, alpha) {
  var m = /^#([0-9a-f]{6})$/i.exec(String(hexa || ''));
  if (!m) return null;
  var n = parseInt(m[1], 16);
  return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + alpha + ')';
}

/* Le cadre de rareté d'une illustration : une bordure et une lueur de sa
   couleur. La feuille de style en garde un repli pour les cinq raretés du
   jeu ; une rareté publiée, ou une couleur corrigée, passe par ici. */
function poserCadreRarete(el, tier, interieure) {
  var c = couleurRarete(tier);
  if (!el || !c) return;
  el.style.borderColor = c;
  var lueur = teinteTransparente(c, 0.5);
  if (lueur) el.style.boxShadow = (interieure ? 'inset ' : '') + '0 0 8px ' + lueur;
}

const ENCHANTMENT_COLORS = {
  Golden:      '#f0c060',
  Heavy:       '#c69c6c',   // même gris-brun que le ralentissement qu'il inflige
  Icy:         '#9fc5e8',
  Turbo:       '#00ffff',
  Shielded:    '#ffff00',
  Restorative: '#00ff00',
  Toxic:       '#38761d',
  Fiery:       '#e69138',
  Shiny:       '#ffffff',
  Deadly:      '#ff0000',
  Radiant:     '#ffffff',
  Obsidian:    '#a335ee',
  Mossy:       '#00ff00',
};

const HIDDEN_TAGS = new Set([
  'RageReference','EconomyReference','Cooldown','Heal','Damage',
  'Shield','Poison','Burn','Freeze','Slow','Haste',
]);

function langueActive() {
  return (typeof window !== 'undefined' && window.BAZAAR_LANGUE) || 'fr';
}

function publies() {
  return (typeof window !== 'undefined' && window.BAZAAR_LIBELLES) || null;
}

function enFrancais() {
  return langueActive() === 'fr';
}

function trad(glossaire, valeur, nomPublie) {
  const p = publies();
  if (p && nomPublie && p[nomPublie] && p[nomPublie][valeur]) {
    return p[nomPublie][valeur];
  }
  if (!enFrancais()) return valeur;
  return glossaire[valeur] || valeur;
}

const LIBELLES = {
  fr: {
    actif: 'Actif', passif: 'Passif', effet: 'Effet', talent: 'Talent',
    delai: 'Délai d\'Activation :', sec: 'sec',
    munitions: 'Munitions', quetes: 'Quêtes', multicast: 'Répétition',
    sansDescription: 'Aucune description.',
    estSur: 'Cet objet est {}', surNotes: 'sur {}',
    uneNote: 'un {}', et: 'et',
  },
  en: {
    actif: 'Active', passif: 'Passive', effet: 'Effect', talent: 'Skill',
    delai: 'Cooldown:', sec: 'sec',
    munitions: 'Ammo', quetes: 'Quests', multicast: 'Multicast',
    sansDescription: 'No description.',
    estSur: 'This item is {}', surNotes: 'on {}',
    uneNote: 'a {}', et: 'and',
  },
};

function lib(cle) {
  const p = publies();
  if (p && p.l && p.l[cle]) return p.l[cle];
  const table = LIBELLES[langueActive()] || LIBELLES.fr;
  return table[cle] || LIBELLES.fr[cle] || cle;
}

/* La couleur d'une étiquette publiée dans presentation.json (« etiquettes ») :
   le texte, un cadre et un fond pâle tirés de la même teinte. Sans couleur
   publiée, rien : la feuille de style garde ses couleurs d'origine. Seul un
   code hexadécimal est accepté, déjà vérifié à la réception. */
function styleEtiquette(c) {
  if (typeof c !== 'string' || !/^#[0-9a-f]{6}$/i.test(c)) return '';
  const n = parseInt(c.slice(1), 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255;
  return ` style="color:${c};border-color:rgba(${r},${g},${b},.55);background:rgba(${r},${g},${b},.12)"`;
}

const TAG_FR = {
  Apparel: 'Accessoire', Aquatic: 'Aquatique', Core: 'Cœur', Dinosaur: 'Dinosaure',
  Dragon: 'Dragon', Drone: 'Drone', Food: 'Nourriture', Friend: 'Ami',
  Loot: 'Butin', Potion: 'Potion', Property: 'Propriété', Ray: 'Rayon',
  Reagent: 'Réactif', Relic: 'Relique', Tech: 'Tech', Tool: 'Outil',
  Toy: 'Jouet', Trap: 'Piège', Vehicle: 'Véhicule', Weapon: 'Arme',
  Instrument: 'Instrument', Merchant: 'Marchand', Burn: 'Brûlure', Poison: 'Poison', Freeze: 'Gel',
  Heal: 'Soin', Shield: 'Bouclier', Regen: 'Régénération', Haste: 'Hâte',
  Slow: 'Ralentissement', Crit: 'Critique', Charge: 'Charge', Economy: 'Économie',
  Flying: 'Volant', Unsellable: 'Invendable',
};
const SIZE_FR = { Small: 'Petit', Medium: 'Moyen', Large: 'Grand' };
const TIER_FR = { Bronze: 'Bronze', Silver: 'Argent', Gold: 'Or', Diamond: 'Diamant', Legendary: 'Légendaire' };

const card        = document.getElementById('card');
const nameEl      = document.getElementById('item-name');
const enchantNameEl = document.getElementById('enchant-name');
const badgesRow   = document.getElementById('badges-row');
const heroPortEl  = document.getElementById('hero-portraits');
const bodyEl      = document.getElementById('item-body');
const itemImgWrap = document.getElementById('item-img-wrap');
const itemImg     = document.getElementById('item-img');
let hideTimer = null;
/* La fiche ne disparaît pas seule au bout de cinq secondes, comme dans
   l'ancien overlay OBS : c'est l'extension qui décide quand la cacher.

   Cette neutralisation s'appelait autrefois « setTimeout ». Déclarée au niveau
   global de la page, elle remplaçait le vrai « setTimeout » pour TOUS les
   scripts, viewer.js compris : le guide ne se fermait plus seul, et d'autres
   minuteries restaient muettes. Elle a désormais son propre nom. */
const sansMinuterie = function () { return 0; };

const ENCHANT_FR = {
  Golden: 'Doré', Heavy: 'Lourd', Icy: 'Glacé', Turbo: 'Turbo',
  Shielded: 'Blindé', Restorative: 'Guérisseur', Toxic: 'Toxique',
  Fiery: 'Ardent', Shiny: 'Brillant', Deadly: 'Mortel',
  Radiant: 'Radieux', Obsidian: 'Obsidienne', Mossy: 'Moussu',
};

function showError(msg) {
  if (hideTimer) clearTimeout(hideTimer);
  nameEl.textContent = msg;
  enchantNameEl.style.display = 'none';
  bodyEl.innerHTML = '<div class="effect-row passive"><span class="effect-arrow">▸</span><div class="tooltip-text">Tapez !commandes dans le chat pour voir la liste des commandes</div></div>';
  badgesRow.innerHTML = '';
  if (statsRow) { statsRow.innerHTML = ''; statsRow.style.display = 'none'; }
  { const entete = badgesRow.closest('.header'); if (entete) entete.classList.remove('avec-stats', 'sans-filet', 'rencontre'); }
  heroPortEl.innerHTML = '';
  delete heroPortEl.dataset.sig;
  const basErreur = document.getElementById('hero-portraits-bottom');
  if (basErreur) basErreur.remove();
  itemImgWrap.style.display = 'none';
  card.classList.remove('hiding');
  card.classList.add('visible');
  hideTimer = sansMinuterie(() => { card.classList.add('hiding'); card.classList.remove('visible'); }, 5000);
}

/* ── Les pastilles du délai et des munitions ────────────────────────────────

   Sous le nom, à côté des tags : une pastille par valeur, avec son icône.
   En « Global », les paliers en couleur de rareté ; en « Current », la valeur
   de l'exemplaire, seule. Elles remplacent les deux encadrés de la partie
   « Active », plus lourds et loin du nom. */
let statsRow = null;

function ligneStats() {
  if (statsRow && statsRow.isConnected) return statsRow;
  statsRow = document.getElementById('stats-row');
  if (!statsRow) {
    statsRow = document.createElement('div');
    statsRow.id = 'stats-row';
    statsRow.className = 'stats-row';
    /* Sur toute la largeur, sous l'en-tête : dans la colonne du nom, serrée
       entre l'illustration et les portraits, les pastilles passaient sur
       plusieurs lignes et étiraient l'en-tête. */
    const entete = badgesRow.closest('.header') || badgesRow.parentNode;
    entete.parentNode.insertBefore(statsRow, entete.nextSibling);
  }
  return statsRow;
}

function nombreStat(n) {
  const v = Number(n);
  if (!isFinite(v)) return esc(String(n));
  return Number.isInteger(v) ? String(v) : (Math.round(v * 10) / 10).toString();
}

function valeursStat(valeur, unite) {
  if (valeur === null || valeur === undefined) return null;
  if (typeof valeur !== 'object') return `<span class="stat-val">${nombreStat(valeur)}${unite}</span>`;
  let entrees = Object.entries(valeur);
  if (!entrees.length) return null;
  if (__palier && entrees.length > 1) entrees = [valeurDuPalier(entrees, __palier)];
  if (entrees.length === 1 || entrees.every(e => String(e[1]) === String(entrees[0][1]))) {
    return `<span class="stat-val">${nombreStat(entrees[0][1])}${unite}</span>`;
  }
  return entrees.map(([tier, v], i) =>
    (i ? '<span class="stat-sep">›</span>' : '')
    + `<span class="stat-val" style="color:${couleurRarete(tier) || '#c0a070'}">${nombreStat(v)}${unite}</span>`).join('');
}

function rendreStats(cooldowns, ammo) {
  const el = ligneStats();
  const parts = [];
  const cd = valeursStat(cooldowns, 's');
  if (cd) parts.push(`<span class="stat-pastille stat-delai" title="${esc(lib('delai'))}"><svg class="stat-icone" viewBox="0 0 18 18"><use href="#cooldown"/></svg><span class="stat-deux-points">:</span>${cd}</span>`);
  const am = valeursStat(ammo, '');
  if (am) parts.push(`<span class="stat-pastille stat-munitions" title="${esc(lib('munitions'))}"><svg class="stat-icone" viewBox="0 0 18 18"><use href="#ammo"/></svg><span class="stat-deux-points">:</span>${am}</span>`);
  el.innerHTML = parts.join('');
  el.style.display = parts.length ? '' : 'none';
  const entete = badgesRow.closest('.header');
  if (entete) entete.classList.toggle('avec-stats', parts.length > 0);
}

function showItem(data) {
  /* Le palier à montrer seul : la rareté actuelle de l'objet, en mode
     « Current ». Une recherche ou une carte sans rareté connue reste en
     « Global ». */
  __palier = (window.BAZAAR_STATS === 'current' && data && data.currentTier && !data.statsGlobales)
    ? data.currentTier : null;
  __avancement = (data && !data.statsGlobales) ? lireAvancement(data.avancementQuetes) : null;
  /* Les valeurs du jeu servent aussi sur une fiche épinglée, qui montre tous
     ses paliers : sans elles, ses « - » (valeurs qui dépendent de la partie)
     restaient vides. appliquerJetons ne remplace alors que ces « - ». Une
     fiche de la recherche n'a pas de valeurs vivantes : rien ne change. */
  __jetons = data ? lireJetons(data.jetonsVivants) : null;
  __tierVivant = (data && data.currentTier) || null;
  __crit = (data && !data.statsGlobales && typeof data.critVivant === 'number') ? data.critVivant : null;
  __rencontre = !!(data && data.isEncounter);
  { const entete = badgesRow.closest('.header'); if (entete) entete.classList.toggle('rencontre', __rencontre); }

  if (hideTimer) clearTimeout(hideTimer);

  if (!data.found && data.empty) {
    const msg = data.isSkill ? 'Aucun skill détecté' : 'Aucun objet détecté';
    showError(msg);
    return;
  }

  if (!data.found) {
    const msg = data.isSkill ? 'Aucun skill détecté' : 'Aucun objet détecté';
    showError(msg);
    return;
  }

  if (data.error) {
    showError('Erreur serveur.');
    return;
  }

  nameEl.textContent = data.name || '?';

  /* Même principe pour les enchantements : la teinte publiée l'emporte. */
  const enchantPubliees = (window.BAZAAR_LIBELLES || {}).couleurs_enchantements;
  const enchantColor = (enchantPubliees && enchantPubliees[data.enchantmentName])
    || ENCHANTMENT_COLORS[data.enchantmentName] || '#f0c060';
  if (data.enchantmentName) {
    enchantNameEl.textContent = trad(ENCHANT_FR, data.enchantmentName, 'enchantements');
    enchantNameEl.style.color = enchantColor;
    enchantNameEl.style.display = '';
  } else {
    enchantNameEl.style.display = 'none';
  }

  if (data.image) {
    const imgDir = data.isSkill ? 'skills' : 'items';
    const source = `${window.BAZAAR_CONFIG.DATA_BASE_URL}/images/${data.image}` + (window.BAZAAR_SUFFIXE_CACHE || '');

    if (itemImg.src !== source) {
      itemImg.style.visibility = 'hidden';
      itemImg.onload = () => { itemImg.style.visibility = ''; };
      itemImg.src = source;
    } else {
      itemImg.style.visibility = '';
    }
    itemImg.alt = data.name;
    /* En « Current », le cadre prend la rareté ACTUELLE de l'objet, non sa
       rareté de départ. */
    const rareteCadre = __palier || data.tier || 'Bronze';
    itemImgWrap.className = `item-img-wrap size-${data.size || 'Medium'} tier-${rareteCadre}${data.isSkill ? ' skill-img' : ''}`;
    poserCadreRarete(itemImgWrap, rareteCadre, false);

    /* La fiche porte aussi le palier : le cadre « rareté » du menu des
       options s'en sert pour prendre la teinte correspondante. */
    if (card) {
      card.className = card.className.replace(/\btier-\w+\b/g, '').trim();
      card.classList.add('tier-' + (data.tier || 'Bronze'));
    }
    itemImgWrap.style.display = '';
    itemImg.onerror = () => { itemImgWrap.style.display = 'none'; };
  } else {
    itemImgWrap.style.display = 'none';
  }

  badgesRow.innerHTML = '';

  const E = window.BAZAAR_ETIQUETTES || {};
  if (data.isSkill) badgesRow.innerHTML += `<span class="badge badge-size"${styleEtiquette(E.talent)}>${lib('talent')}</span>`;
  else if (data.size) badgesRow.innerHTML += `<span class="badge badge-size taille-${esc(data.size)}"${styleEtiquette((E.tailles || {})[data.size])}>${esc(trad(SIZE_FR, data.size, 'tailles'))}</span>`;
  if (data.tags?.length) {
    data.tags.filter(t => !HIDDEN_TAGS.has(t))
      .forEach(t => { badgesRow.innerHTML += `<span class="badge-tag ${esc(t)}"${styleEtiquette((E.types || {})[t])}>${esc(trad(TAG_FR, t, 'tags'))}</span>`; });
  }

  /* Les tags gagnés en partie : en blanc, avec un petit « + » qui dépasse à
     gauche du cadre. Un tag que la carte a déjà n'est pas répété. */
  if (Array.isArray(data.tagsAjoutes) && data.tagsAjoutes.length) {
    const deja = new Set(data.tags || []);
    data.tagsAjoutes
      .filter(t => typeof t === 'string' && t && !deja.has(t) && !HIDDEN_TAGS.has(t))
      .forEach(t => { badgesRow.innerHTML += `<span class="badge-tag badge-ajoute"><span class="badge-plus">+</span>${esc(trad(TAG_FR, t, 'tags'))}</span>`; });
  }

  rendreStats(data.cooldowns, data.isSkill ? null : data.ammo);

  /* Les portraits ne sont refaits que s'ils changent : une fiche mise à jour
     pendant le survol (rareté, enchantement...) garde les mêmes images
     au lieu de les recréer. */
  const sigPortraits = (data.isSkill ? 'k' : 'i') + '|' + (data.heroes || []).join(',');
  const portraitsInchanges = heroPortEl.dataset.sig === sigPortraits;
  const existingBottom = document.getElementById('hero-portraits-bottom');
  if (!portraitsInchanges) {
    heroPortEl.innerHTML = '';
    heroPortEl.dataset.sig = sigPortraits;
    if (existingBottom) existingBottom.remove();
  }

  /* Le jeu range les héros dans un ordre propre à chaque carte : « Supply
     Cache » commence par Vanessa, « Right Eye » par Pygmalien. On impose le
     même ordre partout, celui du jeu lui-même, pour que le spectateur
     retrouve chaque portrait à la même place d'une fiche à l'autre. */
  const ORDRE = (window.BAZAAR_LIBELLES || {}).ordre_heros
    || ['Vanessa', 'Pygmalien', 'Dooley', 'Mak', 'Stelle',
        'Jules', 'Karnok', 'Hero8', 'Common'];

  const ordonner = (liste) => (liste || []).slice().sort((a, b) => {
    const ia = ORDRE.indexOf(a), ib = ORDRE.indexOf(b);
    // Un héros inconnu vient à la fin plutôt que de disparaître.
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });

  const PORTRAITS_EN_HAUT_MAX = 2;
  const enLigneDediee = data.isSkill
    || (data.heroes && data.heroes.length > PORTRAITS_EN_HAUT_MAX);

  if (!enLigneDediee && !portraitsInchanges) {
    const heroes = ordonner(data.heroes?.length ? data.heroes : ['Common']);
    heroes.forEach(hero => {
      const div = document.createElement('div');
      div.className = 'hero-portrait';
      const heroSrc = portraitHeros(hero);
      div.innerHTML = heroSrc
        ? `<img src="${heroSrc}" alt="${esc(hero)}" />`
        : `<span class="hero-initial">${esc(HERO_INITIAL[hero] || hero[0])}</span>`;
      heroPortEl.appendChild(div);
    });
  }

  bodyEl.innerHTML = buildBody(data.tooltips || [], data.cooldowns, data.ammo, data.multicast, data.quests, data.isSkill, data.enchantmentTooltips, enchantColor);

  /* Les valeurs que le jeu calcule pour l'exemplaire réel, d'abord. */
  appliquerJetons(bodyEl, __jetons);

  /* En « Current », chaque valeur n'est plus montrée que pour la rareté
     actuelle de l'objet, dans la couleur de son mot-clé. */
  if (__palier) ramenerAuPalier(bodyEl, __palier);

  bodyEl.innerHTML += rendreEffetEmplacement(data.socketEffect);

  /* Pas de double trait : quand la description s'ouvre sur un titre
     (« Actif », « Passif », « Effet ») ou sur les pastilles, son trait sépare
     déjà l'en-tête ; le filet sous l'en-tête disparaît. Il reste pour une
     fiche sans titre, comme celle d'un talent. */
  {
    const entete = badgesRow.closest('.header');
    const premier = bodyEl.firstElementChild;
    const avecPastilles = statsRow && statsRow.style.display !== 'none' && statsRow.innerHTML !== '';
    if (entete) entete.classList.toggle('sans-filet',
      !!(avecPastilles || (premier && premier.classList.contains('section-label'))));
  }

  /* Sous un talent, les portraits n'ont pas de trait au-dessus d'eux. Posé
     à chaque rendu : une rangée de portraits conservée telle quelle peut
     passer d'un objet à un talent. */
  queueMicrotask(() => {
    const bas = document.getElementById('hero-portraits-bottom');
    if (bas) bas.classList.toggle('talent', !!data.isSkill);
  });

  if (enLigneDediee && data.heroes?.length && !portraitsInchanges) {
    const bottomDiv = document.createElement('div');
    bottomDiv.id = 'hero-portraits-bottom';
    bottomDiv.className = 'hero-portraits-bottom'
      + (data.heroes.length > 4 ? ' serres' : '');
    ordonner(data.heroes).forEach(hero => {
      const div = document.createElement('div');
      div.className = 'hero-portrait';
      const heroSrc = portraitHeros(hero);
      div.innerHTML = heroSrc
        ? `<img src="${heroSrc}" alt="${esc(hero)}" />`
        : `<span class="hero-initial">${esc(HERO_INITIAL[hero] || hero[0])}</span>`;
      bottomDiv.appendChild(div);
    });
    const bottomBar = card.querySelector('.bottom-bar');
    card.insertBefore(bottomDiv, bottomBar);
  }

  card.classList.remove('hiding');
  card.classList.add('visible');

  /* Plus de minuteur ni de barre de progression : c'est la souris qui décide.
     La fiche reste tant qu'elle ne bouge pas, et disparaît au premier
     mouvement. Ces dix secondes venaient de l'ancien overlay OBS, où les
     fiches s'affichaient sur commande du chat sans qu'aucune souris ne les
     tienne. */
}

function rendreEffetEmplacement(effets) {
  if (!effets || !effets.length) return '';
  var connus = effets.filter(e => e && e.nom);
  if (!connus.length) return '';

  var notes = [];    // « un Do », « un Fourneau »

  /* Le nom de chaque effet (« Fa », « La ») prend la couleur de son mot-clé :
     Hâte pour le Fa, Dégâts pour le La. Le texte autour est échappé morceau
     par morceau. */
  const motEffet = e => {
    const cls = classeEmplacement(e.code);
    return '<span class="' + cls + '"' + styleMotCle(cls) + '>' + esc(e.nom || e.code || '') + '</span>';
  };
  const gabarit = (cle, contenu) => esc(lib(cle)).split('{}').join(contenu);

  connus.forEach(e => {
    notes.push(gabarit('uneNote', motEffet(e)));
  });

  var morceaux = [];
  if (notes.length) morceaux.push(gabarit('surNotes', enumerer(notes)));

  var lignes = connus.filter(e => e.texte).map(e =>
    /* Le nom seul (« Fa ») dans la couleur de son mot-clé, Hâte pour le Fa ;
       les deux-points restent dans celle du texte. */
    '<div class="se-ligne2"><b><span class="' + classeEmplacement(e.code) + '"'
    + styleMotCle(classeEmplacement(e.code)) + '>'
    + esc(e.nom || e.code || '') + '</span> :</b> '
    + colorize(e.texte) + '</div>');

  return '<div class="socket-effect">'
    + '<div class="se-ligne1">'
      + gabarit('estSur', morceaux.join(' ' + esc(lib('et')) + ' ')) + '.'
      + '</div>'
    + lignes.join('')
    + '</div>';
}

function enumerer(liste) {
  if (liste.length <= 1) return liste[0] || '';
  return liste.slice(0, -1).join(', ') + ' ' + lib('et') + ' ' + liste[liste.length - 1];
}

/* Les teintes des effets d'emplacement. Celles-ci servent de repli : la liste
   publiée avec les données l'emporte, de sorte qu'un effet introduit par une
   mise à jour du jeu - une forge, un aquarium - prenne sa couleur sans qu'il
   faille téléverser l'extension. */
const CLASSE_NOTE_DEFAUT = {
  C: 'kw-slow',   D: 'kw-shield', E: 'kw-heal',  F: 'kw-haste',
  G: 'kw-tempo',  A: 'kw-damage', B: 'kw-burn',
  Stove: 'kw-burn', Cooler: 'kw-freeze',
};

function classeEmplacement(code) {
  var publiees = (window.BAZAAR_LIBELLES || {}).classes_emplacements;
  if (publiees && publiees[code]) return publiees[code];
  return CLASSE_NOTE_DEFAUT[code] || '';
}

const NOTE_FR = {
  'C Note': 'Note Do', 'D Note': 'Note Ré', 'E Note': 'Note Mi',
  'F Note': 'Note Fa', 'G Note': 'Note Sol', 'A Note': 'Note La',
  'B Note': 'Note Si', 'Stove': 'Fourneau', 'Cooler': 'Glacière',
};

function buildBody(tooltips, cooldowns, ammo, multicast, quests, isSkill, enchantTooltips, enchantColor) {
  /* Une Répétition de 0 ne s'affiche pas, comme en jeu (Mecha Dragon en
     Shiny). Par palier, la ligne ne disparaît que si tous valent 0. */
  if (typeof multicast === 'number' && multicast <= 0) multicast = null;
  else if (multicast && typeof multicast === 'object'
           && Object.values(multicast).every(v => typeof v === 'number' && v <= 0)) multicast = null;
  const enchantMarked = (enchantTooltips || []).map(t => Object.assign({}, t, { isEnchant: true }));
  const allTooltips = tooltips.concat(enchantMarked);
  if (!allTooltips.length && !(quests && quests.length)) {
    return `<div class="not-found">${lib('sansDescription')}</div>`;
  }

  const actives  = allTooltips.filter(t => t.type === 'Active');
  const passives = allTooltips.filter(t => t.type !== 'Active');
  let html = '';
  const enchantC = enchantColor || '#f0c060';

  function renderRow(t, defaultClass) {
    if (t.isEnchant) {
      return `<div class="effect-row enchant-effect" style="border-color:${enchantC}">` +
             `<span class="effect-arrow" style="color:${enchantC}">▸</span>` +
             `<div class="tooltip-text">${colorize(t.text)}</div></div>`;
    }
    return `<div class="effect-row ${defaultClass}"><span class="effect-arrow">▸</span><div class="tooltip-text">${colorize(t.text)}</div></div>`;
  }

  function fmtNum(n) {
    return Number.isInteger(n) ? String(n) : n.toFixed(1).replace('.0','');
  }

  function cdLine() {
    if (cooldowns === null || cooldowns === undefined) return '';

    if (typeof cooldowns === 'number') {
      return `<div class="cd-line"><span class="cd-label">${lib('delai')}</span><span class="cd-val">${fmtNum(cooldowns)}</span><span class="cd-unit">${lib('sec')}</span></div>`;
    }

    let entries = Object.entries(cooldowns);
    if (!entries.length) return '';

    /* En « Current », la seule valeur de la rareté actuelle, dans la couleur
       du délai d'activation. */
    if (__palier && entries.length > 1) {
      const v = valeurDuPalier(entries, __palier)[1];
      return `<div class="cd-line"><span class="cd-label">${lib('delai')}</span><span class="cd-val">${fmtNum(v)}</span><span class="cd-unit">${lib('sec')}</span></div>`;
    }

    if (entries.length === 1) {
      return `<div class="cd-line"><span class="cd-label">${lib('delai')}</span><span class="cd-val">${fmtNum(entries[0][1])}</span><span class="cd-unit">${lib('sec')}</span></div>`;
    }

    const parts = entries.map(([tier, val], i) => {
      const c = couleurRarete(tier) || '#c0a070';
      const sep = i > 0 ? '<span class="cd-sep">&gt;</span>' : '';
      return sep + `<span class="cd-tier-entry"><span class="cd-tier-dot" style="background:${c}"></span><span class="cd-tier-val" style="color:${c}">${fmtNum(val)}s</span></span>`;
    }).join('');
    return `<div class="cd-line"><span class="cd-label">${lib('delai')}</span>${parts}</div>`;
  }

  /* La partie « Active » existe aussi sans phrase active : Mecha Dragon n'a
     que son délai et « Multicast 2 », ses deux phrases étant passives. Sans
     cela, délai, munitions et répétition disparaissaient de la fiche. */
  /* Le délai et les munitions sont dans les pastilles, sous le nom : la
     partie « Active » ne paraît plus que pour une phrase ou une Répétition. */
  const aDuMulticast = multicast !== null && multicast !== undefined;
  if (actives.length || aDuMulticast) {
    if (!isSkill) html += `<div class="section-label">${lib('actif')}</div>`;
    actives.forEach(t => {
      html += renderRow(t, 'active');
    });
    if (multicast !== null && multicast !== undefined) {
      /* La ligne de Multicast est écrite ici, hors du texte de la carte : elle
         ne passe pas par la coloration des mots-clés. On lui donne donc la
         couleur publiée de la famille, comme ailleurs. Elle restait blanche
         sur un objet qui gagne du Multicast en partie. */
      const cMulti = couleurDeFamille('kw-multi') || '#ffffff';
      if (typeof multicast === 'object') {
        const entries = Object.entries(multicast);
        const parts = entries.map(([tier, val], i) => {
          const c = couleurRarete(tier) || '#c0a070';
          const sep = i > 0 ? '<span class="cd-sep">&gt;</span>' : '';
          return sep + `<span class="cd-tier-entry"><span class="cd-tier-dot" style="background:${c}"></span><span class="cd-tier-val" style="color:${c}">${val}</span></span>`;
        }).join('');
        html += `<div class="effect-row active"><span class="effect-arrow">▸</span><div class="tooltip-text"><span class="kw-multi" style="color:${cMulti}">${lib('multicast')}</span> <svg class="kw-icon" viewBox="0 0 18 18" style="color:${cMulti}"><use href="#multicast"/></svg>${parts}</div></div>`;
      } else {
        html += `<div class="effect-row active"><span class="effect-arrow">▸</span><div class="tooltip-text"><span class="kw-multi" style="color:${cMulti}">${lib('multicast')}</span> <svg class="kw-icon" viewBox="0 0 18 18" style="color:${cMulti}"><use href="#multicast"/></svg><b style="color:${cMulti}">${multicast}</b></div></div>`;
      }
    }

    /* En « Current », la chance de critique actuelle de l'objet, comme une
       ligne de description à part entière, toujours la dernière de la partie
       « Active » : seul un objet actif peut faire un critique. Elle évolue au
       fil d'un combat, et le jeu la tient sur la carte affichée. Le mot passe
       par la coloration habituelle ; le nombre prend l'icône et la couleur
       du critique comme toute valeur en « Current ». */
    if (__palier && typeof __crit === 'number' && __crit > 0) {
      const ligne = `<svg class="kw-icon" viewBox="0 0 18 18"><use href="#crit"/></svg>`
        + `<b data-fixe="1">${__crit}%</b> ${esc(motCrit())}`;
      html += `<div class="effect-row active"><span class="effect-arrow">▸</span><div class="tooltip-text">${colorize(ligne)}</div></div>`;
    }
  }

  if (passives.length) {
    /* Un talent et une rencontre portent « Effet » sur leur trait, un objet
       « Passif ». */
    html += `<div class="section-label">${lib((__rencontre || isSkill) ? 'effet' : 'passif')}</div>`;
    passives.forEach(t => {
      html += renderRow(t, 'passive');
    });
  }

  if (quests?.length) {
    /* Le titre « Quêtes » sur son trait, comme « Actif », « Passif » et
       « Effet ». */
    html += `<div class="section-label">${lib('quetes')}</div><div class="quests-section">`;
    quests.forEach((q, n) => {
      /* L'avancement réel, à la place du « (0/15) » figé du texte publié. Une
         quête accomplie reçoit une coche et un ruban. */
      const a = __avancement && __avancement[n];
      const faite = !!(a && a[1] > 0 && a[0] >= a[1]);
      let condition = esc(q.condition);
      if (a) {
        const avance = `<span class="quete-avance">${Math.min(a[0], a[1] || a[0])}/${a[1]}</span>`;
        condition = /\(\s*\d+\s*\/\s*\d+\s*\)/.test(condition)
          ? condition.replace(/\(\s*\d+\s*\/\s*\d+\s*\)/, `(${avance})`)
          : condition + ` (${avance})`;
      }
      html += `<div class="quest-entry${faite ? ' faite' : ''}">`;
      html += `<div class="quest-condition"><span class="quest-arrow${faite ? ' coche' : ''}">${faite ? '✓' : '◆'}</span>${condition}</div>`;
      q.rewards.forEach(r => {
        html += `<div class="quest-reward"><span class="quest-arrow">▸</span>${colorize(r.text)}</div>`;
      });
      html += `</div>`;
    });
    html += `</div>`;
  }

  return html;
}


function wb(str) {
  const esc = str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![\\p{L}\\p{N}_])(?:${esc})(?![\\p{L}\\p{N}_])`, 'gu');
}


const _regexMot = new Map();

function motEntier(mot) {
  let re = _regexMot.get(mot);
  if (re) { re.lastIndex = 0; return re; }

  const echappe = mot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  const debut = /^\w/.test(mot) ? '\\b' : '';
  const fin   = /\w$/.test(mot) ? '\\b' : '';

  /* La casse compte quand le mot-clé en porte une : en anglais, « Value »
     est un mot-clé mais « value » un nom commun, et les colorer pareillement
     teignait des mots ordinaires.

     Un mot-clé écrit tout en minuscules, lui, se cherche sans égard à la
     casse : l'allemand met une majuscule à ses noms et en début de phrase,
     si bien que « verbrennt » ne correspondait pas à « Verbrennt ». */
  const sensible = /^[A-ZÀ-Þ]/.test(mot);
  re = new RegExp(debut + echappe + fin, sensible ? 'g' : 'gi');
  _regexMot.set(mot, re);
  return re;
}

/* La teinte d'une famille de mots-clés. Publiée avec les données, elle
   l'emporte sur celle de la feuille de style : une famille introduite par une
   mise à jour du jeu s'affiche alors colorée sans qu'il faille téléverser
   l'extension. Sans teinte publiée, la feuille prend le relais. */
function styleMotCle(cls) {
  var teintes = (window.BAZAAR_LIBELLES || {}).couleurs_mots_cles;
  var c = teintes && teintes[cls];
  return c ? ' style="color:' + c + '"' : '';
}

function colorize(html) {
  /* Plusieurs effets sur une même infobulle sont séparés par des retours à la
     ligne dans le texte du jeu : « Burn 5.\n\nPoison 3 ». Le HTML les
     ignorait, et tout s'affichait sur une seule ligne. */
  html = String(html == null ? '' : html).replace(/\s*\n\s*/g, '<br>');

  if (!html) return '';
  html = outside(html, /\b(\d+)(?=\s+Tempo\b)/g,
    n => `<svg class="kw-icon" viewBox="0 0 18 18" style="color:#c060f0"><use href="#tempo"/></svg>${n}`);
  /* Les mots à colorer et leurs teintes viennent TOUS des données publiées,
     depuis mots-cles.json. Il n'y a plus de table interne.

     Les deux qui existaient servaient de repli, mais la liste publiée les
     REMPLAÇAIT au lieu de les compléter : publier trois mots a fait perdre
     149 formes déjà colorées, et n'en publier qu'une partie a fait tomber
     tous les mots-clés anglais. Une seule source évite cette classe d'erreur.

     Si rien n'est publié, rien n'est coloré : c'est franc, et cela se voit
     tout de suite. */
  const p = publies();

  /* Dans les langues listées, un mot-clé s'affiche avec sa majuscule, comme le
     fait l'interface du jeu : le texte écrit parfois « damage », le jeu montre
     « Damage ». Seule la première lettre change. */
  const langues = window.BAZAAR_MAJUSCULE_MOTS || ['en'];
  const capitaliser = langues.indexOf(langueActive()) >= 0;
  const forme = (m) => capitaliser ? m.charAt(0).toLocaleUpperCase() + m.slice(1) : m;

  for (const [mot, cls] of (p && p.mots_cles) || []) {
    html = outside(html, motEntier(mot),
      m => `<span class="${cls}"${styleMotCle(cls)}>${forme(m)}</span>`);
  }
  html = poserIconesMotsCles(html);
  html = outside(html, /\b(\d[\d,.]*)\s*(second[s]?|sec)\b/gi,
    (_, n, u) => `<span class="kw-sec">${n} ${u}</span>`);
  html = outside(html, /\b\d[\d,.]*%\b/g,
    m => `<span class="kw-num">${m}</span>`);
  return html;
}

/* ── Les icônes posées d'après les mots-clés ───────────────────────────────

   Le texte des cartes n'a d'icône que devant les nombres que « server.js »
   sait reconnaître. Les mots-clés sans nombre, comme Détruire, et ceux dont
   le nombre n'était pas reconnu, comme Santé max, en restaient privés.

   Deux règles, celles du jeu :
   - devant le NOMBRE quand il y en a un, signe compris :
       « + [icône] 20 Rage », « [icône] 20% Santé max » ;
   - devant le MOT pour un mot-clé sans nombre :
       « [icône] Détruisez » ;
   et jamais devant une forme adjective, « Enchanté ».

   Une icône déjà posée n'est jamais doublée. */
/* Une seule icône pour deux mots-clés voisins : celle des dégâts pour
   « Crit Damage », comme le jeu. « paires_icone » de mots-cles.json la
   remplace. */
const PAIRES_ICONE_DEFAUT = [{ familles: ['kw-crit', 'kw-damage'], icone: 'damage' }];

/* Les familles dont le mot seul reste sans icône dans une rencontre. */
const FAMILLES_SANS_ICONE_RENCONTRE = ['kw-gold'];

const FAMILLES_ICONE_MOT_DEFAUT = ['kw-destroy', 'kw-transform', 'kw-upgrade',
                                   'kw-enchant', 'kw-rage', 'kw-life', 'kw-fly'];

/* Les formes adjectives, reconnues à leur terminaison. Une règle ne peut pas
   tout voir dans huit langues : « formes_sans_icone » de mots-cles.json la
   complète. */
const TERMINAISONS_ADJECTIVES = {
  en: /ed$/i,
  fr: /(é|ée|és|ées)$/i,
  es: /(ado|ada|ados|adas|ido|ida|idos|idas)$/i,
  pt: /(ado|ada|ados|adas|ido|ida|idos|idas)$/i,
  it: /(ato|ata|ati|ate|ito|ita|iti|ite)$/i,
  de: /(iert|ierte|ierten|elt|elte|elten|tet|tete|teten|ert|erte|erten)$/,
};

/* Les noms qui ne portent leur icône que devant un nombre, comme Bouclier ou
   Dégâts : « + [icône] 20 Rage », mais jamais « Rage » seul. Le verbe, lui,
   la garde : « [icône] Enrage ». La liste publiée s'y ajoute. */
const NOMS_SANS_ICONE_SEULS = {
  en: ['Rage'], fr: ['Rage'], de: ['Wut'], es: ['Furia', 'Ira'],
  it: ['Furia', 'Ira'], pt: ['Fúria', 'Ira'],
};

function sansIcone(mot, avecNoms) {
  const l = langueActive();
  const liste = ((window.BAZAAR_FORMES_SANS_ICONE || {})[l]) || [];
  if (liste.indexOf(mot) >= 0) return true;
  /* Les noms seuls comme « Rage » n'ont pas d'icône en mode « nombres » ; les
     modes fidèles au jeu, eux, la leur donnent. */
  if (avecNoms && (NOMS_SANS_ICONE_SEULS[l] || []).indexOf(mot) >= 0) return true;
  const re = TERMINAISONS_ADJECTIVES[l];
  return !!(re && re.test(mot));
}

function iconeDeFamille(fam) {
  const I = window.BAZAAR_ICONE;
  return I ? I.famille(fam) : null;
}

/* Le dessin, teint de la couleur du mot-clé. L'extension le remplace par
   l'icône du jeu dès qu'il paraît, quand elle existe. */
function balisIcone(id, fam) {
  const t = ((window.BAZAAR_LIBELLES || {}).couleurs_mots_cles || {})[fam] || '#ffffff';
  return '<svg class="kw-icon" viewBox="0 0 18 18" style="color:' + t + '">'
       + '<use href="#' + id + '"/></svg>';
}

/* Le mot qui désigne des objets, dans chaque langue : « Poison item »,
   « objets de Poison ». Placé avant ou après le mot-clé, il en fait un
   qualificatif plutôt qu'une action. */
const MOTS_OBJET = 'items?|objets?|Gegenst\\u00e4nde|Gegenstand|objetos?|oggett[oi]|itens?|\\uc544\\uc774\\ud15c|\\u7269\\u54c1';

function qualifieObjets(avant, apres) {
  const texteApres = apres.replace(/<[^>]+>/g, '');
  const texteAvant = avant.replace(/<[^>]+>/g, '');
  return new RegExp('^\\s*(' + MOTS_OBJET + ')(?![\\p{L}])', 'iu').test(texteApres)
      || new RegExp('(' + MOTS_OBJET + ')\\s+((de|à|di|do|da|mit)\\s+)?$', 'iu').test(texteAvant);
}

/* La suite de la phrase après une position, jusqu'au point suivant. */
function suiteDePhrase(tout, depuis) {
  const reste = tout.slice(depuis, depuis + 300);
  const fin = reste.search(/[.!?](\s|<|$)/);
  return fin >= 0 ? reste.slice(0, fin) : reste;
}

/* L'icône d'une paire de familles voisines, dans un ordre ou dans l'autre. */
function iconeDePaire(a, b) {
  if (!a || !b || a === b) return null;
  const paires = window.BAZAAR_PAIRES_ICONE || PAIRES_ICONE_DEFAUT;
  const p = paires.find(x => Array.isArray(x.familles)
    && x.familles.indexOf(a) >= 0 && x.familles.indexOf(b) >= 0);
  return p ? p.icone : null;
}

/* La famille du mot-clé qui suit immédiatement une balise fermante. */
function familleSuivante(tout, depuis) {
  const fin = tout.indexOf('</span>', depuis);
  if (fin < 0) return null;
  const m = /^\s+<span class="(kw-[a-z0-9-]+)"/.exec(tout.slice(fin + 7, fin + 80));
  return m ? m[1] : null;
}

function poserIconesMotsCles(html) {
  if (!window.BAZAAR_ICONE) return html;

  /* 1. Devant le nombre qui précède un mot-clé, sauf si une icône y est déjà. */
  html = html.replace(
    /(<\/svg>|<img[^>]*>)?([+\-\u2212]\s*)?(\d[\d,.]*%?)(\s+)(<span class="(kw-[a-z0-9-]+)")/g,
    function (m, avant, signe, n, esp, ouv, fam, pos, tout) {
      if (avant) return m;
      /* « +10% Crit Damage » : l'icône de la paire, celle des dégâts. */
      const paire = iconeDePaire(fam, familleSuivante(tout, pos + m.length));
      const id = paire || iconeDeFamille(fam);
      if (!id) return m;
      return (signe || '') + balisIcone(id, fam) + n + esp + ouv;
    });

  /* 1 ter. Même règle devant une valeur que l'export a mise en forme : un
     nombre fixe « <b>2</b> », des paliers « 1 > 2 > 3 », ou une valeur que
     le jeu calcule en partie, publiée « - » et remplie ensuite. La règle 1
     ne les voyait pas, à cause des balises entre le nombre et le mot : « Gain
     2 Prestige » restait sans icône. L'icône va devant la valeur, ou devant
     le premier palier. Jamais devant un compte (« 2 objets »), ni là où
     l'export a déjà posé celle de son effet. */
  html = html.replace(
    /(<\/svg>|<img[^>]*>)?((?:<b\b[^>]*>[^<]*<\/b>)|(?:<span data-tier[^>]*>[^<]*<\/span>(?:<span class="sep-palier"[^>]*>[^<]*<\/span><span data-tier[^>]*>[^<]*<\/span>)*))(%?)(\s+)(<span class="(kw-[a-z0-9-]+)")/g,
    function (m, avant, valeur, pc, esp, ouv, fam, pos, tout) {
      if (avant) return m;
      if (/data-compte/.test(valeur)) return m;
      if (!/>\s*[+\-−]?(\d|-\s*<)/.test(valeur + '<')) return m;
      const paire = iconeDePaire(fam, familleSuivante(tout, pos + m.length));
      const id = paire || iconeDeFamille(fam);
      if (!id) return m;
      return balisIcone(id, fam) + valeur + pc + esp + ouv;
    });

  /* 1 bis. Un mot-clé suivi de son nombre, quand rien n'a posé d'icône devant
     ce nombre : « Shield 10 > 20 > 30 for each Small item ». L'icône va devant
     le nombre, comme partout. Jamais devant un compte d'objets, « Haste 1 item ». */
  html = html.replace(
    /(<span class="(kw-[a-z0-9-]+)"[^>]*>[^<]+<\/span>)(\s+)((?:<(?:b|span)\b[^>]*>)?)([+\-\u2212]?\d[\d,.]*%?)/g,
    function (m, motCle, fam, esp, ouvre, nombre, pos, tout) {
      if (/data-compte/.test(ouvre)) return m;
      const suite = tout.slice(pos + m.length, pos + m.length + 120).replace(/<[^>]+>/g, '');
      if (new RegExp('^[\\d,.%\\s>]*(' + MOTS_OBJET + ')(?![\\p{L}])', 'iu').test(suite)) return m;
      const id = iconeDeFamille(fam);
      return id ? motCle + esp + balisIcone(id, fam) + ouvre + nombre : m;
    });

  /* 3. Une durée écrite en toutes lettres, sans jeton : « reduce this item's
     Cooldown by 1 second ». Le nombre suit le mot-clé de loin ; l'icône est
     celle du DERNIER mot-clé de durée de la phrase, Délai d'activation,
     Charge, Hâte, Ralentissement ou Gel. Rien si un nombre en porte déjà une,
     ou si la phrase n'en contient aucun. */
  html = html.replace(
    new RegExp('(\\d[\\d,.]*)(\\s*)(' + UNITES_DUREE + ')(?![\\p{L}])', 'gu'),
    function (m, n, esp, unite, pos, tout) {
      const avant = tout.slice(Math.max(0, pos - 220), pos);
      if (/(<\/svg>|<img[^>]*>)\s*$/.test(avant)) return m;

      /* La phrase seulement : on s'arrête au dernier point. */
      const phrase = avant.slice(Math.max(avant.lastIndexOf('. '), avant.lastIndexOf('.<')) + 1);
      const familles = [...phrase.matchAll(/<span class="(kw-[a-z0-9-]+)"/g)]
        .map(x => x[1]).filter(f => FAMILLES_DUREE.indexOf(f) >= 0);
      if (!familles.length) return m;

      const fam = familles[familles.length - 1];
      const id = iconeDeFamille(fam);
      return id ? balisIcone(id, fam) + m : m;
    });

  /* 2. Devant le mot-clé sans nombre. Trois réglages, « mode_icones » de
     mots-cles.json :
     - « nombres » : seulement les verbes d'action, comme Détruire ;
     - « premiere » : tout mot-clé, comme le jeu, mais à sa première
       apparition dans la description seulement ;
     - « jeu » : tout mot-clé, à chaque apparition, comme le jeu.
     Un mot suivi ou précédé de son nombre n'a pas d'icône : elle est devant le
     nombre. Une paire de mots voisins comme « Crit Damage » n'en a qu'une. */
  /* Le réglage d'une famille : « mode_icones » peut être un seul mot, valable
     pour tous, ou une table par famille avec une valeur « defaut ». */
  const reglage = window.BAZAAR_MODE_ICONES || 'nombres';
  const MODES = ['nombres', 'premiere', 'jeu'];
  const modeDe = (fam) => {
    if (typeof reglage === 'string') return MODES.indexOf(reglage) >= 0 ? reglage : 'nombres';
    const m = reglage[fam] || reglage.defaut;
    return MODES.indexOf(m) >= 0 ? m : 'nombres';
  };

  const familles = (window.BAZAAR_ICONE.famillesMot && window.BAZAAR_ICONE.famillesMot())
    || FAMILLES_ICONE_MOT_DEFAUT;
  const exclues = window.BAZAAR_FAMILLES_SANS_ICONE_MOT || [];
  const paires = window.BAZAAR_PAIRES_ICONE || PAIRES_ICONE_DEFAUT;

  /* Les icônes déjà présentes, pour le mode « premiere ». */
  const deja = new Set([...html.matchAll(/href="#([a-z0-9_-]+)"/g)].map(x => x[1]));
  let sauterA = -1;

  html = html.replace(
    /(<span class="(kw-[a-z0-9-]+)"[^>]*>)([^<]+)(<\/span>)/g,
    function (m, ouv, fam, mot, ferme, pos, tout) {
      if (pos === sauterA) return m;                           // second mot d'une paire

      const avant = tout.slice(Math.max(0, pos - 60), pos);

      /* Second mot d'une paire dont le premier précède : la paire n'a qu'une
         icône, posée devant le premier ou devant son nombre. */
      const precedent = /<span class="(kw-[a-z0-9-]+)"[^>]*>[^<]+<\/span>\s+$/.exec(avant);
      if (precedent && iconeDePaire(precedent[1], fam)) return m;
      if (/(<\/svg>|<img[^>]*>)\s*$/.test(avant)) return m;   // icône déjà là
      /* Un nombre la porte, même enveloppé dans sa couleur de palier :
         « 20</span> Damage » se terminait par une balise, et la règle ne
         voyait plus le nombre, d'où une seconde icône devant « Damage ». */
      if (/\d[\d,.]*%?(?:<\/[a-z]+>)*%?\s*$/.test(avant)) return m;
      /* De même pour une valeur « - » que la partie remplira. */
      if (/data-vide="1">[^<]*<\/b>\s*$/.test(avant)) return m;

      const mode = modeDe(fam);
      const tous = (mode === 'premiere' || mode === 'jeu');

      if (!tous) {
        if (familles.indexOf(fam) < 0) return m;
        if (__rencontre && FAMILLES_SANS_ICONE_RENCONTRE.indexOf(fam) >= 0) return m;
        if (sansIcone(mot.trim(), true)) return m;
        const id = iconeDeFamille(fam);
        return id ? balisIcone(id, fam) + m : m;
      }

      if (exclues.indexOf(fam) >= 0) return m;
      /* Dans une rencontre, l'Or seul n'a pas d'icône : « Gold » y désigne
         souvent la rareté (« améliorez un objet en Or »). Devant un nombre,
         il la garde : c'est alors bien de l'argent. Dans un objet, le mot
         désigne toujours l'argent, et garde son icône. */
      if (__rencontre && FAMILLES_SANS_ICONE_RENCONTRE.indexOf(fam) >= 0) return m;

      /* Un nombre qui suit : l'icône est la sienne, pas celle du mot. */
      const apres = tout.slice(pos + m.length, pos + m.length + 80);
      if (/^\s*(<svg|<img|<b[^>]*>\s*\d|<span[^>]*>\s*\d|[+\-\u2212]?\d)/.test(apres)) return m;

      if (sansIcone(mot.trim(), false)) return m;

      /* Un mot qui qualifie des objets garde son icône : « [Poison] Poison
         item … gain [Poison] 4 ». Sinon, si sa puissance vient plus loin dans
         la phrase avec la même icône, c'est elle qui la porte : « Freeze an
         item [Gel] 1 second ». */
      const idMot = iconeDeFamille(fam);
      if (idMot && !qualifieObjets(avant, apres)) {
        const finPhrase = suiteDePhrase(tout, pos + m.length);
        if (finPhrase.indexOf('href="#' + idMot + '"') >= 0) return m;
      }

      /* Une paire de mots voisins, dans un ordre ou dans l'autre. */
      let id = null, famIcone = fam;
      const voisin = /^(\s+)<span class="(kw-[a-z0-9-]+)"/.exec(apres);
      if (voisin) {
        const p = paires.find(x => Array.isArray(x.familles)
          && x.familles.indexOf(fam) >= 0 && x.familles.indexOf(voisin[2]) >= 0
          && voisin[2] !== fam);
        if (p) {
          id = p.icone;
          sauterA = pos + m.length + voisin[1].length;
          famIcone = voisin[2];
        }
      }
      id = id || iconeDeFamille(fam);
      if (!id) return m;

      if (mode === 'premiere') {
        if (deja.has(id)) return m;
        deja.add(id);
      }
      return balisIcone(id, famIcone) + m;
    });

  return html;
}

/* Les mots-clés dont la valeur est une durée, et les unités de temps de
   chaque langue, au singulier comme au pluriel. */
const FAMILLES_DUREE = ['kw-cooldown', 'kw-charge', 'kw-haste', 'kw-slow', 'kw-freeze'];
const UNITES_DUREE = ['seconds?', 'secondes?', 'Sekunden?', 'segundos?', 'secondi',
                      'secondo', '초', '秒'].join('|');

function outside(html, re, fn) {
  const PROTEGE = /(<span[^>]*>[\s\S]*?<\/span>|<svg[\s\S]*?<\/svg>|<[^>]+>)/g;
  return html.split(PROTEGE)
    .map((p, i) => i % 2 === 1 ? p : p.replace(re, fn))
    .join('');
}

function esc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// (connexion SSE retirée : les données arrivent par le canal Twitch)


window.showItem = showItem;
window.showError = showError;

/* Pour la recherche : elle propose les héros et les types en
   filtres, et doit les nommer comme la fiche. */
window.HERO_PORTRAITS = HERO_PORTRAITS;
window.TAG_FR = TAG_FR;
window.trad = trad;
window.ENCHANT_FR = ENCHANT_FR;
window.ENCHANTMENT_COLORS = ENCHANTMENT_COLORS;
