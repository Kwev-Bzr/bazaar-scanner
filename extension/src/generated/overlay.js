/* FICHIER GÉNÉRÉ par tools/build-extension.js depuis overlay.html.
   Ne PAS modifier à la main : toute modification sera écrasée.
   Modifie overlay.html puis relance le script. */


let DISPLAY_MS = 10000;
// Durée d'affichage : lue une fois au chargement, puis mise à jour par push
// via /events quand les paramètres sont enregistrés (pas de polling).
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
  // Nouveau héros (maj en cours) : card.Heroes renvoie encore "Hero8" (nom
  // interne/placeholder côté jeu) plutôt qu'un nom définitif — à corriger ici
  // si le jeu expose un jour un vrai nom à la place.
  Hero8:     window.BAZAAR_CONFIG.DATA_BASE_URL + '/characters/Dragons_Portrait.png',
};
const HERO_INITIAL = { Pygmalien:'P', Vanessa:'V', Stelle:'S', Dooley:'D', Jules:'J', Mak:'M', Karnok:'K', Hero8:'D' };

// Couleurs par enchantement (mêmes teintes thématiques que les mots-clés du jeu).
const ENCHANTMENT_COLORS = {
  Golden:      '#f0c060',
  Heavy:       '#999999',
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

// Traductions d'affichage pour les badges (tags et taille). La classe CSS
// garde la valeur anglaise d'origine (ex: "Vehicle") pour que les couleurs et
// la largeur d'image continuent de fonctionner — seul le texte visible change.
/* ── Langue d'affichage ──────────────────────────────────────────────────
   Les glossaires ci-dessous traduisent en français ce que le jeu expose en
   anglais. Dans l'overlay OBS, la langue est celle de l'outil ; dans
   l'extension Twitch, c'est le spectateur qui choisit, et viewer.js pose
   alors window.BAZAAR_LANGUE.

   En anglais, on ne traduit rien : le texte du jeu est déjà dans la bonne
   langue, il suffit de laisser passer la valeur d'origine.
   --------------------------------------------------------------------- */

function langueActive() {
  return (typeof window !== 'undefined' && window.BAZAAR_LANGUE) || 'fr';
}

/* Libellés et glossaires publiés avec les données, déduits des traductions du
   jeu par tools/export-cards.js. Quand ils sont présents, ils font foi : ils
   emploient la terminologie exacte du jeu, ce que des tables écrites à la main
   ne garantiraient pas. Absents — overlay OBS, ou langue non exportée — on
   retombe sur les glossaires français intégrés. */
function publies() {
  return (typeof window !== 'undefined' && window.BAZAAR_LIBELLES) || null;
}

function enFrancais() {
  return langueActive() === 'fr';
}

/* Traduit via un glossaire. Trois sources, dans cet ordre : les données
   publiées, le glossaire français intégré, puis la valeur d'origine — que le
   jeu fournit déjà en anglais. */
function trad(glossaire, valeur, nomPublie) {
  const p = publies();
  if (p && nomPublie && p[nomPublie] && p[nomPublie][valeur]) {
    return p[nomPublie][valeur];
  }
  if (!enFrancais()) return valeur;
  return glossaire[valeur] || valeur;
}

// Libellés fixes de la fiche, par langue.
const LIBELLES = {
  fr: {
    actif: 'Actif', passif: 'Passif', talent: 'Talent',
    delai: 'Délai d\'Activation :', sec: 'sec',
    munitions: 'Munitions', quetes: 'Quêtes', multicast: 'Répétition',
  },
  en: {
    actif: 'Active', passif: 'Passive', talent: 'Skill',
    delai: 'Cooldown:', sec: 'sec',
    munitions: 'Ammo', quetes: 'Quests', multicast: 'Multicast',
  },
};

function lib(cle) {
  const p = publies();
  if (p && p.l && p.l[cle]) return p.l[cle];
  const table = LIBELLES[langueActive()] || LIBELLES.fr;
  return table[cle] || LIBELLES.fr[cle] || cle;
}

const TAG_FR = {
  Apparel: 'Accessoire', Aquatic: 'Aquatique', Core: 'Cœur', Dinosaur: 'Dinosaure',
  Dragon: 'Dragon', Drone: 'Drone', Food: 'Nourriture', Friend: 'Ami',
  Loot: 'Butin', Potion: 'Potion', Property: 'Propriété', Ray: 'Rayon',
  Reagent: 'Réactif', Relic: 'Relique', Tech: 'Tech', Tool: 'Outil',
  Toy: 'Jouet', Trap: 'Piège', Vehicle: 'Véhicule', Weapon: 'Arme',
};
const SIZE_FR = { Small: 'Petit', Medium: 'Moyen', Large: 'Grand' };
const TIER_FR = { Bronze: 'Bronze', Silver: 'Argent', Gold: 'Or', Diamond: 'Diamant', Legendary: 'Légendaire' };

const card        = document.getElementById('card');
const nameEl      = document.getElementById('item-name');
const enchantNameEl = document.getElementById('enchant-name');
const badgesRow   = document.getElementById('badges-row');
const heroPortEl  = document.getElementById('hero-portraits');
const bodyEl      = document.getElementById('item-body');
const progress    = document.getElementById('progress');
const itemImgWrap = document.getElementById('item-img-wrap');
const itemImg     = document.getElementById('item-img');
let hideTimer = null;
const setTimeout = function () { return 0; };

/**
 * Noms français officiels des enchantements (tirés du CSV de traductions du jeu).
 * La clé anglaise reste utilisée en interne (couleurs, lookups).
 */
const ENCHANT_FR = {
  Golden: 'Doré', Heavy: 'Lourd', Icy: 'Glacé', Turbo: 'Turbo',
  Shielded: 'Blindé', Restorative: 'Guérisseur', Toxic: 'Toxique',
  Fiery: 'Ardent', Shiny: 'Brillant', Deadly: 'Mortel',
  Radiant: 'Radieux', Obsidian: 'Obsidienne', Mossy: 'Moussu',
};

// ── Affichage ────────────────────────────────────────────────────────────────
function showError(msg) {
  if (hideTimer) clearTimeout(hideTimer);
  nameEl.textContent = msg;
  enchantNameEl.style.display = 'none';
  bodyEl.innerHTML = '<div class="effect-row passive"><span class="effect-arrow">▸</span><div class="tooltip-text">Tapez !commandes dans le chat pour voir la liste des commandes</div></div>';
  badgesRow.innerHTML = '';
  heroPortEl.innerHTML = '';
  itemImgWrap.style.display = 'none';
  card.classList.remove('hiding');
  card.classList.add('visible');
  hideTimer = setTimeout(() => { card.classList.add('hiding'); card.classList.remove('visible'); }, 5000);
}

function showItem(data) {
  if (hideTimer) clearTimeout(hideTimer);

  // Slot vide ou aucun objet/skill détecté → message d'erreur
  if (!data.found && data.empty) {
    const msg = data.isSkill ? 'Aucun skill détecté' : 'Aucun objet détecté';
    showError(msg);
    return;
  }

  // Aucun résultat (position hors limites, etc.)
  if (!data.found) {
    const msg = data.isSkill ? 'Aucun skill détecté' : 'Aucun objet détecté';
    showError(msg);
    return;
  }

  // Erreur serveur
  if (data.error) {
    showError('Erreur serveur.');
    return;
  }

  nameEl.textContent = data.name || '?';

  // Nom de l'enchantement actif, au-dessus du nom de l'objet, dans sa couleur.
  const enchantColor = ENCHANTMENT_COLORS[data.enchantmentName] || '#f0c060';
  if (data.enchantmentName) {
    enchantNameEl.textContent = trad(ENCHANT_FR, data.enchantmentName, 'enchantements');
    enchantNameEl.style.color = enchantColor;
    enchantNameEl.style.display = '';
  } else {
    enchantNameEl.style.display = 'none';
  }

  // Image
  if (data.image) {
    const imgDir = data.isSkill ? 'skills' : 'items';
    itemImg.src = `${window.BAZAAR_CONFIG.DATA_BASE_URL}/images/${data.image}` + (window.BAZAAR_SUFFIXE_CACHE || '');
    itemImg.alt = data.name;
    // Le cadre porte la qualité MINIMALE de l'objet (celle à laquelle il
    // apparaît en boutique), pas celle de l'exemplaire possédé : c'est une
    // caractéristique de la carte, pas de la partie en cours.
    itemImgWrap.className = `item-img-wrap size-${data.size || 'Medium'} tier-${data.tier || 'Bronze'}${data.isSkill ? ' skill-img' : ''}`;
    itemImgWrap.style.display = '';
    itemImg.onerror = () => { itemImgWrap.style.display = 'none'; };
  } else {
    itemImgWrap.style.display = 'none';
  }

  // Badges
  badgesRow.innerHTML = '';
  if (data.tier) badgesRow.innerHTML += `<span class="badge badge-tier ${esc(data.tier)}">${esc(trad(TIER_FR, data.tier, 'qualites'))}</span>`;
  if (data.isSkill) badgesRow.innerHTML += `<span class="badge badge-size">${lib('talent')}</span>`;
  else if (data.size) badgesRow.innerHTML += `<span class="badge badge-size">${esc(trad(SIZE_FR, data.size, 'tailles'))}</span>`;
  if (data.tags?.length) {
    data.tags.filter(t => !HIDDEN_TAGS.has(t))
      .forEach(t => { badgesRow.innerHTML += `<span class="badge-tag ${esc(t)}">${esc(trad(TAG_FR, t, 'tags'))}</span>`; });
  }

  // Portraits : en haut pour items, en bas pour skills
  heroPortEl.innerHTML = '';
  // Supprime les portraits en bas précédents si existants
  const existingBottom = document.getElementById('hero-portraits-bottom');
  if (existingBottom) existingBottom.remove();

  if (!data.isSkill) {
    // Items : portraits en haut à droite comme avant
    const heroes = data.heroes?.length ? data.heroes : ['Common'];
    heroes.forEach(hero => {
      const div = document.createElement('div');
      div.className = 'hero-portrait';
      const heroSrc = HERO_PORTRAITS[hero];
      div.innerHTML = heroSrc
        ? `<img src="${heroSrc}" alt="${esc(hero)}" />`
        : `<span class="hero-initial">${esc(HERO_INITIAL[hero] || hero[0])}</span>`;
      heroPortEl.appendChild(div);
    });
  }

  // Corps
  bodyEl.innerHTML = buildBody(data.tooltips || [], data.cooldowns, data.ammo, data.multicast, data.quests, data.isSkill, data.enchantmentTooltips, enchantColor);

  // Portraits en bas pour les skills — insérés avant bottom-bar
  if (data.isSkill && data.heroes?.length) {
    const bottomDiv = document.createElement('div');
    bottomDiv.id = 'hero-portraits-bottom';
    bottomDiv.className = 'hero-portraits-bottom';
    data.heroes.forEach(hero => {
      const div = document.createElement('div');
      div.className = 'hero-portrait';
      const heroSrc = HERO_PORTRAITS[hero];
      div.innerHTML = heroSrc
        ? `<img src="${heroSrc}" alt="${esc(hero)}" />`
        : `<span class="hero-initial">${esc(HERO_INITIAL[hero] || hero[0])}</span>`;
      bottomDiv.appendChild(div);
    });
    // Insère avant la bottom-bar
    const bottomBar = card.querySelector('.bottom-bar');
    card.insertBefore(bottomDiv, bottomBar);
  }

  // Animation
  card.classList.remove('hiding');
  card.classList.add('visible');

  // Progression
  progress.style.transition = 'none';
  progress.style.transform  = 'scaleX(1)';
  void progress.offsetWidth;
  progress.style.transition = `transform ${DISPLAY_MS}ms linear`;
  progress.style.transform  = 'scaleX(0)';

  hideTimer = setTimeout(() => {
    card.classList.remove('visible');
    card.classList.add('hiding');
  }, DISPLAY_MS);
}

// ── Corps ─────────────────────────────────────────────────────────────────────
function buildBody(tooltips, cooldowns, ammo, multicast, quests, isSkill, enchantTooltips, enchantColor) {
  const enchantMarked = (enchantTooltips || []).map(t => Object.assign({}, t, { isEnchant: true }));
  const allTooltips = tooltips.concat(enchantMarked);
  if (!allTooltips.length) return '<div class="not-found">Aucune description.</div>';

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

  const TIER_COLORS = {
    Bronze:'#e08830', Silver:'#d0d0d0', Gold:'#f0c060', Diamond:'#a8d8f8', Legendary:'#f08040'
  };

  function fmtNum(n) {
    return Number.isInteger(n) ? String(n) : n.toFixed(1).replace('.0','');
  }

  // Ligne cooldown horizontale
  function cdLine() {
    if (cooldowns === null || cooldowns === undefined) return '';

    if (typeof cooldowns === 'number') {
      return `<div class="cd-line"><span class="cd-label">${lib('delai')}</span><span class="cd-val">${fmtNum(cooldowns)}</span><span class="cd-unit">${lib('sec')}</span></div>`;
    }

    const entries = Object.entries(cooldowns);
    if (!entries.length) return '';

    if (entries.length === 1) {
      return `<div class="cd-line"><span class="cd-label">${lib('delai')}</span><span class="cd-val">${fmtNum(entries[0][1])}</span><span class="cd-unit">${lib('sec')}</span></div>`;
    }

    // Multi-tiers : valeurs inline avec points colorés et >
    const parts = entries.map(([tier, val], i) => {
      const c = TIER_COLORS[tier] || '#c0a070';
      const sep = i > 0 ? '<span class="cd-sep">&gt;</span>' : '';
      return sep + `<span class="cd-tier-entry"><span class="cd-tier-dot" style="background:${c}"></span><span class="cd-tier-val" style="color:${c}">${fmtNum(val)}s</span></span>`;
    }).join('');
    return `<div class="cd-line"><span class="cd-label">${lib('delai')}</span>${parts}</div>`;
  }

  if (actives.length) {
    if (!isSkill) html += `<div class="section-label">${lib('actif')}</div>`;
    html += cdLine();
    if (ammo !== null && ammo !== undefined) {
      if (typeof ammo === 'object') {
        // Multi-tier : même affichage que cooldown multi-tier
        const TIER_COLORS = { Bronze:'#cd7f32', Silver:'#c8c8c8', Gold:'#f0c860', Diamond:'#a0d0f0' };
        const entries = Object.entries(ammo);
        const parts = entries.map(([tier, val], i) => {
          const c = TIER_COLORS[tier] || '#c0a070';
          const sep = i > 0 ? '<span class="cd-sep">&gt;</span>' : '';
          return sep + `<span class="cd-tier-entry"><span class="cd-tier-dot" style="background:${c}"></span><span class="cd-tier-val" style="color:${c}">${val}</span></span>`;
        }).join('');
        html += `<div class="cd-line"><span class="cd-label">${lib('munitions')}</span>${parts}</div>`;
      } else {
        html += `<div class="cd-line"><span class="cd-label">${lib('munitions')}</span><span class="cd-val">${ammo}</span></div>`;
      }
    }
    actives.forEach(t => {
      html += renderRow(t, 'active');
    });
    if (multicast !== null && multicast !== undefined) {
      if (typeof multicast === 'object') {
        const TIER_COLORS = { Bronze:'#cd7f32', Silver:'#c8c8c8', Gold:'#f0c860', Diamond:'#a0d0f0' };
        const entries = Object.entries(multicast);
        const parts = entries.map(([tier, val], i) => {
          const c = TIER_COLORS[tier] || '#c0a070';
          const sep = i > 0 ? '<span class="cd-sep">&gt;</span>' : '';
          return sep + `<span class="cd-tier-entry"><span class="cd-tier-dot" style="background:${c}"></span><span class="cd-tier-val" style="color:${c}">${val}</span></span>`;
        }).join('');
        html += `<div class="effect-row active"><span class="effect-arrow">▸</span><div class="tooltip-text"><span class="kw-multi">${lib('multicast')}</span> <svg class="kw-icon" viewBox="0 0 18 18" style="color:#ffffff"><use href="#multicast"/></svg>${parts}</div></div>`;
      } else {
        html += `<div class="effect-row active"><span class="effect-arrow">▸</span><div class="tooltip-text"><span class="kw-multi">${lib('multicast')}</span> <svg class="kw-icon" viewBox="0 0 18 18" style="color:#ffffff"><use href="#multicast"/></svg><b>${multicast}</b></div></div>`;
      }
    }
  }

  if (passives.length) {
    if (!isSkill) html += `<div class="section-label">${lib('passif')}</div>`;
    passives.forEach(t => {
      html += renderRow(t, 'passive');
    });
  }

  // Quêtes
  if (quests?.length) {
    html += `<div class="quests-section"><div class="quest-label">${lib('quetes')}</div>`;
    quests.forEach(q => {
      html += `<div class="quest-entry">`;
      html += `<div class="quest-condition"><span class="quest-arrow">◆</span>${esc(q.condition)}</div>`;
      q.rewards.forEach(r => {
        html += `<div class="quest-reward"><span class="quest-arrow">▸</span>${colorize(r.text)}</div>`;
      });
      html += `</div>`;
    });
    html += `</div>`;
  }

  return html;
}

// ── Colorisation ──────────────────────────────────────────────────────────────
const KW_MAP = [
  // Ordre : plus long d'abord pour éviter les conflits partiels
  [/\bCrit Chance\b/g,   'kw-crit'],
  [/\bMax Health\b/g,    'kw-health'],
  [/\b[Ll]ifesteal\b/g, 'kw-life'],
  [/\bMulticast\b/g,     'kw-multi'],
  [/\bTempo\b/g,         'kw-tempo'],
  [/\bDestroy(?:ed)?\b/g, 'kw-destroy'],
  [/\bDestruct(?:ion)?\b/gi, 'kw-destroy'],
  [/\bTransform\b/g,     'kw-transform'],
  [/\bRepair\b/g,        'kw-repair'],
  [/\bChilled?\b/g,      'kw-chilled'],
  [/\bHeated?\b/g,       'kw-heated'],
  [/\bDamage\b/g,        'kw-damage'],
  [/\bShield\b/g,        'kw-shield'],
  [/\bHealth\b/g,        'kw-health'],
  [/\bHeal\b/g,          'kw-heal'],
  [/\bRegen\b/g,         'kw-regen'],
  [/\bValue\b/g,         'kw-value'],
  [/\bGold\b/g,          'kw-gold'],
  [/\bPoison\b/g,        'kw-poison'],
  [/\bBurn\b/g,          'kw-burn'],
  [/\bFreeze\b/g,        'kw-freeze'],
  [/\bFrozen?\b/g,       'kw-freeze'],
  [/\bSlow\b/g,          'kw-slow'],
  [/\bSlowed?\b/g,       'kw-slow'],
  [/\bHaste\b/g,         'kw-haste'],
  [/\bHasted?\b/g,       'kw-haste'],
  [/\bCharge\b/g,        'kw-charge'],
  [/\bReload\b/g,        'kw-reload'],
  [/\bCrit\b/g,          'kw-crit'],
  [/\bAmmo\b/g,          'kw-ammo'],
  [/\bQuest\b/g,         'kw-quest'],
  [/\bFlying\b/g,        'kw-fly'],
  [/\bEnrage\b/g,        'kw-rage'],
  [/\bRage\b/g,          'kw-rage'],
];

// ── Coloration FR ────────────────────────────────────────────────────────────
// Le texte des tooltips est maintenant en français ; KW_MAP (ci-dessus) ne
// matche que l'anglais et devient inoffensif mais inutile sur ce texte.
// IMPORTANT : \b en JS ne reconnaît que les lettres ASCII comme "caractère de
// mot" — un mot commençant/finissant par un accent (Éthéré, Gèle...) ne serait
// PAS détecté correctement avec \b. On utilise donc des lookaround Unicode.
function wb(str) {
  const esc = str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![\\p{L}\\p{N}_])(?:${esc})(?![\\p{L}\\p{N}_])`, 'gu');
}

// Une entrée par forme trouvée (variantes/conjugaisons incluses) → même classe
// que l'équivalent anglais dans KW_MAP, pour rester visuellement cohérent.
// Certains mots-clés (Lifesteal, Value, Gold, Quest) n'étaient pas dans le CSV
// fourni : traduction probable ajoutée, À CONFIRMER. Gold/"Or" est volontairement
// désactivé (collision avec la conjonction française "or" très fréquente).
const KW_MAP_FR = [
  // Plus long/spécifique d'abord pour éviter qu'un terme court ne matche en premier
  [['Chances de Crit', 'Coup Crit', 'Crit'],                         'kw-crit'],
  [['Vol de Vie'],                                                   'kw-life'],
  [['Répétition'],                                                   'kw-multi'],
  // "Tempo" : supposé non traduit (terme musical déjà français) — À CONFIRMER
  // une fois translations_fr.csv mis à jour ; corriger la forme ici si besoin.
  [['Tempo'],                                                        'kw-tempo'],
  [['Détruit', 'Détruits', 'Détruite', 'Détruites', 'Détruisez'],    'kw-destroy'],
  [['Destruction'],                                                  'kw-destroy'],
  [['Transforme', 'Transforment', 'Transformez', 'Transformé', 'Transformés'], 'kw-transform'],
  [['Répare', 'Réparent', 'Réparez', 'Réparé', 'Réparer'],           'kw-repair'],
  [['Refroidi', 'Refroidis', 'Refroidie', 'Refroidies'],             'kw-chilled'],
  [['Chauffé', 'Chauffés', 'Chauffée', 'Chauffées'],                 'kw-heated'],
  [['Dégâts'],                                                       'kw-damage'],
  [['Enrage', 'Enrager', 'Enragé', 'Enragez', 'Enragement'],         'kw-rage'],
  [['Rage'],                                                         'kw-rage'],
  [['Protection'],                                                   'kw-shield'],
  [['Protège', 'Protégé', 'Protégez', 'Protégés'],                   'kw-shield'],
  [['Santé Max'],                                                     'kw-health'],
  [['Santé'],                                                        'kw-health'],
  [['Soigne', 'Soignez', 'Soigné'],                                  'kw-heal'],
  [['Soin'],                                                         'kw-heal'],
  [['Régénération'],                                                 'kw-regen'],
  [['Valeur'],                                                       'kw-value'],
  [['Or'],                                                           'kw-gold'],
  [['Poison', 'Empoisonné', 'Empoisonne', 'Empoisonnez', 'Empoisonnés'], 'kw-poison'],
  [['Brûlure', 'Brûle', 'Brûlé', 'Brûlez', 'Brûlés'],                'kw-burn'],
  [['Gèle', 'Gèlent', 'Gelez', 'Geler'],                             'kw-freeze'],
  [['Gelé', 'Gelés', 'Gelée', 'Gelées', 'Gel'],                      'kw-freeze'],
  [['Ralentissement', 'Ralentissent', 'Ralentissez', 'Ralentir', 'Ralentit'], 'kw-slow'],
  [['Ralenti', 'Ralentis', 'Ralentie', 'Ralenties'],                 'kw-slow'],
  [['Hâte', 'Hâtez', 'Hâter'],                                       'kw-haste'],
  [['Hâté', 'Hâtés', 'Hâtée', 'Hâtées'],                             'kw-haste'],
  [['Charge'],                                                       'kw-charge'],
  [['Recharge', 'Rechargez', 'Rechargé'],                            'kw-reload'],
  [['Munitions', 'Munition', 'Munition(s)'],                         'kw-ammo'],
  [['Quête', 'Quêtes'],                                              'kw-quest'],
  [['Volant', 'Volante', 'Volants', 'Volantes', 'Vole', 'Volent', 'Voler'], 'kw-fly'],
  // Tags (mêmes mots que les badges d'en-tête), pour les mentions inline dans le texte
  [['Accessoire', 'Accessoires'],                                    'kw-tag'],
  [['Aquatique', 'Aquatiques'],                                      'kw-tag'],
  [['Cœur', 'Cœurs'],                                                'kw-tag'],
  [['Dinosaure', 'Dinosaures'],                                      'kw-tag'],
  [['Dragon', 'Dragons'],                                            'kw-tag'],
  [['Drone', 'Drones'],                                              'kw-tag'],
  [['Nourriture', 'Nourritures'],                                    'kw-tag'],
  [['Ami', 'Amis'],                                                  'kw-tag'],
  [['Butin', 'Butins'],                                              'kw-tag'],
  [['Potion', 'Potions'],                                            'kw-tag'],
  [['Propriété', 'Propriétés'],                                      'kw-tag'],
  [['Rayon', 'Rayons'],                                              'kw-tag'],
  [['Réactif', 'Réactifs'],                                          'kw-tag'],
  [['Relique', 'Reliques'],                                          'kw-tag'],
  [['Outil', 'Outils'],                                              'kw-tag'],
  [['Jouet', 'Jouets'],                                              'kw-tag'],
  [['Piège', 'Pièges'],                                              'kw-tag'],
  [['Véhicule', 'Véhicules'],                                        'kw-tag'],
  [['Arme', 'Armes'],                                                'kw-tag'],
  [['Tech'],                                                         'kw-tag'],
  [['Délai d\'Activation', 'Délais d\'Activation'],                   'kw-charge'],
].flatMap(([forms, cls]) => forms.map(f => [wb(f), cls]));

/* Un mot-clé publié est du texte quelconque : il peut contenir des caractères
   qui ont un sens dans une expression régulière, et les limites de mot « \b »
   ne fonctionnent pas hors alphabet latin — en japonais ou en chinois, elles
   empêcheraient toute correspondance. On les n'applique donc que lorsque le mot
   commence et finit par un caractère de mot. */
const _regexMot = new Map();

function motEntier(mot) {
  let re = _regexMot.get(mot);
  if (re) { re.lastIndex = 0; return re; }

  const echappe = mot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  // Les limites de mot ne valent que pour l'alphabet latin : en japonais ou en
  // chinois, « \b » empêcherait toute correspondance. On ne les pose donc que
  // si le mot commence, ou finit, par un caractère alphanumérique.
  const debut = /^\w/.test(mot) ? '\\b' : '';
  const fin   = /\w$/.test(mot) ? '\\b' : '';

  re = new RegExp(debut + echappe + fin, 'g');
  _regexMot.set(mot, re);
  return re;
}

function colorize(html) {
  if (!html) return '';
  // Coût en Tempo écrit en toutes lettres par le jeu (pas de jeton {} pour
  // cette valeur, ex. "spend 1 Tempo and remove it") — même convention que
  // pour les valeurs résolues via token : icône juste avant le nombre.
  html = outside(html, /\b(\d+)(?=\s+Tempo\b)/g,
    n => `<svg class="kw-icon" viewBox="0 0 18 18" style="color:#c060f0"><use href="#tempo"/></svg>${n}`);
  // KW_MAP_FR d'abord : une regex ne connaît pas la langue, et un mot-clé
  // anglais isolé (ex. "Crit") matcherait aussi bien dans une phrase FR
  // ("Chances de Crit"), la coupant en deux avant que la phrase FR complète
  // n'ait sa chance de matcher. Cf. règle générale : le plus spécifique d'abord.
  /* Mots-clés publiés avec les données, traduits par le jeu lui-même. Ils
     couvrent toutes les langues ; les listes intégrées ci-dessous ne servent
     plus que de secours pour le français et l'anglais. */
  const p = publies();
  if (p && Array.isArray(p.mots_cles) && p.mots_cles.length) {
    for (const [mot, cls] of p.mots_cles) {
      html = outside(html, motEntier(mot), m => `<span class="${cls}">${m}</span>`);
    }
  } else if (enFrancais()) {
    for (const [re, cls] of KW_MAP_FR) {
      html = outside(html, re, m => `<span class="${cls}">${m}</span>`);
    }
  }
  /* La passe anglaise ne s'applique QUE faute de glossaire publié. Exécutée
     après lui, elle coloriait « Crit » à l'intérieur de « Chance de Crit »,
     empêchant le mot-clé complet d'être reconnu. C'est le conflit de découpe
     déjà rencontré avec « Santé Max ». */
  if (!(p && Array.isArray(p.mots_cles) && p.mots_cles.length)) {
    for (const [re, cls] of KW_MAP) {
      html = outside(html, re, m => `<span class="${cls}">${m}</span>`);
    }
  }
  html = outside(html, /\b(\d[\d,.]*)\s*(second[s]?|sec)\b/gi,
    (_, n, u) => `<span class="kw-sec">${n} ${u}</span>`);
  html = outside(html, /\b\d[\d,.]*%\b/g,
    m => `<span class="kw-num">${m}</span>`);
  return html;
}

// Applique fn seulement hors des <span> existants
function outside(html, re, fn) {
  return html.split(/(<span[^>]*>[\s\S]*?<\/span>)/g)
    .map((p, i) => i % 2 === 1 ? p : p.replace(re, fn))
    .join('');
}

function esc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ── SSE ───────────────────────────────────────────────────────────────────────
// (connexion SSE retirée : les données arrivent par le canal Twitch)


window.showItem = showItem;
window.showError = showError;
