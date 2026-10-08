import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const labels = Object.freeze({
  application: 'com.finnternet.oxe-app-dev',
  gateway: 'com.finnternet.dev-gateway',
  workspace: 'com.finnternet.oxe-dev',
});
const legacyPreviewLabel = 'com.finnternet.oxe-preview';

const xml = (value) =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');

const writePrivateJson = (path, value) => {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporaryPath = `${path}.${process.pid}.tmp`;
  writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  renameSync(temporaryPath, path);
  chmodSync(path, 0o600);
};

const readPrivateJson = (path) => {
  if (!existsSync(path)) return undefined;
  const metadata = statSync(path);
  if (!metadata.isFile() || (metadata.mode & 0o077) !== 0)
    throw new TypeError(`${path} must be an owner-private regular file.`);
  const value = JSON.parse(readFileSync(path, 'utf8'));
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new TypeError(`${path} must contain a JSON object.`);
  return value;
};

const randomSecret = () => randomBytes(48).toString('base64url');

const plist = ({
  arguments: arguments_,
  errorPath,
  label,
  outputPath,
  workingDirectory,
}) => `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${xml(label)}</string>
  <key>ProgramArguments</key>
  <array>
${arguments_.map((argument) => `    <string>${xml(argument)}</string>`).join('\n')}
  </array>
  <key>WorkingDirectory</key>
  <string>${xml(workingDirectory)}</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ProcessType</key>
  <string>Background</string>
  <key>ThrottleInterval</key>
  <integer>5</integer>
  <key>Umask</key>
  <integer>63</integer>
  <key>StandardOutPath</key>
  <string>${xml(outputPath)}</string>
  <key>StandardErrorPath</key>
  <string>${xml(errorPath)}</string>
</dict>
</plist>
`;

const writePlist = (path, value) => {
  writeFileSync(path, value, { mode: 0o600 });
  chmodSync(path, 0o600);
};

const pause = (milliseconds) =>
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);

const launch = (label, path) => {
  const domain = `gui/${process.getuid()}`;
  spawnSync('/bin/launchctl', ['bootout', `${domain}/${label}`], { stdio: 'ignore' });
  pause(250);
  let bootstrap;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    bootstrap = spawnSync('/bin/launchctl', ['bootstrap', domain, path], {
      encoding: 'utf8',
    });
    if (bootstrap.status === 0) break;
    pause(500);
  }
  if (bootstrap.status !== 0)
    throw new Error(
      `Unable to bootstrap ${label}: ${(bootstrap.stderr || bootstrap.stdout).trim()}`,
    );
  const kickstart = spawnSync('/bin/launchctl', ['kickstart', '-k', `${domain}/${label}`], {
    encoding: 'utf8',
  });
  if (kickstart.status !== 0)
    throw new Error(`Unable to start ${label}: ${(kickstart.stderr || kickstart.stdout).trim()}`);
};

