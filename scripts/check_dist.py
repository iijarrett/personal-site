#!/usr/bin/env python3
"""Post-build checks for dist/. Standard library only.

Fails (exit 1) when the build output breaks a hard rule from CONTRIBUTING.md:

  * an inline <script> or <style>, a style= attribute or an on*= handler
  * forms, iframes, embeds or objects
  * a resource that points off-site (outbound <a href> links are fine, and so is
    <link rel="canonical">), a data: URL on any tag, or a local resource that
    does not exist
  * the home page HTML over 14 KB, or the first load over 100 KB
  * a sitemap that lists the 404 page or a page that was not built, or a built
    page that is missing from the sitemap

Warns (exit code unchanged) when a page still contains the word "placeholder".

Sizes are uncompressed and use decimal kilobytes, which is the stricter reading.
The header check for the deployed site is a separate script (Phase 5).
"""

from __future__ import annotations

import argparse
import re
import sys
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import unquote, urlparse
from xml.etree import ElementTree

HOME_HTML_LIMIT = 14_000
FIRST_LOAD_LIMIT = 100_000

BANNED_TAGS = {"form", "iframe", "frame", "frameset", "embed", "object"}
# Attributes that make the browser fetch something, on any tag.
RESOURCE_ATTRS = {"src", "srcset", "poster", "data", "action", "formaction", "ping"}
# <link rel> values that name a relationship but do not load anything. A rel that
# also contains "stylesheet" still loads one, so "alternate stylesheet" is checked.
NON_LOADING_RELS = {"canonical", "alternate"}
EVENT_HANDLER = re.compile(r"^on[a-z]+$")
PLACEHOLDER = re.compile(r"placeholder", re.IGNORECASE)
CSS_COMMENT = re.compile(r"/\*.*?\*/", re.DOTALL)
CSS_URL = re.compile(r"url\(\s*['\"]?([^'\")\s]+)")
CSS_IMPORT = re.compile(r"@import\s+['\"]?([^'\";)\s]+)")
SITEMAP_NS = "{http://www.sitemaps.org/schemas/sitemap/0.9}"


def is_external(value: str) -> bool:
    return value.strip().lower().startswith(("http://", "https://", "//"))


def srcset_urls(value: str) -> list[str]:
    return [part.split()[0] for part in value.split(",") if part.strip()]


