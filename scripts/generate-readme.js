#!/usr/bin/env node
/**
 * Generate branded README.md from README.template.md
 *
 * Usage:
 *   node scripts/generate-readme.js autopilot
 *   node scripts/generate-readme.js onbuzz
 *   VITE_BRAND=onbuzz node scripts/generate-readme.js
 */

import { readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

const BRANDS = {
  autopilot: {
    FULL_PRODUCT_NAME: 'Loxia Autopilot',
    PRODUCT_NAME: 'Autopilot',
    TAGLINE: 'Break All Barriers',
    NPM_PACKAGE: '@loxia-labs/loxia-autopilot-one',
    INSTALL_COMMAND: 'npm install -g @loxia-labs/loxia-autopilot-one',
    CLI_COMMAND: 'loxia',
    DOMAIN: 'autopilot.loxia.ai',
    WEBSITE: 'loxia.ai',
    CONTACT_EMAIL: 'contact@loxia.ai',
    LEGAL_COMPANY: 'Loxia Labs LLC',
  },
  onbuzz: {
    FULL_PRODUCT_NAME: 'Loxia OnBuzz',
    PRODUCT_NAME: 'OnBuzz',
    TAGLINE: 'Your AI Fleet',
    NPM_PACKAGE: 'onbuzz',
    INSTALL_COMMAND: 'npm install -g onbuzz',
    CLI_COMMAND: 'onbuzz',
    DOMAIN: 'onbuzz.loxia.ai',
    WEBSITE: 'loxia.ai',
    CONTACT_EMAIL: 'contact@loxia.ai',
    LEGAL_COMPANY: 'Loxia Labs LLC',
  },
};

const brand = process.argv[2] || process.env.VITE_BRAND || 'autopilot';
const vars = BRANDS[brand];

if (!vars) {
  console.error(`Unknown brand: ${brand}. Use: autopilot | onbuzz`);
  process.exit(1);
}

let template = readFileSync(join(root, 'README.template.md'), 'utf8');

for (const [key, value] of Object.entries(vars)) {
  template = template.replaceAll(`{{${key}}}`, value);
}

writeFileSync(join(root, 'README.md'), template);
console.log(`✅ README.md generated for ${brand}`);
