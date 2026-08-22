"""Generate Supabase anon + service_role JWTs from JWT_SECRET.

Usage:
    python supabase_local/gen_keys.py "<JWT_SECRET>"

Prints ANON_KEY and SERVICE_ROLE_KEY. Paste them into docker/supabase/.env
and the app .env files. JWTs are valid for 10 years (self-host convention).
"""

import sys
import time

import jwt  # PyJWT

TEN_YEARS = 60 * 60 * 24 * 365 * 10


def make_key(secret: str, role: str) -> str:
    now = int(time.time())
    payload = {"role": role, "iss": "supabase", "iat": now, "exp": now + TEN_YEARS}
    return jwt.encode(payload, secret, algorithm="HS256")


def main() -> None:
    if len(sys.argv) != 2:
        print("usage: python supabase_local/gen_keys.py <JWT_SECRET>", file=sys.stderr)
        raise SystemExit(2)
    secret = sys.argv[1]
    print("ANON_KEY=" + make_key(secret, "anon"))
    print("SERVICE_ROLE_KEY=" + make_key(secret, "service_role"))


if __name__ == "__main__":
    main()
