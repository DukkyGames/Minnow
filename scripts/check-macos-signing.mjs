#!/usr/bin/env node
/**
 * Validate (and optionally bootstrap) macOS release signing prerequisites.
 *
 * Usage:
 *   npm run signing:check          # report status, exit 1 when release-ready signing is incomplete
 *   npm run signing:setup          # generate a CSR + print portal steps when no cert exists
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {
  csrDir,
  hasDeveloperIdIdentity,
  hasNotarizationCredentials,
  listDeveloperIdIdentities,
  loadSigningEnvFile,
  repoRoot,
  signingEnvPath,
} from './macos-signing-env.mjs';

const setupMode = process.argv.includes('--setup');

function log(title, detail = '') {
  console.log(detail ? `${title}: ${detail}` : title);
}

function warn(title, detail = '') {
  console.warn(detail ? `⚠ ${title}: ${detail}` : `⚠ ${title}`);
}

function ok(title, detail = '') {
  console.log(detail ? `✓ ${title}: ${detail}` : `✓ ${title}`);
}

function fail(title, detail = '') {
  console.error(detail ? `✗ ${title}: ${detail}` : `✗ ${title}`);
}

function hasXcodeTools() {
  const result = spawnSync('xcode-select', ['-p'], { encoding: 'utf8' });
  return result.status === 0 && Boolean(result.stdout?.trim());
}

function ensureCsrDir() {
  fs.mkdirSync(csrDir, { recursive: true });
}

/**
 * Create a Certificate Signing Request for Developer ID Application.
 * The private key stays in build/macos-signing/ (gitignored).
 */
function generateCsr() {
  ensureCsrDir();
  const keyPath = path.join(csrDir, 'developer_id.key');
  const csrPath = path.join(csrDir, 'developer_id.csr');

  if (fs.existsSync(csrPath) && fs.existsSync(keyPath)) {
    return { keyPath, csrPath, created: false };
  }

  const email = process.env.APPLE_ID?.trim() || 'you@example.com';
  const cn = process.env.MINNOW_SIGNING_CN?.trim() || 'Henri Grimm';

  const result = spawnSync(
    'openssl',
    [
      'req',
      '-new',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-keyout',
      keyPath,
      '-out',
      csrPath,
      '-subj',
      `/CN=${cn}/emailAddress=${email}`,
      '-addext',
      'extendedKeyUsage=codeSigning',
    ],
    { encoding: 'utf8', cwd: repoRoot },
  );
  if (result.status !== 0) {
    throw new Error(result.stderr || 'openssl req failed');
  }

  return { keyPath, csrPath, created: true };
}

function printPortalSteps(csrPath) {
  console.log('');
  console.log('Next steps — create your Developer ID Application certificate:');
  console.log('');
  console.log('1. Open https://developer.apple.com/account/resources/certificates/list');
  console.log('2. Click + → Developer ID Application → Continue');
  console.log(`3. Upload CSR: ${csrPath}`);
  console.log('4. Download the .cer file and double-click it to install in Keychain');
  console.log('5. Re-run: npm run signing:check');
  console.log('');
  console.log('Alternative (Xcode): Settings → Accounts → your team → Manage Certificates');
  console.log('→ + → Developer ID Application');
  console.log('');
}

function printNotarizeSteps() {
  console.log('');
  console.log('Notarization credentials (pick one):');
  console.log('');
  console.log('A) App-specific password (simplest for local releases)');
  console.log('   1. https://appleid.apple.com → Sign-In and Security → App-Specific Passwords');
  console.log('   2. cp .env.signing.example .env.signing');
  console.log('   3. Fill APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID');
  console.log('');
  console.log('B) App Store Connect API key (better for CI)');
  console.log('   Fill APPLE_API_KEY, APPLE_API_KEY_ID, APPLE_API_KEY_ISSUER in .env.signing');
  console.log('');
  console.log('Then package a signed release:');
  console.log('   npm run package:mac');
  console.log('');
}

function main() {
  if (process.platform !== 'darwin') {
    fail('macOS only', 'Run this on a Mac with Xcode command-line tools.');
    process.exit(1);
  }

  loadSigningEnvFile();

  let ready = true;

  if (hasXcodeTools()) {
    ok('Xcode command-line tools', spawnSync('xcode-select', ['-p'], { encoding: 'utf8' }).stdout.trim());
  } else {
    fail('Xcode command-line tools', 'Run: xcode-select --install');
    ready = false;
  }

  const identities = listDeveloperIdIdentities();
  if (identities.length > 0) {
    ok('Developer ID Application certificate', identities[0].name);
  } else {
    fail('Developer ID Application certificate', 'not found in login keychain');
    ready = false;

    if (setupMode) {
      try {
        const { csrPath, created } = generateCsr();
        ok(created ? 'Generated CSR' : 'CSR already exists', csrPath);
        printPortalSteps(csrPath);
      } catch (err) {
        fail('CSR generation', err instanceof Error ? err.message : String(err));
      }
    } else {
      warn('Run npm run signing:setup to generate a CSR and see portal steps');
    }
  }

  if (fs.existsSync(signingEnvPath)) {
    ok('.env.signing', 'loaded');
  } else {
    warn('.env.signing', 'missing — copy .env.signing.example when you are ready to notarize');
  }

  if (hasNotarizationCredentials()) {
    ok('Notarization credentials', `team ${process.env.APPLE_TEAM_ID}`);
  } else {
    fail('Notarization credentials', 'APPLE_ID + APPLE_APP_SPECIFIC_PASSWORD + APPLE_TEAM_ID (or API key trio)');
    ready = false;
    printNotarizeSteps();
  }

  if (ready) {
    console.log('');
    ok('Release signing ready', 'npm run package:mac');
    process.exit(0);
  }

  console.log('');
  warn('Release signing is not fully configured yet.');
  process.exit(1);
}

main();
