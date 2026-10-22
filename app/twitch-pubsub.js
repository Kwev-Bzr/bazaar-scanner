'use strict';

const ENDPOINT = 'https://api.twitch.tv/helix/extensions/pubsub';

const MIN_INTERVAL_MS = 1000;
const HEARTBEAT_MS    = 2000;
const MAX_BYTES       = 5000;

/* Une requête que Twitch ou le relais laisse sans réponse est abandonnée au
   bout de ce délai, au lieu d'en empiler une nouvelle toutes les secondes. */
const DELAI_REQUETE_MS = 8000;

const MARGE_RENOUVELLEMENT_S = 120;

let cfg = null;

let jetonDelegue = null;          // { jeton, clientId, channelId, expire }
let renouvellementEnCours = null;

let derniereSignature = null;
let dernierEnvoi = 0;
let enAttente = null;
let minuteur = null;
let envoiEnCours = false;

let connecte = null;              // null tant qu'aucun envoi n'a eu lieu
let derniereErreur = '';

function log(niveau, message) {
  if (cfg && typeof cfg.log === 'function') cfg.log(niveau, message);
}

function marquer(ok, message) {
  const change = connecte !== ok;
  connecte = ok;
  derniereErreur = ok ? '' : (message || '');
  if (change && cfg && typeof cfg.onEtat === 'function') cfg.onEtat(ok, derniereErreur);
}

async function assurerJeton() {
  const maintenant = Math.floor(Date.now() / 1000);
  if (jetonDelegue && jetonDelegue.expire - maintenant > MARGE_RENOUVELLEMENT_S) {
    return jetonDelegue;
  }
  if (renouvellementEnCours) return renouvellementEnCours;

  renouvellementEnCours = (async () => {
    try {
      const res = await fetch(cfg.relayUrl + '/jeton', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + cfg.token },
        signal: AbortSignal.timeout(DELAI_REQUETE_MS),
      });

      if (!res.ok) {
        const detail = (await res.text()).slice(0, 200);
        log('error', 'le relais refuse le jeton : ' + res.status + ' ' + detail);
        marquer(false, res.status === 401 ? 'jeton refusé' : 'relais indisponible');
        return null;
      }

      jetonDelegue = await res.json();
      log('info', 'jeton obtenu pour la chaîne ' + jetonDelegue.channelId);
      return jetonDelegue;
    } catch (e) {
      log('error', 'relais injoignable : ' + e.message);
      marquer(false, 'pas de connexion');
      return null;
    } finally {
      renouvellementEnCours = null;
    }
  })();

  return renouvellementEnCours;
}

/* Retire d'un message les éléments facultatifs, dans l'ordre où ils manquent
   le moins : les valeurs vivantes des jetons, puis l'avancement des quêtes.
   Un message trop gros était jeté en entier : mieux vaut l'alléger. */
function alleger(message, cle) {
  const copie = JSON.parse(JSON.stringify(message));
  (function nettoyer(o) {
    if (Array.isArray(o)) o.forEach(nettoyer);
    else if (o && typeof o === 'object') {
      delete o[cle];
      Object.values(o).forEach(nettoyer);
    }
  })(copie);
  return copie;
}

let dejaEnregistre = false;

