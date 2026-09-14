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
const CONFIG_INI = path.join(APP_DIR, 'config.ini');
const INTERVALLE = 1000;

const CONFIG_DEFAUT = [
  '# Bazaar Scanner — configuration',
  '#',
  '# RELAY_TOKEN : rempli automatiquement par « Se connecter avec Twitch ».',
  '# BAZAAR_PATH : dossier d\'installation du jeu. Détecté automatiquement au',
  '#               premier lancement dans la plupart des cas.',
  '# CADRE       : où se trouve le jeu dans ta scène OBS, en pourcentage',
  '#               (gauche,haut,largeur,hauteur). Vide = plein cadre.',
  '#               Renseigné par le bouton Calibrer, pas à la main.',
  '',
  'RELAY_TOKEN=',
  'TWITCH_NOM=',
  'BAZAAR_PATH=',
  'CADRE=',
  'TAILLE=m',
  '# DELAI_STREAM : délai de ton stream, en secondes.',
  '#               Il s\'AJOUTE au retard de l\'extension. À régler si tu',
  '#               diffuses en différé, en tournoi par exemple.',
  'DELAI_STREAM=0',
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
  return !!dossier && fs.existsSync(path.join(dossier, 'TheBazaar_Data'));
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
};

const abonnes = new Set();

function definirEtat(code, detail) {
  if (etat.code === code && etat.detail === (detail || '')) return;
  etat.code = code;
  etat.detail = detail || '';
  diffuserEtat();
}

function diffuserEtat() {
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
      const it = { s: c.Socket || 0, n: SLOTS_PAR_TAILLE[c.Size] || 1, id: c.TemplateId };
      if (c.Enchantment && c.Enchantment !== 'None') it.e = c.Enchantment;
      if (c.Tier) it.q = c.Tier;

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
          return code ? { i: id, k: code } : { i: id };
        });
      }

      if (type === 'PvpEncounter')    { it.vs = 'pvp'; it.nm = c.Name || ''; }
      if (type === 'CombatEncounter') { it.vs = 'pve'; it.nm = c.Name || ''; }
      return it;
    });
}

function toCompact(state) {
  return cartesCompactes(state && state.Board, false);
}

