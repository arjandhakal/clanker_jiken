import { mkdir, writeFile, unlink } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

if (process.platform !== 'darwin') throw new Error('This installer is macOS-only. On Linux, use the systemd example in README.md.');
const project = dirname(dirname(fileURLToPath(import.meta.url)));
const label = 'dev.pi.browser-search';
const file = join(homedir(), 'Library/LaunchAgents', `${label}.plist`);
const domain = `gui/${process.getuid()}`;
const xml = (s) => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const args = ['--env-file-if-exists=.env', join(project, 'src/server.mjs')];
if (process.argv[2] === 'install') {
  await mkdir(dirname(file), { recursive: true });
  await mkdir(join(project, 'data'), { recursive: true, mode: 0o700 });
  await writeFile(file, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>${label}</string>
<key>ProgramArguments</key><array>${[process.execPath, ...args].map((v) => `<string>${xml(v)}</string>`).join('')}</array>
<key>WorkingDirectory</key><string>${xml(project)}</string>
<key>RunAtLoad</key><true/><key>KeepAlive</key><true/>
<key>ThrottleInterval</key><integer>15</integer>
<key>StandardOutPath</key><string>${xml(join(project, 'data/service.log'))}</string>
<key>StandardErrorPath</key><string>${xml(join(project, 'data/service-error.log'))}</string>
</dict></plist>`, { mode: 0o600 });
  try { execFileSync('launchctl', ['bootout', `${domain}/${label}`], { stdio: 'ignore' }); } catch {}
  execFileSync('launchctl', ['bootstrap', domain, file], { stdio: 'inherit' });
  console.log('Installed and started Pi Search. Logs: data/service*.log');
} else if (process.argv[2] === 'uninstall') {
  try { execFileSync('launchctl', ['bootout', `${domain}/${label}`], { stdio: 'ignore' }); } catch {}
  await unlink(file).catch((error) => { if (error.code !== 'ENOENT') throw error; });
  console.log('Removed Pi Search login service. Your local search data was kept.');
} else throw new Error('Usage: node scripts/service.mjs install|uninstall');
