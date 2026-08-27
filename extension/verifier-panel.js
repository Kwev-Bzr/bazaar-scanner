/* ============================================================================
   DIVERGENCES ENTRE overlay.html ET panel.html

   panel.html embarque une copie manuelle du rendu de carte : glossaires,
   coloration des mots-clés, sprites, libellés. Deux copies d'une même logique
   finissent toujours par diverger, et celle-ci l'a fait à répétition — c'est la
   cause identifiée du plus grand nombre de bugs de ce projet.

   Ce script ne répare rien : il CONSTATE. Réécrire panel.html automatiquement
   serait imprudent — il a déjà été corrompu une fois, et sa mise en page ne se
   déduit pas de celle de l'overlay. Il signale donc précisément ce qui manque,
   et laisse la décision.

     node tools/verifier-panel.js

   Sort en erreur s'il trouve une divergence, ce qui permet de l'appeler depuis
   build.sh. Le vrai remède reste celui noté depuis longtemps : faire charger
   overlay.html par panel.html au moment de l'exécution, et supprimer la copie.
   ========================================================================= */

'use strict';

const fs   = require('node:fs');
const path = require('node:path');

const RACINE  = path.resolve(__dirname, '..');
const OVERLAY = path.join(RACINE, 'overlay.html');
const PANEL   = path.join(RACINE, 'panel.html');

/* --- ce qui doit être identique -------------------------------------------
   Chaque entrée est un bloc que les deux fichiers doivent posséder à
   l'identique. On compare le contenu normalisé — indentation et retours à la
   ligne mis à part — car panel.html indente différemment.
   ----------------------------------------------------------------------- */

const BLOCS = [
  { nom: 'TAG_FR',        debut: 'const TAG_FR = {',        fin: '};' },
  { nom: 'SIZE_FR',       debut: 'const SIZE_FR = {',       fin: '};' },
  { nom: 'TIER_FR',       debut: 'const TIER_FR = {',       fin: '};' },
  { nom: 'ENCHANT_FR',    debut: 'const ENCHANT_FR = {',    fin: '};' },
  // Ces deux tableaux se terminent par un .flatMap(), pas par un simple « ]; ».
  { nom: 'KW_MAP',        debut: 'const KW_MAP = [',        fin: '].flatMap(' },
  { nom: 'KW_MAP_FR',     debut: 'const KW_MAP_FR = [',     fin: '].flatMap(' },
  { nom: 'colorize()',    debut: 'function colorize(',      fin: '\n}' },
];

// Éléments dont la seule présence est vérifiée : leur absence signale une
// évolution de l'overlay non reportée.
const PRESENCES = [
  { nom: 'libellés traduisibles (lib)',        marqueur: 'function lib(' },
  { nom: 'glossaires commutables (trad)',      marqueur: 'function trad(' },
  { nom: 'libellés publiés (publies)',         marqueur: 'function publies(' },
  { nom: 'table LIBELLES',                     marqueur: 'const LIBELLES = {' },
  { nom: 'puce ▸ des effets',                  marqueur: 'effect-arrow">\u25b8' },
  // La qualité affichée est celle de la CARTE, non celle de l'exemplaire :
  // « data.currentTier » signalerait l'ancien comportement.
  { nom: 'cadre à la qualité minimale',        marqueur: 'tier-${data.tier ||' },
];

function normaliser(s) {
  return s.replace(/\s+/g, ' ').trim();
}

function extraire(texte, debut, fin) {
  const i = texte.indexOf(debut);
  if (i < 0) return null;
  const j = texte.indexOf(fin, i + debut.length);
  if (j < 0) return null;
  return texte.slice(i, j + fin.length);
}

/* --- programme ------------------------------------------------------------ */

for (const f of [OVERLAY, PANEL]) {
  if (!fs.existsSync(f)) {
    console.error('\nIntrouvable : ' + f + '\n');
    process.exit(1);
  }
}

const o = fs.readFileSync(OVERLAY, 'utf8');
const p = fs.readFileSync(PANEL, 'utf8');

const ecarts = [];

console.log('\nBlocs partagés');
for (const b of BLOCS) {
  const a = extraire(o, b.debut, b.fin);
  const c = extraire(p, b.debut, b.fin);

  if (!a) { console.log('  ?     ' + b.nom + ' — absent d\'overlay.html'); continue; }
  if (!c) {
    console.log('  MANQUE ' + b.nom);
    ecarts.push(b.nom + ' : absent de panel.html');
    continue;
  }
  if (normaliser(a) === normaliser(c)) {
    console.log('  ok     ' + b.nom);
  } else {
    console.log('  DIFFÈRE ' + b.nom
      + '  (overlay ' + a.length + ' car., panel ' + c.length + ')');
    ecarts.push(b.nom + ' : contenu différent');
  }
}

console.log('\nÉvolutions de l\'overlay');
for (const e of PRESENCES) {
  const dansOverlay = o.includes(e.marqueur);
  const dansPanel   = p.includes(e.marqueur);
  if (!dansOverlay) { console.log('  —      ' + e.nom + ' (pas dans l\'overlay)'); continue; }
  if (dansPanel) console.log('  ok     ' + e.nom);
  else {
    console.log('  MANQUE ' + e.nom);
    ecarts.push(e.nom + ' : non reporté dans panel.html');
  }
}

if (!ecarts.length) {
  console.log('\npanel.html est à jour.\n');
  process.exit(0);
}

console.log('\n' + ecarts.length + ' divergence(s) :');
ecarts.forEach(e => console.log('  ' + e));
console.log('\npanel.html ne sert QUE dans l\'outil complet — overlay OBS et');
console.log('commandes de chat. L\'extension Twitch n\'en dépend pas : son rendu');
console.log('est engendré depuis overlay.html par tools/build-extension.js.');
console.log('\nSi tu n\'utilises plus l\'outil complet, ces écarts sont sans');
console.log('conséquence. Sinon, reporte-les à la main — et jamais à l\'aveugle :');
console.log('panel.html a déjà été corrompu une fois.\n');
process.exit(1);
