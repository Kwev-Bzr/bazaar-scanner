/* ============================================================================
   DIFFUSION VERS L'EXTENSION TWITCH

   Envoie l'état du plateau à l'extension, via le service de diffusion de
   Twitch. Aucune dépendance à installer.

   Ce module n'ouvre AUCUN port et n'attend aucune connexion entrante. Il ne
   fait que des appels sortants, comme un navigateur.

   COMMENT L'AUTORISATION FONCTIONNE

   Twitch exige que chaque message soit signé avec le secret de l'extension.
   Ce secret n'est pas ici, et ne peut pas y être : un exécutable se décompile,
   et quiconque le récupérerait pourrait diffuser de faux plateaux sur la
   chaîne de n'importe quel utilisateur.

   À la place, le relais délivre un jeton Twitch valable une vingtaine de
   minutes, limité à la chaîne du streamer. Ce jeton sert ensuite à parler
   directement à l'API Twitch, sans repasser par le relais. Celui-ci n'est donc
   sollicité que trois fois par heure, et une panne de sa part n'interrompt pas
   une diffusion en cours.

   Utilisation :

     const pubsub = require('./twitch-pubsub');

     pubsub.configure({
       relayUrl: 'https://…workers.dev',
       token:    'tw-…',              // obtenu par la connexion Twitch
       onEtat:   (ok, raison) => { … },
     });

     pubsub.publishBoard(objets, talents);   // à chaque lecture du plateau
   ========================================================================= */

'use strict';

const ENDPOINT = 'https://api.twitch.tv/helix/extensions/pubsub';

// Twitch accepte environ un message par seconde. On envoie dès qu'il y a du
// changement, et on répète l'état au moins toutes les HEARTBEAT_MS pour que les
// spectateurs arrivant en cours de stream soient à jour rapidement.
const MIN_INTERVAL_MS = 1000;
const HEARTBEAT_MS    = 2000;
const MAX_BYTES       = 5000;

// Marge avant expiration en deçà de laquelle on redemande un jeton.
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

/* --- journal et état ------------------------------------------------------ */

function log(niveau, message) {
  if (cfg && typeof cfg.log === 'function') cfg.log(niveau, message);
}

function marquer(ok, message) {
  const change = connecte !== ok;
  connecte = ok;
  derniereErreur = ok ? '' : (message || '');
  if (change && cfg && typeof cfg.onEtat === 'function') cfg.onEtat(ok, derniereErreur);
}

/* --- jeton délivré par le relais ------------------------------------------ */

async function assurerJeton() {
  const maintenant = Math.floor(Date.now() / 1000);
  if (jetonDelegue && jetonDelegue.expire - maintenant > MARGE_RENOUVELLEMENT_S) {
    return jetonDelegue;
  }
  // Un seul renouvellement à la fois, même si plusieurs envois se présentent.
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

/* --- envoi ---------------------------------------------------------------- */

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

    // Simple limitation de débit : la liaison reste saine.
    if (res.status === 429) return;

    if (!res.ok) {
      const detail = (await res.text()).slice(0, 200);
      log('error', 'refus de Twitch : ' + res.status + ' ' + detail);

      // Le motif exact remonte jusqu'à l'interface : un « refus de Twitch »
      // générique serait impossible à diagnostiquer.
      let motif;
      try {
        const j = JSON.parse(detail);
        motif = j.message || j.error || detail;
      } catch (e) { motif = detail; }

      // Jeton périmé côté Twitch (horloge décalée, veille prolongée) : on le
      // jette pour en redemander un au prochain cycle.
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

/* --- API publique --------------------------------------------------------- */

/**
 * options :
 *   relayUrl  adresse du relais
 *   token     jeton personnel du streamer
 *   lang      langue annoncée dans le message (facultatif)
 *   log       (niveau, message) pour la console (facultatif)
 *   onEtat    (ok, raison) à chaque changement de liaison (facultatif)
 *
 * Renvoie false si les paramètres indispensables manquent, auquel cas rien
 * n'est diffusé.
 */
function configure(options) {
  cfg = Object.assign({ lang: 'fr' }, options);

  // Repartir de zéro : sans ça, republier un plateau identique après une
  // reconfiguration serait pris pour un doublon et n'enverrait rien.
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

/**
 * objets : une entrée par objet du plateau
 *   s   emplacement de départ (0 = le plus à gauche)
 *   n   emplacements occupés (1 Petit, 2 Moyen, 3 Grand)
 *   id  TemplateId de la carte
 *   e   enchantement, absent s'il n'y en a pas
 *   q   qualité, absente si inconnue
 *
 * talents : idem, sans le champ n (ils occupent tous une case).
 *
 * cadre : [gauche, haut, largeur, hauteur] en pourcentage de l'image, ou rien
 *         si le jeu occupe tout le cadre. Sert au spectateur à recaler les
 *         zones de survol sur la mise en page du streamer.
 */
function publishBoard(objets, talents, cadre) {
  if (!cfg) return;

  const message = { v: 1, lang: cfg.lang, b: objets || [], k: talents || [] };

  // Cadre du jeu dans l'image, omis quand le jeu occupe tout : inutile de
  // transporter la valeur par défaut à chaque message.
  if (cadre) message.c = cadre;

  const signature = JSON.stringify([message.b, message.k, message.c]);
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

/** État de la liaison : true, false, ou null tant que rien n'a été tenté. */
function etat() {
  return { connecte, erreur: derniereErreur };
}

module.exports = { configure, publishBoard, setLang, etat };
