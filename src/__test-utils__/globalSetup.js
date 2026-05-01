import os from 'os';
import path from 'path';
import fs from 'fs/promises';

export default async function globalSetup() {
  const tmpDir = path.join(os.tmpdir(), `loxia-test-${Date.now()}`);
  await fs.mkdir(tmpDir, { recursive: true });
  process.env.LOXIA_TEST_TMPDIR = tmpDir;
}
