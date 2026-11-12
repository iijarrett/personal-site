"""Check the response headers and security.txt the build ships, and the live site's.

Reads dist/_headers (the file Cloudflare serves headers from) and dist/.well-known/security.txt
and fails on anything that weakens the policy. With --url it also requests the deployed site
and holds the headers it really sends to the same rules.

Usage: python scripts/check_headers.py [dist] [--url https://jarrettd.com]
       With only --url, the build output is not read.
Exit status: 0 clean, 1 a check failed, 2 the build output is missing or the site is unreachable.

Cloudflare's rules for _headers: a path line starts in column 0, a header line is indented,
`# ` starts a comment, `! Name` removes a header an earlier rule set, a header set by several
rules is joined, not replaced, at most 100 rules and 2,000 characters a line.
"""

from __future__ import annotations

import argparse
import http.client
import re
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Callable, Optional
from urllib.parse import urlsplit

USER_AGENT = "check_headers.py (header check for jarrettd.com)"
TIMEOUT = 15.0
MAX_BODY = 2_000_000
LOOPBACK = {"localhost", "127.0.0.1", "::1"}
MISSING_PAGE = "/check-headers-no-such-page/"
MAX_RULES = 100
MAX_LINE = 2_000
HSTS_MIN_AGE = 31_536_000  # one year: the minimum for the preload list
IMMUTABLE_MIN_AGE = 31_536_000
EXPIRY_WARN = timedelta(days=30)
EXPIRY_MAX = timedelta(days=366)  # RFC 9116: Expires should be less than a year away

# Directive -> the exact sources it must have. Nothing else may be added to these.
CSP_EXACT = {
    "default-src": ["'none'"],
    "script-src": ["'self'"],
    "style-src": ["'self'"],
    "img-src": ["'self'"],
    "font-src": ["'self'"],
    "connect-src": ["'self'"],
    "base-uri": ["'none'"],
    "form-action": ["'none'"],
    "frame-ancestors": ["'none'"],
    "require-trusted-types-for": ["'script'"],
}
CSP_FLAGS = ["upgrade-insecure-requests"]
# Never allowed in any directive, including ones not listed above.
CSP_FORBIDDEN = ["'unsafe-inline'", "'unsafe-eval'", "'unsafe-hashes'", "'wasm-unsafe-eval'", "'strict-dynamic'", "*", "data:", "blob:", "http:", "https:", "ws:", "wss:"]

# Header -> a test of its value, and what to say when it fails.
SIMPLE = {
    "x-content-type-options": (lambda v: v.lower() == "nosniff", "must be nosniff"),
    "x-frame-options": (lambda v: v.upper() == "DENY", "must be DENY"),
    "referrer-policy": (lambda v: v.lower() == "no-referrer", "must be no-referrer"),
    "cross-origin-opener-policy": (lambda v: v.lower() == "same-origin", "must be same-origin"),
    "cross-origin-resource-policy": (lambda v: v.lower() == "same-origin", "must be same-origin"),
}
PERMISSIONS_DENIED = ["camera", "microphone", "geolocation", "payment", "usb"]

Rule = tuple[str, list[tuple[str, Optional[str]]]]  # path pattern, [(header, value), ...]; None = detach


def parse_headers(text: str) -> tuple[list[Rule], list[str]]:
    """Return the rules in file order and any problems with the file's shape."""
    rules: list[Rule] = []
    problems: list[str] = []
    for number, raw in enumerate(text.splitlines(), 1):
        if len(raw) > MAX_LINE:
            problems.append(f"line {number} is {len(raw):,} characters, over Cloudflare's {MAX_LINE:,}")
        if not raw.strip() or raw.lstrip().startswith("#"):
            continue
        if not raw[0].isspace():
            rules.append((raw.strip(), []))
            continue
        if not rules:
            problems.append(f"line {number}: a header comes before any path")
            continue
        line = raw.strip()
        if line.startswith("!"):
            rules[-1][1].append((line[1:].strip().lower(), None))
        elif ":" in line:
            name, value = line.split(":", 1)
            rules[-1][1].append((name.strip().lower(), value.strip()))
        else:
            problems.append(f"line {number}: {line!r} is not 'Name: value'")
    if len(rules) > MAX_RULES:
        problems.append(f"{len(rules)} rules, over Cloudflare's {MAX_RULES}")
    return rules, problems


def values(rule: Rule, name: str) -> list[str]:
    return [v for n, v in rule[1] if n == name and v is not None]


