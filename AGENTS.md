# Nioret Translate development conventions

- Keep all project changes inside this repository.
- Never commit `.env`, OAuth tokens, API keys, or Twitch client secrets.
- Use `npm.cmd` in Windows PowerShell because the local execution policy may block `npm.ps1`.
- Run `npm.cmd run check` before describing a change as working.
- Distinguish mocked adapter tests from live Twitch/OpenAI verification in documentation and handoff notes.
- Update `DEVELOPMENT.md` when a milestone changes the architecture, feature status, or verification evidence.
