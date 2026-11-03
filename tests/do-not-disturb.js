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
    const notifications = new Gio.Settings({schema_id: 'org.gnome.desktop.notifications'});
    const messages = [];
    const [, bytes] = sourceDir.get_child('extension.js').load_contents(null);

    // Replace Shell imports and actors only; run the real timer code with Gio and GLib.
    const source = new TextDecoder().decode(bytes)
        .replace(/^import .*;$/gm, '')
        .replace('export default class', 'class');
    const load = new Function('Gio', 'GLib', 'GObject', 'PanelMenu', 'Main', 'Extension', '_', 'ngettext',
        `${source}\nreturn {FocusTimerIndicator, PomodoroExtension};`);
    const {FocusTimerIndicator, PomodoroExtension} = load(Gio, GLib,
        {registerClass: cls => cls}, {Button: class { destroy() {} }}, {
            panel: {addToStatusArea() {}},
            notify(title) {
                messages.push({title, banners: notifications.get_boolean('show-banners')});
            },
        }, class {}, text => text, (one, many, count) => count === 1 ? one : many);

    FocusTimerIndicator.prototype._buildPanel = function () {
        this._panelIcon = {};
        this._panelLabel = {};
    };
    FocusTimerIndicator.prototype._buildMenu = function () {
        for (const name of ['_modeLabel', '_timerLabel', '_sessionLabel', '_startIcon', '_startText'])
            this[name] = {};
    };

    function banners(expected) {
        equal(notifications.get_boolean('show-banners'), expected, 'Notification banners');
    }

    function test(name, run) {
        const settings = new Gio.Settings({settings_schema: schema});
        for (const key of schema.list_keys())
            settings.reset(key);
        notifications.reset('show-banners');
        messages.length = 0;
        settings.set_boolean('do-not-disturb', true);
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

    test('disabled by default and does not change notification settings', (timer, settings) => {
        equal(settings.get_default_value('do-not-disturb').get_boolean(), false, 'Default');
        settings.reset('do-not-disturb');
        timer._toggle();
        banners(true);
        timer._reset();
        notifications.set_boolean('show-banners', false);
        timer._toggle();
        timer._reset();
        banners(false);
    });

    test('start, pause, resume and reset', timer => {
        banners(true);
        timer._toggle();
        banners(false);
        timer._tick();
        banners(false);
        timer._toggle();
        banners(true);
        timer._toggle();
        banners(false);
        timer._reset();
        banners(true);
    });

    for (const mode of ['short-break', 'long-break']) {
        test(`skipping focus restores notifications for ${mode}`, (timer, settings) => {
            timer._sessions = mode === 'long-break' ? settings.get_int('sessions-before-long-break') - 1 : 0;
            timer._toggle();
            timer._complete(false);
            equal(timer._mode, mode, 'Next mode');
            banners(true);
            timer._toggle();
            banners(true);
        });

        test(`automatically started ${mode} leaves notifications enabled`, (timer, settings) => {
            settings.set_boolean('auto-start-breaks', true);
            timer._sessions = mode === 'long-break' ? settings.get_int('sessions-before-long-break') - 1 : 0;
            timer._toggle();
            timer._complete(true);
            equal(timer._mode, mode, 'Next mode');
            equal(timer._running, true, 'Break is running');
            banners(true);
            equal(messages[0].banners, true, 'Focus completion notification');
        });
    }

    test('timer expiry restores banners before the completion notification', timer => {
        timer._toggle();
        timer._stopTimeout();
        timer._deadline = GLib.get_monotonic_time() - 1;
        equal(timer._tick(), GLib.SOURCE_REMOVE, 'Expired timeout');
        banners(true);
        equal(messages.length, 1, 'Completion notification count');
        equal(messages[0].title, 'Focus session complete', 'Completion notification');
        equal(messages[0].banners, true, 'Banners when notifying');
    });

    test('automatically started focus enables Do Not Disturb', (timer, settings) => {
        timer._complete(false);
        settings.set_boolean('auto-start-focus', true);
        timer._toggle();
        timer._complete(true);
        equal(timer._mode, 'focus', 'Next mode');
        equal(timer._running, true, 'Focus is running');
        banners(false);
    });

    test('changing the option during focus takes effect immediately', (timer, settings) => {
        settings.set_boolean('do-not-disturb', false);
        timer._toggle();
        banners(true);
        settings.set_boolean('do-not-disturb', true);
        banners(false);
        settings.set_boolean('do-not-disturb', false);
        banners(true);
        settings.set_boolean('do-not-disturb', true);
        banners(false);
    });

    test('changing the option while paused preserves the remaining time', (timer, settings) => {
        timer._toggle();
        timer._remaining = 123;
        timer._toggle();
        settings.set_boolean('do-not-disturb', false);
        settings.set_boolean('do-not-disturb', true);
        equal(timer._remaining, 123, 'Paused timer');
        banners(true);
    });

    for (const action of ['pause', 'reset', 'skip', 'finish', 'disable', 'option-off']) {
        test(`pre-existing Do Not Disturb is preserved on ${action}`, (timer, settings) => {
            notifications.set_boolean('show-banners', false);
            timer._toggle();
            if (action === 'pause')
                timer._toggle();
            else if (action === 'reset')
                timer._reset();
            else if (action === 'skip' || action === 'finish')
                timer._complete(action === 'finish');
            else if (action === 'disable')
                timer.destroy();
            else
                settings.set_boolean('do-not-disturb', false);
            banners(false);
        });
    }

    test('manually turning Do Not Disturb off is respected until the next focus', timer => {
        timer._toggle();
        notifications.set_boolean('show-banners', true);
        timer._tick();
        banners(true);
        timer._toggle();
        timer._toggle();
        banners(false);
    });

    test('manually turning Do Not Disturb off and on is preserved on completion', timer => {
        timer._toggle();
        notifications.set_boolean('show-banners', true);
        notifications.set_boolean('show-banners', false);
        timer._complete(true);
        banners(false);
    });

    test('manually disabling pre-existing Do Not Disturb is preserved', timer => {
        notifications.set_boolean('show-banners', false);
        timer._toggle();
        notifications.set_boolean('show-banners', true);
        timer._tick();
        timer._reset();
        banners(true);
    });

    test('destroy restores notifications and disconnects settings callbacks', (timer, settings) => {
        timer._toggle();
        timer.destroy();
        banners(true);
        equal(timer._timeoutId, 0, 'Timeout removed');
        settings.set_boolean('do-not-disturb', false);
        notifications.set_boolean('show-banners', false);
        equal(timer._restoreBanners, null, 'Notification callback disconnected');
        equal(timer._notificationSettings, null, 'Notification settings released');
    });

    test('extension disable and re-enable clean up notification state', (timer, settings) => {
        timer.destroy();
        const extension = new PomodoroExtension();
        extension.getSettings = () => settings;
        extension.enable();
        extension._indicator._toggle();
        banners(false);
        extension.disable();
        banners(true);
        equal(extension._indicator, null, 'Indicator released');
        extension.enable();
        banners(true);
        extension._indicator._toggle();
        banners(false);
        extension.disable();
        banners(true);
    });

    print(`${passed} tests passed.`);
} finally {
    const compiled = Gio.File.new_for_path(`${schemaDir}/gschemas.compiled`);
    if (compiled.query_exists(null))
        compiled.delete(null);
    Gio.File.new_for_path(schemaDir).delete(null);
}
