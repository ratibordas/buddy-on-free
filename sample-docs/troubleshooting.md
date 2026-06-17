# Troubleshooting

## Build fails with "module not found"

This usually means a dependency is missing from your lockfile. Make sure
`package-lock.json` (or `pnpm-lock.yaml`) is committed and up to date. Acme Cloud
installs dependencies in a clean environment, so anything not in the lockfile
will not be available.

## Deployment is stuck in "Queued"

Deployments queue when your team has reached its concurrent build limit. The
Free tier allows 1 concurrent build; paid tiers allow more. Wait for the current
build to finish, or upgrade your plan under **Settings → Billing**.

## 502 Bad Gateway after deploy

A 502 after a successful build usually means your app did not start listening on
the expected port. Acme Cloud injects the `PORT` environment variable — your app
must listen on `process.env.PORT`, not a hard-coded port.

## Environment variables not applied

Environment variables are read at build and boot time. After changing a variable
you must **redeploy** for it to take effect; existing running deployments keep
their old values.
