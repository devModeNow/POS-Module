#!/bin/sh
set -e

mkdir -p /app/backups

# Nest compiles `import from 'src/...'` as require('src/...').
# Map that to the compiled output at /app/dist.
if [ ! -e /app/src ]; then
  ln -sfn /app/dist /app/src
fi

if [ -f /app/dist/main.js ]; then
  exec node /app/dist/main.js
fi

if [ -f /app/dist/src/main.js ]; then
  exec node /app/dist/src/main.js
fi

echo "Cannot find compiled Nest entrypoint under /app/dist" >&2
ls -la /app /app/dist 2>/dev/null || true
exit 1
