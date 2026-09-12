#!/bin/sh
set -eu
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
cd "$SCRIPT_DIR"
if [ ! -d node_modules ]; then
  npm install
fi
npm run start:dashboard
