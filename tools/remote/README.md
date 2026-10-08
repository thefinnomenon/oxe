# Remote development services

The Mini uses one loopback-only gateway for Cloudflare Tunnel traffic and one
LaunchAgent per long-running development service. The gateway accepts only exact
hostnames from its private route file and may proxy only to explicit loopback
HTTP origins. Unknown hostnames receive a 404 response.

For the current OXE setup:

- `oxe-dev.finnternet.com` routes to the OXE workspace on `127.0.0.1:4175`.
- The workspace mounts TinyTodo from `127.0.0.1:3000` at `/__app` on that same
  development origin.
- `oxe.finnternet.com` remains unassigned for a future production deployment.

Build TinyTodo and the workspace before installing. Then run the macOS installer
with the email allowed by the Cloudflare Access policies:

```sh
node tools/remote/install-macos-services.mjs you@example.com --load
```

The installer is idempotent. It preserves the Better Auth and runtime-operations
secrets across runs, stores environment files under
`~/Library/Application Support/OXE/remote-development` with mode `0600`, and
installs three user agents under `~/Library/LaunchAgents`. The Cloudflare system
daemon is not modified.

Service logs are written under `~/Library/Logs/OXE`. Inspect service state with:

```sh
launchctl print gui/$(id -u)/com.finnternet.dev-gateway
launchctl print gui/$(id -u)/com.finnternet.oxe-app-dev
launchctl print gui/$(id -u)/com.finnternet.oxe-dev
```
