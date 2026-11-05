import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const wait = () => new Promise(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT, 150, () => {
    resolve();
    return GLib.SOURCE_REMOVE;
}));

export default class Inspect extends Extension {
    enable() {
        Object.defineProperty(Main.extensionManager, 'updatesSupported', {get: () => false});
        this._timeout = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 5, () => {
            this._timeout = 0;
            Main.overview.hide();
            const indicator = Main.panel.statusArea['pomodoro@lsbcodes'];
            if (!indicator)
                throw new Error('Timer indicator was not loaded');
            indicator.menu.open();
            this._inspect(indicator).catch(logError);
            return GLib.SOURCE_REMOVE;
        });
    }

    async _inspect(timer) {
        await wait();
        const dir = GLib.getenv('POMODORO_RENDER_DIR');
        const monitor = Main.layoutManager.primaryMonitor;
        const popup = timer.menu.actor;
        const label = timer._modeLabel;
        const [x, y] = popup.get_transformed_position();
        const result = {
            monitor,
            heading: {width: label.width, ellipsized: label.clutter_text.get_layout().is_ellipsized()},
            popup: {x, y, width: popup.width, height: popup.height},
            checks: [],
        };
        GLib.file_set_contents(`${dir}/initial.json`, JSON.stringify(result, null, 2));
        const check = (condition, message) => {
            if (!condition)
                throw new Error(message);
            result.checks.push(message);
        };
        const screenshot = async name => {
            const [sx, sy] = popup.get_transformed_position();
            const stream = Gio.File.new_for_path(`${dir}/${name}.png`).replace(null, false, Gio.FileCreateFlags.NONE, null);
            await new Shell.Screenshot().screenshot_area(Math.floor(sx), Math.floor(sy), Math.ceil(popup.width), Math.ceil(popup.height), stream);
            stream.close(null);
        };
        await screenshot('popup');
        if (timer._increaseButton) {
            check(!result.heading.ellipsized, 'Heading fits the available popup width');
            check(x >= monitor.x && x + popup.width <= monitor.x + monitor.width + 1, 'Popup stays within the screen width');
            result.popup.fitsScreenHeight = y + popup.height <= monitor.y + monitor.height + 1;
            check(!timer._timerLabel.clutter_text.get_layout().is_ellipsized(), 'Timer is fully visible');
            const [minusX] = timer._decreaseButton.get_transformed_position();
            const [timeX] = timer._timerLabel.get_transformed_position();
            const [plusX] = timer._increaseButton.get_transformed_position();
            check(minusX + timer._decreaseButton.width <= timeX + 1 && timeX + timer._timerLabel.width <= plusX + 1, 'Adjustment buttons do not overlap the timer');
            check(timer._decreaseButton.accessible_name === 'Remove 5 minutes' && timer._increaseButton.accessible_name === 'Add 5 minutes', 'Adjustment buttons have accessible names');
            timer._increaseButton.emit('clicked', 1);
            check(timer._remaining === 1800 && timer._startText.text === 'Start', 'Plus button adds five minutes before starting');
            timer._decreaseButton.emit('clicked', 1);
            check(timer._remaining === 1500, 'Minus button removes five minutes');
            timer._startButton.emit('clicked', 1);
            check(!timer._decreaseButton.visible && !timer._increaseButton.visible, 'Both adjustment buttons hide while running');
            timer._startButton.emit('clicked', 1);
            timer._increaseButton.emit('clicked', 1);
            check(timer._remaining === 1800 && timer._startText.text === 'Resume', 'Paused timer accepts adjustments and retains Resume');
            timer._resetButton.emit('clicked', 1);
            check(timer._remaining === 1500 && timer._startText.text === 'Start', 'Reset restores the configured timer');
            timer._remaining = 300;
            timer._sync();
            check(!timer._decreaseButton.reactive && !timer._decreaseButton.can_focus, 'Minus is disabled and skipped by keyboard at five minutes');
            timer._remaining = 7500;
            timer._sync();
            await wait();
            check(!timer._timerLabel.clutter_text.get_layout().is_ellipsized(), 'Three-digit minute values remain fully visible');
            await screenshot('long-timer');
            label.text = 'A VERY LONG TRANSLATED FOCUS SESSION NAME THAT WILL NOT FIT';
            await wait();
            check(label.clutter_text.get_layout().is_ellipsized(), 'Long headings retain ellipsis when space is insufficient');
        }
        GLib.file_set_contents(`${dir}/result.json`, JSON.stringify(result, null, 2));
        GLib.file_set_contents(`${dir}/done`, 'done');
    }

    disable() {
        if (this._timeout)
            GLib.source_remove(this._timeout);
    }
}
