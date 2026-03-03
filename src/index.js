#!/usr/bin/env node

/**
 * OpenClaw Doctor Pro v2.0.0 — Diagnose AND Fix
 * Catches the config mistakes that cost you 12 hours. Then fixes them.
 */

import { readFile, writeFile, copyFile } from 'fs/promises';
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
  magenta: (s) => `\x1b[35m${s}\x1b[0m`,
};

const PASS = c.green('✓ PASS');
const FAIL = c.red('✗ FAIL');
const WARN = c.yellow('⚠ WARN');
const INFO = c.cyan('ℹ INFO');
const FIXED = c.magenta('🔧 FIX');

const FIX_MODE = process.argv.includes('--fix');
const args = process.argv.slice(2);

function run(cmd) {
  try {
    return execSync(cmd, { encoding: 'utf8', timeout: 15000 }).trim();
  } catch { return null; }
}

async function readJson(path) {
  try { return JSON.parse(await readFile(path, 'utf8')); }
  catch { return null; }
}

async function writeJson(path, data) {
  await writeFile(path, JSON.stringify(data, null, 2));
}

const CONFIG_PATH = join(homedir(), '.openclaw', 'openclaw.json');
const checks = [];
let fixCount = 0;

function report(status, category, message, fix = null) {
  checks.push({ status, category, message, fix });
  const icon = status === 'pass' ? PASS : status === 'fail' ? FAIL : status === 'warn' ? WARN : status === 'fixed' ? FIXED : INFO;
  console.log(`  ${icon}  ${message}`);
  if (fix && status !== 'pass' && status !== 'fixed' && !FIX_MODE)
    console.log(`         ${c.dim('Fix:')} ${c.yellow(fix)}`);
}

function reportFixed(message) {
  fixCount++;
  report('fixed', 'autofix', message);
}

function deepSet(obj, path, value) {
  const keys = path.split('.');
  let current = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    if (!current[keys[i]]) current[keys[i]] = {};
    current = current[keys[i]];
  }
  current[keys[keys.length - 1]] = value;
}

async function backupConfig() {
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = CONFIG_PATH.replace('.json', `.backup-${ts}.json`);
  try {
    await copyFile(CONFIG_PATH, backupPath);
    console.log(`  ${c.cyan('📦')}  Config backed up to ${c.dim(backupPath)}`);
    return backupPath;
  } catch {
    console.log(`  ${c.red('⚠')}  Could not backup config`);
    return null;
  }
}

async function checkConfig() {
  console.log(`\n${c.bold('━━━ Configuration ━━━')}`);
  let config = await readJson(CONFIG_PATH);
  if (!config) { report('fail', 'config', 'Cannot read openclaw.json', `Check ${CONFIG_PATH}`); return null; }
  report('pass', 'config', `Config loaded from ${CONFIG_PATH}`);
  let configChanged = false;
  const providers = config?.models?.providers || {};
  for (const [name, provider] of Object.entries(providers)) {
    const url = provider.baseUrl || '';
    if (provider.api === 'ollama' && url.endsWith('/v1')) {
      report('fail', 'config', `Provider "${name}": baseUrl ends with /v1 but api is "ollama"`);
      if (FIX_MODE) { config.models.providers[name].baseUrl = url.replace('/v1', ''); configChanged = true; reportFixed(`Removed /v1 from ${name} baseUrl`); }
    } else if (provider.api === 'ollama') { report('pass', 'config', `Provider "${name}": baseUrl correct for native Ollama API`); }
    if (url.includes('0.0.0.0')) {
      report('warn', 'config', `Provider "${name}": uses 0.0.0.0`, 'Change to 127.0.0.1');
      if (FIX_MODE) { config.models.providers[name].baseUrl = url.replace('0.0.0.0', '127.0.0.1'); configChanged = true; reportFixed(`Changed 0.0.0.0 → 127.0.0.1 for ${name}`); }
    }
    if (provider.api === 'ollama' && (!provider.models || provider.models.length === 0)) report('warn', 'config', `Provider "${name}": no models defined`);
    else if (provider.models) report('pass', 'config', `Provider "${name}": ${provider.models.length} models configured`);
  }
  const primary = config?.agents?.defaults?.model?.primary;
  if (primary) report('info', 'config', `Primary model: ${primary}`);
  else { report('fail', 'config', 'No primary model set'); if (FIX_MODE) { deepSet(config, 'agents.defaults.model.primary', 'ollama/qwen2.5:7b'); configChanged = true; reportFixed('Set primary model → ollama/qwen2.5:7b'); } }
  const sandbox = config?.agents?.defaults?.sandbox?.mode;
  if (sandbox === 'all') report('info', 'config', 'Sandbox mode: ALL (requires Docker)');
  else if (sandbox === 'off') report('warn', 'config', 'Sandbox mode: OFF');
  const deny = config?.tools?.deny || [];
  if (deny.length === 0) { report('warn', 'config', 'No tools denied'); if (FIX_MODE) { if (!config.tools) config.tools = {}; config.tools.deny = ['browser']; configChanged = true; reportFixed('Set tools.deny → ["browser"]'); } }
  else report('pass', 'config', `Tools deny list: ${deny.join(', ')}`);
  const telegram = config?.channels?.telegram;
  if (telegram?.botToken) {
    const masked = telegram.botToken.slice(0, 10) + '...' + telegram.botToken.slice(-4);
    report('pass', 'config', `Telegram token: ${masked}`);
    if (!telegram.dmPolicy || telegram.dmPolicy === 'open') { report('warn', 'config', 'Telegram DM policy is open'); if (FIX_MODE) { config.channels.telegram.dmPolicy = 'pairing'; configChanged = true; reportFixed('Set Telegram DM policy → "pairing"'); } }
  }
  const gw = config?.gateway;
  if (gw?.auth?.token === 'ollama' || gw?.auth?.token === 'test') {
    report('warn', 'config', `Gateway auth token "${gw.auth.token}" is weak`);
    if (FIX_MODE) { const strong = Array.from({ length: 32 }, () => Math.random().toString(36)[2]).join(''); config.gateway.auth.token = strong; configChanged = true; reportFixed(`Generated strong gateway token: ${strong.slice(0, 8)}...`); }
  }
  if (configChanged) { await writeJson(CONFIG_PATH, config); console.log(`  ${c.green('💾')}  Config saved`); }
  return config;
}

