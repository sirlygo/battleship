#!/usr/bin/env node

const { spawn } = require('node:child_process');
const { existsSync } = require('node:fs');
const path = require('node:path');

const projectRoot = path.join(__dirname, '..');
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const MIN_NODE_MAJOR = 18;

function logHeading(message) {
  const divider = '-'.repeat(message.length + 4);
  console.log(`\n${divider}`);
  console.log(`| ${message} |`);
  console.log(divider);
}

function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: projectRoot,
      stdio: 'inherit',
      shell: false,
      ...options,
    });

    child.on('error', (error) => {
      reject(error);
    });

    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`${command} ${args.join(' ')} exited with code ${code}`));
        return;
      }
      resolve();
    });
  });
}

async function ensureDependencies() {
  const nodeModulesExists = existsSync(path.join(projectRoot, 'node_modules'));
  if (nodeModulesExists) {
    console.log('Dependencies already installed (node_modules found). Skipping install step.');
    return;
  }

  logHeading('Installing dependencies');
  await runCommand(npmCommand, ['install', '--no-audit']);
}

async function startServer() {
  logHeading('Starting Battleship server');
  console.log('Launching development server on http://localhost:3000');
  console.log('Press Ctrl+C to stop the server.');

  const child = spawn(npmCommand, ['start'], {
    cwd: projectRoot,
    stdio: 'inherit',
    shell: false,
  });

  child.on('close', (code) => {
    process.exit(code ?? 0);
  });

  child.on('error', (error) => {
    console.error('Failed to launch the development server:', error.message);
    process.exit(1);
  });
}

async function main() {
  const [major] = process.versions.node.split('.').map(Number);
  if (Number.isNaN(major) || major < MIN_NODE_MAJOR) {
    console.error(`Node.js ${MIN_NODE_MAJOR}+ is required. Detected version ${process.versions.node}.`);
    process.exit(1);
  }

  logHeading('Battleship 1-click setup');
  console.log('This script will install dependencies (if needed) and start the local server.');

  try {
    await ensureDependencies();
    await startServer();
  } catch (error) {
    console.error('\nSetup failed:', error.message);
    process.exit(1);
  }
}

main();
