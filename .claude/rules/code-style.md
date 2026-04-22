# Code Style Guide

This repository primarily uses **Python** and **Docker**. The goal of this guide is to ensure consistency, readability, and maintainability across all contributions.

---

## General Principles

* Prefer **clarity over cleverness**.
* Write code for humans first, machines second.
* Keep things **simple, explicit, and predictable**.
* Avoid premature optimization.

---

## Repository Structure

```
.
├── app/                # Main application code
│   ├── __init__.py
│   ├── main.py
│   └── modules/
├── tests/              # Unit and integration tests
├── docker/             # Docker-related files
│   ├── Dockerfile
│   └── docker-compose.yml
├── scripts/            # Utility scripts (CLI tools, migrations, etc.)
├── .env.example        # Example environment variables
├── requirements.txt    # Python dependencies
└── README.md
```

---

## Python Style Guide

### Formatting

* Follow **PEP 8**.
* Use **4 spaces** for indentation.
* Maximum line length: **100 characters**.
* Use **black** for formatting.
* Use **isort** for import sorting.

### Imports

Order imports as:

1. Standard library
2. Third-party libraries
3. Local modules

Example:

```python
import os
import sys

import requests

from app.modules.user import UserService
```

---

### Naming Conventions

| Type            | Convention          | Example         |
| --------------- | ------------------- | --------------- |
| Variables       | snake_case          | user_id         |
| Functions       | snake_case          | get_user_data   |
| Classes         | PascalCase          | UserService     |
| Constants       | UPPER_CASE          | MAX_RETRIES     |
| Private members | _leading_underscore | _internal_cache |

---

### Functions & Methods

* Keep functions **small and focused**.
* Prefer functions under **50 lines**.
* Avoid deep nesting (max 3 levels).
* Use **type hints**.

Example:

```python
def fetch_user(user_id: int) -> dict:
    """Fetch user data from API."""
    ...
```

---

### Type Hints

* Always use type hints for public functions.
* Prefer built-in types (`list`, `dict`) over `typing.List` where possible.

---

### Error Handling

* Do not silently ignore exceptions.
* Catch **specific exceptions**, not generic ones.

```python
try:
    result = risky_operation()
except ValueError as e:
    logger.error("Invalid value", exc_info=e)
```

---

### Logging

* Use the `logging` module, not `print`.
* Use appropriate levels: DEBUG, INFO, WARNING, ERROR.

---

### Configuration

* Use environment variables.
* Never hardcode secrets.
* Use `.env` files for local development.

---

## Data Storage Guidelines

This project uses **SQLite** and **JSON files** for persistence. These are simple but require strict conventions to avoid data corruption and deployment issues.

### Directory Structure

All persistent data MUST live under a single directory:

```
/data/
├── app.db
├── json/
│   ├── users.json
│   └── config.json
```

* Never store data inside `/app` or code directories.
* `/data` must be treated as the only source of truth for runtime state.

---

### SQLite Guidelines

* Database file location: `/data/app.db`
* Use a **single connection manager** per process.
* Prefer lightweight abstractions (e.g. `sqlite3`, or minimal ORM if needed).
* Always enable WAL mode for better concurrency:

```python
conn.execute("PRAGMA journal_mode=WAL;")
```

* Avoid long-running transactions.
* Avoid concurrent writes from multiple threads/processes when possible.

---

### JSON Storage Guidelines

* Store all JSON files under `/data/json/`
* Use consistent schema per file (define structure in code or docs)
* Never mix unrelated data in the same file

#### Safe Write Pattern

Always write JSON atomically to prevent corruption:

```python
import json
import tempfile
import os


def write_json_atomic(path: str, data: dict):
    dir_name = os.path.dirname(path)
    with tempfile.NamedTemporaryFile("w", dir=dir_name, delete=False) as tmp:
        json.dump(data, tmp)
        tmp.flush()
        os.fsync(tmp.fileno())
    os.replace(tmp.name, path)
```

* Never write directly to the target file.
* Always use atomic replace.

---

### When to Use SQLite vs JSON

| Use Case                   | Recommended Storage |
| -------------------------- | ------------------- |
| Structured relational data | SQLite              |
| Simple config/state        | JSON                |
| Frequent queries/filtering | SQLite              |
| Append-only logs           | JSON (or logs)      |

---

## Docker Guidelines

### Dockerfile

* Use **official base images**.
* Prefer **slim/alpine** variants when possible.
* Minimize layers.
* Use `.dockerignore`.

Example:

```Dockerfile
FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

CMD ["python", "-m", "app.main"]
```

---

### docker-compose

* Use `docker-compose` for local development.
* Keep services modular.
* Use named volumes for persistence.

Example:

```yaml
version: '3.9'

services:
  app:
    build: .
    ports:
      - "8000:8000"
    env_file:
      - .env
    depends_on:
      - db

  db:
    image: postgres:15
    volumes:
      - db_data:/var/lib/postgresql/data

volumes:
  db_data:
```

---

### Environment Variables

* Define all variables in `.env.example`.
* Do not commit real `.env` files.

---

## Testing

* Use **pytest**.
* Tests must be deterministic and isolated.
* Name test files as `test_*.py`.

Example:

```python
def test_fetch_user():
    assert fetch_user(1)["id"] == 1
```

---

## Git Workflow

### Branch Naming

* feature/<name>
* fix/<name>
* chore/<name>

### Commits

Follow conventional commits:

```
feat: add user authentication
fix: resolve docker build issue
chore: update dependencies
```

---

## Linting & Tooling

Recommended tools:

* black
* isort
* flake8 or ruff
* mypy (optional but recommended)

---

## Security

* Never commit secrets.
* Regularly update dependencies.
* Validate all external inputs.

---

## Performance

* Avoid unnecessary Docker rebuilds.
* Cache dependencies where possible.
* Profile before optimizing.

---

## Documentation

* Keep README updated.
* Document public APIs.
* Use docstrings consistently.

---

## Final Notes

* Consistency beats personal preference.
* If unsure, follow existing patterns in the codebase.
* When introducing new patterns, document them.
