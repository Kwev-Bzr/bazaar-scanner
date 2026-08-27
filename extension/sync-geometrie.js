/* ============================================================================
   GÉOMÉTRIE : DE LA SOURCE VERS L'APPLICATION

   Le problème que ce script supprime : la géométrie du jeu — où le plateau se
   trouve, où tombent les talents, où sont les repères fixes — était présente à
   DEUX endroits. Dans config.js pour l'extension, et recopiée à la main dans
   interface.html pour l'outil de calibrage.

   Deux copies d'une même vérité finissent toujours par diverger. C'est la même
   cause qui a produit les bugs répétés entre overlay.html et panel.html, et
   elle s'est déjà manifestée ici : une régénération a effacé le bloc de repères
   sans que rien ne le signale.

   Désormais config.js est la SOURCE UNIQUE, et le bloc de l'application en est
   DÉRIVÉ. Le script réécrit la zone délimitée par les deux sentinelles, et
   refuse d'agir si elles manquent plutôt que d'écrire au hasard.

     node tools/sync-geometrie.js                    # vérifie, n'écrit rien
     node tools/sync-geometrie.js --ecrire
     node tools/sync-geometrie.js --ecrire --app ../autre/interface.html

   Le mode par défaut est la VÉRIFICATION : il sort en erreur si l'application
   a divergé, ce qui permet de l'appeler depuis build.sh et d'être arrêté avant
   de livrer deux fichiers incohérents.
   ========================================================================= */

'use strict';

const fs   = require('node:fs');
const path = require('node:path');

const RACINE = path.resolve(__dirname, '..');
const SOURCE = path.join(RACINE, 'twitch-extension', 'extension', 'config.js');

/* Les chemins sont résolus par rapport au SCRIPT, jamais au dossier courant :
   sinon la commande ne fonctionne que depuis un endroit précis, ce qui n'est
   deviné par personne. */
function resoudre(chemin) {
  return path.isAbsolute(chemin) ? chemin : path.resolve(process.cwd(), chemin);
}

const ECRIRE = process.argv.includes('--ecrire');
const iApp   = process.argv.indexOf('--app');
// À défaut d'indication, on cherche l'application aux endroits habituels,
// relativement au script et non au dossier depuis lequel on l'appelle.
const CANDIDATS = [
  path.resolve(RACINE, '..', 'scanner-light', 'interface.html'),
  path.resolve(RACINE, '..', 'bazaar-scanner-light', 'interface.html'),
  path.resolve(RACINE, 'app', 'interface.html'),
];

const APP = (iApp > 0 && process.argv[iApp + 1])
  ? resoudre(process.argv[iApp + 1])
  : (CANDIDATS.find(c => fs.existsSync(c)) || CANDIDATS[0]);

const DEBUT = '    /* <<< GÉOMÉTRIE — engendré par tools/sync-geometrie.js */';
const FIN   = '    /* GÉOMÉTRIE >>> */';

/* --- lecture de la source ------------------------------------------------- */

function lireConfig() {
  if (!fs.existsSync(SOURCE)) {
    throw new Error('config.js introuvable : ' + SOURCE);
  }
  // On ÉVALUE la source au lieu de l'analyser : une expression régulière sur du
  // JavaScript casse au premier changement de mise en forme.
  const bac = { window: {} };
  const code = fs.readFileSync(SOURCE, 'utf8');
  new Function('window', code)(bac.window);

  const c = bac.window.BAZAAR_CONFIG;
  if (!c || !c.BOARD || !c.SKILL_LAYOUTS) {
    throw new Error('config.js ne définit pas BAZAAR_CONFIG.BOARD / SKILL_LAYOUTS');
  }
  return c;
}

/* --- fabrication du bloc -------------------------------------------------- */

function fabriquer(c) {
  const l = [];
  l.push(DEBUT);
  l.push('    // Ne pas modifier ici : la source est');
  l.push('    // twitch-extension/extension/config.js');
  l.push('    BOARD: ' + JSON.stringify(c.BOARD) + ',');

  l.push('    SKILL_LAYOUTS: [');
  c.SKILL_LAYOUTS.forEach((d, i) => {
    l.push('      { max: ' + d.max + ', w: ' + d.w + ', h: ' + d.h
         + ', slots: ' + JSON.stringify(d.slots) + ' }'
         + (i < c.SKILL_LAYOUTS.length - 1 ? ',' : ''));
  });
  l.push('    ],');

  if (c.REPERES) {
    l.push('    REPERES: {');
    for (const cle of ['cercles', 'equerres']) {
      const liste = c.REPERES[cle] || [];
      l.push('      ' + cle + ': [');
      liste.forEach(r => l.push('        ' + JSON.stringify(r) + ','));
      l.push('      ],');
    }
    l.push('    },');
  }

  l.push(FIN);
  return l.join('\n');
}

/* --- application ---------------------------------------------------------- */

function main() {
  const c = lireConfig();
  const attendu = fabriquer(c);

  if (!fs.existsSync(APP)) {
    console.error('\ninterface.html introuvable.');
    console.error('Cherché à ces emplacements :');
    CANDIDATS.forEach(c => console.error('  ' + c));
    console.error('\nPrécise le bon avec --app <chemin>, par exemple :');
    console.error('  node tools/sync-geometrie.js --app ../scanner-light/interface.html\n');
    process.exit(1);
  }

  const html = fs.readFileSync(APP, 'utf8');
  const i = html.indexOf(DEBUT);
  const j = html.indexOf(FIN);

  if (i < 0 || j < 0 || j < i) {
    console.error('\nLes sentinelles sont absentes de ' + path.basename(APP) + '.');
    console.error('Encadre le bloc de géométrie par ces deux lignes exactes :');
    console.error('\n' + DEBUT + '\n    …\n' + FIN + '\n');
    process.exit(1);
  }

  const actuel = html.slice(i, j + FIN.length);

  if (actuel === attendu) {
    console.log('\nGéométrie à jour : ' + path.basename(APP)
      + ' correspond à config.js.\n');
    return;
  }

  if (!ECRIRE) {
    console.error('\nDIVERGENCE : ' + path.basename(APP)
      + ' ne correspond plus à config.js.');
    console.error('Relance avec --ecrire pour la reporter.\n');
    // Un aperçu de ce qui change, pour ne pas écrire à l'aveugle.
    const a = actuel.split('\n'), b = attendu.split('\n');
    for (let k = 0; k < Math.max(a.length, b.length); k++) {
      if (a[k] !== b[k]) {
        if (a[k] !== undefined) console.error('  - ' + a[k].trim().slice(0, 100));
        if (b[k] !== undefined) console.error('  + ' + b[k].trim().slice(0, 100));
      }
    }
    console.error('');
    process.exit(1);
  }

  fs.writeFileSync(APP, html.slice(0, i) + attendu + html.slice(j + FIN.length), 'utf8');
  console.log('\nGéométrie reportée dans ' + path.basename(APP) + '.');
  console.log('  ' + c.BOARD.slots + ' emplacements, '
    + c.SKILL_LAYOUTS.length + ' disposition(s) de talents'
    + (c.REPERES
        ? ', ' + (c.REPERES.cercles || []).length + ' cercle(s) et '
          + (c.REPERES.equerres || []).length + ' équerre(s)'
        : '') + '.\n');
}

try {
  main();
} catch (e) {
  console.error('\n' + e.message + '\n');
  process.exit(1);
}
