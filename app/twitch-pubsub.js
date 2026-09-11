'use strict';

const ENDPOINT = 'https://api.twitch.tv/helix/extensions/pubsub';

const MIN_INTERVAL_MS = 1000;
const HEARTBEAT_MS    = 2000;
const MAX_BYTES       = 5000;

const MARGE_RENOUVELLEMENT_S = 120;

let cfg = null;

let jetonDelegue = null;          // { jeton, clientId, channelId, expire }
let renouvellementEnCours = null;

let derniereSignature = null;
let dernierEnvoi = 0;
let enAttente = null;
let minuteur = null;

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

async function envoyer(message) {
  const texte = JSON.stringify(message);

  if (Buffer.byteLength(texte) > MAX_BYTES) {
    log('error', 'message trop volumineux (' + Buffer.byteLength(texte) + ' octets), ignoré');
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
    });

    if (res.status === 429) return;

    if (!res.ok) {
      const detail = (await res.text()).slice(0, 200);
      log('error', 'refus de Twitch : ' + res.status + ' ' + detail);

      let motif;
      try {
        const j = JSON.parse(detail);
        motif = j.message || j.error || detail;
      } catch (e) { motif = detail; }

      if (res.status === 401) jetonDelegue = null;

      marquer(false, 'Twitch ' + res.status + ' — ' + String(motif).slice(0, 90));
      return;
    }

    marquer(true);
  } catch (e) {
    log('error', 'échec de l\u2019envoi : ' + e.message);
    marquer(false, 'pas de connexion');
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
  const message = { v: 2, lang: cfg.lang, b: objets || [], k: talents || [] };

  if (enFace && enFace.delaiStream > 0) message.d = enFace.delaiStream;

  if (enFace) {
    if (enFace.face && enFace.face.length)               message.f  = enFace.face;
    if (enFace.reserve && enFace.reserve.length)         message.r  = enFace.reserve;
    if (enFace.faceTalents && enFace.faceTalents.length) message.fk = enFace.faceTalents;
    if (enFace.faceCentree && message.f)                 message.fc = 1;
  }

  if (cadre) message.c = cadre;

  const signature = JSON.stringify([message.b, message.k, message.c, message.p,
                                    message.f, message.r, message.fk, message.fc,
                                    message.t, message.d]);
  const maintenant = Date.now();

  const change = signature !== derniereSignature;
  const perime = maintenant - dernierEnvoi >= HEARTBEAT_MS;
  if (!change && !perime) return;

  enAttente = message;
  derniereSignature = signature;

  const attente = Math.max(0, MIN_INTERVAL_MS - (maintenant - dernierEnvoi));
  if (minuteur) return;

  minuteur = setTimeout(() => {
    minuteur = null;
    dernierEnvoi = Date.now();
    const m = enAttente;
    enAttente = null;
    envoyer(m);
  }, attente);
}

function setLang(lang) {
  if (!cfg || !lang || lang === cfg.lang) return;
  cfg.lang = lang;
  derniereSignature = null;      // force un renvoi avec la nouvelle langue
}

function etat() {
  return { connecte, erreur: derniereErreur };
}

module.exports = { configure, publishBoard, setLang, etat };
