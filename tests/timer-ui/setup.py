from pathlib import Path
import json
import shutil
import subprocess
import sys

project = Path(__file__).resolve().parents[2]
run_dir = project / '.git/timer-ui' / sys.argv[1]
source = project / 'src/v45-46-47-48-49-50'
extensions = run_dir / 'data/gnome-shell/extensions'
timer = extensions / 'pomodoro@lsbcodes'
timer.mkdir(parents=True, exist_ok=True)
for name in ('extension.js', 'prefs.js', 'stylesheet.css', 'metadata.json'):
    if len(sys.argv) > 2:
        (timer / name).write_bytes(subprocess.check_output(['git', 'show', sys.argv[2] + ':src/v45-46-47-48-49-50/' + name]))
    else:
        shutil.copy2(source / name, timer / name)
shutil.copytree(source / 'schemas', timer / 'schemas', dirs_exist_ok=True)
subprocess.run(['glib-compile-schemas', '--strict', str(timer / 'schemas')], check=True)
inspector = extensions / 'pomodoro-ui-inspect@local'
inspector.mkdir(parents=True, exist_ok=True)
shutil.copy2(Path(__file__).with_name('inspector.js'), inspector / 'extension.js')
(inspector / 'metadata.json').write_text(json.dumps({
    'uuid': 'pomodoro-ui-inspect@local', 'name': 'Pomodoro UI test',
    'description': 'Isolated popup inspection', 'shell-version': ['50'],
}))
major = subprocess.check_output(['gnome-shell', '--version'], text=True).split()[2].split('.')[0]
(run_dir / 'data/gnome-shell' / f'update-check-{major}').touch()
print(run_dir)
