/* ============================================================================
   BAZAAR SCANNER

   Application destinée aux streamers de The Bazaar. Elle lit l'état du plateau
   écrit par le mod BepInEx et le diffuse vers l'extension Twitch, où les
   spectateurs peuvent survoler une carte pour en lire la description.

   Ce qu'elle fait, en entier :
     - lit board_state.json une fois par seconde ;
     - en extrait la position, la taille, la qualité et l'enchantement de
       chaque carte, plus son identifiant ;
     - diffuse cela vers Twitch ;
     - sert une petite fenêtre locale montrant le plateau et l'état de la
       liaison.

   Elle ne transporte que des identifiants de carte. Les descriptions et les
   illustrations sont récupérées par l'extension elle-même, ce qui évite
   d'embarquer ici la moindre donnée de jeu.

   Trois fichiers suffisent : l'exécutable, interface.html, et config.ini —
   ce dernier étant créé au premier lancement.
   ========================================================================= */

'use strict';

const fs    = require('node:fs');
const path  = require('node:path');
const http  = require('node:http');
const { spawn, execFileSync } = require('node:child_process');

const pubsub = require('./twitch-pubsub');

// En exécutable autonome (SEA), __dirname pointe à l'intérieur du binaire :
// on prend le dossier de l'exe. Lancé par `node app.js`, celui du script.
const APP_DIR = require('node:module').isSEA
  ? path.dirname(process.execPath)
  : __dirname;

// Adresse du relais. Identique pour tous les utilisateurs, ce n'est pas un
// réglage : elle est donc en dur plutôt que dans config.ini, où elle n'aurait
// fait qu'ajouter un champ incompréhensible.
//
// Une valeur présente dans config.ini l'emporte malgré tout. C'est la porte de
// sortie si le relais devait déménager : sans elle, tous les exécutables déjà
// distribués deviendraient inutilisables.
const RELAIS_PAR_DEFAUT = 'https://bazaar-relais.kwev-stream.workers.dev';

/* --- traduction des noms affichés ------------------------------------------
   board_state.json ne contient que de l'anglais : le mod ne traduit plus, sa
   détection de langue se trompait dès que le jeu tournait dans une autre langue
   que Windows.

   L'aperçu du plateau est donc traduit ici, dans la langue choisie par le
   streamer avec le sélecteur — une seule langue affichée, décidée à un seul
   endroit.

   La source est la base du jeu : un fichier SQLite par langue, où la clé est
   md5(texte anglais). Aucune dépendance : node:sqlite est intégré depuis
   Node 22.
   ----------------------------------------------------------------------- */

const LOCALES = {
  en: 'en-US', fr: 'fr-FR', de: 'de-DE', es: 'es-ES', it: 'it-IT',
  pt: 'pt-BR', ko: 'ko-KR', zh: 'zh-CN', tr: 'tr-TR',
};

let _langueAffichage = 'en';
let _requeteTrad = null;
let _connexionTrad = null;
const _cacheTrad = new Map();

/* Le jeu ne télécharge que les langues qu'il a eu besoin d'afficher : la
   branche publique n'en contenait que huit, sans le russe, l'ukrainien ni le
   japonais. On cherche donc dans toutes les branches présentes, la publique
   d'abord.

   C'est sans conséquence ici : cet aperçu est LOCAL, il ne sert qu'au streamer
   pour vérifier ce qu'il diffuse, et rien n'en sort. La restriction à la
   branche publique reste entière côté serveur, où les fiches sont publiées. */
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

  // L'anglais est la langue source : rien à traduire.
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

/* --- configuration -------------------------------------------------------- */

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

/* --- détection du jeu ----------------------------------------------------- */

function jeuValide(dossier) {
  return !!dossier && fs.existsSync(path.join(dossier, 'TheBazaar_Data'));
}

