/**
 * electron-builder afterPack hook
 *
 * Runs after the app has been packaged but before code signing.
 * This is where we work around platform-specific issues.
 *
 * Issue: puppeteer-extra-plugin-stealth contains a directory called
 * `evasions/chrome.app` (it's a Node.js module — not an app bundle).
 * macOS codesign sees the `.app` extension and tries to sign it as
 * a bundle, which fails: "bundle format unrecognized".
 *
 * Workaround on macOS: rename the directory to `chrome-app` and
 * patch the parent `evasions/index.js` to require the renamed path.
 * The require call is in a single file we can patch.
 *
 * On Windows/Linux: do nothing — the original directory works fine.
 */

const fs = require('fs');
const path = require('path');

exports.default = async function afterPack(context) {
  const { electronPlatformName, appOutDir, packager } = context;

  // Only patch on macOS — Windows/Linux are unaffected
  if (electronPlatformName !== 'darwin' && electronPlatformName !== 'mas') {
    return;
  }

  const appName = packager.appInfo.productFilename;
  const stealthDir = path.join(
    appOutDir,
    `${appName}.app`,
    'Contents',
    'Resources',
    'app',
    'node_modules',
    'puppeteer-extra-plugin-stealth',
    'evasions'
  );

  const oldPath = path.join(stealthDir, 'chrome.app');
  const newPath = path.join(stealthDir, 'chrome-app');

  if (!fs.existsSync(oldPath)) {
    console.log('[afterPack] chrome.app not found, skipping rename');
    return;
  }

  console.log('[afterPack] Renaming chrome.app → chrome-app to avoid codesign issues');
  fs.renameSync(oldPath, newPath);

  // Patch the require: find any .js file that requires './chrome.app' and rewrite it
  const patchFiles = [
    path.join(stealthDir, '..', 'index.js'),
    path.join(stealthDir, 'index.js')
  ];

  // Also scan all index.js files in the stealth plugin
  const allEvasions = fs.readdirSync(stealthDir).filter(f => fs.statSync(path.join(stealthDir, f)).isDirectory());
  for (const ev of allEvasions) {
    const evIndex = path.join(stealthDir, ev, 'index.js');
    if (fs.existsSync(evIndex)) patchFiles.push(evIndex);
  }

  let patched = 0;
  for (const filePath of patchFiles) {
    if (!fs.existsSync(filePath)) continue;
    let content = fs.readFileSync(filePath, 'utf8');
    if (content.includes("'./chrome.app'") || content.includes('"./chrome.app"') ||
        content.includes("'chrome.app'") || content.includes('"chrome.app"')) {
      content = content
        .replace(/'\.\/chrome\.app'/g, "'./chrome-app'")
        .replace(/"\.\/chrome\.app"/g, '"./chrome-app"')
        .replace(/'evasions\/chrome\.app'/g, "'evasions/chrome-app'")
        .replace(/"evasions\/chrome\.app"/g, '"evasions/chrome-app"');
      fs.writeFileSync(filePath, content, 'utf8');
      patched++;
    }
  }

  console.log(`[afterPack] Patched ${patched} require statements`);
};
