import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

if (GLib.getenv('GSETTINGS_BACKEND') !== 'memory')
    throw new Error('Run with GSETTINGS_BACKEND=memory to leave desktop settings untouched.');

const root = Gio.File.new_for_uri(import.meta.url).get_parent().get_parent();
const sourceDir = root.get_child('src/v45-46-47-48-49-50');
const schemaDir = GLib.dir_make_tmp('pomodoro-tests-XXXXXX');
let passed = 0;

function equal(actual, expected, message) {
    if (actual !== expected)
        throw new Error(`${message}: expected ${expected}, got ${actual}`);
}

try {
    const [, , stderr, status] = GLib.spawn_sync(null, [
        'glib-compile-schemas', '--strict', `--targetdir=${schemaDir}`,
        sourceDir.get_child('schemas').get_path(),
    ], null, GLib.SpawnFlags.SEARCH_PATH, null);
    equal(status, 0, new TextDecoder().decode(stderr));

    const schemaSource = Gio.SettingsSchemaSource.new_from_directory(
        schemaDir, Gio.SettingsSchemaSource.get_default(), false);
    const schema = schemaSource.lookup('org.gnome.shell.extensions.pomodoro-lsantiagoba', false);
    const [, bytes] = sourceDir.get_child('extension.js').load_contents(null);

    // Replace Shell imports and actors only; run the real timer code with Gio and GLib.
    const source = new TextDecoder().decode(bytes)
        .replace(/^import .*;$/gm, '')
        .replace('export default class', 'class');
    const load = new Function('Gio', 'GLib', 'GObject', 'PanelMenu', 'Main', 'Extension', '_', 'ngettext',
        `${source}\nreturn FocusTimerIndicator;`);
    const FocusTimerIndicator = load(Gio, GLib,
        {registerClass: cls => cls}, {Button: class { destroy() {} }}, {
            panel: {addToStatusArea() {}},
            notify() {},
        }, class {}, text => text, (one, many, count) => count === 1 ? one : many);

    FocusTimerIndicator.prototype._buildPanel = function () {
        this._panelIcon = {};
        this._panelLabel = {};
    };
    FocusTimerIndicator.prototype._buildMenu = function () {
        for (const name of ['_modeLabel', '_timerLabel', '_sessionLabel', '_startIcon', '_startText', '_decreaseButton', '_increaseButton'])
            this[name] = {};
    };

    function test(name, run) {
        const settings = new Gio.Settings({settings_schema: schema});
        for (const key of schema.list_keys())
            settings.reset(key);
        settings.set_boolean('play-sound', false);
        const timer = new FocusTimerIndicator({getSettings: () => settings});
        try {
            run(timer, settings);
            print(`ok ${++passed} - ${name}`);
        } finally {
            if (timer._settings)
                timer.destroy();
        }
    }

    for (const mode of ['focus', 'short-break', 'long-break']) {
        test(`${mode}: adjustments change only the current timer`, (timer, settings) => {
            timer._mode = mode;
            timer._remaining = 600;
            timer._sessions = 2;
            const durations = ['focus-duration', 'short-break-duration', 'long-break-duration'];
            const before = durations.map(key => settings.get_int(key));
            timer._adjustTime(5);
            equal(timer._remaining, 900, 'Add five minutes');
            equal(timer._timerLabel.text, '15:00', 'Timer display');
            equal(timer._startText.text, 'Start', 'Adjusted new timer');
            timer._adjustTime(-5);
            equal(timer._remaining, 600, 'Remove five minutes');
            equal(timer._mode, mode, 'Mode preserved');
            equal(timer._sessions, 2, 'Session count preserved');
            equal(durations.map(key => settings.get_int(key)).join(), before.join(), 'Preferences preserved');
        });
    }

    test('running timers cannot be adjusted and hide both buttons', timer => {
        timer._toggle();
        const before = timer._remaining;
        const deadline = timer._deadline;
        timer._adjustTime(5);
        timer._adjustTime(-5);
        equal(timer._remaining, before, 'Running duration preserved');
        equal(timer._deadline, deadline, 'Running deadline preserved');
        equal(timer._decreaseButton.visible, false, 'Minus hidden');
        equal(timer._increaseButton.visible, false, 'Plus hidden');
    });

    test('paused timers can be adjusted and resume from the new duration', timer => {
        timer._toggle();
        timer._remaining = 123;
        timer._toggle();
        timer._adjustTime(5);
        equal(timer._remaining, 423, 'Paused time adjusted');
        equal(timer._running, false, 'Timer remains paused');
        equal(timer._startText.text, 'Resume', 'Resume label');
        equal(timer._increaseButton.visible, true, 'Plus visible');
        equal(timer._decreaseButton.visible, true, 'Minus visible');
        timer._toggle();
        const seconds = Math.ceil((timer._deadline - GLib.get_monotonic_time()) / GLib.USEC_PER_SEC);
        equal(seconds, 423, 'Resume uses adjusted time');
    });

    test('subtraction never produces a zero or negative timer', timer => {
        for (const remaining of [1, 59, 60, 299, 300]) {
            timer._remaining = remaining;
            timer._sync();
            equal(timer._decreaseButton.reactive, false, 'Minus disabled');
            equal(timer._decreaseButton.can_focus, false, 'Disabled minus skipped by keyboard');
            timer._adjustTime(-5);
            equal(timer._remaining, remaining, 'Remaining time preserved');
        }
    });

    test('subtraction preserves seconds and stops before zero', timer => {
        timer._remaining = 301;
        timer._adjustTime(-5);
        equal(timer._remaining, 1, 'Seconds preserved');
        equal(timer._timerLabel.text, '0:01', 'One second displayed');
        timer._adjustTime(-5);
        equal(timer._remaining, 1, 'Further subtraction ignored');
        timer._adjustTime(5);
        equal(timer._remaining, 301, 'Addition still works');
        equal(timer._decreaseButton.reactive, true, 'Minus re-enabled');
    });

    test('reset discards the current override and restores Start', timer => {
        timer._toggle();
        timer._toggle();
        timer._adjustTime(5);
        timer._reset();
        equal(timer._remaining, timer._durationForMode(), 'Reset duration');
        equal(timer._startText.text, 'Start', 'Reset Start label');
        equal(timer._increaseButton.visible, true, 'Controls visible after reset');
    });

    test('skipping resets the next session and its button label', timer => {
        timer._toggle();
        timer._toggle();
        timer._adjustTime(5);
        timer._complete(false);
        equal(timer._mode, 'short-break', 'Next mode');
        equal(timer._remaining, timer._durationForMode(), 'Next duration');
        equal(timer._startText.text, 'Start', 'Next session Start label');
    });

    test('adjusting a paused timer back to its default still shows Resume', timer => {
        timer._toggle();
        timer._toggle();
        timer._adjustTime(5);
        timer._adjustTime(-5);
        equal(timer._remaining, timer._durationForMode(), 'Default duration');
        equal(timer._startText.text, 'Resume', 'Paused session remains Resume');
    });

    test('automatic starts hide adjustments for the next session', (timer, settings) => {
        settings.set_boolean('auto-start-breaks', true);
        timer._complete(false);
        equal(timer._running, true, 'Break starts automatically');
        equal(timer._increaseButton.visible, false, 'Plus hidden during break');
        equal(timer._decreaseButton.visible, false, 'Minus hidden during break');
    });

    print(`${passed} tests passed.`);
} finally {
    const compiled = Gio.File.new_for_path(`${schemaDir}/gschemas.compiled`);
    if (compiled.query_exists(null))
        compiled.delete(null);
    Gio.File.new_for_path(schemaDir).delete(null);
}
