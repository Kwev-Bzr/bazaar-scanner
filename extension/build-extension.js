/* ============================================================================
   GÉNÉRATION DU RENDU DE L'EXTENSION DEPUIS overlay.html

   Le problème que ce script résout : panel.html est une copie manuelle
   d'overlay.html, et cette copie se désynchronise silencieusement à chaque
   modification. On ne refait pas cette erreur pour l'extension.

   Ici, rien n'est recopié à la main. Le script lit overlay.html, en extrait
   le CSS, les sprites SVG, le balisage de la carte et le script de rendu,
   applique une liste de transformations explicites, et écrit le résultat
   dans twitch-extension/extension/generated/.

   À relancer après CHAQUE modification d'overlay.html :
     node tools/build-extension.js

   Chaque transformation est vérifiée : si overlay.html évolue au point qu'un
   motif attendu disparaît, le script s'arrête avec un message clair plutôt
   que de produire un fichier silencieusement cassé.
   ========================================================================= */

'use strict';

const fs   = require('node:fs');
const path = require('node:path');

const ROOT     = path.resolve(__dirname, '..');
const OVERLAY  = path.join(ROOT, 'overlay.html');
const OUT_DIR  = path.join(ROOT, 'twitch-extension', 'extension', 'generated');
const TEMPLATE = path.join(ROOT, 'twitch-extension', 'extension', 'viewer.template.html');
const VIEWER   = path.join(ROOT, 'twitch-extension', 'extension', 'viewer.html');

let erreurs = 0;
function exiger(condition, message) {
  if (!condition) { console.error('  ÉCHEC : ' + message); erreurs++; }
  return condition;
}

/* --- 1. Découpage d'overlay.html -------------------------------------- */

const src = fs.readFileSync(OVERLAY, 'utf8');

function entre(ouvrant, fermant, depuis = 0) {
  const a = src.indexOf(ouvrant, depuis);
  if (a < 0) return null;
  const b = src.indexOf(fermant, a + ouvrant.length);
  if (b < 0) return null;
  return { texte: src.slice(a + ouvrant.length, b), fin: b + fermant.length };
}

const css     = entre('<style>', '</style>');
const sprites = (() => {
  const a = src.indexOf('<svg id="kw-sprites"');
  const b = src.indexOf('</svg>', a);
  return a < 0 ? null : { texte: src.slice(a, b + 6), fin: b + 6 };
})();
const script  = entre('<script>', '</script>');

exiger(css,     'bloc <style> introuvable dans overlay.html');
exiger(sprites, 'bloc <svg id="kw-sprites"> introuvable');
exiger(script,  'bloc <script> introuvable');
if (erreurs) process.exit(1);

// Le balisage de la carte se trouve entre les sprites et le script.
const balisage = src.slice(sprites.fin, src.lastIndexOf('<script>')).trim();
exiger(balisage.includes('id="card"'),      'le balisage extrait ne contient pas #card');
exiger(balisage.includes('id="item-body"'), 'le balisage extrait ne contient pas #item-body');

// Les <link> du <head> — notamment Google Fonts (Cinzel + Rajdhani). Sans eux
// le rendu retombe sur une police de secours et paraît complètement différent.
const liens = (src.slice(0, src.indexOf('<style>')).match(/<link\b[^>]*>/g) || []).join('\n  ');
exiger(/fonts\.googleapis\.com/.test(liens), 'lien vers Google Fonts introuvable dans le <head>');

/* --- 2. Transformations du script ------------------------------------- */

let js = script.texte;

