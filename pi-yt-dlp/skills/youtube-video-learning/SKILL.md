---
name: youtube-video-learning
description: Understand, summarize, download, play, transcribe, and study YouTube videos or playlists using yt-dlp and ffmpeg. Use for YouTube summaries, Japanese transcript extraction, playlist-to-MP3 downloads, and local playback.
---

# YouTube Video Learning with yt-dlp

Use this skill when the user asks to understand, summarize, download, play, transcribe, or study a YouTube video or playlist.

Guidelines:
- Use `youtube_info` first for summaries/questions because it can fetch metadata and subtitles/transcripts without downloading the media.
- For Japanese learning, request subtitle languages like `ja,en` and ask `youtube_info` to include transcripts. Use the returned transcript to explain vocabulary, grammar, and produce study notes.
- For playlists that should become local music files, use `youtube_download` with `mode: "audio"`, `audioFormat: "mp3"`, and a user-provided `outputDir`.
- For offline watching, use `youtube_download` with `mode: "video"`.
- If subtitles are wanted as files, set `writeSubtitles: true` and pass languages such as `ja,en`.
- If the user asks to play media, use `youtube_play` after confirming that opening an external app is okay when appropriate.
