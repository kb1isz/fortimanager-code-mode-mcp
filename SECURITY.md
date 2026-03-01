# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| 0.x.x   | Yes       |

## Reporting a Vulnerability

If you discover a security vulnerability in this project, please report it responsibly.

**Do NOT open a public GitHub issue for security vulnerabilities.**

Instead, please email the maintainer directly or use GitHub's private vulnerability reporting feature:

1. Go to the repository's **Security** tab
2. Click **Report a vulnerability**
3. Provide a detailed description of the issue

### What to Include

- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

### Response Timeline

- **Acknowledgment**: Within 48 hours
- **Initial assessment**: Within 1 week
- **Fix or mitigation**: Dependent on severity, typically within 2 weeks for critical issues

## Security Considerations

This project runs agent-generated code in a sandboxed environment. Key security measures:

- **QuickJS WASM sandbox**: All untrusted code runs in an isolated WASM environment with memory (64 MB) and CPU (30s) limits
- **No host access**: Sandbox code cannot access `process`, `require`, `fs`, `net`, or any Node.js APIs
- **No eval in host**: The host Node.js process never executes `eval()` or `new Function()` with untrusted input
- **Fresh contexts**: Each execution creates a new sandbox context; no state persists between invocations
- **TLS verification**: Enabled by default for FortiManager connections
- **Token-based auth**: API tokens via `Authorization: Bearer` header; no passwords stored
- **Input validation**: All environment variables and API inputs validated with Zod schemas
