import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { after, before } from 'node:test';

export let tempDir = '';

before(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'quick-jsonl-viewer-'));
});

after(async () => {
  if (tempDir) {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

export async function writeFixture(
  fileName: string,
  contents: string
): Promise<string> {
  const filePath = path.join(tempDir, fileName);
  await fs.writeFile(filePath, contents, 'utf8');
  return filePath;
}
