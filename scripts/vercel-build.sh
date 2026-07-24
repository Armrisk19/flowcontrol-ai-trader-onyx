#!/usr/bin/env bash
set -euo pipefail

echo "Repository working directory:"
pwd

npm run build -w @flowcontrol/web

if [[ -d "apps/web/dist" ]]; then
  echo "Copying apps/web/dist to root dist"
  rm -rf dist
  cp -R apps/web/dist dist
elif [[ -d "dist" ]]; then
  echo "Using existing root dist"
else
  echo "ERROR: Vite build output was not found"
  find . -maxdepth 4 -type d -name dist -print
  exit 1
fi

test -f dist/index.html
echo "Vercel output ready: dist/index.html"
