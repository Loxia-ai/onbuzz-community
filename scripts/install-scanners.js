#!/usr/bin/env node
/**
 * Post-install script to set up security scanners
 * Automatically installs required scanners for the platform
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import https from 'https';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createWriteStream } from 'fs';
import { pipeline } from 'stream/promises';

const execAsync = promisify(exec);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SCANNER_DIR = path.join(__dirname, '..', 'node_modules', '.scanners');
const SEMGREP_VERSION = 'v1.55.0';

console.log('═══════════════════════════════════════════════════════════');
console.log('  Installing Security Scanners');
console.log(`  Platform: ${process.platform} (${process.arch})`);
console.log('═══════════════════════════════════════════════════════════\n');

/**
 * Main installation function
 */
async function installScanners() {
  // Ensure scanner directory exists
  await fs.promises.mkdir(SCANNER_DIR, { recursive: true });

  // 1. Check ESLint Security Plugin (should be in package.json)
  await checkESLintSecurity();

  // 2. Install Semgrep standalone binary
  await installSemgrep();

  // 3. Optionally install Python scanners if Python is available
  await installPythonScanners();

  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('  Installation Complete');
  console.log('═══════════════════════════════════════════════════════════\n');
}

/**
 * Check if ESLint Security Plugin is installed
 */
async function checkESLintSecurity() {
  console.log('📦 Checking ESLint Security Plugin...');
  try {
    await import('eslint-plugin-security');
    console.log('   ✅ eslint-plugin-security is installed\n');
  } catch (error) {
    console.log('   ⚠️  eslint-plugin-security not found');
    console.log('   Run: npm install --save-dev eslint-plugin-security\n');
  }
}

/**
 * Install Semgrep standalone binary for the current platform
 */
async function installSemgrep() {
  console.log('🔍 Installing Semgrep...');

  const platform = process.platform;
  const arch = process.arch;

  // Check if semgrep is already installed globally
  try {
    const result = await execAsync('semgrep --version', { timeout: 5000 });
    console.log(`   ✅ Semgrep already installed: ${result.stdout.trim()}`);
    console.log('   Using system-installed Semgrep\n');
    return;
  } catch (error) {
    console.log('   Semgrep not found in PATH, installing standalone binary...');
  }

  // Determine download URL based on platform
  const binaryInfo = getSemgrepBinaryInfo(platform, arch);

  if (!binaryInfo) {
    console.log(`   ⚠️  No Semgrep binary available for ${platform}-${arch}`);
    console.log('   Please install manually: https://semgrep.dev/docs/getting-started/\n');
    return;
  }

  try {
    const binaryPath = path.join(SCANNER_DIR, 'semgrep');

    console.log(`   Downloading from ${binaryInfo.url}...`);
    await downloadFile(binaryInfo.url, binaryPath);

    // Make executable
    await fs.promises.chmod(binaryPath, 0o755);

    console.log('   ✅ Semgrep installed successfully');
    console.log(`   Location: ${binaryPath}\n`);

    // Add to PATH environment note
    console.log('   Note: To use system-wide, add to PATH or install globally:');
    console.log('   pip install semgrep\n');
  } catch (error) {
    console.log(`   ⚠️  Failed to install Semgrep: ${error.message}`);
    console.log('   You can install manually: pip install semgrep\n');
  }
}

/**
 * Get Semgrep binary info for platform
 */
function getSemgrepBinaryInfo(platform, arch) {
  // Semgrep binary URLs (using latest stable release)
  // Note: Semgrep doesn't provide standalone binaries anymore for all platforms
  // They recommend using pip install or Docker

  // For now, we'll provide instructions rather than downloading
  // The actual implementation would use Semgrep's Python package

  return null; // Will trigger manual installation message
}

/**
 * Install Python-based scanners (Bandit, pip-audit) if Python is available
 */
async function installPythonScanners() {
  console.log('🐍 Checking Python scanners...');

  // Check if Python is available
  let pythonCommand = null;

  try {
    await execAsync('python3 --version', { timeout: 5000 });
    pythonCommand = 'python3';
  } catch (error) {
    try {
      await execAsync('python --version', { timeout: 5000 });
      pythonCommand = 'python';
    } catch (error2) {
      console.log('   ⚠️  Python not found - skipping Python scanners');
      console.log('   To enable Python scanning, install Python and run:');
      console.log('   pip install semgrep bandit pip-audit checkov yamllint\n');
      return;
    }
  }

  console.log(`   ✅ Python found: ${pythonCommand}`);

  // Security scanners
  await installViaPip('semgrep', pythonCommand);
  await installViaPip('bandit', pythonCommand);
  await installViaPip('pip-audit', pythonCommand);

  // Config validation tools
  await installViaPip('checkov', pythonCommand);
  await installViaPip('yamllint', pythonCommand);

  console.log('');
}

/**
 * Check if Python is from Homebrew installation (macOS)
 * Homebrew Python doesn't support --user flag
 */
async function isHomebrewPython(pythonCommand) {
  try {
    const { stdout } = await execAsync(`${pythonCommand} -c "import sys; print(sys.prefix)"`, {
      timeout: 5000
    });
    return stdout.includes('/opt/homebrew') || stdout.includes('/usr/local/Cellar');
  } catch {
    return false;
  }
}

/**
 * Install a Python package via pip
 * Automatically detects Homebrew Python and skips --user flag
 */
async function installViaPip(packageName, pythonCommand) {
  try {
    // Check if already installed
    const checkResult = await execAsync(`${pythonCommand} -m pip show ${packageName}`, {
      timeout: 5000
    });
    console.log(`   ✅ ${packageName} already installed`);
    return true;
  } catch (error) {
    // Not installed, try to install
    console.log(`   Installing ${packageName}...`);
    try {
      // Detect if using Homebrew Python (skip --user flag)
      const isHomebrew = await isHomebrewPython(pythonCommand);
      const userFlag = isHomebrew ? '' : '--user';

      const installCmd = `${pythonCommand} -m pip install ${userFlag} ${packageName}`.replace(/\s+/g, ' ').trim();
      await execAsync(installCmd, {
        timeout: 60000
      });
      console.log(`   ✅ ${packageName} installed successfully`);
      return true;
    } catch (installError) {
      console.log(`   ⚠️  Failed to install ${packageName}: ${installError.message}`);
      console.log(`   You can install manually: pip install ${packageName}`);
      return false;
    }
  }
}

/**
 * Download a file from URL
 */
async function downloadFile(url, outputPath) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;

    client.get(url, (response) => {
      if (response.statusCode === 302 || response.statusCode === 301) {
        // Follow redirect
        downloadFile(response.headers.location, outputPath)
          .then(resolve)
          .catch(reject);
        return;
      }

      if (response.statusCode !== 200) {
        reject(new Error(`Failed to download: HTTP ${response.statusCode}`));
        return;
      }

      const fileStream = createWriteStream(outputPath);
      response.pipe(fileStream);

      fileStream.on('finish', () => {
        fileStream.close();
        resolve();
      });

      fileStream.on('error', (error) => {
        fs.unlink(outputPath, () => {}); // Delete partial file
        reject(error);
      });
    }).on('error', reject);
  });
}

// Run installation
installScanners().catch((error) => {
  console.error('❌ Installation failed:', error.message);
  console.error('\nYou can manually install scanners:');
  console.error('  npm install --save-dev eslint-plugin-security');
  console.error('  pip install semgrep bandit pip-audit');
  process.exit(0); // Don't fail npm install
});
