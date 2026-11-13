import { mkdir, readFile, rename, open, rm } from 'node:fs/promises';
import { dirname } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

function checksum(text) { return createHash('sha256').update(text).digest('hex'); }

export class CaptureStore {
  constructor(path) { this.path = path; this.queue = Promise.resolve(); }
  async read() {
    let text;
    try { text = await readFile(this.path, 'utf8'); }
    catch (error) { if (error.code === 'ENOENT') return { revision: 0, records: [] }; throw error; }
    const envelope = JSON.parse(text);
    if (checksum(envelope.body) !== envelope.checksum) throw new Error('接收文件校验失败');
    return JSON.parse(envelope.body);
  }
  append(record) {
    const work = this.queue.then(async () => {
      const state = await this.read();
      const body = JSON.stringify({ revision: state.revision + 1, records: [...state.records, structuredClone(record)] });
      const temporary = `${this.path}.${randomUUID()}.tmp`;
      await mkdir(dirname(this.path), { recursive: true });
      try {
        const handle = await open(temporary, 'wx', 0o600);
        try { await handle.writeFile(JSON.stringify({ checksum: checksum(body), body })); await handle.sync(); }
        finally { await handle.close(); }
        await rename(temporary, this.path);
        const directory = await open(dirname(this.path), 'r');
        try { await directory.sync(); } finally { await directory.close(); }
      } finally { await rm(temporary, { force: true }); }
      return this.read();
    });
    this.queue = work.catch(() => {});
    return work;
  }
}
