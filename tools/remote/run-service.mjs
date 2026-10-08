import { readFileSync, statSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ENVIRONMENT_NAME = /^[A-Z_][A-Z0-9_]*$/;

export const loadServiceEnvironment = (path) => {
  const metadata = statSync(path);
  if (!metadata.isFile()) throw new TypeError('Service environment path must be a regular file.');
  if ((metadata.mode & 0o077) !== 0)
    throw new TypeError(
      'Service environment file must not be readable or writable by group or others.',
    );
  const source = JSON.parse(readFileSync(path, 'utf8'));
  if (typeof source !== 'object' || source === null || Array.isArray(source))
    throw new TypeError('Service environment must be a JSON object.');
  const environment = {};
  for (const [name, value] of Object.entries(source)) {
    if (!ENVIRONMENT_NAME.test(name))
      throw new TypeError(`Invalid service environment variable ${JSON.stringify(name)}.`);
    if (typeof value !== 'string')
      throw new TypeError(`Service environment variable ${name} must be a string.`);
    environment[name] = value;
  }
  return Object.freeze(environment);
};

const main = () => {
  const [environmentPath, command, ...arguments_] = process.argv.slice(2);
  if (!environmentPath || !command)
    throw new TypeError('Usage: node run-service.mjs <environment.json> <command> [...arguments]');
  const child = spawn(command, arguments_, {
    env: { ...process.env, ...loadServiceEnvironment(environmentPath) },
    stdio: 'inherit',
  });
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => child.kill(signal));
  child.once('error', (error) => {
    process.stderr.write(`Unable to start service: ${error.message}\n`);
    process.exitCode = 1;
  });
  child.once('exit', (code, signal) => {
    if (signal) process.kill(process.pid, signal);
    else process.exitCode = code ?? 1;
  });
};

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
    process.exitCode = 1;
  }