async function checkOllama() {
  console.log(`\n${c.bold('━━━ Ollama ━━━')}`);
  const version = run('ollama --version');
  if (!version) { report('fail', 'ollama', 'Ollama not found', 'Install from https://ollama.ai'); return; }
  report('pass', 'ollama', `Ollama installed: ${version}`);
  const apiCheck = run('curl -s http://127.0.0.1:11434/api/tags');
  if (!apiCheck) { report('fail', 'ollama', 'API not reachable at 127.0.0.1:11434', 'Start: ollama serve'); return; }
  report('pass', 'ollama', 'Ollama API responding');
  const modelList = run('ollama list');
  if (modelList) { const lines = modelList.split('\n').slice(1).filter(l => l.trim()); report('info', 'ollama', `${lines.length} models installed`); lines.forEach(line => { const p = line.split(/\s+/); console.log(`         ${c.dim(p[0])} ${c.dim(p[2] || '')}`); }); }
  const ps = run('ollama ps');
  if (ps) {
    const lines = ps.split('\n').slice(1).filter(l => l.trim());
    lines.forEach(line => {
      if (line.includes('100% CPU')) { const model = line.split(/\s+/)[0]; report('fail', 'ollama', `Model "${model}" on CPU!`); if (FIX_MODE) { run('powershell -NoProfile -Command "Get-Service *ollama* | Restart-Service -Force"'); reportFixed('Restarted Ollama service'); } }
      else if (line.includes('GPU')) { report('pass', 'ollama', `Model "${line.split(/\s+/)[0]}" on GPU`); }
    });
    if (lines.length === 0) { report('warn', 'ollama', 'No models loaded'); if (FIX_MODE) { console.log(`  ${c.cyan('⏳')}  Loading primary model...`); run('ollama run qwen2.5:7b --keepalive 24h "hello"'); reportFixed('Loaded qwen2.5:7b with 24h keepalive'); } }
  }
}

async function checkGPU() {
  console.log(`\n${c.bold('━━━ GPU ━━━')}`);
  const smi = run('nvidia-smi --query-gpu=name,memory.total,memory.used,memory.free,utilization.gpu --format=csv,noheader,nounits');
  if (!smi) { report('warn', 'gpu', 'nvidia-smi not available'); return; }
  const [gpuName, totalMem, usedMem, freeMem, util] = smi.split(',').map(s => s.trim());
  report('pass', 'gpu', `GPU: ${gpuName}`);
  report('info', 'gpu', `VRAM: ${usedMem}MB / ${totalMem}MB (${freeMem}MB free)`);
  report('info', 'gpu', `Utilization: ${util}%`);
  if ((parseInt(usedMem) / parseInt(totalMem)) * 100 > 90) report('warn', 'gpu', 'VRAM above 90%');
}

