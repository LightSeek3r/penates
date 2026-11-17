# Security policy

## Reporting a vulnerability

Please **do not open a public issue** for a security or privacy problem. Report it privately in either way:

- GitHub: the **Security** tab of this repository, then **Report a vulnerability**
  (private vulnerability reporting).
- Email: [n.opal@unit42.fr](mailto:n.opal@unit42.fr?subject=Penates%20security%20report), the address
  behind the app's own legal notice.

Include what you found, how to reproduce it, and which page or endpoint is affected. I will acknowledge a
report within a few days and tell you what I plan to do about it. This is a one-person project, so these
are best-effort timelines, not guarantees.

## Scope

In scope: the web app and its service worker, the Pages Functions (`/api/event`, `/api/admin/*`, including
the Cloudflare Access check and the privacy switch), the security headers and CSP, the data pipeline, and
the GitHub workflows.

A privacy problem counts too: anything that would let an individual sale, address or person be identified
from the tiles or the pages, or that records more than the anonymous daily counters, is a vulnerability.

Out of scope: the third-party services and data the app depends on (the open data sources, OpenFreeMap,
Cloudflare, GitHub). Please report those to their owners.

## Supported versions

Only the latest release and the current `main` branch are supported.

## What the repository contains

No secrets. The Cloudflare and R2 credentials used to publish are GitHub Actions secrets, and the admin
endpoints are protected by Cloudflare Access, configured outside the repository. If you ever find a
credential in this repository or its history, that is a vulnerability: please report it as above.
