import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createLoopbackGateway, parseGatewayConfig } from './dev-gateway.mjs';
import { loadServiceEnvironment } from './run-service.mjs';

const listen = (server) =>
  new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });

const close = (server) => new Promise((resolve) => server.close(resolve));

const gatewayRequest = (port, host, path = '/') =>
  new Promise((resolve, reject) => {
    const outgoing = request({ headers: { host }, host: '127.0.0.1', path, port }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.once('end', () =>
        resolve({ body: Buffer.concat(chunks).toString('utf8'), status: response.statusCode }),
      );
    });
    outgoing.once('error', reject);
    outgoing.end();
  });

describe('development gateway', () => {
  const target = createServer((request, response) => {
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({ host: request.headers.host, path: request.url }));
  });
  let gateway;
  let gatewayPort;

  before(async () => {
    const targetPort = await listen(target);
    gateway = createLoopbackGateway(
      parseGatewayConfig({
        host: '127.0.0.1',
        port: 8080,
        routes: { 'project-dev.example.test': `http://127.0.0.1:${targetPort}` },
      }),
    );
    gatewayPort = await listen(gateway);
  });

  after(async () => {
    await close(gateway);
    await close(target);
  });

  it('routes only an exact configured host and preserves its public Host header', async () => {
    const response = await gatewayRequest(
      gatewayPort,
      'project-dev.example.test',
      '/hello?from=test',
    );
    assert.equal(response.status, 200);
    assert.deepEqual(JSON.parse(response.body), {
      host: 'project-dev.example.test',
      path: '/hello?from=test',
    });

    const missing = await gatewayRequest(gatewayPort, 'unknown.example.test');
    assert.equal(missing.status, 404);
  });

  it('rejects wildcards and non-loopback targets', () => {
    assert.throws(
      () =>
        parseGatewayConfig({
          routes: { '*.example.test': 'http://127.0.0.1:3000' },
        }),
      /exact hostname/,
    );
    assert.throws(
      () =>
        parseGatewayConfig({
          routes: { 'project.example.test': 'https://remote.example.test' },
        }),
      /exact loopback HTTP origin/,
    );
  });
});

describe('service environment loader', () => {
  const directory = mkdtempSync(join(tmpdir(), 'oxe-service-environment-'));
  const path = join(directory, 'environment.json');

  after(() => rmSync(directory, { force: true, recursive: true }));

  it('loads string values only from an owner-private regular file', () => {
    writeFileSync(path, JSON.stringify({ EXAMPLE_TOKEN: 'private' }), { mode: 0o600 });
    assert.deepEqual(loadServiceEnvironment(path), { EXAMPLE_TOKEN: 'private' });
    chmodSync(path, 0o644);
    assert.throws(() => loadServiceEnvironment(path), /group or others/);
  });
});