async function checkGateway() {
  console.log(`\n${c.bold('━━━ Gateway ━━━')}`);
  const portCheck = run('netstat -ano | findstr 18789') || run('ss -tlnp | grep 18789');
  if (portCheck) {
    const listeners = portCheck.split('\n').filter(l => l.includes('LISTENING'));
    const pids = [...new Set(listeners.map(l => l.trim().split(/\s+/).pop()))];
    if (pids.length > 1) { report('fail', 'gateway', `${pids.length} processes on port 18789 — 409 conflicts! PIDs: ${pids.join(', ')}`); if (FIX_MODE) { pids.slice(1).forEach(pid => { run(`taskkill /PID ${pid} /F`); reportFixed(`Killed duplicate gateway PID ${pid}`); }); } }
    else if (pids.length === 1) { report('pass', 'gateway', `Gateway active on port 18789 (PID ${pids[0]})`); }
  } else { report('warn', 'gateway', 'Gateway not running', 'Start: openclaw gateway'); }
}

async function checkTelegram(config) {
  console.log(`\n${c.bold('━━━ Telegram ━━━')}`);
  const token = config?.channels?.telegram?.botToken;
  if (!token) { report('info', 'telegram', 'Not configured — skipping'); return; }
  try { const res = run(`curl -s "https://api.telegram.org/bot${token}/getMe"`); if (res) { const data = JSON.parse(res); if (data.ok) report('pass', 'telegram', `Bot: @${data.result.username}`); else report('fail', 'telegram', `Token invalid: ${data.description}`); } } catch { report('warn', 'telegram', 'Cannot reach Telegram API'); }
  try {
    const wh = JSON.parse(run(`curl -s "https://api.telegram.org/bot${token}/getWebhookInfo"`) || '{}');
    if (wh.result?.url && wh.result.url !== '') { report('fail', 'telegram', 'Webhook active — conflicts with polling!'); if (FIX_MODE) { run(`curl -s "https://api.telegram.org/bot${token}/deleteWebhook?drop_pending_updates=true"`); reportFixed('Deleted Telegram webhook'); } }
    else report('pass', 'telegram', 'No webhook (good)');
  } catch {}
}

async function checkDocker(config) {
  console.log(`\n${c.bold('━━━ Docker ━━━')}`);
  if (config?.agents?.defaults?.sandbox?.mode !== 'all') { report('info', 'docker', 'Sandbox off — Docker not required'); return; }
  const ver = run('docker --version');
  if (!ver) { report('fail', 'docker', 'Docker not installed but sandbox is "all"'); return; }
  report('pass', 'docker', ver);
  const info = run('docker info --format "{{.ServerVersion}}"');
  if (!info) report('fail', 'docker', 'Docker Engine not running');
  else report('pass', 'docker', `Engine: ${info}`);
}

async function checkEnv() {
  console.log(`\n${c.bold('━━━ Environment ━━━')}`);
  if (process.env.TAVILY_API_KEY) report('pass', 'env', 'TAVILY_API_KEY set');
  else report('info', 'env', 'TAVILY_API_KEY not set', 'Free key: https://tavily.com');
  if (process.env.BRAVE_API_KEY) report('pass', 'env', 'BRAVE_API_KEY set');
  else report('info', 'env', 'BRAVE_API_KEY not set');
  const fromEnv = process.env.OLLAMA_GPU_OVERHEAD;
  const fromRegUser = run('powershell -NoProfile -Command "[System.Environment]::GetEnvironmentVariable(\'OLLAMA_GPU_OVERHEAD\', \'User\')"');
  const fromRegMachine = run('powershell -NoProfile -Command "[System.Environment]::GetEnvironmentVariable(\'OLLAMA_GPU_OVERHEAD\', \'Machine\')"');
  const hasUser = fromRegUser && fromRegUser.trim() !== '';
  const hasMachine = fromRegMachine && fromRegMachine.trim() !== '';
  const gpuOverhead = fromEnv || (hasUser ? fromRegUser : null) || (hasMachine ? fromRegMachine : null);
  if (gpuOverhead) {
    report('fail', 'env', `OLLAMA_GPU_OVERHEAD="${gpuOverhead}" — forces CPU mode!`);
    if (FIX_MODE) {
      if (hasUser) { run('powershell -NoProfile -Command "[System.Environment]::SetEnvironmentVariable(\'OLLAMA_GPU_OVERHEAD\', $null, \'User\')"'); reportFixed('Removed OLLAMA_GPU_OVERHEAD from User env'); }
      if (hasMachine) { run('powershell -NoProfile -Command "Start-Process powershell -Verb RunAs -ArgumentList \'-NoProfile -Command [System.Environment]::SetEnvironmentVariable(\\\"OLLAMA_GPU_OVERHEAD\\\", $null, \\\"Machine\\\")\'"'); reportFixed('Removed OLLAMA_GPU_OVERHEAD from Machine env'); }
      run('powershell -NoProfile -Command "Get-Service *ollama* | Restart-Service -Force"'); reportFixed('Restarted Ollama service');
    }
  } else { report('pass', 'env', 'No OLLAMA_GPU_OVERHEAD (good)'); }
}

