// MV3 forbids eval-based development loaders. Watch and emit real release bundles instead.
import { watch } from 'node:fs';
import { spawn } from 'node:child_process';
let building = false, pending = false, timer, child, stopping = false;
function build() {
  if (building) { pending = true; return; }
  building = true;
  child = spawn(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['shadow-cljs', 'release', 'extension'], { stdio: 'inherit' });
  child.on('error', error => console.error(error.message));
  child.on('close', code => {
    building = false;
    if (stopping) return;
    if (code === 0) console.log('\nMargin rebuilt. Reload the extension in chrome://extensions, then refresh your test page.');
    if (pending) { pending = false; build(); }
  });
}
function changed() { clearTimeout(timer); timer = setTimeout(build, 200); }
const watchers = [watch('src', { recursive: true }, changed), watch('shadow-cljs.edn', changed)];
process.on('SIGINT', () => { stopping = true; clearTimeout(timer); watchers.forEach(w => w.close()); child?.kill('SIGINT'); });
build();
