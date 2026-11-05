#!/bin/bash
set -eu
export XDG_DATA_HOME="$POMODORO_RENDER_DIR/data"
export XDG_CONFIG_HOME="$POMODORO_RENDER_DIR/config"
export XDG_CACHE_HOME="$POMODORO_RENDER_DIR/cache"
export XDG_RUNTIME_DIR="$(mktemp -d /tmp/pomodoro-ui.XXXXXX)"
export GSETTINGS_BACKEND=keyfile
export NO_AT_BRIDGE=1 GTK_A11Y=none
mkdir -p "$XDG_RUNTIME_DIR"
chmod 700 "$XDG_RUNTIME_DIR"
unset DISPLAY WAYLAND_DISPLAY SESSION_MANAGER
gsettings set org.gnome.shell enabled-extensions "['pomodoro@lsbcodes', 'pomodoro-ui-inspect@local']"
gsettings set org.gnome.shell disable-user-extensions false
gsettings set org.gnome.shell allow-extension-installation true
gsettings set org.gnome.shell welcome-dialog-last-shown-version '999'
gsettings set org.gnome.desktop.interface enable-animations false
gsettings set org.gnome.desktop.interface text-scaling-factor "$POMODORO_TEXT_SCALE"
timeout 25s gnome-shell --headless --wayland --no-x11 --wayland-display pomodoro-ui-test --virtual-monitor "$POMODORO_MONITOR" > "$POMODORO_RENDER_DIR/shell.log" 2>&1 &
shell_pid=$!
trap 'kill "$shell_pid" 2>/dev/null || true; wait "$shell_pid" 2>/dev/null || true; rm -rf "$XDG_RUNTIME_DIR"' EXIT
for attempt in {1..80}; do
    if [ -f "$POMODORO_RENDER_DIR/done" ]; then
        cat "$POMODORO_RENDER_DIR/result.json"
        exit 0
    fi
    sleep 0.25
done
cat "$POMODORO_RENDER_DIR/shell.log"
exit 1
