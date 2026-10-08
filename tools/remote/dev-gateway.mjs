import { readFileSync } from 'node:fs';
import { createServer, request as createUpstreamRequest } from 'node:http';
import { connect } from 'node:net';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1', 'localhost']);
const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'proxy-connection',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

const objectValue = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);

const portValue = (value, name) => {
  if (!Number.isInteger(value) || value < 1 || value > 65_535)
    throw new TypeError(`${name} must be an integer between 1 and 65535.`);
  return value;
};

const routeHostname = (value) => {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.includes('*') ||
    value.includes(':') ||
    value.includes('/')
  )
    throw new TypeError(`Gateway route ${JSON.stringify(value)} must be an exact hostname.`);
  const url = new URL(`http://${value}`);
  if (url.hostname !== value.toLowerCase())
    throw new TypeError(`Gateway route ${JSON.stringify(value)} must be a normalized hostname.`);
  return url.hostname;
};

const loopbackTarget = (value, route) => {
  if (typeof value !== 'string')
    throw new TypeError(`Gateway target for ${route} must be an HTTP URL.`);
  const url = new URL(value);
  if (
    url.protocol !== 'http:' ||
    !LOOPBACK_HOSTS.has(url.hostname) ||
    !url.port ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  )
    throw new TypeError(
      `Gateway target for ${route} must be an exact loopback HTTP origin with an explicit port.`,
    );
  return url;
};

export const parseGatewayConfig = (source) => {
  if (!objectValue(source)) throw new TypeError('Gateway configuration must be an object.');
  const host = source.host ?? '127.0.0.1';
  if (typeof host !== 'string' || !LOOPBACK_HOSTS.has(host))
    throw new TypeError('Gateway host must be a loopback hostname or address.');
  const port = portValue(source.port ?? 8080, 'Gateway port');
  if (!objectValue(source.routes) || Object.keys(source.routes).length === 0)
    throw new TypeError('Gateway routes must be a non-empty hostname map.');
  const routes = new Map();
  for (const [rawHostname, rawTarget] of Object.entries(source.routes)) {
    const hostname = routeHostname(rawHostname);
    if (routes.has(hostname)) throw new TypeError(`Duplicate gateway route ${hostname}.`);
    routes.set(hostname, loopbackTarget(rawTarget, hostname));
  }
  return Object.freeze({ host, port, routes });
};

export const loadGatewayConfig = (path) =>
  parseGatewayConfig(JSON.parse(readFileSync(path, 'utf8')));

const requestHostname = (host) => {
  if (!host) return undefined;
  try {
    const parsed = new URL(`http://${host}`);
    return parsed.pathname === '/' && !parsed.username && !parsed.password
      ? parsed.hostname.toLowerCase()
      : undefined;
  } catch {
    return undefined;
  }
};

const connectionHeaders = (headers) => {
  const names = new Set(HOP_BY_HOP_HEADERS);
  const connection = headers.connection;
  const values = Array.isArray(connection) ? connection : connection ? [connection] : [];
  for (const value of values)
    for (const name of value.split(',')) names.add(name.trim().toLowerCase());
  return names;
};

const proxyHeaders = (headers, includeUpgrade = false) => {
  const excluded = connectionHeaders(headers);
  if (includeUpgrade) {
    excluded.delete('connection');
    excluded.delete('upgrade');
  }
  return Object.fromEntries(
    Object.entries(headers).filter(
      ([name, value]) => value !== undefined && !excluded.has(name.toLowerCase()),
    ),
  );
};

const plainSocketResponse = (socket, status, message) => {
  const body = `${message}\n`;
  socket.end(
    `HTTP/1.1 ${status}\r\nConnection: close\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`,
  );
};

export const createLoopbackGateway = (config) => {
  const server = createServer((request, response) => {
    const target = config.routes.get(requestHostname(request.headers.host));
    if (!target) {
      response.writeHead(404, {
        'cache-control': 'no-store',
        'content-type': 'text/plain; charset=utf-8',
      });
      response.end('No development route is configured for this host.\n');
      return;
    }
    const upstream = createUpstreamRequest(
      {
        headers: proxyHeaders(request.headers),
        hostname: target.hostname,
        method: request.method,
        path: request.url,
        port: target.port,
      },
      (upstreamResponse) => {
        response.writeHead(
          upstreamResponse.statusCode ?? 502,
          proxyHeaders(upstreamResponse.headers),
        );
        upstreamResponse.pipe(response);
      },
    );
    upstream.once('error', () => {
      if (!response.headersSent)
        response.writeHead(502, {
          'cache-control': 'no-store',
          'content-type': 'text/plain; charset=utf-8',
        });
      response.end('The configured development service is unavailable.\n');
    });
    request.once('aborted', () => upstream.destroy());
    request.pipe(upstream);
  });

  server.on('upgrade', (request, socket, head) => {
    const target = config.routes.get(requestHostname(request.headers.host));
    if (!target) {
      plainSocketResponse(
        socket,
        '404 Not Found',
        'No development route is configured for this host.',
      );
      return;
    }
    const upstream = connect({ host: target.hostname, port: Number(target.port) });
    upstream.once('connect', () => {
      const headers = proxyHeaders(request.headers, true);
      const lines = [`${request.method ?? 'GET'} ${request.url ?? '/'} HTTP/1.1`];
      for (const [name, value] of Object.entries(headers)) {
        if (Array.isArray(value)) for (const item of value) lines.push(`${name}: ${item}`);
        else if (value !== undefined) lines.push(`${name}: ${value}`);
      }
      upstream.write(`${lines.join('\r\n')}\r\n\r\n`);
      if (head.length > 0) upstream.write(head);
      socket.pipe(upstream).pipe(socket);
    });
    upstream.once('error', () => {
      if (!socket.destroyed)
        plainSocketResponse(
          socket,
          '502 Bad Gateway',
          'The configured development service is unavailable.',
        );
    });
    socket.once('error', () => upstream.destroy());
  });
  server.on('clientError', (_error, socket) => {
    if (!socket.destroyed)
      plainSocketResponse(socket, '400 Bad Request', 'Invalid gateway request.');
  });
  return server;
};

const main = async () => {
  const configPath = process.argv[2];
  if (!configPath) throw new TypeError('Usage: node dev-gateway.mjs <routes.json>');
  const config = loadGatewayConfig(configPath);
  const server = createLoopbackGateway(config);
  await new Promise((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(config.port, config.host, resolveListen);
  });
  const close = () => server.close();
  process.once('SIGINT', close);
  process.once('SIGTERM', close);
  process.stdout.write(`Development gateway: http://${config.host}:${config.port}\n`);
  for (const [hostname, target] of config.routes)
    process.stdout.write(`  ${hostname} -> ${target.origin}\n`);
};

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  void main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
    process.exitCode = 1;
  });