function generateHTML() {
  const now = new Date().toISOString();
  const pass = checks.filter(c => c.status === 'pass').length;
  const fail = checks.filter(c => c.status === 'fail').length;
  const warn = checks.filter(c => c.status === 'warn').length;
  const fixed = checks.filter(c => c.status === 'fixed').length;
  const total = checks.filter(c => ['pass','fail','warn','fixed'].includes(c.status)).length;
  const score = Math.round(((pass + fixed) / Math.max(total, 1)) * 100);
  const icon = (s) => s === 'pass' ? '✓' : s === 'fail' ? '✗' : s === 'warn' ? '⚠' : s === 'fixed' ? '🔧' : 'ℹ';
  const color = (s) => s === 'pass' ? '#00ff88' : s === 'fail' ? '#ff4444' : s === 'warn' ? '#ffaa00' : s === 'fixed' ? '#cc44ff' : '#00ccff';
  const rows = checks.map(ch => `<div class="ck ${ch.status}"><span class="ic" style="color:${color(ch.status)}">${icon(ch.status)}</span><span class="cat">${ch.category}</span><span class="msg">${ch.message}</span>${ch.fix && ch.status !== 'pass' && ch.status !== 'fixed' ? `<div class="fix">Fix: <code>${ch.fix}</code></div>` : ''}</div>`).join('\n');
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>OpenClaw Doctor Pro</title><style>@import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@300;400;700&family=Orbitron:wght@700;900&display=swap');*{margin:0;padding:0;box-sizing:border-box}body{font-family:'JetBrains Mono',monospace;background:#0a0a0f;color:#c8c8d0;min-height:100vh;padding:2rem}.ctr{max-width:900px;margin:0 auto}h1{font-family:'Orbitron',sans-serif;font-size:2rem;color:#00ccff;text-shadow:0 0 30px rgba(0,204,255,0.3);margin-bottom:.5rem}.sub{color:#666;margin-bottom:2rem}.sb{background:#1a1a2e;border:1px solid #2a2a3e;border-radius:12px;padding:1.5rem 2rem;margin-bottom:2rem;display:flex;justify-content:space-between;align-items:center}.sn{font-family:'Orbitron',sans-serif;font-size:3rem;font-weight:900;color:${score>=80?'#00ff88':score>=50?'#ffaa00':'#ff4444'}}.sl{color:#666;font-size:.85rem}.sts{display:flex;gap:2rem}.st{text-align:center}.st-n{font-size:1.5rem;font-weight:700}.st-l{font-size:.75rem;color:#666}.ck{padding:.8rem 1rem;border-left:3px solid transparent;margin-bottom:2px;background:#12121e;display:grid;grid-template-columns:2rem 5rem 1fr;align-items:start;gap:.5rem}.ck.fail{border-left-color:#ff4444;background:#1a1015}.ck.warn{border-left-color:#ffaa00;background:#1a1810}.ck.pass{border-left-color:#00ff88}.ck.fixed{border-left-color:#cc44ff;background:#1a1020}.ic{font-size:1.1rem;text-align:center}.cat{color:#666;font-size:.8rem;text-transform:uppercase}.msg{color:#ddd}.fix{grid-column:3;color:#888;font-size:.8rem;margin-top:.3rem}.fix code{background:#1a1a2e;color:#ffaa00;padding:.15rem .4rem;border-radius:3px;font-size:.75rem}</style></head><body><div class="ctr"><h1>🦞 OpenClaw Doctor Pro</h1><div class="sub">Health Report — ${now}${fixed > 0 ? ` — ${fixed} issues auto-fixed!` : ''}</div><div class="sb"><div><div class="sn">${score}%</div><div class="sl">HEALTH SCORE</div></div><div class="sts"><div class="st"><div class="st-n" style="color:#00ff88">${pass}</div><div class="st-l">PASSED</div></div><div class="st"><div class="st-n" style="color:#ff4444">${fail}</div><div class="st-l">FAILED</div></div><div class="st"><div class="st-n" style="color:#ffaa00">${warn}</div><div class="st-l">WARNINGS</div></div>${fixed > 0 ? `<div class="st"><div class="st-n" style="color:#cc44ff">${fixed}</div><div class="st-l">FIXED</div></div>` : ''}</div></div>${rows}<div style="margin-top:2rem;text-align:center;color:#333;font-size:.75rem">Generated by OpenClaw Doctor Pro v2.0.0</div></div></body></html>`;
}