function talentsCompacts(liste) {
  if (!Array.isArray(liste)) return [];
  return liste
    .filter(c => c && c.TemplateId)
    .map((c, i) => {
      const sk = { s: typeof c.Socket === 'number' ? c.Socket : i, id: c.TemplateId };
      if (c.Tier) sk.q = c.Tier;
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

function titreDeLaBande(state) {
  if (Array.isArray(state.Reserve) && state.Reserve.length) return 'Stash';

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

  /* Lancée depuis les sources — « node app.js » —, cette constante n'existe
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
   service à maintenir. Une absence de réponse ne change rien — mieux vaut ne
   rien dire que de crier au loup parce que le réseau a hoqueté. */
let versionEnLigne = null;

async function releverVersion() {
  try {
    const base = (config.DATA_BASE_URL || 'https://bazaar-scanner.pages.dev')
      .replace(/\/+$/, '');
    const r = await fetch(base + '/index.json', { signal: AbortSignal.timeout(8000) });
    if (!r.ok) return;
    const i = await r.json();
    if (i && typeof i.version_app === 'string') versionEnLigne = i.version_app;
  } catch (e) { /* hors ligne : on n'affirme rien */ }
}

function lireDelaiStream() {
  const n = parseInt(config.DELAI_STREAM, 10);
  if (!Number.isFinite(n) || n < 0) return 0;
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
  return path.join(cfg.BAZAAR_PATH || '', 'BepInEx', 'plugins',
                   'BazaarScannerBridge', 'board_state.json');
}

let config = {};
let actif = false;

function appliquerConfig() {
  config = lireConfig();

  if (!jeuValide(config.BAZAAR_PATH)) {
    const trouve = detecterJeu();
    if (trouve) config = ecrireConfig({ BAZAAR_PATH: trouve });
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
    return definirEtat('config', 'connexion Twitch requise');
  }
  if (!jeuValide(config.BAZAAR_PATH)) {
    return definirEtat('jeu', 'dossier du jeu introuvable');
  }
  const plateau = cheminEtatPlateau(config);
  if (!fs.existsSync(plateau) || plateauPerime(plateau)) {
    return definirEtat('attente', 'le jeu n\u2019est pas lancé');
  }
}

function cycle() {
  if (!actif) return;
  if (!jeuValide(config.BAZAAR_PATH)) return definirEtat('jeu', 'dossier du jeu introuvable');

  const fichier = cheminEtatPlateau(config);
  if (!fs.existsSync(fichier)) {
    etat.objets = etat.talents = 0;
    etat.plateau = [];
    etat.listeTalents = [];
    etat.face = [];
    etat.faceTalents = [];
    etat.faceCentree = false;
    etat.reserve = [];
    etat.faceTitre = '';
    return definirEtat('attente', 'le jeu n\u2019est pas lancé');
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
    etat.faceTitre = '';
    return definirEtat('attente', 'le jeu n\u2019est pas lancé');
  }

  let state = null;
  try { state = JSON.parse(fs.readFileSync(fichier, 'utf8')); }
  catch (e) { return; }          // écriture en cours : on réessaiera dans 1 s

  if (!state || state.Ready === false) {
    etat.objets = etat.talents = 0;
    etat.plateau = [];
    etat.listeTalents = [];
    etat.face = [];
    etat.faceTalents = [];
    etat.faceCentree = false;
    etat.reserve = [];
    etat.faceTitre = '';
    return definirEtat('attente', 'aucune partie en cours');
  }

  const objets  = toCompact(state);
  const talents = skillsToCompact(state);

  const enFace   = cartesCompactes(state.Face, !!state.FaceCentree);
  const reserve  = cartesCompactes(state.Reserve, false);
  const talentsAdverses = talentsCompacts(state.FaceSkills);
  etat.objets  = objets.length;
  etat.talents = talents.length;
  etat.plateau = apercuPlateau(state);
  etat.listeTalents = apercuTalents(state);
  etat.face = apercuCartes(state.Face);
  etat.reserve = apercuCartes(state.Reserve);
  etat.faceTalents = apercuCartes(state.FaceSkills);
  etat.faceCentree = !!state.FaceCentree;

  etat.faceTitre = titreDeLaBande(state);

  noterSession();

  pubsub.publishBoard(objets, talents, lireCadre(), null, {
    delaiStream: lireDelaiStream(),
    face: enFace,
    reserve: reserve,
    faceTalents: talentsAdverses,
    faceCentree: !!state.FaceCentree,
  });

  const liaison = pubsub.etat();
  if (liaison.connecte === false) definirEtat('erreur', liaison.erreur);
  else definirEtat('pret', '');
  diffuserEtat();               // les compteurs bougent même quand l'état ne change pas
}

function choisirDossier(depart, callback) {
  const script = [
    'Add-Type -AssemblyName System.Windows.Forms',
    '$f = New-Object System.Windows.Forms.Form',
    '$f.TopMost = $true',
    '$f.ShowInTaskbar = $false',
    '$f.Opacity = 0',
    '$f.Show(); $f.Activate()',
    '$d = New-Object System.Windows.Forms.FolderBrowserDialog',
    '$d.Description = "Dossier d\'installation de The Bazaar"',
    '$d.ShowNewFolderButton = $false',
    depart ? '$d.SelectedPath = ' + JSON.stringify(depart) : '',
    'if ($d.ShowDialog($f) -eq [System.Windows.Forms.DialogResult]::OK) ' +
      '{ [Console]::Out.Write($d.SelectedPath) }',
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

function ouvrirNavigateur(url, ongletNormal) {
  const tentatives = ongletNormal
    ? [['cmd', ['/c', 'start', '', url]]]
    : [
        ['cmd', ['/c', 'start', '', 'msedge', `--app=${url}`, '--window-size=1170,770']],
        ['cmd', ['/c', 'start', '', 'chrome', `--app=${url}`, '--window-size=1170,770']],
        ['cmd', ['/c', 'start', '', url]],
      ];

  (function essayer(i) {
    if (i >= tentatives.length) {
      console.log('Aucun navigateur n\u2019a pu être ouvert. Va sur ' + url);
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

releverVersion();
setInterval(releverVersion, 6 * 60 * 60 * 1000);

const serveur = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');

  if (url.pathname === '/') {
    const html = path.join(APP_DIR, 'interface.html');
    if (!fs.existsSync(html)) {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('interface.html manquant à côté de l\u2019exécutable.');
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(fs.readFileSync(html));
  }

  if (url.pathname === '/etat') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });
    res.write('data: ' + JSON.stringify(etat) + '\n\n');
    abonnes.add(res);
    req.on('close', () => {
      abonnes.delete(res);
      if (abonnes.size === 0) setTimeout(() => {
        if (abonnes.size === 0) process.exit(0);
      }, 3000);
    });
    return;
  }

  if (url.pathname === '/oauth') {
    const jeton  = url.searchParams.get('jeton');
    const pseudo = url.searchParams.get('pseudo') || '';
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
      + (jeton ? 'Connecté' + (pseudo ? ' — ' + pseudo : '') : 'Connexion échouée')
      + '</p><p style="opacity:.7">Tu peux fermer cet onglet.</p></div>'
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

    const retour = encodeURIComponent(`http://127.0.0.1:${PORT}/oauth`);
    ouvrirNavigateur(`${relais}/connexion?retour=${retour}`, true);
    return repondre(true, 'Autorise dans ton navigateur…');
  }

  if (url.pathname === '/parcourir' && req.method === 'GET') {
    choisirDossier(config.BAZAAR_PATH, (chemin) => {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({
        chemin: chemin || '',
        valide: chemin ? jeuValide(chemin) : false,
      }));
    });
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
        for (const cle of ['RELAY_URL', 'RELAY_TOKEN', 'TWITCH_NOM',
                           'BAZAAR_PATH', 'CADRE', 'DELAI_STREAM']) {
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
  console.log('Bazaar Scanner — ' + url);
});

serveur.on('error', e => {
  console.error(e.code === 'EADDRINUSE'
    ? 'Bazaar Scanner est déjà lancé.'
    : 'Erreur : ' + e.message);
  process.exit(1);
});