def check_csp(policy: str) -> list[str]:
    problems: list[str] = []
    directives: dict[str, list[str]] = {}
    for part in policy.split(";"):
        tokens = part.split()
        if not tokens:
            continue
        name = tokens[0].lower()
        if name in directives:
            problems.append(f"Content-Security-Policy repeats {name} (browsers keep only the first)")
            continue
        directives[name] = tokens[1:]
    for name, wanted in CSP_EXACT.items():
        got = directives.get(name)
        if got is None:
            problems.append(f"Content-Security-Policy has no {name}")
        elif sorted(got) != sorted(wanted):
            problems.append(f"Content-Security-Policy {name} is {' '.join(got) or '(empty)'}, expected {' '.join(wanted)}")
    for flag in CSP_FLAGS:
        if flag not in directives:
            problems.append(f"Content-Security-Policy has no {flag}")
    for name, sources in directives.items():
        for source in sources:
            if source.lower() in CSP_FORBIDDEN:
                problems.append(f"Content-Security-Policy {name} allows {source}")
    return problems


def check_hsts(value: str) -> list[str]:
    problems: list[str] = []
    match = re.search(r"max-age=(\d+)", value, re.IGNORECASE)
    if not match or int(match.group(1)) < HSTS_MIN_AGE:
        problems.append(f"Strict-Transport-Security max-age must be at least {HSTS_MIN_AGE:,} seconds")
    tokens = {t.strip().lower() for t in value.split(";")}
    for token in ("includesubdomains", "preload"):
        if token not in tokens:
            problems.append(f"Strict-Transport-Security is missing {token}")
    return problems


def check_permissions(value: str) -> list[str]:
    problems: list[str] = []
    for feature in PERMISSIONS_DENIED:
        if not re.search(rf"(^|,)\s*{feature}=\(\)\s*(,|$)", value):
            problems.append(f"Permissions-Policy does not turn off {feature} (expected {feature}=())")
    return problems


def check_cache(value: str, need_immutable: bool) -> list[str]:
    lowered = value.lower()
    if need_immutable:
        match = re.search(r"max-age=(\d+)", lowered)
        if "immutable" not in lowered or not match or int(match.group(1)) < IMMUTABLE_MIN_AGE:
            return ["Cache-Control must be max-age of a year or more with immutable"]
        return []
    if "no-cache" not in lowered and "max-age=0" not in lowered:
        return ["Cache-Control must be no-cache"]
    return []


def check_headers(dist: Path) -> tuple[list[tuple[str, str]], int]:
    failures: list[tuple[str, str]] = []
    name = "_headers"
    path = dist / name
    if not path.is_file():
        return [(name, "missing: the build must ship its response headers")], 0
    rules, problems = parse_headers(path.read_text(encoding="utf-8"))
    failures.extend((name, p) for p in problems)

    catch_all = [rule for rule in rules if rule[0] == "/*"]
    if len(catch_all) != 1:
        failures.append((name, f"expected exactly one /* rule, found {len(catch_all)}"))
        return failures, len(rules)
    block = catch_all[0]

    for header, (test, message) in SIMPLE.items():
        found = values(block, header)
        if len(found) != 1:
            failures.append((name, f"/* needs exactly one {header} header, found {len(found)}"))
        elif not test(found[0]):
            failures.append((name, f"{header} {message}, found {found[0]!r}"))

    for header, check in (
        ("content-security-policy", check_csp),
        ("strict-transport-security", check_hsts),
        ("permissions-policy", check_permissions),
    ):
        found = values(block, header)
        if len(found) != 1:
            failures.append((name, f"/* needs exactly one {header} header, found {len(found)}"))
        else:
            failures.extend((name, p) for p in check(found[0]))

    # A header on /* is joined with the ones on every longer path, so caching set there could not
    # be overridden for hashed files.
    if values(block, "cache-control"):
        failures.append((name, "/* must not set Cache-Control: Cloudflare would join it onto every path"))
    for rule in rules:
        if rule[0] != "/*" and any(n == "content-security-policy" for n, _ in rule[1]):
            failures.append((name, f"{rule[0]} sets its own Content-Security-Policy; Cloudflare would join it with the one on /*"))

    # Caching, and every named path must exist, so a renamed file cannot leave a dead rule behind.
    cache: dict[str, list[str]] = {}
    for rule in rules:
        if rule[0] != "/*":
            cache.setdefault(rule[0], []).extend(values(rule, "cache-control"))
    for pattern, immutable in (("/_astro/*", True), ("/theme-init.js", False), ("/.well-known/security.txt", False)):
        found = cache.get(pattern)
        if not found:
            failures.append((name, f"no Cache-Control rule for {pattern}"))
        else:
            failures.extend((name, f"{pattern}: {p}") for p in check_cache(found[-1], immutable))
    for rule in rules:
        pattern = rule[0]
        if pattern == "/*":
            continue
        target = dist / pattern.lstrip("/")
        exists = target.parent.is_dir() if pattern.endswith("/*") else target.is_file()
        if not exists:
            failures.append((name, f"{pattern} matches nothing in the build"))
    return failures, len(rules)