async function main() {
  console.log(c.bold('\n🦞 OpenClaw Doctor Pro v2.0.0'));
  if (FIX_MODE) { console.log(c.magenta('⚡ AUTO-FIX MODE — will repair issues automatically\n')); await backupConfig(); }
  else { console.log(c.dim('Deep diagnostics for OpenClaw installations')); console.log(c.dim('Run with --fix to auto-repair issues\n')); }
  const config = await checkConfig();
  await checkOllama(); await checkGPU(); await checkGateway(); await checkTelegram(config); await checkDocker(config); await checkEnv();
  const pass = checks.filter(c => c.status === 'pass').length;
  const fail = checks.filter(c => c.status === 'fail').length;
  const warn = checks.filter(c => c.status === 'warn').length;
  const fixed = checks.filter(c => c.status === 'fixed').length;
  const total = checks.filter(c => ['pass','fail','warn','fixed'].includes(c.status)).length;
  const score = Math.round(((pass + fixed) / Math.max(total, 1)) * 100);
  console.log(`\n${c.bold('━━━ Summary ━━━')}`);
  console.log(`  Score: ${score >= 80 ? c.green(score + '%') : score >= 50 ? c.yellow(score + '%') : c.red(score + '%')}`);
  console.log(`  ${c.green(pass + ' passed')}  ${c.red(fail + ' failed')}  ${c.yellow(warn + ' warnings')}${fixed > 0 ? '  ' + c.magenta(fixed + ' fixed') : ''}`);
  if (FIX_MODE && fixCount > 0) console.log(`\n  ${c.magenta('⚡')} ${c.bold(`Auto-fixed ${fixCount} issues!`)} Run again without --fix to verify.`);
  else if (!FIX_MODE && fail > 0) console.log(`\n  ${c.yellow('💡')} Run ${c.bold('openclaw-doctor --fix')} to auto-repair ${fail} issue${fail > 1 ? 's' : ''}`);
  if (args.includes('--json')) console.log('\n' + JSON.stringify({ timestamp: new Date().toISOString(), score, fixCount, checks }, null, 2));
  if (args.includes('--html') || args.includes('--publish')) {
    const html = generateHTML(); const out = join(process.cwd(), 'doctor-report.html'); await writeFile(out, html); console.log(`\n  ${INFO}  Report: ${out}`);
    if (args.includes('--publish')) { console.log(`  ${INFO}  Publishing to here.now...`); try { const sz = Buffer.byteLength(html, 'utf8'); const cr = run(`curl -sS https://here.now/api/v1/publish -H "content-type: application/json" -d "{\\"files\\":[{\\"path\\":\\"index.html\\",\\"size\\":${sz},\\"contentType\\":\\"text/html; charset=utf-8\\"}]}"`); if (cr) { const pub = JSON.parse(cr); run(`curl -sS -X PUT "${pub.upload.uploads[0].url}" -H "Content-Type: text/html; charset=utf-8" --data-binary @"${out}"`); run(`curl -sS -X POST "${pub.upload.finalizeUrl}" -H "content-type: application/json" -d "{\\"versionId\\":\\"${pub.upload.versionId}\\"}"`); console.log(`\n  ${c.green('✓')} ${c.bold('Published!')} ${c.cyan(pub.siteUrl)}`); if (pub.claimUrl) console.log(`  ${c.yellow('Save to keep permanent:')} ${pub.claimUrl}`); } } catch (e) { console.log(`  ${FAIL}  Publish failed: ${e.message}`); } }
  }
  console.log('');
}

main().catch(console.error);
