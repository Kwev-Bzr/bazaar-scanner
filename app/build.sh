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

echo "── 1. Bundle ──"
npx --yes esbuild app.js \
  --bundle --platform=node --target=node22 \
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
  cp build/package/node.exe build/node.exe
fi
cp build/node.exe "$SORTIE/$NOM"

echo "── 4. Icône et métadonnées ──"
# ATTENTION : l'icône DOIT être posée AVANT postject. Injecter d'abord
# déplacerait les sections du binaire et l'icône serait perdue.
npx --yes resedit-cli \
  --in "$SORTIE/$NOM" --out "$SORTIE/$NOM" \
  --icon icon.ico \
  --product-name "Bazaar Scanner" \
  --file-description "Bazaar Scanner" \
  --company-name "Kwev" \
  --product-version 1.0.0.0 \
  --file-version 1.0.0.0 2>/dev/null || echo "   (resedit indisponible, icône ignorée)"

echo "── 5. Application graphique (pas de console) ──"
node -e '
  const fs = require("fs");
  const f = process.argv[1];
  const b = fs.readFileSync(f);
  const pe = b.readUInt32LE(0x3c);
  const sub = pe + 4 + 20 + 68;      // en-tête optionnel : champ Subsystem
  if (b.readUInt16LE(sub) !== 2) { b.writeUInt16LE(2, sub); fs.writeFileSync(f, b); }
  console.log("   subsystem =", b.readUInt16LE(sub), "(2 = fenêtré)");
' "$SORTIE/$NOM"

echo "── 6. Injection du blob ──"
npx --yes postject "$SORTIE/$NOM" NODE_SEA_BLOB build/sea.blob \
  --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2

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
