'use strict';

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const readline = require('readline');

let child = null;
let rl = null;
let pending = [];
let binaryPathCache = null;

function resolveBinaryPath() {
  if (binaryPathCache && fs.existsSync(binaryPathCache)) return binaryPathCache;
  const binName = process.platform === 'win32' ? 'yogatik-accel.exe' : 'yogatik-accel';
  const candidates = [
    // Packaged Electron resources & local bin/
    process.resourcesPath ? path.join(process.resourcesPath, 'yogatik-accel', binName) : null,
    process.resourcesPath ? path.join(process.resourcesPath, 'bin', binName) : null,
    path.resolve(__dirname, '../../bin/yogatik-accel', binName),
    // Dev / workspace release & debug builds
    path.resolve(__dirname, '../../../rust/yogatik-accel/target/release', binName),
    path.resolve(__dirname, '../../../rust/yogatik-accel/target/debug', binName),
  ].filter(Boolean);

  for (const p of candidates) {
    if (fs.existsSync(p)) {
      binaryPathCache = p;
      return p;
    }
  }
  return null;
}

function failAllPending(err) {
  const queue = pending;
  pending = [];
  for (const item of queue) {
    clearTimeout(item.timer);
    item.reject(err);
  }
}

function ensureWorker() {
  if (child && !child.killed && child.stdin && !child.stdin.destroyed) {
    return true;
  }
  const bin = resolveBinaryPath();
  if (!bin) return false;

  try {
    child = spawn(bin, [], {
      stdio: ['pipe', 'pipe', 'ignore'],
      windowsHide: true,
    });
    rl = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
    rl.on('line', (line) => {
      const next = pending.shift();
      if (!next) return;
      clearTimeout(next.timer);
      try {
        next.resolve(JSON.parse(line));
      } catch (e) {
        next.reject(e);
      }
    });
    child.on('exit', () => {
      child = null;
      rl = null;
      failAllPending(new Error('yogatik-accel exited'));
    });
    child.on('error', (err) => {
      child = null;
      rl = null;
      failAllPending(err);
    });
    return true;
  } catch {
    child = null;
    rl = null;
    return false;
  }
}

function sendCommand(line, timeoutMs = 2000) {
  return new Promise((resolve, reject) => {
    if (!ensureWorker()) {
      return reject(new Error('yogatik-accel binary not available'));
    }
    const timer = setTimeout(() => {
      const idx = pending.findIndex((p) => p.timer === timer);
      if (idx !== -1) pending.splice(idx, 1);
      reject(new Error('yogatik-accel timeout'));
    }, timeoutMs);

    pending.push({ resolve, reject, timer });
    try {
      child.stdin.write(String(line).replace(/[\r\n]+/g, ' ') + '\n');
    } catch (e) {
      clearTimeout(timer);
      pending.pop();
      reject(e);
    }
  });
}

function isAvailable() {
  return !!resolveBinaryPath();
}

function stopWorker() {
  if (child) {
    try { child.kill(); } catch {}
    child = null;
  }
  if (rl) {
    try { rl.close(); } catch {}
    rl = null;
  }
  failAllPending(new Error('yogatik-accel stopped'));
}

module.exports = {
  isAvailable,
  sendCommand,
  stopWorker,
};
