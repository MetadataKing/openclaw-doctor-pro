# 🦞 OpenClaw Doctor Pro

Deep diagnostic tool for OpenClaw installations. Catches the config mistakes that cost you 12 hours — **then fixes them automatically**.

## Install

```
npm install -g openclaw-doctor-pro
```

Or run without installing:

```
npx openclaw-doctor-pro
```

## Usage

```
openclaw-doctor              # Diagnose all issues
openclaw-doctor --fix        # ⚡ Auto-repair everything
openclaw-doctor --json       # JSON output
openclaw-doctor --html       # Generate HTML report
openclaw-doctor --publish    # Generate + publish to here.now
```

## What `--fix` Does

| Issue | Auto-Fix Action |
|-------|----------------|
| baseUrl ends with `/v1` | Strips the suffix from config |
| `0.0.0.0` in provider URL | Replaces with `127.0.0.1` |
| No primary model set | Sets `ollama/qwen2.5:7b` |
| Empty tools deny list | Adds default deny list |
| Telegram DM policy open | Sets to `pairing` |
| Weak gateway token | Generates strong random token |
| Duplicate gateway PIDs | Kills extra processes |
| Telegram webhook active | Deletes webhook |
| `OLLAMA_GPU_OVERHEAD` set | Removes from User + Machine env |
| Models on CPU | Restarts Ollama service |
| No models loaded | Loads primary model with keepalive |

Every fix creates a **timestamped backup** of your config first.

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
