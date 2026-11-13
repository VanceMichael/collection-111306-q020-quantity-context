import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:net';
import {startSource} from '../src/source.mjs';

test('显式监听端口与默认独立源互不混淆', async () => {
  const reservation = createServer();
  await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve));
  const port = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  const configured = await startSource({port});
  const independent = await startSource();
  try {
    assert.equal(Number(new URL(configured.url).port), port);
    assert.notEqual(configured.url, independent.url);
    const response = await fetch(configured.url + '/api/snapshot');
    assert.equal(response.status, 200);
    assert.equal(typeof await response.json(), 'object');
  } finally {
    await configured.close();
    await independent.close();
  }
});
