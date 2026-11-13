import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { deflateSync } from 'node:zlib';

const configuration = JSON.parse(await readFile(new URL('../fixtures/source.json', import.meta.url)));
const controls = JSON.parse(await readFile(new URL('../fixtures/controls.json', import.meta.url)));
const kind = configuration.kind;

export async function startSource() {
  let state = structuredClone(configuration.data);
  const requests = [];
  const timers = new Set();
  const assignments = new Map();
  const json = (response, value, status = 200, headers = {}) => {
    response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', ...headers });
    response.end(JSON.stringify(value));
  };
  const schedule = (callback, delay = 0) => {
    const timer = setTimeout(() => { timers.delete(timer); callback(); }, delay);
    timers.add(timer);
    return timer;
  };
  async function input(request) {
    const chunks = [];
    let size = 0;
    for await (const chunk of request) {
      size += chunk.length;
      if (size > 1048576) throw new Error('源端控制请求过大');
      chunks.push(chunk);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  }
  async function serve(request, response) {
    try {
      const url = new URL(request.url, 'http://127.0.0.1');
      if (url.pathname === '/api/snapshot') return json(response, state);
      if (url.pathname === '/api/requests') return json(response, requests);
      if (url.pathname === '/api/action' && request.method === 'POST') {
        const { action } = await input(request);
        if (action === 'reset') state = structuredClone(configuration.data);
        else if (controls[action]) Object.assign(state, structuredClone(controls[action]));
        else return json(response, { error: '未知控制动作' }, 400);
        return json(response, state);
      }
      if (kind === 'quantity-context' && url.pathname.startsWith('/api/document/')) {
        const page = state.pages.find(value => value.id === url.pathname.split('/').at(-1));
        if (!page) return json(response, { error: '无此公告' }, 404);
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'etag': state.version });
        return response.end(page.html);
      }
      if (url.pathname === '/portal.mjs') {
        response.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' });
        return response.end(await readFile(new URL('../public/portal.mjs', import.meta.url)));
      }
      if (url.pathname === '/') {
        try {
          response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
          return response.end(await readFile(new URL('../public/index.html', import.meta.url)));
        } catch { return response.end('<p>本地资料源已启动；GET /api/snapshot 预览原始资料。</p>'); }
      }
      return json(response, { error: '无此资源' }, 404);
    } catch (error) {
      if (!response.headersSent) json(response, { error: error.message }, 400);
      else response.destroy();
    }
  }
  const server = createServer((request, response) => { void serve(request, response); });
  server.on('checkContinue', (request, response) => {
    if (kind === 'query-body' && state.mode === 'reject') { response.writeHead(417); response.end(); return; }
    response.writeContinue(); void serve(request, response);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    close: async () => { for (const timer of timers) clearTimeout(timer); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  };
}
