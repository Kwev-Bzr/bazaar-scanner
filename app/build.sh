#!/usr/bin/env bash
# ============================================================================
#  Construction de l'exécutable Windows.
#
#  Même technique que l'outil complet : bundle esbuild → blob SEA → injection
#  dans un node.exe → passage en application graphique → icône.
#
#  Ce qui sort : dist/BazaarScanner.exe, à livrer avec interface.html.
#
#  Prérequis : node 22 et npx. Le reste est téléchargé automatiquement.
# ============================================================================

set -euo pipefail

# ── Cohérence de la géométrie ──────────────────────────────────────────────
# interface.html contient une copie DÉRIVÉE de la géométrie du jeu, dont la
# source est twitch-extension/extension/config.js. Si les deux divergent, le
# calibrage du streamer ne correspondra pas aux zones de survol des
# spectateurs : autant s'arrêter ici.
SYNC="../bazaar-scanner/tools/sync-geometrie.js"
if [ -f "$SYNC" ]; then
  node "$SYNC" --app interface.html || {
    echo
    echo "Géométrie divergente. Reporte-la avant de compiler :"
    echo "  node $SYNC --ecrire --app interface.html"
    exit 1
  }
else
  echo "(contrôle de géométrie ignoré : $SYNC absent)"
fi
cd "$(dirname "$0")"

NODE_VERSION="22.22.2"
SORTIE="dist"
NOM="BazaarScanner.exe"

rm -rf "$SORTIE" build
mkdir -p "$SORTIE" build

# Version unique, lue dans VERSION et inscrite dans le bundle.
VERSION=$(tr -d ' \r\n' < VERSION)
if [ -z "$VERSION" ]; then
  echo "VERSION est vide ou absent." >&2
  exit 1
fi
echo "   version : $VERSION"

echo "── 1. Bundle ──"
npx --yes esbuild app.js \
  --bundle --platform=node --target=node22 \
  --define:__VERSION__="\"$VERSION\"" \
  --outfile=build/app.cjs --format=cjs

echo "── 2. Blob SEA ──"
cat > build/sea-config.json <<EOF
{
  "main": "build/app.cjs",
  "output": "build/sea.blob",
  "disableExperimentalSEAWarning": true
}
EOF
node --experimental-sea-config build/sea-config.json

echo "── 3. node.exe Windows ──"
if [ ! -f build/node.exe ]; then
  npm pack "node-win-x64@${NODE_VERSION}" --pack-destination build >/dev/null
  tar -xzf build/node-win-x64-*.tgz -C build

  # L'emplacement dans l'archive a déjà changé d'une version à l'autre
  # (package/node.exe, puis bin/node.exe) : on le cherche au lieu de le
  # présumer, sinon la compilation casse au prochain changement.
  TROUVE=$(find build -name node.exe -not -path 'build/node.exe' | head -1)
  if [ -z "$TROUVE" ]; then
    echo "node.exe introuvable dans l'archive téléchargée." >&2
    exit 1
  fi
  echo "   node.exe : $TROUVE"
  cp "$TROUVE" build/node.exe
fi
cp build/node.exe "$SORTIE/$NOM"

echo "── 4. Application graphique (pas de console) ──"
node -e '
  const fs = require("fs");
  const f = process.argv[1];
  const b = fs.readFileSync(f);
  const pe = b.readUInt32LE(0x3c);
  const sub = pe + 4 + 20 + 68;      // en-tête optionnel : champ Subsystem
  if (b.readUInt16LE(sub) !== 2) { b.writeUInt16LE(2, sub); fs.writeFileSync(f, b); }
  console.log("   subsystem =", b.readUInt16LE(sub), "(2 = fenêtré)");
' "$SORTIE/$NOM"

echo "── 5. Injection du blob ──"
npx --yes postject "$SORTIE/$NOM" NODE_SEA_BLOB build/sea.blob \
  --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2

echo "── 6. Icône et métadonnées ──"
# APRÈS l'injection, et non avant.
#
# Remplacer le groupe d'icônes réduit la section des ressources de 170 Ko et
# décale les suivantes : la table de relocation ne correspond plus, et postject
# signalait « Relocation corrupted ». Injecter d'abord évite ce décalage.
#
# « 1,icon.ico » et non « icon.ico » : sans identifiant, l'icône serait AJOUTÉE
# à côté de celle de node.exe, qui garde l'identifiant 1 — et l'Explorateur
# affiche celle de plus petit identifiant, donc celle de Node.
#
# --ignore-signed : le node.exe officiel est signé, et resedit refuse d'y
# toucher par défaut. La signature est de toute façon invalidée par l'injection.
#
# Et surtout PAS de « 2>/dev/null » : il masquait ces erreurs, et l'exécutable
# sortait sans icône sans que rien ne le signale.
npx --yes resedit-cli \
  --in "$SORTIE/$NOM" --out "$SORTIE/$NOM.tmp" \
  --ignore-signed \
  --icon 1,icon.ico \
  --product-name "Bazaar Scanner" \
  --file-description "Bazaar Scanner" \
  --company-name "Kwev" \
  --product-version 1.0.0.0 \
  --file-version 1.0.0.0

