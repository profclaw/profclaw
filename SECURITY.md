# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| 2.x     | Yes       |
| 1.x     | Security fixes only |
| < 1.0   | No        |

## Reporting a Vulnerability

**Do not open a public issue for security vulnerabilities.**

Instead, please report security issues via:

1. **GitHub Security Advisories**: [Report a vulnerability](https://github.com/profclaw/profclaw/security/advisories/new)
2. **Email**: security@profclaw.ai

### What to Include

- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

### Response Timeline

- **Acknowledgment**: Within 48 hours
- **Assessment**: Within 1 week
- **Fix**: Depends on severity (critical: 72 hours, high: 1 week, medium: 2 weeks)

## Security Model

profClaw is designed to run locally on user-owned hardware. The security model assumes:

### Trust Boundaries

- **Trusted**: The machine operator and configured admin users
- **Semi-trusted**: Chat channel users (controlled via allowlists and DM pairing)
- **Untrusted**: External webhook payloads, user-provided code in sandbox

### Key Security Features

- **Webhook signature verification**: HMAC-SHA256 for all incoming webhooks
- **API token scoping**: Tokens are prefixed (`profclaw_`) and scoped
- **Sandbox execution**: Agent code runs in isolated environments
- **Rate limiting**: Configurable per-endpoint and per-user
- **No secrets in code**: All sensitive values via environment variables

### What We Do NOT Protect Against

- A malicious machine operator (they have full access)
- Side-channel attacks on the host machine
- Vulnerabilities in upstream dependencies (report to those projects)

## Responsible Disclosure

We follow coordinated disclosure. We ask that you:

1. Give us reasonable time to fix the issue before public disclosure
2. Do not exploit the vulnerability beyond what is needed to demonstrate it
3. Do not access or modify other users' data

We will credit reporters in the security advisory (unless you prefer anonymity).
