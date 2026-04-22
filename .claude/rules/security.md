# Security Guidelines

This document defines the minimum security standards for this repository. These rules are not optional—violations should block merges.

---

## Core Principles

* Assume **all inputs are untrusted**.
* Minimize attack surface.
* Fail securely (deny by default).
* Secrets must never be exposed—ever.

---

## Secrets Management

* Never commit secrets to the repository.
* Use environment variables for all sensitive values:

  * API keys
  * Database credentials
  * Tokens

### Required Practices

* `.env` is for local development only (must be gitignored)
* Provide `.env.example` with placeholders
* Use strong, random values for secrets

### Prohibited

* Hardcoding secrets in code
* Storing secrets in JSON files under `/data`
* Logging secrets

---

## Authentication & Authorization

* Always validate identity before granting access
* Use token-based authentication where possible
* Enforce least privilege access

### Rules

* Never trust client-provided roles/permissions
* Validate tokens on every request
* Expire tokens when possible

---

## Input Validation

* Validate ALL external input:

  * API requests
  * Query params
  * JSON payloads
  * File inputs

### Guidelines

* Use strict schemas (e.g. pydantic)
* Reject unexpected fields
* Sanitize user input before processing

---

## Output Handling

* Never expose internal errors directly to users
* Mask sensitive data in responses

Example:

```python
try:
    ...
except Exception:
    return {"error": "Internal server error"}
```

---

## Logging

* Use structured logging
* Never log:

  * Passwords
  * Tokens
  * Full request bodies (if sensitive)

### Recommended

* Log request IDs for traceability
* Use log levels appropriately

---

## Dependency Security

* Pin dependency versions
* Regularly update dependencies
* Scan for vulnerabilities (recommended tools):

  * pip-audit
  * safety

---

## Docker Security

### Image

* Use minimal base images (e.g. `python:slim`)
* Avoid running as root

```Dockerfile
RUN useradd -m appuser
USER appuser
```

### Runtime

* Read-only filesystem where possible
* Limit container privileges
* Do not expose unnecessary ports

---

## Data Security

### SQLite

* Store database in `/data`
* Restrict file permissions
* Do not expose DB file over network

### JSON Files

* Treat JSON files as sensitive if they contain user data
* Validate schema before reading

---

## Network Security

* Use HTTPS for all external communication
* Validate SSL certificates
* Avoid calling untrusted endpoints

---

## Rate Limiting & Abuse Protection

* Implement rate limiting on APIs
* Detect and block abusive patterns

---

## Error Handling

* Do not leak stack traces
* Log full errors internally only

---

## Backup & Recovery

* Regularly back up `/data`
* Test restore procedures
* Encrypt backups if they contain sensitive data

---

## Security Reviews

* All PRs must be reviewed for security impact
* High-risk changes require explicit approval

---

## Incident Response

If a security issue is detected:

1. Contain the issue immediately
2. Rotate affected secrets
3. Identify root cause
4. Patch and deploy fix
5. Document the incident

---

## Final Notes

* Security is not a one-time task—it is continuous
* If something feels unsafe, it probably is
* When in doubt, choose the more restrictive option