# Windows garde le fichier verrouillé un instant après l'écriture : on attend
# qu'il soit réellement accessible avant de le déplacer.
sleep 2
for i in 1 2 3 4 5; do
  if (exec 3<> "$SORTIE/$NOM.tmp") 2>/dev/null; then exec 3>&-; break; fi
  echo "   fichier encore verrouillé, nouvelle tentative ($i)…"
  sleep 2
done
mv "$SORTIE/$NOM.tmp" "$SORTIE/$NOM"

echo "── 7. Vérification ──"
node -e '
  const fs = require("fs");
  const b = fs.readFileSync(process.argv[1]);
  const pe = b.readUInt32LE(0x3c);
  const s = b.readUInt16LE(pe + 4 + 20 + 68);
  if (s !== 2) { console.error("   ÉCHEC : subsystem =", s, "— la console apparaîtra"); process.exit(1); }
  console.log("   subsystem toujours à 2 après injection");
' "$SORTIE/$NOM"

cp interface.html "$SORTIE/"
cp LISEZMOI.txt README.txt "$SORTIE/" 2>/dev/null || true

echo
echo "Prêt : $SORTIE/"
ls -la "$SORTIE"
echo
echo "À distribuer : $NOM + interface.html + LISEZMOI.txt + README.txt"
echo "config.ini est créé au premier lancement."


# ────────────────────────────────────────────────────────────────────────────
#  8. Installateur Windows
#
#  Facultatif : il ne se construit que si makensis est présent ET si les deux
#  pièces qui ne viennent pas d'ici sont là — la DLL du mod, compilée par
#  dotnet, et la charge BepInEx.
# ────────────────────────────────────────────────────────────────────────────

echo
echo "── 8. Installateur ──"

# NSIS ne se met pas dans le PATH à l'installation : on le cherche aussi à ses
# emplacements habituels sous Windows, plutôt que d'abandonner.
MAKENSIS=""
if command -v makensis >/dev/null 2>&1; then
  MAKENSIS="makensis"
else
  for C in \
    "/c/Program Files (x86)/NSIS/makensis.exe" \
    "/c/Program Files/NSIS/makensis.exe" \
    "$PROGRAMFILES/NSIS/makensis.exe" \
    "${PROGRAMFILES:-}/NSIS/makensis.exe"
  do
    [ -f "$C" ] && MAKENSIS="$C" && break
  done
fi

if [ -z "$MAKENSIS" ]; then
  echo "   makensis introuvable : installateur non construit."
  echo "   Installe NSIS (https://nsis.sourceforge.io), puis relance."
  echo "   S'il est déjà installé ailleurs :"
  echo "     MAKENSIS=\"/c/chemin/vers/makensis.exe\" bash build.sh"
  exit 0
fi
echo "   makensis : $MAKENSIS"

MANQUE=""
[ -f "BazaarScannerBridge.dll" ] || MANQUE="$MANQUE BazaarScannerBridge.dll"
[ -d "bepinex_payload" ]         || MANQUE="$MANQUE bepinex_payload/"

if [ -n "$MANQUE" ]; then
  echo "   Manquant :$MANQUE"
  echo "   L'exécutable est prêt dans $SORTIE/, mais l'installateur a besoin"
  echo "   de la DLL du mod (dotnet build) et du dossier bepinex_payload."
  exit 0
fi

# makensis lit les fichiers dans le dossier du script : on l'exécute là où
# ils se trouvent, et on récupère l'installateur ensuite.
cp "$SORTIE/$NOM" .
# La version vient du fichier VERSION, jamais du script NSIS.
"$MAKENSIS" -DVERSION_APP="$VERSION" installer.nsi | tail -3
rm -f "$NOM"
mv BazaarScanner_setup.exe "$SORTIE/" 2>/dev/null || true

echo
echo "Installateur : $SORTIE/BazaarScanner_setup.exe"
echo "C'est LE seul fichier à transmettre aux streamers."
