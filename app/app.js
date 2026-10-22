'use strict';

const fs    = require('node:fs');
const path  = require('node:path');
const http  = require('node:http');
const { spawn, execFileSync } = require('node:child_process');

const pubsub = require('./twitch-pubsub');

function estAutonome() {
  try {
    return require('node:sea').isSea();
  } catch (e) {
    return !/^node(\.exe)?$/i.test(path.basename(process.execPath));
  }
}

const APP_DIR = estAutonome() ? path.dirname(process.execPath) : __dirname;

const RELAIS_PAR_DEFAUT = 'https://bazaar-relais.kwev-stream.workers.dev';

const LOCALES = {
  en: 'en-US', fr: 'fr-FR', de: 'de-DE', es: 'es-ES', it: 'it-IT',
  pt: 'pt-BR', ko: 'ko-KR', zh: 'zh-CN', tr: 'tr-TR',
};

let _langueAffichage = 'en';
let _requeteTrad = null;
let _connexionTrad = null;
const _cacheTrad = new Map();

function fichiersTraduction(langue) {
  const bas = process.env.LOCALAPPDATA
    ? path.join(process.env.LOCALAPPDATA, '..', 'LocalLow')
    : (process.env.APPDATA ? path.join(process.env.APPDATA, '..', 'LocalLow') : null);
  if (!bas) return [];

  const racine = path.join(bas, 'Tempo Storm', 'The Bazaar');
  const nom = (LOCALES[langue] || langue) + '.bytes';

  return ['prod', 'ptr', 'staging']
    .map(b => path.join(racine, b, 'cache', 'translations', nom))
    .filter(p => fs.existsSync(p));
}

function ouvrirTraductions(langue) {
  if (_connexionTrad) { try { _connexionTrad.close(); } catch (e) {} }
  _connexionTrad = null;
  _requeteTrad = null;
  _cacheTrad.clear();
  _langueAffichage = langue;

  if (langue === 'en') return;

  const fichier = fichiersTraduction(langue)[0];
  if (!fichier) return;

  try {
    const { DatabaseSync } = require('node:sqlite');
    _connexionTrad = new DatabaseSync(fichier, { readOnly: true });
    _requeteTrad = _connexionTrad.prepare(
      'SELECT text FROM translation WHERE hash = ? LIMIT 1');
  } catch (e) {
    _connexionTrad = null;
    _requeteTrad = null;
  }
}

function traduire(texte) {
  if (!texte || !_requeteTrad) return texte;
  if (_cacheTrad.has(texte)) return _cacheTrad.get(texte);
  let out = texte;
  try {
    const h = require('node:crypto').createHash('md5').update(texte, 'utf8').digest('hex');
    const r = _requeteTrad.get(h);
    if (r && r.text) out = r.text;
  } catch (e) { /* on garde l'anglais */ }
  _cacheTrad.set(texte, out);
  return out;
}

const PORT       = 3210;

/* ── Protection du serveur local ──────────────────────────────────────────
   La fenêtre de l'application est une page servie sur 127.0.0.1. N'importe
   quel site ouvert dans le navigateur du streamer peut lui aussi envoyer des
   requêtes à cette adresse. Sans garde-fou, une page piégée pouvait réécrire
   config.ini (et y glisser un faux relais qui aurait reçu le jeton du
   streamer), ou imposer son propre jeton par /oauth.

   Trois verrous :
   - l'hôte demandé doit être 127.0.0.1 ou localhost : un nom de domaine
     pointé ici (« DNS rebinding ») est refusé ;
   - les routes qui lisent ou modifient la configuration exigent un en-tête
     portant un secret tiré au lancement. Seule la fenêtre servie par
     l'application le connaît, et un autre site ne peut ni le lire ni
     envoyer d'en-tête personnalisé ;
   - le retour de connexion Twitch n'est accepté qu'avec le code à usage
     unique remis au départ de cette connexion. */
const JETON_LOCAL = require('node:crypto').randomBytes(18).toString('hex');
let codeConnexion = null;
let codeConnexionExpire = 0;
const ROUTES_PROTEGEES = ['/config', '/connexion', '/parcourir', '/langue', '/fermer',
                          '/maj/installer', '/maj/annuler'];

function echapperHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* Ajouté en tête de la fenêtre : le secret, et l'envoi automatique de
   celui-ci avec chaque requête vers l'application. interface.html n'a donc
   pas à changer. */
const ENTETE_FENETRE = '<meta name="jeton-local" content="' + JETON_LOCAL + '">'
  + '<script>(function(){var j=' + JSON.stringify(JETON_LOCAL) + ',f=window.fetch;'
  + 'window.fetch=function(u,o){o=o||{};if(typeof u==="string"&&u.charAt(0)==="/"){'
  + 'var h={};var e=o.headers||{};for(var k in e)h[k]=e[k];h["X-Jeton"]=j;o.headers=h;}'
  + 'return f.call(this,u,o);};})();</script>';
const CONFIG_INI = path.join(APP_DIR, 'config.ini');
const INTERVALLE = 1000;

const CONFIG_DEFAUT = [
  '# Bazaar Scanner - configuration',
  '#',
  '# RELAY_TOKEN : rempli automatiquement par « Se connecter avec Twitch ».',
  '# STEAM_PATH  : The Bazaar installé par Steam.',
  '# TEMPO_PATH  : The Bazaar installé par le client Tempo.',
  '# SOURCE      : celle des deux que l\'application lit, steam ou tempo.',
  '# BAZAAR_PATH : recopie de la source retenue. Détecté automatiquement au',
  '#               premier lancement dans la plupart des cas.',
  '# CADRE       : où se trouve le jeu dans votre scène OBS, en pourcentage',
  '#               (gauche,haut,largeur,hauteur). Vide = plein cadre.',
  '#               Renseigné par le bouton Calibrer, pas à la main.',
  '',
  'RELAY_TOKEN=',
  'TWITCH_NOM=',
  'STEAM_PATH=',
  'TEMPO_PATH=',
  'SOURCE=steam',
  'BAZAAR_PATH=',
  'CADRE=',
  'TAILLE=m',
  '# DELAI_STREAM : délai de votre stream, en secondes. 2 par défaut.',
  '#               Il s\'AJOUTE au retard de l\'extension. À régler si vous',
  '#               diffusez en différé, en tournoi par exemple.',
  'DELAI_STREAM=2',
  '',
].join('\r\n');

function adresseRelais() {
  const perso = (config.RELAY_URL || '').trim();
  return (perso || RELAIS_PAR_DEFAUT).replace(/\/$/, '');
}

function lireConfig() {
  const cfg = {};
  if (!fs.existsSync(CONFIG_INI)) return cfg;
  for (const ligne of fs.readFileSync(CONFIG_INI, 'utf8').split(/\r?\n/)) {
    const t = ligne.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i > 0) cfg[t.slice(0, i).trim()] = t.slice(i + 1).trim();
  }
  return cfg;
}

function ecrireConfig(maj) {
  /* Changer le délai en cours de partie vide la file d'attente : des plateaux
     calés sur l'ancienne valeur paraîtraient au mauvais moment. */
  if (maj && maj.DELAI_STREAM !== undefined
      && String(maj.DELAI_STREAM) !== String(config.DELAI_STREAM)) {
    reinitialiserFileDiffusion();
  }

  const actuel = lireConfig();
  const fusion = Object.assign(actuel, maj);
  const lignes = CONFIG_DEFAUT.split('\r\n').map(l => {
    const i = l.indexOf('=');
    if (i <= 0 || l.startsWith('#')) return l;
    const cle = l.slice(0, i);
    return cle + '=' + (fusion[cle] || '');
  });
  fs.writeFileSync(CONFIG_INI, lignes.join('\r\n'), 'utf8');
  return fusion;
}

function jeuValide(dossier) {
  /* L'exécutable, et non le dossier voisin : c'est lui que l'installateur
     demande, et c'est lui qu'il vérifie. Chercher autre chose rendait les
     messages incohérents. */
  return !!dossier && fs.existsSync(path.join(dossier, 'TheBazaar.exe'));
}

/* Cherche The Bazaar installé par le client Tempo.
 *
 * Le client se loge dans AppData\Roaming sous un nom qui varie avec la
 * version : « Tempo Launcher - Beta », « Tempo Launcher - Internal Staging ».
 * On balaie donc tout ce qui commence par « Tempo Launcher », en écartant les
 * environnements de développement, qui ne sont pas ceux des joueurs. */
function detecterTempo() {
  const racine = process.env.APPDATA;
  if (!racine) return null;

  let noms;
  try { noms = fs.readdirSync(racine); } catch (e) { return null; }

  let repli = null;

  for (const nom of noms) {
    if (!nom.startsWith('Tempo Launcher')) continue;

    const dossier = path.join(racine, nom, 'game', 'buildx64');
    if (!jeuValide(dossier)) continue;

    if (/Internal|Staging/i.test(nom)) {
      if (!repli) repli = dossier;
      continue;
    }
    return dossier;
  }

  return repli;
}

