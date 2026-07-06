#!/usr/bin/env bash
# Auto-deploy the levelx web build to https://levelx.expo.app — but only when
# app source files actually changed since the last deploy. Invoked from a Stop
# hook (.claude/settings.local.json), so it runs every time Claude finishes a
# turn; the mtime gate keeps chat-only turns instant (no redundant deploys).
set -euo pipefail

APP_DIR="/c/Users/Admin/claud_learning/projects/calisthenics-app"
MARKER="$APP_DIR/.last-deploy"
cd "$APP_DIR"

# Newest source-file mtime (epoch seconds), ignoring build/dependency output and
# this scripts/ dir so a deploy (which writes dist/) doesn't re-trigger itself.
newest=$(find . \
  \( -path ./node_modules -o -path ./dist -o -path ./.expo -o -path ./.git -o -path ./scripts \) -prune \
  -o -type f -printf '%T@\n' 2>/dev/null | cut -d. -f1 | sort -nr | head -1)
[ -z "${newest:-}" ] && newest=0

last=0
[ -f "$MARKER" ] && last=$(cat "$MARKER" 2>/dev/null || echo 0)

# Nothing newer than the last deploy → exit quietly, turn ends immediately.
if [ "$newest" -le "$last" ]; then
  exit 0
fi

# Build + deploy. Touch the marker FIRST to the current time so even if files
# change during the (slow) deploy, the next turn still re-deploys them.
date +%s > "$MARKER"

if npx expo export -p web >/tmp/levelx-deploy.log 2>&1 \
   && npx eas-cli deploy --prod --non-interactive >>/tmp/levelx-deploy.log 2>&1; then
  printf '{"systemMessage": "🚀 Auto-deployed to https://levelx.expo.app"}\n'
else
  # Roll the marker back so the failed change retries next turn.
  echo "$last" > "$MARKER"
  printf '{"systemMessage": "⚠️ Auto-deploy failed — see /tmp/levelx-deploy.log"}\n'
fi
