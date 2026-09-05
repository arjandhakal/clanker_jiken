import { mkdirSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
mkdirSync('dist', { recursive: true });
const output = resolve('dist/margin-0.1.0.zip');
rmSync(output, { force: true });
execFileSync('zip', ['-qr', output, 'manifest.json', 'worker.js', 'library.html', 'popup.html', 'styles.css', 'icons', 'js', '-x', '*.map', '*.DS_Store'], { cwd: 'extension' });
console.log(`Packaged ${output}`);