def check_security_txt(dist: Path, now: datetime) -> tuple[list[tuple[str, str]], list[tuple[str, str]]]:
    name = ".well-known/security.txt"
    path = dist / name
    if not path.is_file():
        return [(name, "missing (RFC 9116)")], []
    return parse_security_txt(path.read_text(encoding="utf-8"), name, now)


def parse_security_txt(text: str, name: str, now: datetime) -> tuple[list[tuple[str, str]], list[tuple[str, str]]]:
    failures: list[tuple[str, str]] = []
    warnings: list[tuple[str, str]] = []
    fields: dict[str, list[str]] = {}
    for line in text.splitlines():
        if line.strip() and not line.startswith("#") and ":" in line:
            key, value = line.split(":", 1)
            fields.setdefault(key.strip().lower(), []).append(value.strip())

    contacts = fields.get("contact", [])
    if not contacts:
        failures.append((name, "no Contact field"))
    for contact in contacts:
        if not re.match(r"(mailto:[^@\s]+@[^@\s]+|https://\S+|tel:\+?[0-9-]+)$", contact):
            failures.append((name, f"Contact {contact!r} must be a mailto:, https: or tel: URI"))

    expires = fields.get("expires", [])
    if len(expires) != 1:
        failures.append((name, f"needs exactly one Expires field, found {len(expires)}"))
    else:
        try:
            when = datetime.fromisoformat(expires[0].replace("Z", "+00:00"))
            if when.tzinfo is None:
                raise ValueError("no time zone")
        except ValueError:
            failures.append((name, f"Expires {expires[0]!r} is not an ISO 8601 date with a time zone"))
        else:
            if when <= now:
                failures.append((name, f"expired on {when:%Y-%m-%d}: renew it"))
            elif when - now < EXPIRY_WARN:
                warnings.append((name, f"expires on {when:%Y-%m-%d}: renew it soon"))
            elif when - now > EXPIRY_MAX:
                warnings.append((name, f"Expires is more than a year away ({when:%Y-%m-%d}); RFC 9116 asks for less"))

    for canonical in fields.get("canonical", []):
        if not re.match(r"https://\S+/\.well-known/security\.txt$", canonical):
            failures.append((name, f"Canonical {canonical!r} must be an https URL ending /.well-known/security.txt"))
    return failures, warnings


def check_response_headers(headers: dict[str, str]) -> list[str]:
    """Hold the headers of one live response (lower-case names, repeats already joined) to the policy."""
    problems: list[str] = []
    for header, (test, message) in SIMPLE.items():
        got = headers.get(header)
        if got is None:
            problems.append(f"{header} is missing")
        elif not test(got):
            problems.append(f"{header} {message}, found {got!r}")
    for header, check in (
        ("content-security-policy", check_csp),
        ("strict-transport-security", check_hsts),
        ("permissions-policy", check_permissions),
    ):
        got = headers.get(header)
        if got is None:
            problems.append(f"{header} is missing")
        else:
            problems.extend(check(got))
    return problems


def check_http_redirect(status: int, location: Optional[str]) -> list[str]:
    """Plain http must send visitors to https, never serve the page."""
    if status in (301, 302, 307, 308) and location and location.lower().startswith("https://"):
        return []
    if status in (301, 302, 307, 308):
        return [f"http redirects to {location or 'nowhere'}, which is not https"]
    return [f"http answers {status} instead of redirecting to https"]


def validate_url(url: str) -> Optional[str]:
    """Why the URL cannot be checked, or None. Only loopback may use plain http."""
    parts = urlsplit(url)
    if parts.scheme not in ("http", "https") or not parts.hostname:
        return f"{url!r} is not an http(s) URL"
    if parts.scheme == "http" and parts.hostname not in LOOPBACK:
        return "the live check needs an https URL (http is only allowed for localhost)"
    return None


Fetch = Callable[[str], tuple[int, dict[str, str], bytes]]


