/* ============================================================================
   RELAIS DE DIFFUSION — Cloudflare Worker

   Pourquoi ce relais existe : l'extension Twitch n'a qu'UN seul secret, et
   c'est lui qui signe les messages. Si chaque streamer signait sur sa machine,
   il faudrait lui livrer ce secret — donc le publier, puisqu'un binaire se
   décompile. N'importe qui pourrait alors diffuser de faux plateaux sur la
   chaîne de n'importe quel utilisateur.

   Ici, le secret ne quitte jamais Cloudflare.

   Le relais N'EST PAS sur le chemin de chaque message. Il délivre un jeton
   Twitch de courte durée à l'outil du streamer, qui parle ensuite directement
   à l'API Twitch. Un appel toutes les vingt minutes au lieu de 1 800 par
   heure : le forfait gratuit tient alors plusieurs milliers de streamers, et
   une panne du relais n'interrompt pas un direct déjà en cours.

   Le jeton délivré ne vaut que pour LA chaîne associée au jeton personnel, et
   expire vite. Un streamer ne peut donc jamais diffuser ailleurs que chez lui,
   et un jeton intercepté ne sert plus au bout de quelques minutes.

   La route /publier est conservée pour les cas où l'appel direct échoue.

   INSCRIPTION AUTONOME. Un streamer n'a rien à demander à personne : il clique
   sur « Se connecter avec Twitch » dans l'application, autorise, et son jeton
   personnel est déposé automatiquement dans sa configuration.

   Ce jeton n'est stocké nulle part. Il est DÉRIVÉ de l'identifiant de la chaîne
   par signature, et le relais le recalcule pour le vérifier. Pas de base de
   données, pas d'écriture, donc rien à administrer et rien à payer.

   Déploiement :
     wrangler deploy
     wrangler secret put TWITCH_EXT_SECRET      # secret de l'EXTENSION
     wrangler secret put TWITCH_EXT_CLIENT_ID   # client id de l'EXTENSION
     wrangler secret put OAUTH_CLIENT_ID        # client id de l'APPLICATION
     wrangler secret put OAUTH_CLIENT_SECRET    # secret de l'APPLICATION
     wrangler secret put JETON_SECRET           # aléatoire, sert à signer
   ========================================================================= */

const ENDPOINT   = 'https://api.twitch.tv/helix/extensions/pubsub';
const TAILLE_MAX = 5000;          // limite Twitch pour un message de diffusion

// Durée de validité du jeton délivré aux outils. Assez court pour qu'une fuite
// soit sans conséquence durable, assez long pour ne solliciter le relais que
// trois fois par heure et par streamer.
const DUREE_JETON_S = 25 * 60;

/* --- signature du jeton (HS256, via Web Crypto) ------------------------- */