const transformations = [
  {
    nom: 'portraits de héros vers le CDN',
    de: /http:\/\/localhost:3000\/characters\//g,
    vers: '" + window.BAZAAR_CONFIG.DATA_BASE_URL + "/characters/',
    // cas particulier : ce sont des littéraux entre apostrophes, on recolle après
    apres: s => s.replace(
      /'" \+ window\.BAZAAR_CONFIG\.DATA_BASE_URL \+ "\/characters\/([^']+)'/g,
      "window.BAZAAR_CONFIG.DATA_BASE_URL + '/characters/$1'")
  },
  {
    nom: 'images d\u2019objets et de talents vers le CDN',
    de: /`http:\/\/localhost:3000\/\$\{imgDir\}\/\$\{data\.image\}`/,
    vers: '`${window.BAZAAR_CONFIG.DATA_BASE_URL}/images/${data.image}`'
  },
  {
    nom: 'suppression de la lecture de /overlay-config',
    de: /fetch\('\/overlay-config'\)[\s\S]*?\.catch\(\(\) => \{[^}]*\}\);/,
    vers: '// (paramètre de durée retiré : c\'est le survol qui pilote l\'affichage)'
  },
  {
    nom: 'suppression de la connexion SSE',
    de: /function connect\(\)\s*\{[\s\S]*?\n\}\s*\nconnect\(\);/,
    vers: '// (connexion SSE retirée : les données arrivent par le canal Twitch)'
  },
  {
    nom: 'désactivation du masquage automatique',
    de: /let hideTimer\s*=\s*null;/,
    // Le seul usage de setTimeout dans overlay.html est le masquage après
    // DISPLAY_MS. Ici c'est le survol qui pilote l'affichage, donc on rend
    // setTimeout inerte. `const` plutôt que `function` : une déclaration de
    // fonction serait hissée et se capturerait elle-même (récursion infinie).
    vers: 'let hideTimer = null;\n'
        + 'const setTimeout = function () { return 0; };'
  },
  {
    nom: 'suffixe de cache sur les images',
    de: /`\$\{window\.BAZAAR_CONFIG\.DATA_BASE_URL\}\/images\/\$\{data\.image\}`/,
    vers: '`${window.BAZAAR_CONFIG.DATA_BASE_URL}/images/${data.image}`'
        + ' + (window.BAZAAR_SUFFIXE_CACHE || \'\')'
  },
  {
    nom: 'exposition de showItem',
    de: /$/,
    vers: '\n\nwindow.showItem = showItem;\nwindow.showError = showError;\n'
  }
];

console.log('\nTransformations :');
for (const t of transformations) {
  const avant = js;
  js = js.replace(t.de, t.vers);
  if (t.apres) js = t.apres(js);
  const applique = js !== avant;
  console.log('  ' + (applique ? 'ok  ' : 'RIEN') + '  ' + t.nom);
  if (!applique) erreurs++;
}

/* --- 3. Contrôles de sortie -------------------------------------------- */

console.log('\nContrôles :');
const controles = [
  ['aucun localhost restant',      !/localhost:3000/.test(js)],
  ['aucun EventSource restant',    !/EventSource/.test(js)],
  ['colorize() conservée',          /function colorize/.test(js)],
  ['KW_MAP_FR conservée',           /KW_MAP_FR/.test(js)],
  ['glossaires FR conservés',       /TIER_FR/.test(js) && /ENCHANT_FR/.test(js)],
  ['showItem exposée',              /window\.showItem/.test(js)],
  ['sprites SVG non vides',         sprites.texte.length > 5000],
];
for (const [nom, ok] of controles) {
  console.log('  ' + (ok ? 'ok  ' : 'ÉCHEC') + '  ' + nom);
  if (!ok) erreurs++;
}

/* --- 3bis. Isolation du CSS global ------------------------------------
   Les règles `body` et `*` de l'overlay s'appliqueraient à toute la page de
   l'extension et casseraient la mise en page — c'est exactement le problème
   documenté pour panel.html. On les restreint à #card-panel.
   ----------------------------------------------------------------------- */

let cssOut = css.texte;
const avantCss = cssOut;