def fetch(url: str) -> tuple[int, dict[str, str], bytes]:
    """GET one URL without following redirects: status, lower-case headers, the start of the body."""
    parts = urlsplit(url)
    connection_class = http.client.HTTPSConnection if parts.scheme == "https" else http.client.HTTPConnection
    connection = connection_class(parts.hostname, parts.port, timeout=TIMEOUT)
    try:
        target = (parts.path or "/") + (f"?{parts.query}" if parts.query else "")
        connection.request("GET", target, headers={"User-Agent": USER_AGENT, "Accept-Encoding": "identity"})
        response = connection.getresponse()
        body = response.read(MAX_BODY)
        headers = {name.lower(): response.getheader(name) or "" for name, _ in response.getheaders()}
        return response.status, headers, body
    finally:
        connection.close()


def check_live(base: str, get: Fetch, now: datetime) -> tuple[list[tuple[str, str]], list[tuple[str, str]], int]:
    """Request the deployed site and check what it sends. Raises OSError if the site is unreachable."""
    base = base.rstrip("/")
    failures: list[tuple[str, str]] = []
    warnings: list[tuple[str, str]] = []
    probes = 0

    def probe(path: str, expect: int) -> tuple[dict[str, str], bytes]:
        nonlocal probes
        probes += 1
        status, headers, body = get(base + path)
        label = f"live {path}"
        if status != expect:
            failures.append((label, f"status {status}, expected {expect}"))
        failures.extend((label, p) for p in check_response_headers(headers))
        return headers, body

    def cache(label: str, headers: dict[str, str], immutable: bool) -> None:
        value = headers.get("cache-control")
        if value is None:
            failures.append((label, "Cache-Control is missing"))
        else:
            failures.extend((label, p) for p in check_cache(value, immutable))

    _, home = probe("/", 200)
    probe("/about/", 200)
    probe(MISSING_PAGE, 404)

    asset = re.search(rb"/_astro/[\w./-]+\.(?:css|js)", home)
    if asset:
        headers, _ = probe(asset.group(0).decode(), 200)
        cache(f"live {asset.group(0).decode()}", headers, True)
    else:
        failures.append(("live /", "the home page links no /_astro/ file, so the asset caching could not be checked"))

    headers, _ = probe("/theme-init.js", 200)
    cache("live /theme-init.js", headers, False)

    txt_label = "live /.well-known/security.txt"
    headers, body = probe("/.well-known/security.txt", 200)
    cache(txt_label, headers, False)
    if not headers.get("content-type", "").lower().startswith("text/plain"):
        failures.append((txt_label, f"Content-Type must be text/plain, found {headers.get('content-type')!r}"))
    txt_failures, txt_warnings = parse_security_txt(body.decode("utf-8", "replace"), txt_label, now)
    failures.extend(txt_failures)
    warnings.extend(txt_warnings)

    parts = urlsplit(base)
    if parts.scheme == "https" and parts.port in (None, 443):
        probes += 1
        try:
            status, headers, _ = get(f"http://{parts.hostname}/")
        except OSError:
            pass  # nothing listens on port 80, which is fine
        else:
            failures.extend(("live http://", p) for p in check_http_redirect(status, headers.get("location")))
    return failures, warnings, probes


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("dist", nargs="?", default=None, type=Path, help="build output (default: dist, unless only --url is given)")
    parser.add_argument("--url", help="also check this deployed site, e.g. https://jarrettd.com")
    args = parser.parse_args()

    if args.url:
        problem = validate_url(args.url)
        if problem:
            print(f"error: {problem}.", file=sys.stderr)
            return 2

    failures: list[tuple[str, str]] = []
    warnings: list[tuple[str, str]] = []
    if args.dist is not None or not args.url:
        dist = args.dist or Path("dist")
        if not dist.is_dir():
            print(f"error: {dist} not found. Run the build first.", file=sys.stderr)
            return 2
        dist = dist.resolve()
        failures, rule_count = check_headers(dist)
        txt_failures, warnings = check_security_txt(dist, datetime.now(timezone.utc))
        failures.extend(txt_failures)
        print(f"_headers:   {rule_count} rule(s), limit {MAX_RULES}")

    if args.url:
        try:
            live_failures, live_warnings, probes = check_live(args.url, fetch, datetime.now(timezone.utc))
        except OSError as error:
            print(f"error: cannot reach {args.url}: {error}", file=sys.stderr)
            return 2
        failures.extend(live_failures)
        warnings.extend(live_warnings)
        print(f"live:       {probes} request(s) to {args.url}")

    for name, message in warnings:
        print(f"WARN {name}: {message}")
    for name, message in failures:
        print(f"FAIL {name}: {message}")
    print(f"headers checked: {len(failures)} failure(s), {len(warnings)} warning(s)")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
