# Security

This is a fan/demo project for learning Microsoft Fabric + Rayfin. Please don't
file security issues through public GitHub issues.

## Reporting a vulnerability

Open a private security advisory on the repository, or contact the maintainer
directly. Include steps to reproduce, affected files, and impact.

## Notes for this project

- **No secrets in the client bundle.** This app is static-hosted; never embed API
  keys or connection strings. Live data auth is handled by the Fabric host (the
  signed-in user's token via the embed proxy), not by this app.
- **Personal config is gitignored** (`fabric.yaml`, `rayfin/rayfin.yml`,
  `rayfin/.env`, `src/fabric.generated.ts` with real ids). Keep it that way.
- The backend (`fabric-live-api-backend`) holds the OpenSky and Eventstream
  credentials — see its own README for handling guidance.
