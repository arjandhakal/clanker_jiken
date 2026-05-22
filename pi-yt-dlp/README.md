# pi-yt-dlp

A Pi package that adds YouTube tools powered by [`yt-dlp`](https://github.com/yt-dlp/yt-dlp) and `ffmpeg`.

## Features

- Fetch video / playlist metadata.
- Extract human or auto-generated subtitles/transcripts (including Japanese).
- Download videos.
- Download playlists as audio-only MP3/M4A/Opus/etc.
- Save subtitles/transcripts next to media or to a text file.
- Open/play downloaded media with your system player (`open`, `xdg-open`, `mpv`, `vlc`, etc.).

## Requirements

Install command-line dependencies yourself:

```bash
brew install yt-dlp ffmpeg        # macOS
# or: pipx install yt-dlp; brew/apt install ffmpeg
```

Optional players: `mpv` or `vlc`.

## Install in Pi

From this repository/project:

```bash
pi install ./pi-yt-dlp
# or test once:
pi -e ./pi-yt-dlp
```

Then `/reload` if Pi is already running.

## Tools provided

- `youtube_info` — metadata and optional transcript/subtitle text.
- `youtube_download` — download video or extract audio (playlist-safe).
- `youtube_play` — play a local file, or download a URL to a temp directory then play it.

## Example prompts

- "Summarize this YouTube video: https://youtu.be/..."
- "Download this Eminem playlist as MP3 to `~/Music/Eminem`: ..."
- "Get the Japanese transcript for this video and save it as `~/japanese/video.txt`: ..."
- "Download this video with Japanese and English subtitles."
