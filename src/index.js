#!/usr/bin/env node

/**
 * OpenClaw Doctor Pro — Deep Diagnostic Tool
 * Catches the config mistakes that cost you 12 hours.
 */

import { readFile, writeFile, access } from 'fs/promises';
import { execSync } from 'child_process';
import { homedir } from 'os';
import { join } from 'path';

const c = {
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  cyan: (s) => `\x1b[36m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
};

const PASS = c.green('✓ PASS');
const FAIL = c.red('✗ FAIL');
const WARN = c.yellow('⚠ WARN');
const INFO = c.cyan('ℹ INFO');

function run(cmd) {
  try {
    return execSync(cmd, { encoding: 'utf8', timeout: 15000 }).trim();
  } catch { return null; }
}

async function readJson(path) {
  try { return JSON.parse(await readFile(path, 'utf8')); }
  catch { return null; }
}

const checks = [];
function report(status, category, message, fix = null) {
  checks.push({ status, category, message, fix });
  const icon = status === 'pass' ? PASS : status === 'fail' ? FAIL : status === 'warn' ? WARN : INFO;
  console.log(`  ${icon}  ${message}`);
  if (fix && status !== 'pass') console.log(`         ${c.dim('Fix:')} ${c.yellow(fix)}`);
}

// ─── 1. Config ───────────────────────────────────────────
async function checkConfig() {
  console.log(`\n${c.bold('━━━ Configuration ━━━')}`);
  const configPath = join(homedir(), '.openclaw', 'openclaw.json');
  const config = await readJson(configPath);
  if (!config) { report('fail', 'config', 'Cannot read openclaw.json', `Check ${configPath}`); return null; }
  report('pass', 'config', `Config loaded from ${configPath}`);

  const providers = config?.models?.providers || {};
  for (const [name, provider] of Object.entries(providers)) {
    const url = provider.baseUrl || '';
    if (provider.api === 'ollama' && url.endsWith('/v1'))
      report('fail', 'config', `Provider "${name}": baseUrl ends with /v1 but api is "ollama"`, `openclaw config set models.providers.${name}.baseUrl "${url.replace('/v1', '')}"`);
    else if (provider.api === 'ollama')
      report('pass', 'config', `Provider "${name}": baseUrl correct for native Ollama API`);
    if (url.includes('0.0.0.0'))
      report('warn', 'config', `Provider "${name}": uses 0.0.0.0 — may cause issues`, `Change to 127.0.0.1`);
    if (provider.api === 'ollama' && (!provider.models || provider.models.length === 0))
      report('warn', 'config', `Provider "${name}": no models defined`, 'Run: ollama launch openclaw');
    else if (provider.models)
      report('pass', 'config', `Provider "${name}": ${provider.models.length} models configured`);
  }

  const primary = config?.agents?.defaults?.model?.primary;
  if (primary) report('info', 'config', `Primary model: ${primary}`);
  else report('fail', 'config', 'No primary model set', 'openclaw config set agents.defaults.model.primary "ollama/qwen2.5:7b"');

  const sandbox = config?.agents?.defaults?.sandbox?.mode;
  if (sandbox === 'all') report('info', 'config', 'Sandbox mode: ALL (requires Docker)');
  else if (sandbox === 'off') report('warn', 'config', 'Sandbox mode: OFF', 'Enable: openclaw config set agents.defaults.sandbox.mode "all"');

  const deny = config?.tools?.deny || [];
  if (deny.length === 0) report('warn', 'config', 'No tools denied — small models vulnerable to prompt injection');
  else report('pass', 'config', `Tools deny list: ${deny.join(', ')}`);

  const telegram = config?.channels?.telegram;
  if (telegram?.botToken) {
    const masked = telegram.botToken.slice(0, 10) + '...' + telegram.botToken.slice(-4);
    report('pass', 'config', `Telegram token: ${masked}`);
    if (!telegram.dmPolicy || telegram.dmPolicy === 'open')
      report('warn', 'config', 'Telegram DM policy is open', 'openclaw config set channels.telegram.dmPolicy "pairing"');
  }

  const gw = config?.gateway;
  if (gw?.auth?.token === 'ollama' || gw?.auth?.token === 'test')
    report('warn', 'config', `Gateway auth token "${gw.auth.token}" is weak`, 'Use a strong random token for production');

  return config;
}

// ─── 2. Ollama ───────────────────────────────────────────
async function checkOllama() {
  console.log(`\n${c.bold('━━━ Ollama ━━━')}`);
  const version = run('ollama --version');
  if (!version) { report('fail', 'ollama', 'Ollama not found', 'Install from https://ollama.ai'); return; }
  report('pass', 'ollama', `Ollama installed: ${version}`);

  const apiCheck = run('curl -s http://127.0.0.1:11434/api/tags');
  if (!apiCheck) { report('fail', 'ollama', 'API not reachable at 127.0.0.1:11434', 'Start: ollama serve'); return; }
  report('pass', 'ollama', 'Ollama API responding');

  const modelList = run('ollama list');
  if (modelList) {
    const lines = modelList.split('\n').slice(1).filter(l => l.trim());
    report('info', 'ollama', `${lines.length} models installed`);
    lines.forEach(line => { const p = line.split(/\s+/); console.log(`         ${c.dim(p[0])} ${c.dim(p[2] || '')}`); });
  }

  const ps = run('ollama ps');
  if (ps) {
    const lines = ps.split('\n').slice(1).filter(l => l.trim());
    lines.forEach(line => {
      if (line.includes('100% CPU')) {
        report('fail', 'ollama', `Model "${line.split(/\s+/)[0]}" on CPU — extremely slow!`, 'Remove OLLAMA_GPU_OVERHEAD, restart Ollama');
      } else if (line.includes('GPU')) {
        report('pass', 'ollama', `Model "${line.split(/\s+/)[0]}" on GPU`);
      }
    });
    if (lines.length === 0) report('warn', 'ollama', 'No models loaded', 'ollama run qwen2.5:7b --keepalive 24h');
  }

  if (process.env.OLLAMA_GPU_OVERHEAD)
    report('fail', 'ollama', `OLLAMA_GPU_OVERHEAD="${process.env.OLLAMA_GPU_OVERHEAD}" forces CPU!`, 'Remove this env var and restart Ollama');
}

// ─── 3. GPU ──────────────────────────────────────────────
async function checkGPU() {
  console.log(`\n${c.bold('━━━ GPU ━━━')}`);
  const smi = run('nvidia-smi --query-gpu=name,memory.total,memory.used,memory.free,utilization.gpu --format=csv,noheader,nounits');
  if (!smi) { report('warn', 'gpu', 'nvidia-smi not available'); return; }
  const [gpuName, totalMem, usedMem, freeMem, util] = smi.split(',').map(s => s.trim());
  report('pass', 'gpu', `GPU: ${gpuName}`);
  report('info', 'gpu', `VRAM: ${usedMem}MB / ${totalMem}MB (${freeMem}MB free)`);
  report('info', 'gpu', `Utilization: ${util}%`);
  if ((parseInt(usedMem) / parseInt(totalMem)) * 100 > 90)
    report('warn', 'gpu', 'VRAM above 90%', 'Close LM Studio, stop unused models');
}

// ─── 4. Gateway ──────────────────────────────────────────
async function checkGateway() {
  console.log(`\n${c.bold('━━━ Gateway ━━━')}`);
  const portCheck = run('netstat -ano | findstr 18789') || run('ss -tlnp | grep 18789');
  if (portCheck) {
    const listeners = portCheck.split('\n').filter(l => l.includes('LISTENING'));
    if (listeners.length > 1) report('fail', 'gateway', `${listeners.length} listeners on port 18789 — 409 conflicts!`, 'Kill extras with taskkill /PID <pid> /F');
    else if (listeners.length === 1) report('pass', 'gateway', 'Gateway port 18789 active');
  } else {
    report('warn', 'gateway', 'Gateway not running', 'Start: openclaw gateway');
  }
}

// ─── 5. Telegram ─────────────────────────────────────────
async function checkTelegram(config) {
  console.log(`\n${c.bold('━━━ Telegram ━━━')}`);
  const token = config?.channels?.telegram?.botToken;
  if (!token) { report('info', 'telegram', 'Not configured — skipping'); return; }
  try {
    const res = run(`curl -s "https://api.telegram.org/bot${token}/getMe"`);
    if (res) {
      const data = JSON.parse(res);
      if (data.ok) report('pass', 'telegram', `Bot: @${data.result.username}`);
      else report('fail', 'telegram', `Token invalid: ${data.description}`, 'Get new token from @BotFather');
    }
  } catch { report('warn', 'telegram', 'Cannot reach Telegram API'); }
  try {
    const wh = JSON.parse(run(`curl -s "https://api.telegram.org/bot${token}/getWebhookInfo"`) || '{}');
    if (wh.result?.url && wh.result.url !== '')
      report('fail', 'telegram', `Webhook active — conflicts with polling!`, 'Delete: curl ".../deleteWebhook?drop_pending_updates=true"');
    else report('pass', 'telegram', 'No webhook (good)');
  } catch {}
}

// ─── 6. Docker ───────────────────────────────────────────
async function checkDocker(config) {
  console.log(`\n${c.bold('━━━ Docker ━━━')}`);
  if (config?.agents?.defaults?.sandbox?.mode !== 'all') { report('info', 'docker', 'Sandbox off — Docker not required'); return; }
  const ver = run('docker --version');
  if (!ver) { report('fail', 'docker', 'Docker not installed but sandbox is "all"', 'Install Docker Desktop'); return; }
  report('pass', 'docker', ver);
  const info = run('docker info --format "{{.ServerVersion}}"');
  if (!info) report('fail', 'docker', 'Docker Engine not running', 'Start Docker Desktop');
  else report('pass', 'docker', `Engine: ${info}`);
}

// ─── 7. Env ──────────────────────────────────────────────
async function checkEnv() {
  console.log(`\n${c.bold('━━━ Environment ━━━')}`);
  if (process.env.TAVILY_API_KEY) report('pass', 'env', `TAVILY_API_KEY set`);
  else report('info', 'env', 'TAVILY_API_KEY not set', 'Free key: https://tavily.com');
  if (process.env.BRAVE_API_KEY) report('pass', 'env', `BRAVE_API_KEY set`);
  else report('info', 'env', 'BRAVE_API_KEY not set');
  if (process.env.OLLAMA_GPU_OVERHEAD) report('fail', 'env', 'OLLAMA_GPU_OVERHEAD set — forces CPU!', 'Remove it');
}

// ─── HTML Report ─────────────────────────────────────────
function generateHTML() {
  const now = new Date().toISOString();
  const pass = checks.filter(c => c.status === 'pass').length;
  const fail = checks.filter(c => c.status === 'fail').length;
  const warn = checks.filter(c => c.status === 'warn').length;
  const score = Math.round((pass / Math.max(checks.length, 1)) * 100);
  const icon = (s) => s === 'pass' ? '✓' : s === 'fail' ? '✗' : s === 'warn' ? '⚠' : 'ℹ';
  const color = (s) => s === 'pass' ? '#00ff88' : s === 'fail' ? '#ff4444' : s === 'warn' ? '#ffaa00' : '#00ccff';
  const rows = checks.map(ch => `<div class="ck ${ch.status}"><span class="ic" style="color:${color(ch.status)}">${icon(ch.status)}</span><span class="cat">${ch.category}</span><span class="msg">${ch.message}</span>${ch.fix && ch.status !== 'pass' ? `<div class="fix">Fix: <code>${ch.fix}</code></div>` : ''}</div>`).join('\n');
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>OpenClaw Doctor Pro</title>
<style>@import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@300;400;700&family=Orbitron:wght@700;900&display=swap');*{margin:0;padding:0;box-sizing:border-box}body{font-family:'JetBrains Mono',monospace;background:#0a0a0f;color:#c8c8d0;min-height:100vh;padding:2rem}.ctr{max-width:900px;margin:0 auto}h1{font-family:'Orbitron',sans-serif;font-size:2rem;color:#00ccff;text-shadow:0 0 30px rgba(0,204,255,0.3);margin-bottom:.5rem}.sub{color:#666;margin-bottom:2rem}.sb{background:#1a1a2e;border:1px solid #2a2a3e;border-radius:12px;padding:1.5rem 2rem;margin-bottom:2rem;display:flex;justify-content:space-between;align-items:center}.sn{font-family:'Orbitron',sans-serif;font-size:3rem;font-weight:900;color:${score>=80?'#00ff88':score>=50?'#ffaa00':'#ff4444'};text-shadow:0 0 20px ${score>=80?'rgba(0,255,136,0.3)':score>=50?'rgba(255,170,0,0.3)':'rgba(255,68,68,0.3)'}}.sl{color:#666;font-size:.85rem}.sts{display:flex;gap:2rem}.st{text-align:center}.st-n{font-size:1.5rem;font-weight:700}.st-l{font-size:.75rem;color:#666}.ck{padding:.8rem 1rem;border-left:3px solid transparent;margin-bottom:2px;background:#12121e;display:grid;grid-template-columns:2rem 5rem 1fr;align-items:start;gap:.5rem}.ck.fail{border-left-color:#ff4444;background:#1a1015}.ck.warn{border-left-color:#ffaa00;background:#1a1810}.ck.pass{border-left-color:#00ff88}.ic{font-size:1.1rem;text-align:center}.cat{color:#666;font-size:.8rem;text-transform:uppercase}.msg{color:#ddd}.fix{grid-column:3;color:#888;font-size:.8rem;margin-top:.3rem}.fix code{background:#1a1a2e;color:#ffaa00;padding:.15rem .4rem;border-radius:3px;font-size:.75rem;word-break:break-all}.ft{margin-top:2rem;text-align:center;color:#333;font-size:.75rem}</style></head>
<body><div class="ctr"><h1>🦞 OpenClaw Doctor Pro</h1><div class="sub">Health Report — ${now}</div>
<div class="sb"><div><div class="sn">${score}%</div><div class="sl">HEALTH SCORE</div></div><div class="sts"><div class="st"><div class="st-n" style="color:#00ff88">${pass}</div><div class="st-l">PASSED</div></div><div class="st"><div class="st-n" style="color:#ff4444">${fail}</div><div class="st-l">FAILED</div></div><div class="st"><div class="st-n" style="color:#ffaa00">${warn}</div><div class="st-l">WARNINGS</div></div></div></div>
${rows}<div class="ft">Generated by OpenClaw Doctor Pro v1.0.0</div></div></body></html>`;
}

