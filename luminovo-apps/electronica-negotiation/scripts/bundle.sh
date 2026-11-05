#!/usr/bin/env bash
# Builds the complete app bundle: manifest.json must be passed as $1 (the current app document).
set -euo pipefail
cd "$(dirname "$0")/.."
rm -rf dist-bundle && mkdir -p dist-bundle/widgets dist-bundle/assets
npx vite build >/dev/null
npx esbuild worker/index.ts --bundle --format=esm --platform=neutral --target=es2022 --outfile=dist-bundle/worker.js --log-level=warning
cp widgets/floor.html dist-bundle/widgets/floor.html
cp dist-web/assets/* dist-bundle/assets/
cp "$1" dist-bundle/manifest.json
echo '<!doctype html><title>electronica negotiation</title><p>Open this app from the Luminovo product.</p>' > dist-bundle/index.html
tar --exclude=node_modules --exclude=dist-web --exclude=dist-bundle --exclude='*.tgz' -czf dist-bundle/source.tgz -C .. electronica-negotiation/src electronica-negotiation/worker electronica-negotiation/widgets electronica-negotiation/scripts electronica-negotiation/package.json electronica-negotiation/vite.config.ts electronica-negotiation/tsconfig.json
(cd dist-bundle && tar -czf ../bundle.tgz index.html manifest.json worker.js source.tgz widgets assets)
ls -la dist-bundle dist-bundle/assets
