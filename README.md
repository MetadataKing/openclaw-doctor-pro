# 🦞 OpenClaw Doctor Pro

**Deep diagnostic tool for OpenClaw installations.**
Catches the config mistakes that cost you 12 hours.

## Install

```bash
npm install -g openclaw-doctor-pro
```

Or run without installing:

```bash
npx openclaw-doctor-pro
```

## Usage

```bash
openclaw-doctor              # Run all checks
openclaw-doctor --json       # JSON output
openclaw-doctor --html       # Generate HTML report
openclaw-doctor --publish    # Generate + publish to here.now
```

## What It Checks

- **Config**: baseUrl /v1 suffix, 0.0.0.0 vs 127.0.0.1, model arrays, sandbox, tools deny
- **Ollama**: API reachability, models, GPU vs CPU loading
- **GPU**: NVIDIA detection, VRAM usage, OOM risk
- **Gateway**: Port conflicts, multiple listeners (409), zombie processes
- **Telegram**: Token validity, webhook conflicts, DM policy
- **Docker**: Engine status, sandbox image
- **Environment**: API keys, dangerous env vars

## Born From Pain

Every check exists because someone spent hours debugging it.

| Check | What Went Wrong |
|-------|----------------|
| baseUrl /v1 | 3 hours of "fetch failed" |
| GPU vs CPU | 5 min responses instead of 5 sec |
| OLLAMA_GPU_OVERHEAD | One env var forced everything to CPU |
| Port 18789 | Gateway zombies everywhere |
| Telegram webhooks | 409 conflicts from multiple pollers |

## License

MIT