// ─── Main ────────────────────────────────────────────────
async function main() {
  console.log(c.bold('\n🦞 OpenClaw Doctor Pro v1.0.0'));
  console.log(c.dim('Deep diagnostics for OpenClaw installations\n'));
  const args = process.argv.slice(2);
  const config = await checkConfig();
  await checkOllama();
  await checkGPU();
  await checkGateway();
  await checkTelegram(config);
  await checkDocker(config);
  await checkEnv();

  const pass = checks.filter(c => c.status === 'pass').length;
  const fail = checks.filter(c => c.status === 'fail').length;
  const warn = checks.filter(c => c.status === 'warn').length;
  const score = Math.round((pass / Math.max(checks.length, 1)) * 100);
  console.log(`\n${c.bold('━━━ Summary ━━━')}`);
  console.log(`  Score: ${score >= 80 ? c.green(score + '%') : score >= 50 ? c.yellow(score + '%') : c.red(score + '%')}`);
  console.log(`  ${c.green(pass + ' passed')}  ${c.red(fail + ' failed')}  ${c.yellow(warn + ' warnings')}`);

  if (args.includes('--json')) console.log('\n' + JSON.stringify({ timestamp: new Date().toISOString(), score, checks }, null, 2));

  if (args.includes('--html') || args.includes('--publish')) {
    const html = generateHTML();
    const out = join(process.cwd(), 'doctor-report.html');
    await writeFile(out, html);
    console.log(`\n  ${INFO}  Report: ${out}`);
    if (args.includes('--publish')) {
      console.log(`  ${INFO}  Publishing to here.now...`);
      try {
        const sz = Buffer.byteLength(html, 'utf8');
        const cr = run(`curl -sS https://here.now/api/v1/publish -H "content-type: application/json" -d "{\\"files\\":[{\\"path\\":\\"index.html\\",\\"size\\":${sz},\\"contentType\\":\\"text/html; charset=utf-8\\"}]}"`);
        if (cr) {
          const pub = JSON.parse(cr);
          run(`curl -sS -X PUT "${pub.upload.uploads[0].url}" -H "Content-Type: text/html; charset=utf-8" --data-binary @"${out}"`);
          run(`curl -sS -X POST "${pub.upload.finalizeUrl}" -H "content-type: application/json" -d "{\\"versionId\\":\\"${pub.upload.versionId}\\"}"`);
          console.log(`\n  ${c.green('✓')} ${c.bold('Published!')} ${c.cyan(pub.siteUrl)}`);
          if (pub.claimUrl) console.log(`  ${c.yellow('Save to keep permanent:')} ${pub.claimUrl}`);
        }
      } catch (e) { console.log(`  ${FAIL}  Publish failed: ${e.message}`); }
    }
  }
  console.log('');
}

main().catch(console.error);