function b64url(octets) {
  let s = '';
  for (const o of octets) s += String.fromCharCode(o);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function texteEnB64url(texte) {
  return b64url(new TextEncoder().encode(texte));
}

function base64EnOctets(b64) {
  const brut = atob(b64.replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(brut.length);
  for (let i = 0; i < brut.length; i++) out[i] = brut.charCodeAt(i);
  return out;
}

async function signerJeton(secretB64, channelId, dureeSecondes) {
  const entete  = { alg: 'HS256', typ: 'JWT' };
  const charge  = {
    exp: Math.floor(Date.now() / 1000) + (dureeSecondes || 120),
    user_id: String(channelId),
    role: 'external',
    channel_id: String(channelId),
    pubsub_perms: { send: ['broadcast'] },
  };

  const corps = texteEnB64url(JSON.stringify(entete)) + '.'
              + texteEnB64url(JSON.stringify(charge));

  const cle = await crypto.subtle.importKey(
    'raw', base64EnOctets(secretB64),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);

  const sig = new Uint8Array(
    await crypto.subtle.sign('HMAC', cle, new TextEncoder().encode(corps)));

  return corps + '.' + b64url(sig);
}

/* --- jetons des streamers ------------------------------------------------
   Deux origines possibles :
     - jeton dérivé, délivré par la connexion Twitch (cas normal) ;
     - jeton listé à la main dans TOKENS, pour les cas particuliers.
   ----------------------------------------------------------------------- */

async function empreinte(secret, message) {
  const cle = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(
    await crypto.subtle.sign('HMAC', cle, new TextEncoder().encode(message)));
  return b64url(sig);
}

async function fabriquerJeton(env, channelId) {
  const sig = await empreinte(env.JETON_SECRET || '', 'jeton:' + channelId);
  return 'tw-' + channelId + '-' + sig.slice(0, 24);
}

// Comparaison à durée constante : évite de laisser deviner une signature
// valide en mesurant le temps de réponse.
function memeChaine(a, b) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

async function chaineAutorisee(env, jeton) {
  if (!jeton) return null;

  if (jeton.startsWith('tw-')) {
    const m = jeton.match(/^tw-(\d+)-(.+)$/);
    if (!m) return null;
    const attendu = await fabriquerJeton(env, m[1]);
    if (!memeChaine(jeton, attendu)) return null;
    if (estBanni(env, m[1])) return null;
    return m[1];
  }

  let table;
  try { table = JSON.parse(env.TOKENS || '{}'); }
  catch (e) { return null; }
  const v = table[jeton];
  return v ? String(v) : null;
}

// Révocation : liste d'identifiants de chaîne séparés par des virgules.
function estBanni(env, channelId) {
  return String(env.BANNIS || '').split(',').map(s => s.trim()).includes(channelId);
}

/* --- garde-fou de débit -------------------------------------------------
   Best-effort : chaque isolat Cloudflare a sa propre mémoire, donc ce compteur
   ne voit qu'une partie du trafic. Il suffit à bloquer une boucle emballée,
   pas à contrer une attaque distribuée. Le vrai plafond reste le quota
   quotidien du forfait gratuit.
   ----------------------------------------------------------------------- */

const derniers = new Map();
const INTERVALLE_MIN_MS = 400;

function tropRapide(jeton) {
  const t = Date.now();
  const precedent = derniers.get(jeton) || 0;
  if (t - precedent < INTERVALLE_MIN_MS) return true;
  derniers.set(jeton, t);
  if (derniers.size > 500) derniers.clear();   // évite une croissance sans fin
  return false;
}

/* --- point d'entrée ------------------------------------------------------ */

function reponse(code, texte) {
  return new Response(texte, {
    status: code,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}

/* --- connexion Twitch ----------------------------------------------------
   Trois temps :
     /connexion  l'application ouvre cette page ; on renvoie vers Twitch
     /retour     Twitch nous renvoie ici ; on identifie le compte et on
                 fabrique le jeton, puis on le repose dans l'application
   L'adresse de retour est enfermée dans un « state » signé : sans ça, on
   offrirait une redirection ouverte vers n'importe quel site.
   ----------------------------------------------------------------------- */

function adresseDeBase(url) {
  return url.origin;
}

async function signerEtat(env, retour) {
  const donnee = btoa(retour).replace(/=+$/, '');
  const sig = (await empreinte(env.JETON_SECRET || '', 'etat:' + donnee)).slice(0, 16);
  return donnee + '.' + sig;
}

async function verifierEtat(env, etat) {
  const i = String(etat || '').lastIndexOf('.');
  if (i < 0) return null;
  const donnee = etat.slice(0, i);
  const sig = (await empreinte(env.JETON_SECRET || '', 'etat:' + donnee)).slice(0, 16);
  if (!memeChaine(etat.slice(i + 1), sig)) return null;
  try { return atob(donnee); } catch (e) { return null; }
}

// L'application n'écoute que sur la machine du streamer : toute autre
// destination serait une redirection ouverte.
function retourAutorise(retour) {
  try {
    const u = new URL(retour);
    return u.protocol === 'http:'
      && (u.hostname === '127.0.0.1' || u.hostname === 'localhost');
  } catch (e) { return false; }
}

function pageFin(titre, texte) {
  return new Response(
    '<!doctype html><html lang="fr"><meta charset="utf-8">'
    + '<title>Bazaar Scanner</title>'
    + '<body style="background:#140c06;color:#e8dcc4;font-family:system-ui,sans-serif;'
    + 'display:flex;align-items:center;justify-content:center;height:100vh;margin:0">'
    + '<div style="text-align:center;max-width:30em;padding:2em">'
    + '<h1 style="color:#f0c060;font-size:1.3em;letter-spacing:.1em">' + titre + '</h1>'
    + '<p style="line-height:1.6">' + texte + '</p></div>',
    { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Sonde de disponibilité, sans authentification et sans rien révéler.
    if (request.method === 'GET' && url.pathname === '/sante') {
      return reponse(200, 'ok');
    }

    if (request.method === 'GET' && url.pathname === '/connexion') {
      if (!env.OAUTH_CLIENT_ID) return pageFin('Indisponible',
        'La connexion Twitch n\u2019est pas configurée sur ce relais.');

      const retour = url.searchParams.get('retour') || '';
      if (!retourAutorise(retour)) return pageFin('Adresse refusée',
        'Cette page ne peut être ouverte que depuis l\u2019application.');

      const dest = new URL('https://id.twitch.tv/oauth2/authorize');
      dest.searchParams.set('client_id', env.OAUTH_CLIENT_ID);
      dest.searchParams.set('redirect_uri', adresseDeBase(url) + '/retour');
      dest.searchParams.set('response_type', 'code');
      dest.searchParams.set('scope', '');
      // Sans ceci, Twitch réutilise silencieusement la session du navigateur.
      // Un streamer dont le compte de stream diffère de sa session courante
      // se connecterait au mauvais compte sans s'en apercevoir.
      dest.searchParams.set('force_verify', 'true');
      dest.searchParams.set('state', await signerEtat(env, retour));
      return Response.redirect(dest.toString(), 302);
    }

    if (request.method === 'GET' && url.pathname === '/retour') {
      const code = url.searchParams.get('code');
      const retour = await verifierEtat(env, url.searchParams.get('state'));

      if (!code || !retour || !retourAutorise(retour)) {
        return pageFin('Connexion interrompue',
          'Relance la connexion depuis l\u2019application.');
      }

      // Échange du code contre un jeton d'accès, puis identification.
      let identifiant, pseudo;
      try {
        const t = await fetch('https://id.twitch.tv/oauth2/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            client_id: env.OAUTH_CLIENT_ID,
            client_secret: env.OAUTH_CLIENT_SECRET,
            code,
            grant_type: 'authorization_code',
            redirect_uri: adresseDeBase(url) + '/retour',
          }),
        });
        if (!t.ok) throw new Error('échange refusé');
        const acces = (await t.json()).access_token;

        const u = await fetch('https://api.twitch.tv/helix/users', {
          headers: { 'Client-Id': env.OAUTH_CLIENT_ID, 'Authorization': 'Bearer ' + acces },
        });
        if (!u.ok) throw new Error('identification refusée');
        const moi = (await u.json()).data[0];
        identifiant = moi.id;
        pseudo = moi.display_name;

        // Le jeton d'accès a fait son office : on le révoque immédiatement.
        fetch('https://id.twitch.tv/oauth2/revoke', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ client_id: env.OAUTH_CLIENT_ID, token: acces }),
        }).catch(() => {});
      } catch (e) {
        return pageFin('Connexion impossible', 'Twitch a refusé la demande. Réessaie.');
      }

      if (estBanni(env, identifiant)) {
        return pageFin('Accès refusé', 'Cette chaîne n\u2019est pas autorisée.');
      }

      const jeton = await fabriquerJeton(env, identifiant);
      const dest = new URL(retour);
      dest.searchParams.set('jeton', jeton);
      dest.searchParams.set('pseudo', pseudo || '');
      return Response.redirect(dest.toString(), 302);
    }

    const routeConnue = request.method === 'POST'
      && (url.pathname === '/publier' || url.pathname === '/jeton'
          || url.pathname === '/diagnostic');
    if (!routeConnue) return reponse(404, 'Route inconnue');

    const entete = request.headers.get('Authorization') || '';
    const jeton  = entete.startsWith('Bearer ') ? entete.slice(7).trim() : '';
    const chaine = await chaineAutorisee(env, jeton);

    // Contrôle placé APRÈS l'authentification mais AVANT tout refus pour
    // configuration incomplète : c'est justement dans ce cas qu'il sert.

    if (!chaine) return reponse(401, 'Jeton inconnu');

    /* --- contrôle de configuration --------------------------------------
       Décrit la FORME des secrets, jamais leur contenu : longueur, présence
       d'espaces parasites, décodabilité. Suffisant pour repérer un secret
       tronqué, pollué par un retour chariot, ou interverti avec un autre.
       --------------------------------------------------------------------- */
    if (url.pathname === '/diagnostic') {
      const decrire = (nom, valeur, attendu) => {
        const v = valeur || '';
        const propre = v.trim();
        return {
          cle: nom,
          present: !!v,
          longueur: v.length,
          longueur_attendue: attendu || null,
          espaces_parasites: v !== propre,
          debut: propre.slice(0, 4),
          fin: propre.slice(-4),
        };
      };

      const secretExt = (env.TWITCH_EXT_SECRET || '').trim();
      let octetsSecret = null, decodable = false;
      try { octetsSecret = base64EnOctets(secretExt).length; decodable = octetsSecret > 0; }
      catch (e) { decodable = false; }

      return new Response(JSON.stringify({
        extension: [
          decrire('TWITCH_EXT_CLIENT_ID', env.TWITCH_EXT_CLIENT_ID, 30),
          Object.assign(decrire('TWITCH_EXT_SECRET', env.TWITCH_EXT_SECRET),
            { base64_decodable: decodable, octets_apres_decodage: octetsSecret }),
        ],
        application: [
          decrire('OAUTH_CLIENT_ID', env.OAUTH_CLIENT_ID, 30),
          decrire('OAUTH_CLIENT_SECRET', env.OAUTH_CLIENT_SECRET, 30),
        ],
        signature: [decrire('JETON_SECRET', env.JETON_SECRET)],
        alertes: [
          (env.TWITCH_EXT_CLIENT_ID || '').trim() === (env.OAUTH_CLIENT_ID || '').trim()
            ? 'Les deux Client ID sont IDENTIQUES : celui de l\u2019extension et celui de '
              + 'l\u2019application doivent être différents.' : null,
          (env.TWITCH_EXT_SECRET || '').trim() === (env.OAUTH_CLIENT_SECRET || '').trim()
            ? 'Les deux secrets sont IDENTIQUES : celui de l\u2019extension vient de '
              + '« Secret Keys », celui de l\u2019application de sa page de réglages.' : null,
          !decodable
            ? 'TWITCH_EXT_SECRET n\u2019est pas du base64 valide : ce n\u2019est probablement '
              + 'pas la clé de « Secret Keys ».' : null,
          decodable && octetsSecret !== 32
            ? 'TWITCH_EXT_SECRET fait ' + octetsSecret + ' octets une fois décodé, on en '
              + 'attend 32 : valeur tronquée ou mauvaise clé.' : null,
        ].filter(Boolean),
      }, null, 1), { status: 200, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
    }


    if (!env.TWITCH_EXT_SECRET || !env.TWITCH_EXT_CLIENT_ID) {
      return reponse(500, 'Relais mal configuré');
    }

    /* --- délivrance d'un jeton Twitch de courte durée -------------------
       C'est la route normale. L'outil la rappelle avant expiration, et se
       charge lui-même de parler à Twitch entre deux renouvellements.
       --------------------------------------------------------------------- */
    if (url.pathname === '/jeton') {
      const duree = DUREE_JETON_S;
      let jwtCourt;
      try { jwtCourt = await signerJeton(env.TWITCH_EXT_SECRET, chaine, duree); }
      catch (e) { return reponse(500, 'Signature impossible'); }

      return new Response(JSON.stringify({
        jeton:     jwtCourt,
        clientId:  env.TWITCH_EXT_CLIENT_ID,   // public : visible dans l'extension
        channelId: chaine,
        expire:    Math.floor(Date.now() / 1000) + duree,
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    if (tropRapide(jeton)) return reponse(429, 'Trop de messages');

    const corps = await request.text();
    if (!corps || corps.length > TAILLE_MAX) {
      return reponse(413, 'Message absent ou trop volumineux');
    }
    try { JSON.parse(corps); }
    catch (e) { return reponse(400, 'Message illisible'); }

    let jwt;
    try { jwt = await signerJeton(env.TWITCH_EXT_SECRET, chaine); }
    catch (e) { return reponse(500, 'Signature impossible'); }

    const r = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'Client-Id': env.TWITCH_EXT_CLIENT_ID,
        'Authorization': 'Bearer ' + jwt,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        broadcaster_id: chaine,
        message: corps,
        target: ['broadcast'],
        is_global_broadcast: false,
      }),
    });

    if (!r.ok) {
      const detail = (await r.text()).slice(0, 200);
      return reponse(502, 'Refus de Twitch (' + r.status + ') ' + detail);
    }

    return new Response(null, { status: 204 });
  },
};
