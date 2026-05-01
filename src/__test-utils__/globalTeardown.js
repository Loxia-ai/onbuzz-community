import fs from 'fs/promises';

export default async function globalTeardown() {
  const tmpDir = process.env.LOXIA_TEST_TMPDIR;
  if (tmpDir) {
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
    } catch {
      // Best-effort cleanup
    }
  }
}
