/* ============================================================================
   Serveur local pour développer l'extension.

   Lancement :   node dev/serve.js
   Puis ouvrir : https://localhost:8080/dev/harness.html   (calibrage)

   Twitch exige du HTTPS. Génère un certificat une seule fois avec mkcert :
     mkcert -install
     mkcert -cert-file dev/certs/localhost.pem -key-file dev/certs/localhost-key.pem localhost
   Sans certificat, le serveur bascule en HTTP : suffisant pour le calibrage,
   pas pour le Local Test dans Twitch.
   ========================================================================= */

'use strict';

const http  = require('node:http');
const https = require('node:https');
const fs    = require('node:fs');
const path  = require('node:path');

const PORT = process.env.PORT || 8080;
const ROOT = path.resolve(__dirname, '..');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'text/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg':  'image/svg+xml',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.webp': 'image/webp',
  '.ico':  'image/x-icon'
};

function horodatage() {
  return new Date().toTimeString().slice(0, 8);
}

function handler(req, res) {
  let rel = decodeURIComponent(req.url.split('?')[0]);
  if (rel.endsWith('/')) rel += 'index.html';

  // Journalisation de CHAQUE requête : c'est le seul moyen de savoir si Twitch
  // vient réellement chercher les fichiers, ou s'il ne tente rien du tout.
  const origine = req.headers.referer || req.headers.origin || '—';
  console.log(horodatage() + '  ' + req.method + ' ' + rel + '   ← ' + origine);

  const file = path.join(ROOT, rel);

  // Empêche de sortir du dossier du projet.
  if (!file.startsWith(ROOT)) {
    res.writeHead(403).end('Interdit');
    return;
  }

  fs.readFile(file, (err, buf) => {
    if (err) {
      console.log('          INTROUVABLE : ' + file);
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Introuvable : ' + rel);
      return;
    }
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-store'
    });
    res.end(buf);
  });
}

const certDir = path.join(__dirname, 'certs');
const certFile = path.join(certDir, 'localhost.pem');
const keyFile  = path.join(certDir, 'localhost-key.pem');

if (fs.existsSync(certFile) && fs.existsSync(keyFile)) {
  https
    .createServer({ cert: fs.readFileSync(certFile), key: fs.readFileSync(keyFile) }, handler)
    .listen(PORT, () => {
      console.log('HTTPS prêt.');
      console.log('  Calibrage      https://localhost:' + PORT + '/dev/harness.html');
      console.log('  URI Twitch     https://localhost:' + PORT + '/extension/');
      console.log('');
      console.log('  Toute requête reçue s\'affiche ci-dessous. Si rien n\'apparaît');
      console.log('  quand tu ouvres ta page Twitch, c\'est que Twitch ne demande');
      console.log('  pas les fichiers : le problème est dans la console développeur.');
      console.log('');
    });
} else {
  http.createServer(handler).listen(PORT, () => {
    console.log('Aucun certificat trouvé dans dev/certs — démarrage en HTTP.');
    console.log('  Calibrage      http://localhost:' + PORT + '/dev/harness.html');
    console.log('  Pour le Local Test Twitch, génère un certificat (voir en-tête du fichier).');
  });
}