function detecterJeu() {
  const candidats = [];

  try {
    const sortie = execFileSync('reg',
      ['query', 'HKCU\\Software\\Valve\\Steam', '/v', 'SteamPath'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const m = sortie.match(/SteamPath\s+REG_SZ\s+(.+)/);
    if (m) {
      const steam = m[1].trim().replace(/\//g, '\\');
      candidats.push(path.join(steam, 'steamapps', 'common', 'The Bazaar'));

      const vdf = path.join(steam, 'steamapps', 'libraryfolders.vdf');
      if (fs.existsSync(vdf)) {
        const texte = fs.readFileSync(vdf, 'utf8');
        const re = /"path"\s+"([^"]+)"/g;
        let x;
        while ((x = re.exec(texte)) !== null) {
          candidats.push(path.join(x[1].replace(/\\\\/g, '\\'),
            'steamapps', 'common', 'The Bazaar'));
        }
      }
    }
  } catch (e) { /* pas de Steam, ou pas Windows : on continue */ }

  for (const lettre of ['C', 'D', 'E', 'F']) {
    candidats.push(`${lettre}:\\Steam\\steamapps\\common\\The Bazaar`);
    candidats.push(`${lettre}:\\Program Files (x86)\\Steam\\steamapps\\common\\The Bazaar`);
  }

  return candidats.find(jeuValide) || null;
}

const etat = {
  code: 'demarrage',
  detail: '',
  objets: 0,
  talents: 0,
  plateau: [],
  listeTalents: [],

  face: [],
  faceTalents: [],
  reserve: [],
  faceTitre: '',
  faceCentree: false,

  /* La partie en cours (barre des jours, victoires, prestige, mode), le
     journal des événements marquants, et le diagnostic. */
  partie: null,
  journal: [],
  diag: null,
};

const abonnes = new Set();

/* Les motifs que l'application transmet à sa fenêtre. Ce sont des CODES, non
   des phrases : la fenêtre les traduit dans sa propre langue. Envoyer du
   texte tout fait affichait du français dans une interface anglaise. */
const MOTIFS = {
  twitch:   'twitch',      // aucun compte connecté
  dossier:  'dossier',     // dossier du jeu introuvable
  ferme:    'ferme',       // le jeu n'est pas lancé
  horsJeu:  'horsJeu',     // lancé, mais aucune partie en cours
};

/* Le chemin que lit l'application découle de la source retenue. Les deux
   clés sont tenues d'accord ici plutôt qu'aux quatre endroits qui les
   consultent. */
/* Le mod vit dans BepInEx, à côté du jeu. Sa seule présence suffit : s'il est
   là, BepInEx l'est aussi, l'installateur posant les deux ensemble. */
function modInstalle(dossier) {
  if (!dossier) return false;
  return fs.existsSync(path.join(dossier, 'BepInEx', 'plugins',
    'BazaarScannerBridge', 'BazaarScannerBridge.dll'));
}

function cheminActif(cfg) {
  const source = (cfg.SOURCE === 'tempo') ? 'TEMPO_PATH' : 'STEAM_PATH';
  return cfg[source] || cfg.BAZAAR_PATH || '';
}

function definirEtat(code, detail) {
  if (etat.code === code && etat.detail === (detail || '')) return;
  etat.code = code;
  etat.detail = detail || '';
  diffuserEtat();
}

function diffuserEtat() {
  try { majDiagnostic(); } catch (e) { /* le diagnostic ne doit rien bloquer */ }
  try { majEtatMiseAJour(); } catch (e) { /* pas encore prête au démarrage */ }
  const charge = 'data: ' + JSON.stringify(etat) + '\n\n';
  for (const r of abonnes) { try { r.write(charge); } catch (e) { /* client parti */ } }
}

const LARGEUR_PAR_TAILLE = { Small: 5.1, Medium: 9.8, Large: 14.5 };

const SLOTS_PAR_TAILLE = { Small: 1, Medium: 2, Large: 3 };

function cartesCompactes(liste, avecPosition) {
  if (!Array.isArray(liste)) return [];
  return liste
    .filter(c => c && c.TemplateId)
    .sort((a, b) => (a.Socket || 0) - (b.Socket || 0))
    .map(c => {
      /* La taille n'est envoyée qu'au-delà d'une case : l'extension compte 1
         quand elle manque. Six octets de moins par petit objet. */
      const it = { s: c.Socket || 0, id: idCourt(c.TemplateId) };
      const cases = SLOTS_PAR_TAILLE[c.Size] || 1;
      if (cases !== 1) it.n = cases;
      if (c.Enchantment && c.Enchantment !== 'None') it.e = c.Enchantment;
      if (c.Tier) it.q = rareteCourte(c.Tier);

      const type = String(c.Type || '');
      const rencontre = /Encounter$/.test(type);

      if (/Encounter/.test(type)) it.k = 'e';
      else if (type === 'Skill')  it.k = 's';
      if ((avecPosition || rencontre) && typeof c.X === 'number') {
        it.x = Math.round(c.X * 10) / 10;
        if (typeof c.W === 'number') it.w = Math.round(c.W * 10) / 10;

        if (typeof c.Y === 'number') it.y = Math.round(c.Y * 10) / 10;
        if (typeof c.H === 'number') it.h = Math.round(c.H * 10) / 10;
      }
      if (rencontre) it.r = 1;

      if (Array.isArray(c.SocketEffects) && c.SocketEffects.length) {
        it.se = c.SocketEffects.map(e => {
          const [id, code] = String(e).split('|');
          /* L'identifiant raccourci, comme celui des cartes : l'extension
             retrouve la fiche par son début. 28 octets de moins par effet. */
          return code ? { i: idCourt(id), k: code } : { i: idCourt(id) };
        });
      }

      /* L'avancement des quêtes, compact : « 14/25,13/15,0/1 », dans l'ordre
         des quêtes de la carte. Quelques octets, et seulement pour un objet
         qui a des quêtes. */
      /* Les valeurs vivantes des jetons, calculées par le jeu : « a1=6;a1.mod=3 ».
         « a » pour aura, « b » pour ability, deux décimales au plus. */
      const jv = valeursVivantes(c.Jetons);
      if (jv) it.jv = jv;

      /* La chance de critique, telle que le jeu la tient : elle évolue au fil
         d'un combat. */
      /* Rien à 0 : l'extension n'affiche de ligne de critique qu'au-dessus. */
      if (typeof c.Crit === 'number' && c.Crit > 0) it.cc = c.Crit;

      /* Le Multicast tel que le jeu le tient : certains objets en gagnent ou
         en perdent en combat (Anaconda, Mecha Dragon en Shiny...). Envoyé même
         à 1, pour qu'un objet qui retombe à 1 perde sa ligne « Multicast ».
         Absent quand le jeu n'en donne pas : la fiche garde alors sa valeur. */
      if (typeof c.Multicast === 'number') it.mc = c.Multicast;

      /* Le délai d'activation actuel, en secondes à un chiffre après la
         virgule (3599 ms donnent 3.6) : il change en combat (Honey Badger,
         Seashadow). Seulement pour un objet qui en a un. */
      if (typeof c.Delai === 'number' && c.Delai > 0) it.cd = Math.round(c.Delai / 100) / 10;

      /* Les munitions maximales actuelles, pour un objet qui en a. */
      if (typeof c.Munitions === 'number' && c.Munitions > 0) it.am = c.Munitions;

      /* Les tags gagnés en partie (absents du modèle), le plus souvent aucun.
         Tous, sans plafond : un message trop gros est allégé dans
         twitch-pubsub.js, où les tags font partie de ce qu'on retire. */
      if (Array.isArray(c.TagsAjoutes) && c.TagsAjoutes.length) {
        it.ta = c.TagsAjoutes.filter(t => typeof t === 'string' && t);
      }

      if (Array.isArray(c.Quests) && c.Quests.length) {
        it.qp = c.Quests.map(q => (q && q.length >= 2) ? (q[0] | 0) + '/' + (q[1] | 0) : '0/0').join(',');
      }

      if (type === 'PvpEncounter')    { it.vs = 'pvp'; it.nm = c.Name || ''; }
      if (type === 'CombatEncounter') { it.vs = 'pve'; it.nm = c.Name || ''; }
      return it;
    });
}

/* ── Le diagnostic de la fenêtre ───────────────────────────────────────────
   Ce qu'on vérifiait à la main quand « rien ne marche » : la version du mod
   qui écrit board_state.json, la date de la DLL dans chaque installation, la
   date des données publiées, le relais Twitch, et le poids du dernier
   message. Relevé toutes les dix secondes au plus : la date d'un fichier ne
   change pas plus vite. */
/* Depuis la V3, le mod porte le même numéro que l'application. */
const MOD_ATTENDU = '3.0.0';
let versionJeuVue = null;       // Application.version, lue par le mod
let derniereEcritureMod = null; // date du dernier board_state.json lu
let modVu = null;
let diagnosticRelevé = 0;

function dateDll(dossier) {
  if (!dossier) return null;
  try {
    const f = path.join(dossier, 'BepInEx', 'plugins', 'BazaarScannerBridge', 'BazaarScannerBridge.dll');
    return fs.statSync(f).mtimeMs;
  } catch (e) { return null; }
}

function majDiagnostic() {
  const maintenant = Date.now();
  const liaison = pubsub.etat ? pubsub.etat() : {};
  if (!etat.diag || maintenant - diagnosticRelevé > 10000) {
    diagnosticRelevé = maintenant;
    etat.diag = {
      modAttendu: MOD_ATTENDU,
      steam: config.STEAM_PATH ? { dll: dateDll(config.STEAM_PATH) } : null,
      tempo: config.TEMPO_PATH ? { dll: dateDll(config.TEMPO_PATH) } : null,
      source: (config.SOURCE === 'tempo') ? 'tempo' : 'steam',
    };
  }
  etat.diag.mod = modVu;
  etat.diag.jeu = versionJeuVue;
  etat.diag.lecture = derniereEcritureMod;
  etat.diag.donnees = donneesEnLigne;
  etat.diag.relais = { connecte: liaison.connecte, erreur: liaison.erreur || '' };
  etat.diag.message = liaison.dernierMessage || null;
  etat.diag.envois = liaison.statistiques || null;
  etat.diag.version = { app: VERSION, enLigne: versionEnLigne };
  /* Le délai ajouté avant l'envoi : plateaux en file, et prochain envoi. */
  const d = lireDelaiStream();
  etat.diag.delai = d > 0 ? { s: d, attente: fileDiffusion.length,
                               prochain: fileDiffusion.length ? fileDiffusion[0].quand : null } : null;
}

/* Le journal de partie : les derniers événements marquants, pour la
   fenêtre. Des codes, traduits par la fenêtre dans sa langue. */
function noter(type, details) {
  etat.journal.unshift(Object.assign({ t: Date.now(), type }, details || {}));
  if (etat.journal.length > 40) etat.journal.length = 40;
}

/* Les talents qui changent de rareté, notés au journal. */
let raretesTalents = null;
const RANG_RARETE = { Bronze: 0, Silver: 1, Gold: 2, Diamond: 3, Legendary: 4 };
function suivreTalents(state) {
  const actuel = new Map();
  for (const c of (state && state.Skills) || []) {
    if (c && c.TemplateId) actuel.set(c.TemplateId, { nom: traduire(c.Name) || c.Name || '?', q: c.Tier });
  }
  if (raretesTalents) {
    for (const [id, v] of actuel) {
      const avant = raretesTalents.get(id);
      if (avant && (RANG_RARETE[v.q] || 0) > (RANG_RARETE[avant.q] || 0)) {
        noter('talent', { nom: v.nom, rarete: v.q });
      }
    }
  }
  raretesTalents = actuel;
}

/* ── L'historique des jours, pour le compteur de victoires ──────────────────
   Le jeu ne garde pas l'historique des combats ; on le reconstitue au fil de
   la partie avec ce que le mod lit déjà :
     - les victoires qui montent : le PVP du jour est gagné (« v ») ;
     - le prestige qui baisse : il est perdu (« d ») ;
     - une défaite qui aurait mis le prestige à zéro et le laisse à 1, ou un
       prestige qui remonte de 0 à 1 : le refus de la mort (« r »).
   Un résultat va au premier jour sans résultat : l'ordre de lecture du jour
   et des compteurs ne compte donc pas.

   L'application lancée en cours de partie ne connaît que les totaux : les
   jours déjà joués sont alors posés groupés, victoires d'abord. L'historique
   est gardé dans un fichier, pour survivre à un redémarrage de l'application
   pendant la partie. */
const CHEMIN_PARTIE = path.join(APP_DIR, 'partie-en-cours.json');
let partie = null;
try { partie = JSON.parse(fs.readFileSync(CHEMIN_PARTIE, 'utf8')); } catch (e) { partie = null; }

/* Depuis quand le jeu montre le même jour, les mêmes victoires et le même
   prestige. Voir « jours manqués » dans suivrePartie. */
let constatPartie = { cle: '', depuis: 0 };
const DELAI_CONSTAT_MS = 5000;

/* Au menu principal, après une partie, le jeu garde son objet de partie
   mais le héros y vaut « Common » : ce n'est pas un personnage jouable. On
   le tient pour « hors partie », sans quoi le journal notait une nouvelle
   partie de « Common » à chaque retour au menu. */
function enPartieReelle(state) {
  const h = String((state && state.Hero) || '');
  return h !== '' && h !== 'Common';
}

function suivrePartie(state) {
  if (!enPartieReelle(state)) return null;
  const j = state && state.Jour, vi = state && state.Victoires, pr = state && state.Prestige;
  if (!Number.isInteger(j) || j < 1) return null;
  const entier = x => Number.isInteger(x) ? x : null;
  const avant = JSON.stringify(partie);

  const nouvelle = !partie || partie.hero !== (state.Hero || '')
    || j < partie.jour
    || (entier(vi) !== null && entier(partie.vi) !== null && vi < partie.vi);
  if (nouvelle) {
    const victoires = entier(vi) || 0;
    const defaites = Math.max(0, (j - 1) - victoires);
    partie = { hero: state.Hero || '', jour: j, vi: entier(vi), pr: entier(pr),
               jours: 'v'.repeat(Math.min(victoires, j - 1)) + 'd'.repeat(defaites) };
    noter('partie', { hero: partie.hero, jour: j });
    raretesTalents = null;
  }

  const poser = (r) => {
    const libre = partie.jours.length;            // le premier jour sans résultat
    if (libre < Math.max(j, partie.jour)) {
      partie.jours += r;
      noter(r === 'v' ? 'victoire' : (r === 'r' ? 'refus' : 'defaite'), { jour: libre + 1 });
    }
  };

  if (!nouvelle) {
    if (entier(vi) !== null && entier(partie.vi) !== null && vi > partie.vi) {
      for (let k = partie.vi; k < vi; k++) poser('v');
    }
    if (entier(pr) !== null && entier(partie.pr) !== null) {
      if (pr < partie.pr) {
        /* La perte vaut le jour : si elle devait vider le prestige et qu'il
           en reste 1, c'est le refus de la mort. */
        poser(pr === 1 && partie.pr - Math.max(j, partie.jour) <= 0 ? 'r' : 'd');
      } else if (partie.pr === 0 && pr === 1 && partie.jours.endsWith('d')) {
        partie.jours = partie.jours.slice(0, -1) + 'r';
        noter('refus', { jour: partie.jours.length });
      }
    }
  }
  /* Les jours manqués. Une partie reprise après coup, ou une défaite subie
     pendant que l'application était fermée, laissait un trou : au jour 8 avec
     6 victoires, l'historique n'en comptait que 6, sans la défaite, et
     l'extension montrait deux cristaux vides.

     Le jeu, lui, est formel : au jour J, J - 1 jours sont joués, et tous ceux
     qui ne sont pas des victoires sont des défaites. Quand toutes les
     victoires sont déjà notées, les jours qui manquent sont donc des
     défaites. On ne sait pas QUAND elles ont eu lieu : elles se placent dans
     le trou, comme pour une partie découverte en cours de route.

     Seulement après cinq secondes sans changement : le jeu ne met pas
     forcément le jour et les victoires à jour au même instant, et une victoire
     en cours d'enregistrement ne doit pas passer pour une défaite. */
  const joues = j - 1;
  if (entier(vi) !== null && partie.jours.length < joues
      && (partie.jours.match(/v/g) || []).length >= vi) {
    const cle = j + '/' + vi + '/' + (entier(pr) === null ? '' : pr);
    if (constatPartie.cle !== cle) constatPartie = { cle, depuis: Date.now() };
    else if (Date.now() - constatPartie.depuis >= DELAI_CONSTAT_MS) {
      while (partie.jours.length < joues) {
        partie.jours += 'd';
        noter('defaite', { jour: partie.jours.length });
      }
    }
  }

  partie.jour = j;
  if (entier(vi) !== null) partie.vi = vi;
  if (entier(pr) !== null) partie.pr = pr;

  if (JSON.stringify(partie) !== avant) {
    try { fs.writeFileSync(CHEMIN_PARTIE, JSON.stringify(partie)); } catch (e) { /* sans gravité */ }
  }
  return partie.jours.slice(0, j);
}

function toCompact(state) {
  return cartesCompactes(state && state.Board, false);
}

/* Les valeurs vivantes des jetons, calculées par le jeu : « a1=6;a1.mod=3 ».
   « a » pour aura, « b » pour ability ; un attribut garde son nom, comme
   « Custom_0=3 ». Deux décimales au plus. */
/* Les identifiants et raretés, raccourcis pour le message vers Twitch : les
   huit premiers caractères d'un identifiant suffisent à reconnaître une carte
   parmi celles du jeu, l'export le vérifie ; la rareté tient en une lettre.
   Un talent passe ainsi d'une soixantaine d'octets à une trentaine : quarante
   talents à deux joueurs, situation fréquente, approchaient la limite. */
function idCourt(id) {
  return String(id || '').replace(/-/g, '').slice(0, 8).toLowerCase();
}
function rareteCourte(q) {
  return ({ Bronze: 'B', Silver: 'S', Gold: 'G', Diamond: 'D', Legendary: 'L' })[q] || q;
}

function valeursVivantes(jetons) {
  if (!jetons || typeof jetons !== 'object') return '';
  return Object.entries(jetons)
    .map(([k, v]) => k.replace(/^aura\./, 'a').replace(/^ability\./, 'b') + '=' + (Math.round(v * 100) / 100))
    .join(';');
}

function talentsCompacts(liste) {
  if (!Array.isArray(liste)) return [];
  return liste
    .filter(c => c && c.TemplateId)
    .map((c, i) => {
      const sk = { s: typeof c.Socket === 'number' ? c.Socket : i, id: idCourt(c.TemplateId) };
      if (c.Tier) sk.q = rareteCourte(c.Tier);
      const jv = valeursVivantes(c.Jetons);
      if (jv) sk.jv = jv;
      return sk;
    })
    .sort((a, b) => a.s - b.s);
}

function skillsToCompact(state) {
  return talentsCompacts(state && state.Skills);
}

function apercuCartes(liste) {
  if (!Array.isArray(liste)) return [];
  return liste
    .filter(c => c && c.TemplateId)
    .sort((a, b) => (a.Socket || 0) - (b.Socket || 0))
    .map(c => ({
      s: c.Socket || 0,
      n: SLOTS_PAR_TAILLE[c.Size] || 1,
      nom: (c.Type === 'PvpEncounter') ? 'PVP' : (traduire(c.Name) || '?'),
      tier: c.Tier || '',
      ench: (c.Enchantment && c.Enchantment !== 'None') ? c.Enchantment : '',

      se: (c.SocketEffects || [])
        .map(e => String(e).split('|')[1])
        .filter(Boolean),
      x: (typeof c.X === 'number') ? c.X : null,
      y: (typeof c.Y === 'number') ? c.Y : null,
      w: LARGEUR_PAR_TAILLE[c.Size] || 5.2,
      h: (typeof c.H === 'number') ? c.H : null,
      rencontre: /Encounter$/.test(String(c.Type || '')),
    }));
}

function apercuPlateau(state) {
  return apercuCartes(state && state.Board);
}


/* ── Le délai de tournoi ───────────────────────────────────────────────────

   Il s'applique ICI, et non chez le spectateur.

   Retenir les messages dans son navigateur voulait dire qu'un spectateur
   arrivé en cours de route ne verrait rien pendant toute la durée du délai,
   qu'une simple actualisation lui ferait tout perdre, et que mille huit cents
   plateaux resteraient en mémoire pour un délai de trente minutes.

   En retardant l'envoi, le spectateur reçoit une information déjà décalée et
   l'affiche aussitôt : il peut arriver quand il veut, actualiser, fermer son
   onglet. La latence de son lecteur reste traitée chez lui, et les deux
   retards s'additionnent sans se gêner.

   La file ne garde que les plateaux qui CHANGENT : pendant une partie, le
   plateau bouge quelques fois par minute, pas une fois par seconde. Un seul
   minuteur la vide, plutôt qu'un par message. */

const fileDiffusion = [];
let minuteurDiffusion = null;
let dernierPublie = null;

function publierAvecDelai(objets, talents, cadre, extra) {
  /* Le spectateur n'a plus à retarder quoi que ce soit : son lecteur reste
     mesuré de son côté. */
  const charge = { objets, talents, cadre, extra };

  const empreinte = JSON.stringify([objets, talents, extra]);
  const delai = Math.max(0, lireDelaiStream()) * 1000;

  if (!delai) {
    pubsub.publishBoard(objets, talents, cadre, null, extra);
    dernierPublie = empreinte;
    return;
  }

  /* Inutile d'empiler un plateau identique au dernier mis en file. */
  const dernierEnFile = fileDiffusion.length
    ? fileDiffusion[fileDiffusion.length - 1].empreinte : dernierPublie;
  if (empreinte === dernierEnFile) return;

  fileDiffusion.push({ quand: Date.now() + delai, charge, empreinte });
  if (!minuteurDiffusion) minuteurDiffusion = setInterval(viderFile, 500);
}

/* Jeu fermé, ou hors partie : on diffuse un plateau VIDE. Sans lui, les
   spectateurs gardaient à l'écran le dernier plateau et la dernière réserve
   reçus, l'application se taisant simplement. Il passe par la même file que
   les autres, pour qu'un délai de tournoi s'y applique aussi ; les envois
   identiques sont ensuite écartés comme d'habitude. */
let videDiffuse = false;

function publierVide() {
  /* Une seule fois par arrêt : répété, il entretiendrait le flux, et les
     boutons de l'extension resteraient affichés jeu fermé. */
  if (!actif || videDiffuse) return;
  videDiffuse = true;
  try {
    publierAvecDelai([], [], lireCadre(), { delaiStream: lireDelaiStream() });
  } catch (e) { /* rien à diffuser n'est pas une erreur */ }
}

/* Le dernier plateau sorti de la file : celui que montre la vidéo retardée.

   Sans délai, l'application renvoie le plateau toutes les deux secondes, même
   immobile : un spectateur qui arrive le reçoit aussitôt, et l'extension sait
   que l'application tourne (sans nouvelles pendant 30 s, elle retire ses
   zones). La file, elle, n'envoyait que les plateaux qui changent : avec un
   délai de tournoi, un nouveau spectateur attendait le prochain changement,
   et les zones disparaissaient au bout de 30 s de plateau immobile.

   On renvoie donc ce dernier plateau sorti, et lui seul : jamais un plateau
   encore en file, qui dévoilerait le jeu en avance sur la vidéo. publishBoard
   écarte les doublons et n'en laisse passer qu'un toutes les deux secondes.
   Le plateau vide (jeu fermé) n'est pas répété, comme sans délai. */
let dernierSorti = null;

function plateauVide(charge) {
  const x = charge.extra || {};
  return !(charge.objets && charge.objets.length) && !(charge.talents && charge.talents.length)
      && !(x.face && x.face.length) && !(x.reserve && x.reserve.length)
      && !(x.faceTalents && x.faceTalents.length);
}

function rappelerDernierSorti() {
  if (!dernierSorti || !lireDelaiStream() || plateauVide(dernierSorti)) return;
  try {
    pubsub.publishBoard(dernierSorti.objets, dernierSorti.talents,
                        dernierSorti.cadre, null, dernierSorti.extra);
  } catch (e) { /* le prochain essai suffira */ }
}
setInterval(rappelerDernierSorti, 1000);

function viderFile() {
  const maintenant = Date.now();

  while (fileDiffusion.length && fileDiffusion[0].quand <= maintenant) {
    const e = fileDiffusion.shift();
    dernierSorti = e.charge;
    try {
      pubsub.publishBoard(e.charge.objets, e.charge.talents,
                          e.charge.cadre, null, e.charge.extra);
      dernierPublie = e.empreinte;
    } catch (err) { /* une diffusion ratée ne doit pas bloquer la file */ }
  }

  if (!fileDiffusion.length && minuteurDiffusion) {
    clearInterval(minuteurDiffusion);
    minuteurDiffusion = null;
  }
}

/* Changer le délai en cours de partie vide la file : garder des plateaux
   calés sur l'ancienne valeur les ferait paraître au mauvais moment. */
function reinitialiserFileDiffusion() {
  fileDiffusion.length = 0;
  /* Calé sur l'ancien délai, il serait en avance ou en retard sur la vidéo. */
  dernierSorti = null;
  if (minuteurDiffusion) { clearInterval(minuteurDiffusion); minuteurDiffusion = null; }
}

function titreDeLaBande(state) {
  /* « ReserveAffichee » dit que le coffre est ouvert à l'écran ; « Reserve »
     est garnie en permanence et ne dirait rien. */
  if (Array.isArray(state.ReserveAffichee) && state.ReserveAffichee.length) {
    return 'Stash';
  }

  const cartes = Array.isArray(state.Face) ? state.Face : [];
  const rencontre = cartes.filter(c => /Encounter$/.test(String(c.Type || '')));

  if (rencontre.some(c => c.Type === 'PvpEncounter')) return 'PVP';
  if (rencontre.some(c => c.Type === 'CombatEncounter')) return 'PVE';

  if (rencontre.length >= 2) return 'Choices';

  const nomme = rencontre.find(c => c.Name);
  if (nomme) return traduire(nomme.Name) || nomme.Name;

  return cartes.length ? '' : '';
}

function apercuTalents(state) {
  if (!state || !Array.isArray(state.Skills)) return [];
  return state.Skills
    .filter(c => c && c.TemplateId)
    .map((c, i) => ({
      s: typeof c.Socket === 'number' ? c.Socket : i,
      nom: traduire(c.Name) || '?',
      tier: c.Tier || '',
    }))
    .sort((a, b) => a.s - b.s);
}

function lireCadre() {
  const brut = (config.CADRE || '').trim();
  if (!brut) return null;
  const v = brut.split(',').map(x => parseFloat(x));
  if (v.length !== 4 || v.some(x => !isFinite(x))) return null;
  if (v[2] <= 0 || v[3] <= 0) return null;
  if (v[0] === 0 && v[1] === 0 && v[2] === 100 && v[3] === 100) return null;
  return v.map(x => Math.round(x * 100) / 100);
}

/* Version de cette application, inscrite à la construction depuis le fichier
   VERSION. C'est la seule source : l'export et l'installateur le lisent aussi,
   de sorte que les trois ne peuvent plus diverger. */
/* global __VERSION__ */
const VERSION = (() => {
  // Inscrite à la construction par esbuild.
  if (typeof __VERSION__ === 'string') return __VERSION__;

  /* Lancée depuis les sources - « node app.js » -, cette constante n'existe
     pas. On lit alors le fichier VERSION, faute de quoi l'application se
     croit périmée et affiche le bandeau de mise à jour à tort. */
  try {
    const v = fs.readFileSync(path.join(__dirname, 'VERSION'), 'utf8').trim();
    if (v) return v;
  } catch (e) { /* tant pis */ }

  return null;   // version inconnue : on ne compare pas
})();

/* Dernière version publiée, relevée au démarrage puis toutes les six heures.

   Le fichier est celui que l'export publie déjà : y ajouter un champ évite un
   service à maintenir. Une absence de réponse ne change rien - mieux vaut ne
   rien dire que de crier au loup parce que le réseau a hoqueté. */
let versionEnLigne = null;
let donneesEnLigne = null;      // horodatage des données publiées (AAAAMMJJhhmm, UTC)

/* L'installateur de la version publiée : son numéro, son empreinte SHA-256
   et sa taille, publiés par l'export à partir de la release GitHub. */
let installateurEnLigne = null;

/* MAJ_INDEX, dans config.ini : l'adresse d'un fichier de version à lire À LA
   PLACE du fichier publié. Il ne sert qu'à tester la mise à jour sur le PC de
   Kwev, sans rien publier. Lui seul peut aussi fournir l'adresse de
   l'installateur ; sinon, c'est toujours la release GitHub. */
function modeTestMaj() {
  return /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//i.test(String(config.MAJ_INDEX || ''));
}

async function releverVersion() {
  try {
    let r;
    if (modeTestMaj()) {
      r = await fetch(config.MAJ_INDEX, { signal: AbortSignal.timeout(8000), cache: 'no-store' });
    } else {
      const base = (config.DATA_BASE_URL || 'https://bazaar-scanner.pages.dev')
        .replace(/\/+$/, '');
      /* L'index allégé d'abord : l'index complet pèse plus d'un mégaoctet. */
      r = await fetch(base + '/index-extension.json', { signal: AbortSignal.timeout(8000) });
      if (!r.ok) r = await fetch(base + '/index.json', { signal: AbortSignal.timeout(8000) });
    }
    if (!r.ok) return;
    const i = await r.json();
    if (i && typeof i.version_app === 'string') versionEnLigne = i.version_app;
    if (i && typeof i.version === 'string') donneesEnLigne = i.version;

    const inst = i && i.installateur;
    installateurEnLigne = (inst && typeof inst.version === 'string'
                           && /^[0-9a-f]{64}$/i.test(String(inst.sha256 || '')))
      ? { version: inst.version, sha256: inst.sha256.toLowerCase(),
          taille: Number(inst.taille) || 0,
          url: (modeTestMaj() && typeof inst.url === 'string') ? inst.url : null }
      : null;
    majEtatMiseAJour();
    diffuserEtat();
  } catch (e) { /* hors ligne : on n'affirme rien */ }
}

/* ── La mise à jour intégrée ──────────────────────────────────────────────

   Le streamer clique sur le voyant, confirme, et l'application :
   1. télécharge l'installateur de la dernière release GitHub, à une adresse
      qui ne change jamais ;
   2. vérifie que son empreinte est bien celle publiée avec le numéro de
      version : un fichier tronqué, corrompu, ou qui ne correspond pas à la
      version annoncée n'est jamais lancé ;
   3. le lance en mode « mise à jour » (/MAJ), sans pages à cliquer : Windows
      demande l'autorisation, l'installateur reprend les choix précédents, et
      rouvre l'application à la fin ;
   4. se ferme, pour que son exécutable puisse être remplacé.

   Jamais avec le jeu ouvert : le mod ne peut pas être remplacé pendant que le
   jeu le charge, et une mise à jour à moitié faite serait pire que pas de mise
   à jour. En cas d'échec, la fenêtre propose la page GitHub, comme avant. */
/* L'installateur d'une mise à jour précédente reste dans le dossier
   temporaire : on le retire au lancement. S'il tourne encore (c'est lui qui
   vient de rouvrir l'application), Windows refuse et l'on réessaiera au
   prochain lancement. */
try {
  const dossierMaj = path.join(require('node:os').tmpdir(), 'BazaarScanner');
  for (const f of fs.readdirSync(dossierMaj)) {
    try { fs.rmSync(path.join(dossierMaj, f), { force: true }); } catch (e) { /* encore ouvert */ }
  }
} catch (e) { /* rien à nettoyer */ }

const URL_INSTALLATEUR =
  'https://github.com/Kwev-Bzr/bazaar-scanner/releases/latest/download/BazaarScanner_setup.exe';

const miseAJour = {
  etat: 'aucune',      // aucune, dispo, telechargement, lancement, erreur
  recu: 0,
  total: 0,
  erreur: '',          // code : reseau, empreinte, jeu, refus, lancement, absent
  annuler: null,
};

function chiffreMajeur(v) { return parseInt(String(v || '').split('.')[0], 10) || 0; }

function versionPlusRecente(a, b) {
  const x = String(a).split('.').map(Number), y = String(b).split('.').map(Number);
  for (let k = 0; k < Math.max(x.length, y.length); k++) {
    const d = (x[k] || 0) - (y[k] || 0);
    if (d) return d > 0;
  }
  return false;
}

/* Ce que la fenêtre doit savoir : y a-t-il une mise à jour, est-elle majeure,
   peut-on l'installer d'ici (empreinte publiée, même version), où en est-on. */
function majEtatMiseAJour() {
  const dispo = !!(VERSION && versionEnLigne && versionPlusRecente(versionEnLigne, VERSION));
  if (!dispo && miseAJour.etat !== 'lancement') miseAJour.etat = 'aucune';
  else if (dispo && miseAJour.etat === 'aucune') miseAJour.etat = 'dispo';

  etat.maj = {
    etat: miseAJour.etat,
    ici: VERSION,
    version: versionEnLigne,
    majeure: dispo && chiffreMajeur(versionEnLigne) > chiffreMajeur(VERSION),
    integree: dispo && !!installateurEnLigne && installateurEnLigne.version === versionEnLigne,
    recu: miseAJour.recu,
    total: miseAJour.total,
    erreur: miseAJour.erreur,
    jeuOuvert: jeuSembleOuvert(),
  };
}

/* Le jeu tourne-t-il ? Le mod écrit board_state.json chaque seconde tant
   que le jeu est ouvert : un fichier récent suffit à le dire, sans
   interroger Windows à chaque cycle. */
function jeuSembleOuvert() {
  try {
    const fichier = cheminEtatPlateau(config);
    return fs.existsSync(fichier) && !plateauPerime(fichier);
  } catch (e) { return false; }
}

/* Vérification finale, au moment d'installer : le processus lui-même, dans
   les deux installations, que le mod soit en place ou non. */
function jeuLance() {
  try {
    const sortie = execFileSync('tasklist', ['/FI', 'IMAGENAME eq TheBazaar.exe', '/NH'],
      { encoding: 'utf8', windowsHide: true, timeout: 5000 });
    return /TheBazaar\.exe/i.test(sortie);
  } catch (e) {
    return jeuSembleOuvert();
  }
}

function echecMiseAJour(code) {
  miseAJour.etat = 'erreur';
  miseAJour.erreur = code;
  miseAJour.annuler = null;
  majEtatMiseAJour();
  diffuserEtat();
}

async function lancerMiseAJour() {
  if (miseAJour.etat === 'telechargement' || miseAJour.etat === 'lancement') return;
  const info = installateurEnLigne;
  if (!info || info.version !== versionEnLigne) return echecMiseAJour('absent');
  if (jeuLance()) return echecMiseAJour('jeu');

  const crypto = require('node:crypto');
  const os = require('node:os');
  const dossier = path.join(os.tmpdir(), 'BazaarScanner');
  const final = path.join(dossier, 'BazaarScanner_setup-' + info.version.replace(/[^0-9.]/g, '') + '.exe');
  const partiel = final + '.part';

  miseAJour.etat = 'telechargement';
  miseAJour.erreur = '';
  miseAJour.recu = 0;
  miseAJour.total = info.taille || 0;
  const controle = new AbortController();
  miseAJour.annuler = () => controle.abort();
  majEtatMiseAJour();
  diffuserEtat();

  try {
    fs.mkdirSync(dossier, { recursive: true });

    /* Déjà téléchargé lors d'un essai précédent, et intact : on le reprend. */
    let pret = false;
    if (fs.existsSync(final)) {
      const h = crypto.createHash('sha256').update(fs.readFileSync(final)).digest('hex');
      pret = (h === info.sha256);
      if (!pret) fs.rmSync(final, { force: true });
    }

    if (!pret) {
      const r = await fetch(info.url || URL_INSTALLATEUR,
        { signal: controle.signal, redirect: 'follow', cache: 'no-store' });
      if (!r.ok || !r.body) return echecMiseAJour('reseau');
      const annonce = Number(r.headers.get('content-length')) || 0;
      if (annonce) miseAJour.total = annonce;

      const empreinte = crypto.createHash('sha256');
      const sortie = fs.createWriteStream(partiel);
      let dernierAvis = 0;
      try {
        for await (const morceau of r.body) {
          const tampon = Buffer.from(morceau);
          empreinte.update(tampon);
          miseAJour.recu += tampon.length;
          if (!sortie.write(tampon)) await new Promise(ok => sortie.once('drain', ok));
          if (Date.now() - dernierAvis > 250) {
            dernierAvis = Date.now();
            majEtatMiseAJour();
            diffuserEtat();
          }
        }
      } finally {
        await new Promise(ok => sortie.end(ok));
      }

      if (empreinte.digest('hex') !== info.sha256) {
        fs.rmSync(partiel, { force: true });
        return echecMiseAJour('empreinte');
      }
      fs.renameSync(partiel, final);
    }

    /* Le jeu a pu être lancé pendant le téléchargement. */
    if (jeuLance()) {
      miseAJour.annuler = null;
      return echecMiseAJour('jeu');
    }

    miseAJour.etat = 'lancement';
    miseAJour.annuler = null;
    majEtatMiseAJour();
    diffuserEtat();

    /* Start-Process passe par le shell de Windows : c'est lui qui affiche la
       demande d'autorisation qu'exige l'installateur. Un lancement direct
       échouerait faute de droits. PowerShell rend la main une fois
       l'installateur démarré, ou sur un refus. */
    const cheminPs = "'" + final.replace(/'/g, "''") + "'";
    const ps = spawn('powershell', ['-NoProfile', '-NonInteractive', '-Command',
      'try { Start-Process -FilePath ' + cheminPs + " -ArgumentList '/MAJ' -ErrorAction Stop; exit 0 } "
      + 'catch { exit 1 }'], { windowsHide: true });
    let sansPowershell = false;
    ps.on('error', () => { sansPowershell = true; echecMiseAJour('lancement'); });
    ps.on('close', code => {
      if (sansPowershell) return;
      if (code !== 0) return echecMiseAJour('refus');
      /* L'installateur attend que l'application soit fermée pour la
         remplacer, puis la rouvre. */
      setTimeout(() => process.exit(0), 800);
    });
  } catch (e) {
    try { fs.rmSync(partiel, { force: true }); } catch (x) { /* déjà parti */ }
    if (controle.signal.aborted) {
      miseAJour.etat = 'dispo';
      miseAJour.erreur = '';
      miseAJour.annuler = null;
      majEtatMiseAJour();
      diffuserEtat();
      return;
    }
    echecMiseAJour('reseau');
  }
}

/* Deux secondes par défaut : c'est le décalage d'une diffusion en latence
   basse, le cas le plus fréquent. Beaucoup de streamers ne lisent pas ce
   réglage et n'y touchent jamais ; mieux vaut qu'ils partent d'une valeur
   juste que de zéro. Une valeur absente vaut donc deux, et non rien. */
/* Zéro : l'extension mesure elle-même le retard de chaque spectateur et
   attend d'autant. Ce réglage ne sert plus qu'à déclarer un délai ajouté
   AVANT l'envoi à Twitch, dans OBS ou pour un tournoi, que la mesure ne peut
   pas voir. */
const DELAI_DEFAUT = 0;

function lireDelaiStream() {
  if (config.DELAI_STREAM === undefined || config.DELAI_STREAM === '') {
    return DELAI_DEFAUT;
  }
  const n = parseInt(config.DELAI_STREAM, 10);
  if (!Number.isFinite(n) || n < 0) return DELAI_DEFAUT;
  return Math.min(n, 86400);   // une journée : simple garde-fou
}

const CHEMIN_SESSION = path.join(APP_DIR, 'session.jsonl');
let _enregistre = null;          // null = pas encore vérifié
let _derniereEmpreinte = null;

function enregistrementDemande() {
  if (_enregistre === null) {
    _enregistre = fs.existsSync(path.join(APP_DIR, 'enregistrer-session'));
    if (_enregistre) console.log('[Session] enregistrement actif → ' + CHEMIN_SESSION);
  }
  return _enregistre;
}

function noterSession() {
  if (!enregistrementDemande()) return;

  const empreinte = JSON.stringify([
    etat.code,
    etat.face.map(c => c.nom + '@' + Math.round(c.x || 0)),
    etat.faceTalents.map(c => c.nom),
    etat.plateau.map(c => c.nom),
  ]);
  if (empreinte === _derniereEmpreinte) return;
  _derniereEmpreinte = empreinte;

  const ligne = JSON.stringify({
    t: Date.now(),
    code: etat.code,
    face: etat.face,
    faceTalents: etat.faceTalents,
    faceCentree: etat.faceCentree,
    plateau: etat.plateau,
    listeTalents: etat.listeTalents,
  });

  try { fs.appendFileSync(CHEMIN_SESSION, ligne + '\n'); }
  catch (e) { /* disque occupé : on réessaiera au prochain changement */ }
}

/* Le mod réécrit board_state.json chaque seconde tant que le jeu tourne. Dix
   secondes de silence signifient donc que le jeu est fermé, et le contenu du
   fichier décrit une partie révolue. */
const PEREMPTION_MS = 10000;

function plateauPerime(fichier) {
  try {
    return (Date.now() - fs.statSync(fichier).mtimeMs) > PEREMPTION_MS;
  } catch (e) {
    return true;   // illisible : autant le tenir pour absent
  }
}

function cheminEtatPlateau(cfg) {
  return path.join(cheminActif(cfg), 'BepInEx', 'plugins',
                   'BazaarScannerBridge', 'board_state.json');
}

let config = {};
let actif = false;

function appliquerConfig() {
  config = lireConfig();

  /* La détection automatique ne sert qu'à la première installation, quand
     AUCUN chemin n'est connu. Sans cette réserve, choisir le client Tempo
     alors que son dossier n'est pas encore renseigné faisait retrouver
     l'installation Steam, qui écrasait le choix. */
  if (!config.STEAM_PATH && !config.TEMPO_PATH && !jeuValide(config.BAZAAR_PATH)) {
    const trouve = detecterJeu();
    if (trouve) config = ecrireConfig({ BAZAAR_PATH: trouve, STEAM_PATH: trouve });
  }

  /* Une configuration écrite avant la prise en charge du client Tempo ne
     porte que BAZAAR_PATH. On la complète plutôt que d'exiger une
     réinstallation : le chemin connu devient celui de Steam, et le client
     Tempo est cherché comme à l'installation. */
  if (!config.STEAM_PATH && !config.TEMPO_PATH && config.BAZAAR_PATH) {
    const maj = { STEAM_PATH: config.BAZAAR_PATH, SOURCE: 'steam' };
    const tempo = detecterTempo();
    if (tempo) maj.TEMPO_PATH = tempo;
    config = ecrireConfig(maj);
  }

  actif = pubsub.configure({
    relayUrl: adresseRelais(),
    token:    config.RELAY_TOKEN,
    log:      (niveau, message) => console.log('[' + niveau + '] ' + message),
    onEtat:   (ok, raison) => {
      if (!ok) definirEtat('erreur', raison);
    },
  });

  evaluerEtat();
}

function evaluerEtat() {
  if (!config.RELAY_TOKEN) {
    return definirEtat('config', MOTIFS.twitch);
  }
  if (!jeuValide(cheminActif(config))) {
    return definirEtat('jeu', MOTIFS.dossier);
  }
  const plateau = cheminEtatPlateau(config);
  if (!fs.existsSync(plateau) || plateauPerime(plateau)) {
    return definirEtat('attente', MOTIFS.ferme);
  }
}

/* La dernière bande adverse connue. Certains écrans du jeu, comme l'analyse
   d'après combat, ne montrent plus rien côté adverse : la bande se vidait
   alors pour les spectateurs. On garde la dernière tant qu'aucune autre ne la
   remplace ; elle n'est oubliée qu'avec la partie. */
let derniereBande = null;

/* Le portrait d'un adversaire PVP, retiré du message une fois le combat
   lancé depuis un moment.

   L'extension reconnaît le début d'un combat entre joueurs au portrait
   adverse reçu AVEC ses objets, et retient alors le plateau dix secondes.
   Un spectateur qui arrivait en plein combat, ou sur l'écran Récap, recevait
   ce même couple dans son tout premier message : son extension croyait le
   combat tout juste commencé, et il attendait dix secondes de trop, son
   propre plateau compris.

   Passé ce délai, le plateau adverse est de toute façon visible dans la
   vidéo : il n'y a plus rien à protéger. On n'envoie donc plus le portrait,
   et le nouvel arrivant voit tout aussitôt. Les spectateurs déjà là ne
   perdent que la zone du portrait (« adversaire PVP ») : leur extension sait
   déjà que le combat est en cours, et les objets adverses restent affichés.

   Seul le message pour Twitch change : la fenêtre de l'application garde
   le portrait. Douze secondes : les dix de l'extension, et une marge. */
const PORTRAIT_PVP_MS = 12000;
let debutCombatPvp = null;

function bandePourTwitch(bande) {
  if (!Array.isArray(bande)) return bande;
  const combatPvp = bande.some(it => it && it.vs === 'pvp')
                 && bande.some(it => it && !it.r);
  if (!combatPvp) { debutCombatPvp = null; return bande; }
  if (!debutCombatPvp) debutCombatPvp = Date.now();
  if (Date.now() - debutCombatPvp < PORTRAIT_PVP_MS) return bande;
  return bande.filter(it => !(it && it.vs === 'pvp'));
}

function cycle() {
  if (!actif) return;
  if (!jeuValide(cheminActif(config))) return definirEtat('jeu', MOTIFS.dossier);

  const fichier = cheminEtatPlateau(config);
  if (!fs.existsSync(fichier)) {
    etat.objets = etat.talents = 0;
    etat.plateau = [];
    etat.listeTalents = [];
    etat.face = [];
    etat.faceTalents = [];
    etat.faceCentree = false;
    etat.reserve = [];
    etat.partie = null;
    etat.faceTitre = '';
    derniereBande = null;
    publierVide();
    return definirEtat('attente', MOTIFS.ferme);
  }

  /* Sans cette vérification, la fenêtre rouvrait sur le plateau de la partie
     précédente, lu dans un fichier que plus personne n'écrit. */
  if (plateauPerime(fichier)) {
    etat.objets = etat.talents = 0;
    etat.plateau = [];
    etat.listeTalents = [];
    etat.face = [];
    etat.faceTalents = [];
    etat.faceCentree = false;
    etat.reserve = [];
    etat.partie = null;
    etat.faceTitre = '';
    derniereBande = null;
    publierVide();
    return definirEtat('attente', MOTIFS.ferme);
  }

  let state = null;
  try { state = JSON.parse(fs.readFileSync(fichier, 'utf8')); }
  catch (e) { return; }          // écriture en cours : on réessaiera dans 1 s
  try { derniereEcritureMod = fs.statSync(fichier).mtimeMs; } catch (e) { /* sans gravité */ }
  if (state && typeof state.VersionJeu === 'string' && state.VersionJeu) versionJeuVue = state.VersionJeu;

  if (!state || state.Ready === false) {
    etat.objets = etat.talents = 0;
    etat.plateau = [];
    etat.listeTalents = [];
    etat.face = [];
    etat.faceTalents = [];
    etat.faceCentree = false;
    etat.reserve = [];
    etat.partie = null;
    etat.faceTitre = '';
    derniereBande = null;
    publierVide();
    return definirEtat('attente', MOTIFS.horsJeu);
  }

  const objets  = toCompact(state);
  const talents = skillsToCompact(state);

  /* Une bande adverse vide reprend la dernière connue.

     Et la MÊME bande garde sa disposition. Sur l'écran Récap d'après combat,
     les cartes adverses restent affichées, mais le jeu ne les tient plus pour
     un adversaire en combat : le mod les déclarait alors « centrées », comme
     chez un marchand, et l'extension plaçait leurs zones de survol ailleurs.
     Mêmes cartes aux mêmes emplacements : même disposition qu'avant. */
  const signatureBande = (f) => (Array.isArray(f) ? f : [])
    .map(c => (c.TemplateId || c.Name || '') + '@' + c.Socket).join('|');

  /* Un reste du même combat : la bande ne contient plus que des cartes déjà
     présentes dans la dernière connue. C'est le cas de l'écran Récap, où il
     ne reste que le portrait de l'adversaire, ses objets ayant disparu de la
     lecture. On garde alors la bande complète. Le choix de la prochaine
     rencontre, lui, montre d'AUTRES portraits, et passe normalement. */
  const cleCarte = (c) => (c.TemplateId || c.Name || '') + '@' + c.Socket;
  /* Ces deux souvenirs ne valent que pour un COMBAT, dont la bande n'est pas
     centrée. Chez un marchand, une carte qui disparaît a été achetée : la
     bande, plus courte, ne contenait que des cartes déjà vues, et passait
     pour un reste de combat. L'objet acheté restait donc affiché dans la
     boutique, alors qu'il était déjà dans la réserve. */
  const bandeDeCombat = () => !!derniereBande && !derniereBande.FaceCentree;

  const resteDuCombat = (f) => {
    if (!bandeDeCombat() || !Array.isArray(f) || !f.length) return false;
    const connues = new Set(derniereBande.Face.map(cleCarte));
    return f.length < derniereBande.Face.length && f.every(c => connues.has(cleCarte(c)));
  };

  /* La fin d'une partie. Elle se termine toujours sur un combat, et rien ne
     venait remplacer la bande du dernier adversaire : elle restait affichée
     indéfiniment. On l'oublie quand votre propre plateau se vide, au retour
     au menu, et à défaut au bout de trois minutes, bien plus qu'il n'en faut
     pour consulter un Récap. */
  const plateauVide = !Array.isArray(state.Board) || !state.Board.length;
  if (plateauVide) derniereBande = null;
  if (derniereBande && Date.now() - derniereBande.depuis > 3 * 60 * 1000) derniereBande = null;

  if (resteDuCombat(state.Face)) {
    state = Object.assign({}, state, { Face: derniereBande.Face, FaceSkills: derniereBande.FaceSkills,
                                       FaceCentree: derniereBande.FaceCentree });
  } else if (Array.isArray(state.Face) && state.Face.length) {
    if (derniereBande && signatureBande(state.Face) === signatureBande(derniereBande.Face)
        && !!state.FaceCentree !== !!derniereBande.FaceCentree) {
      state = Object.assign({}, state, {
        FaceCentree: derniereBande.FaceCentree,
        FaceSkills: (Array.isArray(state.FaceSkills) && state.FaceSkills.length)
          ? state.FaceSkills : derniereBande.FaceSkills,
      });
    }
    derniereBande = { Face: state.Face, FaceSkills: state.FaceSkills, FaceCentree: state.FaceCentree,
                      depuis: Date.now() };
  } else if (bandeDeCombat()) {
    state = Object.assign({}, state, { Face: derniereBande.Face, FaceSkills: derniereBande.FaceSkills,
                                       FaceCentree: derniereBande.FaceCentree });
  } else {
    /* Une boutique vidée, ou un écran sans rien en face : rien à garder. */
    derniereBande = null;
  }

  const enFace   = cartesCompactes(state.Face, !!state.FaceCentree);
  const reserve  = cartesCompactes(state.Reserve, false);

  /* La réserve AFFICHÉE, quand le joueur ouvre son coffre : elle occupe la
     bande d'en face à l'écran, et doit y rester survolable. */
  const reserveAffichee = cartesCompactes(state.ReserveAffichee, false);
  const talentsAdverses = talentsCompacts(state.FaceSkills);
  etat.objets  = objets.length;
  etat.talents = talents.length;
  etat.plateau = apercuPlateau(state);
  etat.listeTalents = apercuTalents(state);
  etat.face = apercuCartes(state.Face);
  etat.reserve = apercuCartes(state.Reserve);
  etat.reserveAffichee = apercuCartes(state.ReserveAffichee);
  etat.faceTalents = apercuCartes(state.FaceSkills);
  etat.faceCentree = !!state.FaceCentree;

  etat.faceTitre = titreDeLaBande(state);

  if (state.Mod) modVu = state.Mod;
  suivreTalents(state);
  const histoire = suivrePartie(state);
  const reelle = enPartieReelle(state);
  etat.partie = (reelle && Number.isInteger(state.Jour)) ? {
    jour: state.Jour, histoire: histoire || '', hero: state.Hero || '',
    vi: state.Victoires, pr: state.Prestige, px: state.PrestigeMax,
    mode: state.Classee ? 'classee' : (/tourn/i.test(String(state.Mode || '')) ? 'tournoi' : 'normal'),
  } : null;

  noterSession();

  videDiffuse = false;
  publierAvecDelai(objets, talents, lireCadre(), {
    hero: reelle ? (state.Hero || '') : '',
    face: bandePourTwitch(enFace),
    reserveAffichee: reserveAffichee,
    reserve: reserve,
    faceTalents: talentsAdverses,
    faceCentree: !!state.FaceCentree,
    /* Hors partie (menu principal), ni compteurs ni jour : la barre des
       victoires et les zones disparaissent chez les spectateurs. */
    victoires: reelle ? state.Victoires : null,
    prestige: reelle ? state.Prestige : null,
    prestigeMax: reelle ? state.PrestigeMax : null,
    classee: reelle ? state.Classee : null,
    mode: reelle ? state.Mode : null,
    jour: reelle ? state.Jour : null,
    histoire: histoire,
  });

  const liaison = pubsub.etat();
  if (liaison.connecte === false) definirEtat('erreur', liaison.erreur);
  else definirEtat('pret', '');
  diffuserEtat();               // les compteurs bougent même quand l'état ne change pas
}

function choisirDossier(depart, callback, titre) {
  /* L'explorateur complet, celui qu'on connaît pour joindre un fichier :
     barre d'adresse, panneau latéral, raccourcis. Les sélecteurs de dossier
     de Windows n'offrent qu'une arborescence à dérouler.

     On demande donc TheBazaar.exe, et l'on garde son dossier. C'est aussi
     plus sûr : le streamer désigne un repère visible plutôt que de deviner
     quel niveau de dossier est attendu. */
  const TITRE = titre || 'Où se trouve TheBazaar.exe ?';

  /* PowerShell ne connaît pas la barre oblique inverse comme échappement :
     JSON.stringify doublait les séparateurs du chemin. On emploie ses
     propres chaînes, où seule l'apostrophe se double. */
  const ps = (texte) => "'" + String(texte).replace(/'/g, "''") + "'";

  const script = [
    'Add-Type -AssemblyName System.Windows.Forms',
    '$f = New-Object System.Windows.Forms.Form',
    '$f.TopMost = $true',
    '$f.ShowInTaskbar = $false',
    '$f.Opacity = 0',
    '$f.Show(); $f.Activate()',
    '$d = New-Object System.Windows.Forms.OpenFileDialog',
    '$d.Title = ' + ps(TITRE),
    "$d.Filter = 'The Bazaar|TheBazaar.exe|" + "Tous les fichiers|*.*'",
    '$d.FileName = ' + ps('TheBazaar.exe'),
    '$d.CheckFileExists = $true',
    depart ? '$d.InitialDirectory = ' + ps(depart) : '',
    'if ($d.ShowDialog($f) -eq [System.Windows.Forms.DialogResult]::OK) ' +
      '{ [Console]::Out.Write([System.IO.Path]::GetDirectoryName($d.FileName)) }',
    '$f.Close()',
  ].filter(Boolean).join('; ');

  let sortie = '';
  let termine = false;
  const fini = (chemin) => { if (!termine) { termine = true; callback(chemin); } };

  try {
    const ps = spawn('powershell',
      ['-NoProfile', '-STA', '-NonInteractive', '-Command', script],
      { windowsHide: true });

    ps.stdout.on('data', d => { sortie += d.toString(); });
    ps.on('error', () => fini(null));          // pas de PowerShell : on abandonne
    ps.on('close', () => fini(sortie.trim() || null));

    setTimeout(() => { if (!termine) { try { ps.kill(); } catch (e) {} fini(null); } },
      120000);
  } catch (e) {
    fini(null);
  }
}

/* Retrouve un navigateur installé, ou rend null.
 *
 * « start msedge » ne suffit pas : quand Edge est absent, cmd démarre quand
 * même, Windows affiche sa propre boîte d'erreur, et aucune erreur ne remonte
 * jusqu'ici. La chaîne de secours ne se déclenchait donc jamais et le
 * streamer restait devant un message au lieu de sa fenêtre. */
function trouverNavigateur(nom) {
  const dossiers = [
    process.env['ProgramFiles(x86)'],
    process.env.ProgramFiles,
    process.env.LOCALAPPDATA,
  ].filter(Boolean);

  const sousChemins = (nom === 'msedge')
    ? [['Microsoft', 'Edge', 'Application', 'msedge.exe']]
    : [['Google', 'Chrome', 'Application', 'chrome.exe']];

  for (const base of dossiers) {
    for (const bout of sousChemins) {
      const complet = path.join(base, ...bout);
      if (fs.existsSync(complet)) return complet;
    }
  }

  /* Windows tient aussi un registre des exécutables connus, qui couvre les
     installations hors des dossiers habituels. */
  try {
    const sortie = execFileSync('reg', ['query',
      'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\'
        + nom + '.exe', '/ve'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const m = sortie.match(/REG_SZ\s+(.+)/);
    if (m && fs.existsSync(m[1].trim())) return m[1].trim();
  } catch (e) { /* absent du registre */ }

  return null;
}

function ouvrirNavigateur(url, ongletNormal) {
  const tentatives = [];

  if (!ongletNormal) {
    for (const nom of ['msedge', 'chrome']) {
      const exe = trouverNavigateur(nom);
      if (exe) {
        tentatives.push([exe, [`--app=${url}`, '--window-size=1170,770']]);
      }
    }
  }

  /* Dernier recours : le navigateur par défaut, quel qu'il soit. La fenêtre
     sera un onglet ordinaire, mais l'outil fonctionne. */
  tentatives.push(['cmd', ['/c', 'start', '', url]]);

  (function essayer(i) {
    if (i >= tentatives.length) {
      console.log('Aucun navigateur n\u2019a pu être ouvert. Ouvrez ' + url);
      return;
    }
    let suivant = false;
    try {
      const enfant = spawn(tentatives[i][0], tentatives[i][1],
        { detached: true, stdio: 'ignore' });
      enfant.on('error', () => { if (!suivant) { suivant = true; essayer(i + 1); } });
      enfant.unref();
    } catch (e) {
      if (!suivant) { suivant = true; essayer(i + 1); }
    }
  })(0);
}

/* Le premier relevé attend la lecture de config.ini (plus bas) : sans quoi
   MAJ_INDEX et DATA_BASE_URL n'étaient jamais pris en compte au démarrage. */
setImmediate(releverVersion);
setInterval(releverVersion, 6 * 60 * 60 * 1000);

/* Plus aucune fenêtre : l'application s'arrête, après un court délai qui
   laisse à une actualisation le temps de se reconnecter. */
function oublierFenetre(res) {
  if (!abonnes.delete(res)) return;
  if (abonnes.size === 0) setTimeout(() => {
    if (abonnes.size === 0) process.exit(0);
  }, 3000);
}

/* Un signe de vie toutes les vingt secondes : une connexion morte sans
   l'avoir dit échoue à l'écriture, et cesse de compter comme une fenêtre. */
setInterval(() => {
  for (const r of abonnes) {
    try { r.write(': \n\n'); } catch (e) { oublierFenetre(r); }
    if (r.destroyed || r.writableEnded) oublierFenetre(r);
  }
}, 20000);

const serveur = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');

  const hote = String(req.headers.host || '');
  if (hote !== '127.0.0.1:' + PORT && hote !== 'localhost:' + PORT) {
    res.writeHead(403).end();
    return;
  }
  if (ROUTES_PROTEGEES.includes(url.pathname) && req.headers['x-jeton'] !== JETON_LOCAL) {
    res.writeHead(403).end();
    return;
  }

  if (url.pathname === '/') {
    const html = path.join(APP_DIR, 'interface.html');
    if (!fs.existsSync(html)) {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('interface.html manquant à côté de l\u2019exécutable.');
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    const page = fs.readFileSync(html, 'utf8');
    return res.end(/<head[^>]*>/i.test(page)
      ? page.replace(/<head[^>]*>/i, m => m + ENTETE_FENETRE)
      : ENTETE_FENETRE + page);
  }

  if (url.pathname === '/etat') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });
    res.write('data: ' + JSON.stringify(etat) + '\n\n');
    res.idFenetre = url.searchParams.get('id') || '';
    abonnes.add(res);
    /* La fin de la connexion, vue depuis la réponse : selon la version de
       Node, l'événement de la requête peut ne jamais venir. */
    res.on('close', () => oublierFenetre(res));
    req.on('close', () => oublierFenetre(res));
    return;
  }

  /* La fenêtre prévient qu'elle se ferme. On ne comptait jusqu'ici que sur
     la coupure de sa connexion, que le navigateur ne signale pas toujours :
     l'application restait alors ouverte dans l'invite de commande. */
  if (url.pathname === '/fermer' && req.method === 'POST') {
    const id = url.searchParams.get('id') || '';
    for (const r of abonnes) {
      if (id && r.idFenetre === id) { try { r.end(); } catch (e) { /* déjà fermée */ } oublierFenetre(r); }
    }
    res.writeHead(204).end();
    return;
  }

  /* La mise à jour intégrée : lancer, ou annuler (un téléchargement en
     cours, ou une erreur affichée, pour revenir à la proposition). */
  if (url.pathname === '/maj/installer' && req.method === 'POST') {
    lancerMiseAJour();
    res.writeHead(204).end();
    return;
  }
  if (url.pathname === '/maj/annuler' && req.method === 'POST') {
    if (miseAJour.annuler) miseAJour.annuler();
    else if (miseAJour.etat === 'erreur') {
      miseAJour.etat = 'dispo';
      miseAJour.erreur = '';
      majEtatMiseAJour();
      diffuserEtat();
    }
    res.writeHead(204).end();
    return;
  }

  if (url.pathname === '/oauth') {
    /* Le code remis au départ de la connexion, une seule fois et pour un
       quart d'heure : une autre page ne peut pas imposer son jeton. */
    const attendu = codeConnexion;
    const valable = !!attendu && Date.now() < codeConnexionExpire
      && url.searchParams.get('n') === attendu;
    if (valable) codeConnexion = null;
    const jetonRecu = url.searchParams.get('jeton');
    const jeton  = (valable && jetonRecu && /^[\w.-]{8,200}$/.test(jetonRecu)) ? jetonRecu : null;
    const pseudo = jeton ? (url.searchParams.get('pseudo') || '').slice(0, 60) : '';
    if (jeton) {
      /* Le relais ne transmet pas toujours le pseudonyme. Sans cette
         précaution, une reconnexion sans « pseudo » effaçait le nom déjà
         connu, et la fenêtre n'affichait plus que « connecté ». */
      const maj = { RELAY_TOKEN: jeton };
      if (pseudo) maj.TWITCH_NOM = pseudo;
      ecrireConfig(maj);
      appliquerConfig();
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(
      '<!doctype html><meta charset="utf-8"><title>Bazaar Scanner</title>'
      + '<body style="background:#140c06;color:#e8dcc4;font-family:system-ui,sans-serif;'
      + 'display:flex;align-items:center;justify-content:center;height:100vh;margin:0">'
      + '<div style="text-align:center">'
      + '<p style="color:#f0c060;font-size:1.2em">'
      + (jeton ? 'Connecté' + (pseudo ? ' - ' + echapperHtml(pseudo) : '') : 'Connexion échouée')
      + '</p><p style="opacity:.7">Vous pouvez fermer cet onglet.</p></div>'
      + '<script>setTimeout(function(){window.close()},1500)<\/script>');
  }

  if (url.pathname === '/connexion' && req.method === 'GET') {
    const relais = adresseRelais();
    const repondre = (ok, message) => {
      res.writeHead(ok ? 200 : 400, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok, message: message || '' }));
    };

    if (!/^https:\/\//.test(relais)) {
      return repondre(false, 'Adresse du relais invalide dans config.ini.');
    }

    codeConnexion = require('node:crypto').randomBytes(12).toString('hex');
    codeConnexionExpire = Date.now() + 15 * 60 * 1000;
    const retour = encodeURIComponent(`http://127.0.0.1:${PORT}/oauth?n=${codeConnexion}`);
    ouvrirNavigateur(`${relais}/connexion?retour=${retour}`, true);
    return repondre(true, 'Autorisez dans votre navigateur…');
  }

  if (url.pathname === '/parcourir' && req.method === 'GET') {
    const titreFenetre = url.searchParams.get('titre') || '';
    choisirDossier(cheminActif(config), (chemin) => {
      /* Le dossier choisi appartient à la version en cours : l'enregistrer
         dans sa propre clé, sinon la bascule le perdrait. */
      if (chemin) {
        const cle = (config.SOURCE === 'tempo') ? 'TEMPO_PATH' : 'STEAM_PATH';
        const maj = { BAZAAR_PATH: chemin };
        maj[cle] = chemin;
        config = ecrireConfig(maj);
      }

      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({
        chemin: chemin || '',
        valide: chemin ? jeuValide(chemin) : false,
      }));
    }, titreFenetre);
    return;
  }

  if (url.pathname === '/langue' && req.method === 'GET') {
    const l = (url.searchParams.get('l') || 'en').slice(0, 2).toLowerCase();
    if (l !== _langueAffichage) ouvrirTraductions(l);
    res.writeHead(204).end();
    return;
  }

  if (url.pathname === '/config' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify({
      RELAY_TOKEN: config.RELAY_TOKEN || '',
      TWITCH_NOM:  config.TWITCH_NOM  || '',
      BAZAAR_PATH: config.BAZAAR_PATH || '',

      /* Les deux installations et celle que l'application lit. Sans ces
         trois clés, la fenêtre ne voyait jamais le chemin du client Tempo
         et revenait à Steam à chaque lecture. */
      STEAM_PATH:  config.STEAM_PATH  || '',
      TEMPO_PATH:  config.TEMPO_PATH  || '',

      /* Le mod est-il en place dans chacune ? Le dossier peut être juste et
         le mod absent : la version n'est alors pas exploitable, et la fenêtre
         doit le dire plutôt que de rester muette. */
      STEAM_MOD:   modInstalle(config.STEAM_PATH),
      TEMPO_MOD:   modInstalle(config.TEMPO_PATH),
      SOURCE:      (config.SOURCE === 'tempo') ? 'tempo' : 'steam',

      CADRE:       config.CADRE       || '',
      VERSION,
      VERSION_EN_LIGNE: versionEnLigne,
      DELAI_STREAM: lireDelaiStream(),
    }));
  }

  if (url.pathname === '/config' && req.method === 'POST') {
    let corps = '';
    req.on('data', c => { corps += c; });
    req.on('end', () => {
      try {
        const recu = JSON.parse(corps);
        const maj = {};
        /* RELAY_URL n'en fait pas partie : l'adresse du relais ne se change
           qu'à la main dans config.ini, jamais depuis une page. */
        for (const cle of ['RELAY_TOKEN', 'TWITCH_NOM',
                           'BAZAAR_PATH', 'STEAM_PATH', 'TEMPO_PATH',
                           'SOURCE', 'CADRE', 'DELAI_STREAM']) {
          if (typeof recu[cle] === 'string') maj[cle] = recu[cle].trim();
        }
        ecrireConfig(maj);
        appliquerConfig();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('{"ok":true}');
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end('{"ok":false}');
      }
    });
    return;
  }

  res.writeHead(404).end();
});

if (!fs.existsSync(CONFIG_INI)) fs.writeFileSync(CONFIG_INI, CONFIG_DEFAUT, 'utf8');

appliquerConfig();
setInterval(cycle, INTERVALLE);

serveur.listen(PORT, '127.0.0.1', () => {
  const url = `http://127.0.0.1:${PORT}/`;
  ouvrirNavigateur(url, false);
  console.log('Bazaar Scanner - ' + url);
});

serveur.on('error', e => {
  console.error(e.code === 'EADDRINUSE'
    ? 'Bazaar Scanner est déjà lancé.'
    : 'Erreur : ' + e.message);
  process.exit(1);
});
