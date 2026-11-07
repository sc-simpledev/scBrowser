#!/bin/sh
# Runs the end-to-end tests on an invisible KDE screen, so their windows don't cover the desktop.
# Needs kwin_wayland (KDE Plasma). Extra arguments go to Playwright, e.g. `e2e/hidden.sh e2e/release045.spec.ts`.
# A screen of its own also means tests can't steal focus or clicks from what you're doing.
set -e
cd "$(dirname "$0")/.."
SOCKET="scb-e2e-$$"
ARGS=""
for arg in "$@"; do ARGS="$ARGS '$(printf %s "$arg" | sed "s/'/'\\\\''/g")'"; done
exec kwin_wayland --virtual --xwayland --no-lockscreen --socket "$SOCKET" --width 1920 --height 1200 --exit-with-session "sh -c \"npx playwright test --timeout 20000 $ARGS\""
