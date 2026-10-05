#!/usr/bin/env node
// Starts the mock world and the collector together: open http://127.0.0.1:7777
import { spawn } from 'node:child_process';
import { serveWorld } from './mock-world.mjs';
process.env.MOCK_GITHUB_TOKEN = 'mock'; process.env.MOCK_JENKINS_USER = 'mock'; process.env.MOCK_JENKINS_TOKEN = 'mock';
await serveWorld({ port: 7788, tickSeconds: 6 });
const c = spawn(process.execPath, ['src/index.js', 'run', '--config', 'config.mock.json'], { stdio: 'inherit', env: process.env });
c.on('exit', code => process.exit(code ?? 0));