async function envoyer(message) {
  let texte = JSON.stringify(message);

  /* Ce qu'on retire pour tenir dans la limite, du moins utile au plus utile :
     la chance de critique, puis la rareté des talents, puis les valeurs
     calculées par le jeu, puis l'avancement des quêtes, et en tout dernier
     recours quelques talents. Le plateau, la réserve et la bande passent
     toujours. Retirer d'emblée toutes les valeurs, quand ôter la rareté des
     talents suffisait, aurait sacrifié l'essentiel pour peu de chose. */
  const etapes = [
    ['la chance de critique', m => alleger(m, 'cc')],
    ['la rareté des talents', m => { const c = JSON.parse(JSON.stringify(m));
                                     (c.k || []).forEach(t => { delete t.q; }); return c; }],
    ['les valeurs calculées', m => alleger(m, 'jv')],
    ['le Multicast en cours', m => alleger(m, 'mc')],
    ['les munitions en cours', m => alleger(m, 'am')],
    ["le délai d'activation en cours", m => alleger(m, 'cd')],
    ['les tags gagnés en partie', m => alleger(m, 'ta')],
    ["l'avancement des quêtes", m => alleger(m, 'qp')],
  ];
  for (const [nom, alleg] of etapes) {
    if (Buffer.byteLength(texte) <= MAX_BYTES) break;
    message = alleg(message);
    texte = JSON.stringify(message);
    log('warn', 'message allégé (' + nom + ') pour tenir dans la limite de Twitch');
  }

  /* En tout dernier recours, quelques talents, en partant des premiers. */
  if (Buffer.byteLength(texte) > MAX_BYTES && Array.isArray(message.k) && message.k.length) {
    let retires = 0;
    while (Buffer.byteLength(texte) > MAX_BYTES && message.k.length) {
      message.k.shift();
      retires++;
      texte = JSON.stringify(message);
    }
    log('warn', retires + ' talent(s) retiré(s) pour tenir dans la limite de Twitch');
  }

  if (Buffer.byteLength(texte) > MAX_BYTES) {
    log('error', 'message trop volumineux (' + Buffer.byteLength(texte) + ' octets), ignoré');

    /* Le poids de chaque partie, pour savoir laquelle déborde, et le message
       entier, enregistré une fois pour l'examiner. Un message ordinaire pèse
       deux à trois fois moins que la limite : celui-ci a quelque chose
       d'anormal. */
    try {
      const parties = Object.keys(message)
        .map(k => [k, Buffer.byteLength(JSON.stringify(message[k]) || '')])
        .sort((a, b) => b[1] - a[1])
        .map(([k, n]) => k + ' ' + n)
        .join(', ');
      log('error', 'détail, en octets : ' + parties);

      if (!dejaEnregistre) {
        dejaEnregistre = true;
        const chemin = require('path').join(require('os').tmpdir(), 'bazaar-message-trop-volumineux.json');
        require('fs').writeFileSync(chemin, JSON.stringify(message, null, 1));
        log('error', 'message enregistré dans ' + chemin + ' : envoyez ce fichier pour analyse');
      }
    } catch (e) { /* le diagnostic ne doit jamais gêner l'envoi suivant */ }

    /* Dit dans la fenêtre : rien ne part, et l'extension garde le dernier
       état reçu. En V2, ce cas restait muet : une bande d'en face figée,
       sans aucune explication. */
    marquer(false, 'message trop volumineux pour Twitch : diffusion suspendue');
    noterRefus('taille');
    return;
  }

  const d = await assurerJeton();
  if (!d) return;                 // état déjà signalé par assurerJeton

  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'Client-Id': d.clientId,
        'Authorization': 'Bearer ' + d.jeton,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        broadcaster_id: String(d.channelId),
        message: texte,
        target: ['broadcast'],
        is_global_broadcast: false,
      }),
      signal: AbortSignal.timeout(DELAI_REQUETE_MS),
    });

    /* La réponse est lue même quand on l'ignore : sinon la connexion reste
       occupée jusqu'au prochain ramassage de la mémoire. */
    if (res.status === 429) {
      try { await res.body?.cancel(); } catch (e) { /* rien */ }
      noterRefus(429);
      return;
    }

    if (!res.ok) {
      const detail = (await res.text()).slice(0, 200);
      log('error', 'refus de Twitch : ' + res.status + ' ' + detail);

      let motif;
      try {
        const j = JSON.parse(detail);
        motif = j.message || j.error || detail;
      } catch (e) { motif = detail; }

      if (res.status === 401) jetonDelegue = null;

      marquer(false, 'Twitch ' + res.status + ' - ' + String(motif).slice(0, 90));
      noterRefus(res.status);
      return;
    }

    marquer(true);
    /* Pour le diagnostic de la fenêtre : quand, combien, et le poids de
       chaque partie du message. */
    statistiques.envois++;
    dernierMessage = { quand: Date.now(), octets: Buffer.byteLength(texte), max: MAX_BYTES,
                       parties: poidsParPartie(message, texte) };
  } catch (e) {
    log('error', 'échec de l\u2019envoi : ' + e.message);
    marquer(false, 'pas de connexion');
    noterRefus('connexion');
  }
}

function configure(options) {
  cfg = Object.assign({ lang: 'fr' }, options);

  jetonDelegue = null;
  derniereSignature = null;
  dernierEnvoi = 0;
  enAttente = null;
  if (minuteur) { clearTimeout(minuteur); minuteur = null; }
  connecte = null;
  derniereErreur = '';

  if (!cfg.relayUrl || !cfg.token) {
    log('warn', 'diffusion désactivée : relais ou jeton manquant');
    cfg = null;
    return false;
  }

  cfg.relayUrl = cfg.relayUrl.replace(/\/$/, '');
  log('info', 'diffusion activée');
  return true;
}