class PageScan(HTMLParser):
    """Collects rule violations, local resource references and visible text."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.problems: list[str] = []
        self.resources: list[str] = []
        self.text: list[str] = []
        self._hidden = 0

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        values = {name.lower(): (value or "") for name, value in attrs}

        if tag == "script":
            self._hidden += 1
            if "src" not in values:
                self.problems.append("inline <script>")
        elif tag == "style":
            self._hidden += 1
            self.problems.append("inline <style>")
        elif tag in BANNED_TAGS:
            self.problems.append(f"<{tag}> is not allowed")

        if tag == "meta" and values.get("name", "").lower() == "description":
            self.text.append(values.get("content", ""))

        for name, value in values.items():
            if name == "style":
                self.problems.append(f"style= attribute on <{tag}>")
            elif EVENT_HANDLER.match(name):
                self.problems.append(f"{name}= handler on <{tag}>")
            elif name in RESOURCE_ATTRS:
                urls = srcset_urls(value) if name == "srcset" else [value]
                for url in urls:
                    self._resource(tag, name, url)

        if "href" in values and tag not in {"a", "area"}:
            rels = set(values.get("rel", "").lower().split())
            if not (tag == "link" and rels & NON_LOADING_RELS and "stylesheet" not in rels):
                self._resource(tag, "href", values["href"])

    def handle_endtag(self, tag: str) -> None:
        if tag in {"script", "style"} and self._hidden:
            self._hidden -= 1

    def handle_data(self, data: str) -> None:
        if not self._hidden:
            self.text.append(data)

    def _resource(self, tag: str, attr: str, url: str) -> None:
        if not url or url.startswith("#"):
            return
        if url.strip().lower().startswith("data:"):
            # No data: URLs anywhere: the planned CSP is img-src 'self', so images are no exception.
            self.problems.append(f"data: URL in {attr} on <{tag}>")
            return
        if is_external(url):
            self.problems.append(f"off-site {attr}={url!r} on <{tag}>")
        else:
            self.resources.append(url)


def resolve_local(dist: Path, page_dir: Path, ref: str) -> Path | None:
    """Map a local URL to a path inside dist, or None if it escapes dist."""
    path = unquote(urlparse(ref).path)
    base = dist if path.startswith("/") else page_dir
    target = (base / path.lstrip("/")).resolve()
    try:
        target.relative_to(dist.resolve())
    except ValueError:
        return None
    return target


def scan_css(dist: Path, css_file: Path) -> tuple[list[str], list[Path]]:
    """Return (problems, local files the stylesheet pulls in)."""
    css = CSS_COMMENT.sub("", css_file.read_text(encoding="utf-8"))
    problems: list[str] = []
    pulled: list[Path] = []
    for ref in CSS_URL.findall(css) + CSS_IMPORT.findall(css):
        if ref.startswith("data:"):
            continue
        if is_external(ref):
            problems.append(f"off-site url {ref!r}")
            continue
        target = resolve_local(dist, css_file.parent, ref)
        if target is None or not target.is_file():
            problems.append(f"missing file {ref!r}")
        else:
            pulled.append(target)
    return problems, pulled


def reachable(links: dict[Path, list[Path]], start: list[Path]) -> set[Path]:
    """Every file reachable from start through links, each counted once (cycles are fine)."""
    seen: set[Path] = set()
    stack = list(start)
    while stack:
        path = stack.pop()
        if path not in seen:
            seen.add(path)
            stack.extend(links.get(path, ()))
    return seen


def page_url(dist: Path, html_file: Path) -> str:
    rel = html_file.relative_to(dist).as_posix()
    if rel == "index.html":
        return "/"
    if rel.endswith("/index.html"):
        return "/" + rel[: -len("index.html")]
    return "/" + rel


def check_sitemap(dist: Path, pages: dict[str, Path]) -> list[tuple[str, str]]:
    sitemap = dist / "sitemap.xml"
    if not sitemap.is_file():
        return [("sitemap.xml", "missing")]
    try:
        root = ElementTree.fromstring(sitemap.read_text(encoding="utf-8"))
    except ElementTree.ParseError as error:
        return [("sitemap.xml", f"not valid XML: {error}")]

    problems: list[tuple[str, str]] = []
    listed: set[str] = set()
    for loc in root.iter(f"{SITEMAP_NS}loc"):
        url = (loc.text or "").strip()
        parsed = urlparse(url)
        if parsed.scheme != "https":
            problems.append(("sitemap.xml", f"{url!r} is not an https URL"))
        listed.add(parsed.path)
        if parsed.path in {"/404", "/404/", "/404.html"}:
            problems.append(("sitemap.xml", "lists the 404 page"))
        elif parsed.path not in pages:
            problems.append(("sitemap.xml", f"lists {parsed.path!r}, which was not built"))

    for path in sorted(pages):
        if path not in listed and pages[path].name != "404.html":
            problems.append(("sitemap.xml", f"does not list built page {path!r}"))
    return problems


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("dist", nargs="?", default="dist", type=Path, help="build output (default: dist)")
    dist = parser.parse_args().dist
    if not dist.is_dir():
        print(f"error: {dist} not found. Run the build first.", file=sys.stderr)
        return 2
    dist = dist.resolve()

    failures: list[tuple[str, str]] = []
    warnings: list[tuple[str, str]] = []
    pages: dict[str, Path] = {}
    home_resources: list[Path] = []

    for html_file in sorted(dist.rglob("*.html")):
        name = html_file.relative_to(dist).as_posix()
        pages[page_url(dist, html_file)] = html_file
        scan = PageScan()
        scan.feed(html_file.read_text(encoding="utf-8"))
        failures.extend((name, problem) for problem in sorted(set(scan.problems)))

        for ref in scan.resources:
            target = resolve_local(dist, html_file.parent, ref)
            if target is None or not target.is_file():
                failures.append((name, f"missing file {ref!r}"))
            elif name == "index.html":
                home_resources.append(target)

        hits = len(PLACEHOLDER.findall(" ".join(scan.text)))
        if hits:
            warnings.append((name, f"'placeholder' text appears {hits} time(s)"))

    css_links: dict[Path, list[Path]] = {}
    for css_file in sorted(dist.rglob("*.css")):
        css_problems, css_links[css_file] = scan_css(dist, css_file)
        failures.extend((css_file.relative_to(dist).as_posix(), p) for p in css_problems)

    failures.extend(check_sitemap(dist, pages))

    home = dist / "index.html"
    if not home.is_file():
        failures.append(("index.html", "missing"))
    else:
        home_size = home.stat().st_size
        if home_size > HOME_HTML_LIMIT:
            failures.append(("index.html", f"{home_size:,} bytes exceeds the {HOME_HTML_LIMIT:,} byte limit"))
        # Every font the stylesheets declare counts, whether or not this page uses it,
        # and so does anything reached through @import or url() chains.
        loaded = {home, *reachable(css_links, home_resources)}
        first_load = sum(path.stat().st_size for path in loaded)
        print(f"home HTML:  {home_size:>7,} bytes (limit {HOME_HTML_LIMIT:,})")
        print(f"first load: {first_load:>7,} bytes (limit {FIRST_LOAD_LIMIT:,}), {len(loaded)} files")
        if first_load > FIRST_LOAD_LIMIT:
            failures.append(("index.html", f"first load {first_load:,} bytes exceeds the {FIRST_LOAD_LIMIT:,} byte limit"))

    for name, message in warnings:
        print(f"WARN {name}: {message}")
    for name, message in failures:
        print(f"FAIL {name}: {message}")
    print(f"{len(pages)} pages checked: {len(failures)} failure(s), {len(warnings)} warning(s)")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
