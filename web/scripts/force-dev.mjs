#!/usr/bin/env node
// Force-free & retry start Vite on a fixed port (Windows friendly)
import { execSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const PORT = 5174;              // Desired port
const MAX_RETRIES = 3;          // Attempts to start if EADDRINUSE
const RETRY_DELAY_MS = 500;     // Wait before retry (TIME_WAIT clearance)

const require = createRequire(import.meta.url);

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function findPidsOnPort(port) {
  try {
    const out = execSync(`netstat -ano -p tcp | findstr :${port}`, { encoding: 'utf8' });
    const lines = out.split(/\r?\n/).filter(l => l.trim());
    const pids = new Set();
    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      const pid = parts[parts.length - 1];
      if (/^\d+$/.test(pid)) pids.add(Number(pid));
    }
    return [...pids];
  } catch {
    return [];
  }
}

function killPid(pid) {
  try {
    if (pid === process.pid) return;
    execSync(`taskkill /PID ${pid} /F >NUL 2>&1`);
    console.log(`[force-dev] Killed PID ${pid}`);
  } catch {}
}

function ensurePort(port) {
  const pids = findPidsOnPort(port);
  if (pids.length === 0) {
    console.log(`[force-dev] Port ${port} free.`);
    return true;
  }
  console.log(`[force-dev] Port ${port} in use by: ${pids.join(', ')}`);
  pids.forEach(killPid);
  const left = findPidsOnPort(port);
  if (left.length) {
    console.warn(`[force-dev] WARNING: Still occupied by: ${left.join(', ')}`);
    return false;
  }
  console.log(`[force-dev] Port ${port} cleared.`);
  return true;
}

function resolveViteBin() {
  try {
    const pkgPath = require.resolve('vite/package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    const binRel = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin.vite;
    return path.resolve(path.dirname(pkgPath), binRel);
  } catch (e) {
    console.warn('[force-dev] Could not resolve vite bin, will fallback to npx', e.message);
    return null;
  }
}

async function startViteWithRetries() {
  let attempt = 0;
  const viteBin = resolveViteBin();
  while (attempt < MAX_RETRIES) {
    attempt++;
    console.log(`[force-dev] Start attempt ${attempt}/${MAX_RETRIES}`);
    ensurePort(PORT);
    if (attempt > 1) await sleep(RETRY_DELAY_MS);

    const args = ['--port', String(PORT), '--host', 'localhost'];
    const cmd = viteBin ? process.execPath : (process.platform === 'win32' ? 'npx.cmd' : 'npx');
    const finalArgs = viteBin ? [viteBin, ...args] : ['vite', ...args];

    const child = spawn(cmd, finalArgs, { stdio: ['inherit','pipe','pipe'], env: { ...process.env } });

    let portErr = false;
    const onData = (data) => {
      const text = data.toString();
      process.stdout.write(text); // forward output
      if (/already in use/i.test(text) || /EADDRINUSE/i.test(text)) {
        portErr = true;
      }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);

    const exitCode = await new Promise(res => child.on('exit', code => res(code)));
    if (!portErr && exitCode === 0) {
      // Normal exit (user stopped). Just exit.
      process.exit(0);
    }
    if (!portErr) {
      console.log(`[force-dev] Vite exited with code ${exitCode}.`);
      // If not a port issue, break to avoid infinite loop.
      break;
    }
    console.warn(`[force-dev] Detected port conflict on attempt ${attempt}. Retrying...`);
  }
  console.error('[force-dev] Failed to start Vite after retries.');
  process.exit(1);
}

startViteWithRetries();