function publishBoard(objets, talents, cadre, coin, enFace) {
  if (!cfg) return;

  /* « v » dit ce que l'application sait envoyer. L'extension s'en sert pour
     prévenir le streamer quand elle attend des données qu'une version plus
     ancienne ne produit pas. À relever à chaque changement du format. */
  /* « v » : la version du PROTOCOLE, que l'extension compare à celle qu'elle
     exige. À relever à chaque version de l'application qui transmet quelque
     chose de nouveau : la 3 apporte les quêtes, les valeurs calculées par le
     jeu et la réserve affichée ; la 4, les identifiants raccourcis à huit
     caractères et la rareté en une lettre. Sans cela, une ancienne application passait
     pour à jour, et le message d'alerte ne paraissait jamais. */
  const message = { v: 4, lang: cfg.lang, b: objets || [], k: talents || [] };

  if (enFace && enFace.delaiStream > 0) message.d = enFace.delaiStream;

  if (enFace) {
    /* Le héros joué : le tiroir de la réserve en prend la couleur quand le
       spectateur a choisi le thème « par héros ». Sans lui, il suivait la
       dernière fiche lue et changeait de teinte sans raison. */
    if (enFace.hero)                                     message.h  = enFace.hero;
    if (enFace.face && enFace.face.length)               message.f  = enFace.face;
    if (enFace.reserve && enFace.reserve.length)         message.r  = enFace.reserve;
    if (enFace.reserveAffichee && enFace.reserveAffichee.length)
                                                         message.ra = enFace.reserveAffichee;
    if (enFace.faceTalents && enFace.faceTalents.length) message.fk = enFace.faceTalents;
    if (enFace.faceCentree && message.f)                 message.fc = 1;

    /* Le compteur de victoires et la jauge de prestige, visibles en
       permanence à l'écran du jeu, et le mode de la partie (« r » : classée).
       Quelques octets. */
    if (Number.isInteger(enFace.victoires))              message.vi = enFace.victoires;
    if (Number.isInteger(enFace.prestige))               message.pr = enFace.prestige;
    if (Number.isInteger(enFace.prestigeMax))            message.px = enFace.prestigeMax;
    /* Le mode : « r » classé, « t » tournoi, rien en partie normale. */
    /* Le compteur de victoires : le jour en cours, et un résultat par jour
       joué (v, d, r). Une douzaine d'octets. */
    if (Number.isInteger(enFace.jour) && enFace.jour > 0) message.j = enFace.jour;
    if (typeof enFace.histoire === 'string' && enFace.histoire) message.hj = enFace.histoire;
    if (enFace.classee === true)                         message.m  = 'r';
    else if (/tourn/i.test(String(enFace.mode || '')))   message.m  = 't';
  }

  if (cadre) message.c = cadre;

  const signature = JSON.stringify([message.b, message.k, message.c, message.p,
                                    message.f, message.r, message.fk, message.fc,
                                    message.t, message.d, message.h, message.ra,
                                    message.vi, message.pr, message.px, message.m,
                                    message.j, message.hj]);
  const maintenant = Date.now();

  const change = signature !== derniereSignature;
  const perime = maintenant - dernierEnvoi >= HEARTBEAT_MS;
  if (!change && !perime) return;

  enAttente = message;
  derniereSignature = signature;

  const attente = Math.max(0, MIN_INTERVAL_MS - (maintenant - dernierEnvoi));
  if (minuteur) return;

  minuteur = setTimeout(function partir() {
    minuteur = null;
    /* Un seul envoi à la fois : si le précédent n'a pas encore abouti, le
       message attend (et sera remplacé par un plus récent s'il en vient). */
    if (envoiEnCours) { minuteur = setTimeout(partir, 250); return; }
    if (!enAttente) return;
    dernierEnvoi = Date.now();
    const m = enAttente;
    enAttente = null;
    envoiEnCours = true;
    Promise.resolve().then(() => envoyer(m))
      .catch(() => { /* envoyer signale déjà ses erreurs */ })
      .finally(() => { envoiEnCours = false; });
  }, attente);
}

function setLang(lang) {
  if (!cfg || !lang || lang === cfg.lang) return;
  cfg.lang = lang;
  derniereSignature = null;      // force un renvoi avec la nouvelle langue
}

let dernierMessage = null;     // { quand, octets, max, parties } du dernier envoi réussi

/* Les envois depuis le lancement, et les refus : trop de messages (429),
   jeton expiré (401), message trop gros, ou pas de connexion. */
const statistiques = { depuis: Date.now(), envois: 0, refus: 0, dernierRefus: null };
function noterRefus(code) {
  statistiques.refus++;
  statistiques.dernierRefus = { quand: Date.now(), code: code };
}

/* Le poids de chaque partie du message, en octets : ce qui pèse le plus se
   voit d'un coup d'œil dans le diagnostic. */
function poidsParPartie(message, texte) {
  const poids = k => (message[k] === undefined) ? 0 : Buffer.byteLength(JSON.stringify(message[k]));
  const p = { b: poids('b'), f: poids('f'), r: poids('r') + poids('ra'), k: poids('k'), fk: poids('fk') };
  p.autres = Math.max(0, Buffer.byteLength(texte) - p.b - p.f - p.r - p.k - p.fk);
  return p;
}

function etat() {
  return { connecte, erreur: derniereErreur, dernierMessage, statistiques };
}

module.exports = { configure, publishBoard, setLang, etat };
