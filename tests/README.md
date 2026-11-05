These checks accompany the timer UI change on a separate branch of the fork.

Run the timer checks with GJS and `glib-compile-schemas` installed:

```bash
GSETTINGS_BACKEND=memory gjs -m tests/timer-adjustments.js
```

The optional native popup checks use GNOME Shell 50 and a private headless Wayland session:

```bash
python3 tests/timer-ui/setup.py normal
POMODORO_RENDER_DIR="$PWD/.git/timer-ui/normal" \
POMODORO_MONITOR=1920x1080 POMODORO_TEXT_SCALE=1.0 \
    dbus-run-session -- bash tests/timer-ui/inside.sh
```

Each run uses private config, data, cache, runtime and D-Bus directories. It writes results and screenshots under `.git/timer-ui/`. The inspector checks real button signals, accessible names, timer states, actor positions and Pango ellipsis.

Recorded comparisons in `timer-ui/artifacts/` cover 1920×1080 at normal text size, 800×600 at 150%, and 640×480 at 200%. The heading is fully visible in all three. Longer headings still ellipsize. The popup keeps its original dimensions, within one pixel of width rounding.

At 640×480 with 200% text, the upstream popup already extends slightly below the screen. Its height is unchanged by this patch. Other GNOME Shell versions were not tested with the native harness.