const main = () => {
  const email = process.argv[2]?.trim().toLowerCase();
  if (!email || !email.includes('@'))
    throw new TypeError('Usage: node install-macos-services.mjs <access-email> [--load]');
  const shouldLoad = process.argv.includes('--load');
  const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
  const userHome = homedir();
  const configDirectory = join(userHome, 'Library/Application Support/OXE/remote-development');
  const logDirectory = join(userHome, 'Library/Logs/OXE');
  const agentsDirectory = join(userHome, 'Library/LaunchAgents');
  mkdirSync(configDirectory, { recursive: true, mode: 0o700 });
  mkdirSync(logDirectory, { recursive: true, mode: 0o700 });
  mkdirSync(agentsDirectory, { recursive: true });

  const todoEnvironmentPath = join(configDirectory, 'todo-dev.environment.json');
  const legacyTodoEnvironmentPath = join(configDirectory, 'todo-preview.environment.json');
  const workspaceEnvironmentPath = join(configDirectory, 'workspace-dev.environment.json');
  const gatewayConfigPath = join(configDirectory, 'gateway-routes.json');
  const existingTodo =
    readPrivateJson(todoEnvironmentPath) ?? readPrivateJson(legacyTodoEnvironmentPath);
  const existingWorkspace = readPrivateJson(workspaceEnvironmentPath);
  const operationsToken =
    (typeof existingTodo?.OXE_DEVELOPMENT_OPERATIONS_TOKEN === 'string' &&
      existingTodo.OXE_DEVELOPMENT_OPERATIONS_TOKEN) ||
    (typeof existingWorkspace?.OXE_DEVELOPMENT_OPERATIONS_TOKEN === 'string' &&
      existingWorkspace.OXE_DEVELOPMENT_OPERATIONS_TOKEN) ||
    randomSecret();

  writePrivateJson(todoEnvironmentPath, {
    BETTER_AUTH_SECRET:
      (typeof existingTodo?.BETTER_AUTH_SECRET === 'string' && existingTodo.BETTER_AUTH_SECRET) ||
      randomSecret(),
    BETTER_AUTH_URL: 'https://oxe-dev.finnternet.com',
    DATABASE_URL: 'postgres://localhost/oxe_todo_dev',
    HOST: '127.0.0.1',
    NODE_ENV: 'production',
    OXE_ALLOWED_ORIGINS: 'https://oxe-dev.finnternet.com,http://127.0.0.1:3000',
    OXE_DEVELOPMENT_PARENT_ORIGIN: 'https://oxe-dev.finnternet.com',
    OXE_DEVELOPMENT_OPERATIONS_TOKEN: operationsToken,
    OXE_PUBLIC_BASE_PATH: '/__app',
    PORT: '3000',
  });
  writePrivateJson(workspaceEnvironmentPath, {
    ...(typeof existingWorkspace?.OPENAI_API_KEY === 'string'
      ? { OPENAI_API_KEY: existingWorkspace.OPENAI_API_KEY }
      : {}),
    ...(typeof existingWorkspace?.OXE_AGENT_BEARER_TOKEN === 'string'
      ? { OXE_AGENT_BEARER_TOKEN: existingWorkspace.OXE_AGENT_BEARER_TOKEN }
      : {}),
    ...(typeof existingWorkspace?.OXE_AGENT_ENDPOINT === 'string'
      ? { OXE_AGENT_ENDPOINT: existingWorkspace.OXE_AGENT_ENDPOINT }
      : {}),
    OXE_DEVELOPMENT_OPERATIONS_TOKEN: operationsToken,
    OXE_APPLICATION_URL: 'http://127.0.0.1:3000',
    OXE_WORKSPACE_ALLOWED_EMAILS: email,
    OXE_WORKSPACE_ALLOWED_ORIGINS: 'https://oxe-dev.finnternet.com',
    OXE_WORKSPACE_DB: join(configDirectory, 'workspace.sqlite'),
    OXE_WORKSPACE_PORT: '4175',
    ...(typeof existingWorkspace?.OXE_OPENAI_MODEL === 'string'
      ? { OXE_OPENAI_MODEL: existingWorkspace.OXE_OPENAI_MODEL }
      : {}),
  });
  writePrivateJson(gatewayConfigPath, {
    host: '127.0.0.1',
    port: 8080,
    routes: {
      'oxe-dev.finnternet.com': 'http://127.0.0.1:4175',
    },
  });

  if (shouldLoad) {
    const domain = `gui/${process.getuid()}`;
    spawnSync('/bin/launchctl', ['bootout', `${domain}/${legacyPreviewLabel}`], {
      stdio: 'ignore',
    });
    const legacyPlist = join(agentsDirectory, `${legacyPreviewLabel}.plist`);
    if (existsSync(legacyPlist)) unlinkSync(legacyPlist);
    if (existsSync(legacyTodoEnvironmentPath)) unlinkSync(legacyTodoEnvironmentPath);
  }

  const runner = join(repository, 'tools/remote/run-service.mjs');
  const gateway = join(repository, 'tools/remote/dev-gateway.mjs');
  const node = process.execPath;
  const definitions = [
    {
      arguments: [node, gateway, gatewayConfigPath],
      label: labels.gateway,
      name: 'gateway',
    },
    {
      arguments: [
        node,
        runner,
        todoEnvironmentPath,
        node,
        join(repository, 'apps/todo/dist/server.js'),
      ],
      label: labels.application,
      name: 'application',
    },
    {
      arguments: [
        node,
        runner,
        workspaceEnvironmentPath,
        node,
        join(repository, 'apps/workspace/dist/server.js'),
      ],
      label: labels.workspace,
      name: 'workspace',
    },
  ];
  const installedDefinitions = definitions.map((definition) => {
    const path = join(agentsDirectory, `${definition.label}.plist`);
    writePlist(
      path,
      plist({
        arguments: definition.arguments,
        errorPath: join(logDirectory, `${definition.name}.error.log`),
        label: definition.label,
        outputPath: join(logDirectory, `${definition.name}.log`),
        workingDirectory: repository,
      }),
    );
    return { ...definition, path };
  });
  for (const definition of installedDefinitions) {
    if (shouldLoad) launch(definition.label, definition.path);
    process.stdout.write(
      `${shouldLoad ? 'Installed and started' : 'Installed'} ${definition.label}\n`,
    );
  }
  process.stdout.write(`Private configuration: ${configDirectory}\n`);
  process.stdout.write(`Service logs: ${logDirectory}\n`);
};

try {
  main();
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
}