function detecterJeu() {
  const candidats = [];

  // Chemin d'installation de Steam, via le registre.
  try {
    const sortie = execFileSync('reg',
      ['query', 'HKCU\\Software\\Valve\\Steam', '/v', 'SteamPath'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const m = sortie.match(/SteamPath\s+REG_SZ\s+(.+)/);
    if (m) {
      const steam = m[1].trim().replace(/\//g, '\\');
      candidats.push(path.join(steam, 'steamapps', 'common', 'The Bazaar'));

      // Bibliothèques secondaires déclarées dans libraryfolders.vdf.
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

/* --- état, unique point de vérité pour l'interface ------------------------ */

const etat = {
  code: 'demarrage',
  detail: '',
  objets: 0,
  talents: 0,
  // Aperçu lisible du plateau, pour que le streamer vérifie d'un coup d'œil
  // que ce qui est diffusé correspond à sa partie. Les noms viennent de
  // board_state.json : aucune requête réseau.
  plateau: [],
  listeTalents: [],
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

/* --- lecture du plateau --------------------------------------------------- */

const SLOTS_PAR_TAILLE = { Small: 1, Medium: 2, Large: 3 };

function toCompact(state) {
  if (!state || !Array.isArray(state.Board)) return [];
  return state.Board
    .filter(c => c && c.TemplateId)
    .sort((a, b) => (a.Socket || 0) - (b.Socket || 0))
    .map(c => {
      const it = { s: c.Socket || 0, n: SLOTS_PAR_TAILLE[c.Size] || 1, id: c.TemplateId };
      if (c.Enchantment && c.Enchantment !== 'None') it.e = c.Enchantment;
      if (c.Tier) it.q = c.Tier;
      return it;
    });
}

function skillsToCompact(state) {
  if (!state || !Array.isArray(state.Skills)) return [];
  return state.Skills
    .filter(c => c && c.TemplateId)
    .map((c, i) => {
      const sk = { s: typeof c.Socket === 'number' ? c.Socket : i, id: c.TemplateId };
      if (c.Tier) sk.q = c.Tier;
      return sk;
    })
    .sort((a, b) => a.s - b.s);
}

// Distinct de toCompact(), qui ne transporte que des identifiants vers Twitch.
function apercuPlateau(state) {
  if (!state || !Array.isArray(state.Board)) return [];
  return state.Board
    .filter(c => c && c.TemplateId)
    .sort((a, b) => (a.Socket || 0) - (b.Socket || 0))
    .map(c => ({
      s: c.Socket || 0,
      n: SLOTS_PAR_TAILLE[c.Size] || 1,
      nom: traduire(c.Name) || '?',
      tier: c.Tier || '',
      ench: (c.Enchantment && c.Enchantment !== 'None') ? c.Enchantment : '',
    }));
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

// « 12,34,56,78 » → [12, 34, 56, 78], ou null si absent ou incohérent.
function lireCadre() {
  const brut = (config.CADRE || '').trim();
  if (!brut) return null;
  const v = brut.split(',').map(x => parseFloat(x));
  if (v.length !== 4 || v.some(x => !isFinite(x))) return null;
  if (v[2] <= 0 || v[3] <= 0) return null;
  // Plein cadre : autant ne rien transmettre.
  if (v[0] === 0 && v[1] === 0 && v[2] === 100 && v[3] === 100) return null;
  return v.map(x => Math.round(x * 100) / 100);
}

function cheminEtatPlateau(cfg) {
  return path.join(cfg.BAZAAR_PATH || '', 'BepInEx', 'plugins',
                   'BazaarScannerBridge', 'board_state.json');
}

/* --- boucle --------------------------------------------------------------- */

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
    // Les messages partent dans la console : indispensable pour diagnostiquer
    // un refus, et invisible pour l'utilisateur en version fenêtrée.
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
  if (!fs.existsSync(cheminEtatPlateau(config))) {
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
    return definirEtat('attente', 'le jeu n\u2019est pas lancé');
  }

  let state = null;
  try { state = JSON.parse(fs.readFileSync(fichier, 'utf8')); }
  catch (e) { return; }          // écriture en cours : on réessaiera dans 1 s

  if (!state || state.Ready === false) {
    etat.objets = etat.talents = 0;
    etat.plateau = [];
    etat.listeTalents = [];
    return definirEtat('attente', 'aucune partie en cours');
  }

  const objets  = toCompact(state);
  const talents = skillsToCompact(state);
  etat.objets  = objets.length;
  etat.talents = talents.length;
  etat.plateau = apercuPlateau(state);
  etat.listeTalents = apercuTalents(state);

  pubsub.publishBoard(objets, talents, lireCadre());

  const liaison = pubsub.etat();
  if (liaison.connecte === false) definirEtat('erreur', liaison.erreur);
  else definirEtat('pret', '');
  diffuserEtat();               // les compteurs bougent même quand l'état ne change pas
}

/* --- sélection d'un dossier ----------------------------------------------
   Une page web ne peut pas obtenir un chemin absolu : les navigateurs
   l'interdisent. On ouvre donc le vrai sélecteur de Windows via PowerShell,
   qui est présent sur toutes les machines visées.

   -STA est indispensable : les boîtes de dialogue Windows Forms refusent de
   s'ouvrir depuis un thread multithreadé.
   ----------------------------------------------------------------------- */

function choisirDossier(depart, callback) {
  // La boîte s'ouvrait DERRIÈRE le navigateur : sans fenêtre propriétaire,
  // Windows la place au fond de la pile. On lui en donne une, invisible et
  // marquée TopMost, qui la force au premier plan.
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

    // Garde-fou : si la fenêtre reste ouverte indéfiniment, on ne bloque pas
    // la requête HTTP pour autant.
    setTimeout(() => { if (!termine) { try { ps.kill(); } catch (e) {} fini(null); } },
      120000);
  } catch (e) {
    fini(null);
  }
}

/* --- ouverture du navigateur ---------------------------------------------
   spawn signale un échec par un ÉVÈNEMENT, pas par une exception : sans
   gestionnaire, l'absence d'un navigateur ferait planter l'application au
   lieu d'essayer le suivant.
   ----------------------------------------------------------------------- */

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

/* --- interface ------------------------------------------------------------ */

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
      // Fermer la fenêtre ferme l'application : pas d'icône fantôme dans la
      // barre des tâches, pas de processus oublié.
      if (abonnes.size === 0) setTimeout(() => {
        if (abonnes.size === 0) process.exit(0);
      }, 3000);
    });
    return;
  }

  // Le relais renvoie ici après la connexion Twitch, avec le jeton en clair
  // dans l'adresse. Rien ne sort de la machine : c'est un aller-retour local.
  if (url.pathname === '/oauth') {
    const jeton  = url.searchParams.get('jeton');
    const pseudo = url.searchParams.get('pseudo') || '';
    if (jeton) {
      // Le nom de chaîne est conservé pour l'afficher : un identifiant
      // numérique ne dit rien à personne.
      ecrireConfig({ RELAY_TOKEN: jeton, TWITCH_NOM: pseudo });
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

    // Ne peut arriver qu'avec une RELAY_URL manuelle erronée dans config.ini.
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

  // L'interface annonce sa langue : l'aperçu du plateau suit le sélecteur.
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
    }));
  }

  if (url.pathname === '/config' && req.method === 'POST') {
    let corps = '';
    req.on('data', c => { corps += c; });
    req.on('end', () => {
      try {
        const recu = JSON.parse(corps);
        // Seules les clés réellement transmises sont modifiées : l'interface
        // n'envoie que le dossier du jeu, le jeton ne doit pas être effacé.
        const maj = {};
        for (const cle of ['RELAY_URL', 'RELAY_TOKEN', 'TWITCH_NOM',
                           'BAZAAR_PATH', 'CADRE']) {
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

/* --- démarrage ------------------------------------------------------------ */

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