// :where() restreint la portée SANS ajouter de poids. Indispensable ici :
// `#card-panel *` aurait la spécificité d'un identifiant et écraserait toutes
// les règles de classe (.header, .body…), donc toutes les marges intérieures
// de la carte — c'est ce qui la rendait compressée.
cssOut = cssOut
  .replace(/^(\s*)\*,\s*\*::before,\s*\*::after\s*\{/m,
           '$1:where(#card-panel), :where(#card-panel) *, '
           + ':where(#card-panel) *::before, :where(#card-panel) *::after {')
  .replace(/^(\s*)body\s*\{/m, '$1:where(#card-panel) {');

// La barre de progression n'a plus de sens : c'est le survol qui décide de la
// durée d'affichage, pas un minuteur.
cssOut += `

/* ── Ajouts propres à l'extension Twitch (générés) ────────────────────── */

/* Plus de minuteur : l'affichage est piloté par le survol. */
#card-panel .progress-wrap { display: none !important; }

/* Le bloc « body » d'overlay.html, renommé en #card-panel plus haut, apporte
   des règles de MISE EN PAGE prévues pour une page entière dans OBS :
   display:flex, padding, min-height:100vh et overflow:hidden. Appliquées au
   conteneur de la carte, elles la rognent et tronquent le texte.
   On ne garde que ce qui relève de la typographie, tout le reste est annulé. */
#card-panel {
  display: block;
  min-height: 0;
  padding: 0;
  overflow: visible;
  background: none;
  border: 0;
  border-radius: 0;
  box-shadow: none;
  width: auto;
  max-width: none;
}

/* Même précaution sur la carte elle-même : sa largeur doit rester celle
   prévue par overlay.html, sans rétrécissement par un parent flex. */
#card-panel #card {
  flex: none;
  width: 483px;
  max-width: none;
}

/* La mise à l'échelle est calculée en JavaScript (viewer.js) et posée en
   inline sur #card : en CSS pur, scale() exige un nombre sans unité, et
   calc(100vw / 1920) produit une longueur — la règle serait ignorée. */
#card-panel #card {
  transform-origin: top left;
}
`;

console.log('\nIsolation CSS :');
console.log('  ' + (cssOut !== avantCss ? 'ok  ' : 'RIEN') + '  règles globales restreintes à #card-panel');
if (cssOut === avantCss) erreurs++;

const cssControles = [
  ['plus de sélecteur body nu',  !/^\s*body\s*\{/m.test(cssOut)],
  ['plus de sélecteur * nu',     !/^\s*\*,\s*\*::before/m.test(cssOut)],
  ['portée sans surspécificité', /:where\(#card-panel\) \*/.test(cssOut)
                                 && !/^\s*#card-panel \*[,{ ]/m.test(cssOut)],
  ['#card conservé',              /#card\s*\{/.test(cssOut)],
  ['barre de progression masquée', /progress-wrap \{ display: none/.test(cssOut)],
  ['origine de transformation posée', /transform-origin: top left/.test(cssOut)],
  ['débordement rétabli',           /#card-panel \{[^}]*overflow: visible/.test(cssOut)],
  ['mise en page du body annulée',  /#card-panel \{[^}]*display: block/.test(cssOut)],
  ['largeur de carte préservée',    /#card-panel #card \{[^}]*width: 483px/.test(cssOut)],
];
for (const [nom, ok] of cssControles) {
  console.log('  ' + (ok ? 'ok  ' : 'ÉCHEC') + '  ' + nom);
  if (!ok) erreurs++;
}

if (erreurs) {
  console.error('\n' + erreurs + ' problème(s). Rien n\u2019a été écrit.');
  console.error('overlay.html a probablement changé de structure : ajuste les');
  console.error('motifs dans ce script plutôt que de patcher le résultat.\n');
  process.exit(1);
}

/* --- 4. Écriture -------------------------------------------------------- */

const enTete = '/* FICHIER GÉNÉRÉ par tools/build-extension.js depuis overlay.html.\n'
             + '   Ne PAS modifier à la main : toute modification sera écrasée.\n'
             + '   Modifie overlay.html puis relance le script. */\n\n';

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(path.join(OUT_DIR, 'overlay.css'),  '/* GÉNÉRÉ depuis overlay.html */\n' + cssOut);
fs.writeFileSync(path.join(OUT_DIR, 'overlay.js'),   enTete + js);

// viewer.html est regénéré depuis un gabarit, pour y injecter sprites + balisage.
if (fs.existsSync(TEMPLATE)) {
  let html = fs.readFileSync(TEMPLATE, 'utf8');
  html = html.replace('<!--LIENS-->',   liens)
             .replace('<!--SPRITES-->', sprites.texte)
             .replace('<!--CARTE-->',   balisage);
  fs.writeFileSync(VIEWER, html);
  console.log('\n  viewer.html regénéré depuis le gabarit');
}

const ko = f => Math.round(fs.statSync(path.join(OUT_DIR, f)).size / 1024);
console.log('\nÉcrit dans twitch-extension/extension/generated/ :');
console.log('  overlay.css  ' + ko('overlay.css') + ' Ko');
console.log('  overlay.js   ' + ko('overlay.js') + ' Ko');
console.log('');
