// SpectraHub configuration: one JSON file, no hidden state.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const VERSION = '0.3.1';

export function defaultDir() {
  return process.env.SPECTRAHUB_HOME || join(homedir(), '.spectrahub');
}

export function paths(dir) {
  return {
    dir,
    config: join(dir, 'config.json'),
    data: join(dir, 'data'),
    logs: join(dir, 'logs'),
  };
}

export function readConfig(dir = defaultDir()) {
  const p = paths(dir);
  if (!existsSync(p.config)) return null;
  return JSON.parse(readFileSync(p.config, 'utf8'));
}

export function writeConfig(dir, config) {
  const p = paths(dir);
  mkdirSync(p.data, { recursive: true });
  mkdirSync(p.logs, { recursive: true });
  writeFileSync(p.config, JSON.stringify(config, null, 2) + '\n');
  return p.config;
}

export function newConfig({ port = 8787, host = '127.0.0.1', owner = 'owner' } = {}) {
  return {
    version: 1,
    product: 'spectrahub',
    createdAt: new Date().toISOString(),
    owner,
    server: { host, port },
  };
}
