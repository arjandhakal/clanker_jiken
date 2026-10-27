# pisesh

Local, extension-focused fork of [Blue-B/pisesh](https://github.com/Blue-B/pisesh), imported from commit `55da28df758865a11bf178d2276b8351bf999341` (v0.3.0). These are ordinary files owned by this repository, not a submodule or nested Git checkout. Original MIT license and attribution are preserved in [LICENSE](LICENSE).

## Install globally in Pi

From the repository root:

```sh
pi install ./pisesh
```

Restart Pi or run `/reload`, then use `/sesh` to browse, bookmark, search, and resume sessions. This installs the local package in personal Pi settings, so edits here are used directly. No npm install, build step, standalone global CLI, or runtime dependencies are needed. Requires Node.js 22.19+ and Pi's interactive terminal UI.

The extension runs `bin/pisesh` as a bundled terminal picker, then uses Pi's `ctx.switchSession()` to resume in the current process. Keep `bin/` and `extensions/` together. Upstream screenshots, translated docs, publishing scripts, CI, and release metadata are intentionally omitted.

## Keys

| Key | Action |
| --- | --- |
| `↑` / `↓`, `j` / `k` | Move selection |
| `Tab`, `h` / `l` | Cycle Favorites, Today, Here, All |
| `f` / `Space` | Toggle favorite |
| `/` | Search sessions |
| `Enter` | Resume with current default model/thinking |
| `o` | Resume with session-recorded model/thinking |
| `e` | Edit display title |
| `p` | Pick resume working directory |
| `d` | Show details |
| `g` / `G` | Generate title / configure title model and effort |
| `r` | Rescan sessions |
| `x` | Remove stale favorites |
| `Esc` / `q` | Cancel generation, clear search, then quit |
| `Ctrl-C` | Quit immediately |

## Data and side effects

Favorites and title/cwd overrides live in `favorites.json` and `pisesh-meta.json` under `PI_AGENT_DIR` or `PI_CODING_AGENT_DIR` (default `~/.pi/agent`). Sessions are read from `PI_SESSION_DIR`, `PI_CODING_AGENT_SESSION_DIR`, or the agent directory's `sessions/` folder.

Resuming can repair orphaned tool calls in a session transcript; the original is backed up as `<session>.bak-orphanheal` before the first repair. The already-active session is not rewritten. Cwd overrides require a Pi version supporting `cwdOverride` on session switches; otherwise the extension warns.

Title generation is optional and sends up to 16,000 characters of conversation evidence (excluding tool results) to your selected model provider. Provider charges may apply. It runs an ephemeral `pi --print --no-session` with tools, skills, prompt templates, and context files disabled; provider extensions remain available.

## Development

```sh
cd pisesh
npm test
node bin/pisesh --help
```

Tests use Node's built-in runner. The bundled picker also supports non-interactive flags such as `--list`, `--json`, `--star`, and `--unstar`, without installing a global shell command.
