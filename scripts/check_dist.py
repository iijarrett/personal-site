#!/usr/bin/env python3
"""Post-build checks for dist/. Standard library only.

Fails (exit 1) when the build output breaks a hard rule from CONTRIBUTING.md:

  * an inline <script> or <style>, a style= attribute or an on*= handler
  * forms, iframes, embeds or objects
  * a resource that points off-site (outbound <a href> links are fine, and so is
    <link rel="canonical">), a data: URL on any tag, or a local resource that
    does not exist
  * a script (.js or .mjs) that mentions eval, Function, fetch, XMLHttpRequest,
    WebSocket, sendBeacon, document.cookie (dotted or document["cookie"]),
    createElement("script"), innerHTML, outerHTML, insertAdjacentHTML,
    document.write, an absolute http(s):// URL or a protocol-relative //host URL.
    There is no allowlist. This is a tripwire made of regular expressions, not a
    parser or a sandbox: obfuscated or computed-member tricks are out of scope and
    the CSP is the real enforcement.
  * a script that contains the word import anywhere (\bimport\b), except as
    import.meta, or the word export anywhere (\bexport\b). Both rules are about
    the word and do not try to read syntax: they do not care whether it starts a
    static import, a dynamic import( or a re-export, has a Unicode binding
    (import Ï€ from "x"), has comments or line breaks around it, or sits in a
    string or a comment. Every built script is one self-contained file with
    no imports or exports, with one narrow exception for lazy loading: a page script
    may say import("./name.js") exactly (a quoted string, no spaces, one built .js
    file in its own folder). That file is a lazy script (only a script a page loads with
    <script src> can name one, and a page script cannot also be lazy). It may say export
    but never import and never re-export (export ... from), so the graph is one level deep
    and the first load does not follow it. The name must match the built file exactly,
    letter case included.
    Anything else, including an import( of a file that was not built, still fails.
    A script that merely says the word fails too
    (const s="please import it"); reword it. "important", "reimport", "exports",
    "reexport", "_export" and import.meta pass.
  * the home page HTML over 14 KB, or the first load over 106 KB. The first load
    follows @import and url() chains in CSS, counting each reachable file once.
  * all JavaScript together over 26,000 bytes, or all CSS together over 16,000
    (built, uncompressed)
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
FIRST_LOAD_LIMIT = 106_000
JS_LIMIT = 26_000  # every .js/.mjs under dist/ added together, built and uncompressed
CSS_LIMIT = 16_000  # every .css under dist/ added together, built and uncompressed

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
# Constructs no script on this site may contain. No allowlist: if the build trips
# one, change the code, not this list.
#
# This is a tripwire, not a sandbox. It is plain pattern matching over the built text,
# with no parser, so anything obfuscated or built at run time (string concatenation,
# computed member names, "fe"+"tch") is out of scope. The CSP is the real
# enforcement. The bare words eval and fetch are banned, not just calls, so
# aliases, indirect calls ((0,eval)(...)) and optional calls (fetch?.(...)) all trip.
#
# The bare words eval, fetch and Function are banned, not just calls to them: an alias
# (const F=Function;F("...")), an optional call (Function?.("...")), new Function and
# instanceof Function all trip, so a script cannot say "Function" at all.
_QUOTE = "[\"'`]"
_MEMBER = r"(?:\?\.|\.)"  # a dot or an optional-chaining dot
IMPORT_WORD = 'the word "import"'
EXPORT_WORD = 'the word "export"'
MODULE_LABELS = (IMPORT_WORD, EXPORT_WORD)
MODULE_HINT = (
    ". Built scripts have no imports or exports. The one exception: a page script may say"
    ' import("./file.js") for a built .js file in its own folder, and that lazy file may export but'
    " not import (see CONTRIBUTING.md)"
)
# A re-export in a lazy script: the word from, then a quote (comments and line breaks may sit
# between). Array.from(...) and a variable called from do not match.
REEXPORT_LABEL = "a re-export (export ... from)"
REEXPORT_HINT = ". A lazy script may export its own names only (see CONTRIBUTING.md)"
RE_EXPORT_FROM = re.compile(r"""\bfrom(?:\s|/\*[\s\S]*?\*/|//[^\n]*(?:\n|$))*["'`]""")
# The only import( a built script may contain: an exact quoted ./file.js in its own folder. It
# only counts when that file was built, with the same letter case; otherwise the word still
# trips the import rule. Only a script a page loads can use it, and it only makes the named
# file lazy then.
DYNAMIC_IMPORT = re.compile(r"""\bimport\((["'`])\./([A-Za-z0-9_][A-Za-z0-9_.-]*\.js)\1\)""")
JS_FORBIDDEN = [
    (label, re.compile(pattern, flags))
    for label, pattern, flags in [
        ("eval", r"\beval\b", 0),
        ("Function", r"\bFunction\b", 0),
        ("fetch", r"\bfetch\b", 0),
        ("XMLHttpRequest", r"\bXMLHttpRequest\b", 0),
        ("WebSocket", r"\bWebSocket\b", 0),
        ("sendBeacon", r"\bsendBeacon\b", 0),
        (
            "document.cookie",
            rf"\bdocument\s*{_MEMBER}\s*cookie\b|\bdocument\s*(?:\?\.)?\s*\[\s*{_QUOTE}cookie{_QUOTE}\s*\]",
            0,
        ),
        ("createElement(\"script\")", rf"\bcreateElement\s*\(\s*{_QUOTE}script{_QUOTE}\s*\)", re.IGNORECASE),
        ("an absolute http(s):// URL", r"https?://", re.IGNORECASE),
        # A string that starts with //host. Comments and "//" on its own do not match.
        ("a protocol-relative //host URL", rf"{_QUOTE}\s*//[A-Za-z0-9_-]+(?:[.:][A-Za-z0-9_-]+)*", 0),
        ("innerHTML", r"\binnerHTML\b", 0),
        ("outerHTML", r"\bouterHTML\b", 0),
        ("insertAdjacentHTML", r"\binsertAdjacentHTML\b", 0),
        (
            "document.write",
            rf"\bdocument\s*{_MEMBER}\s*write(?:ln)?\b|\bdocument\s*(?:\?\.)?\s*\[\s*{_QUOTE}write(?:ln)?{_QUOTE}\s*\]",
            0,
        ),
        # Imports and exports are banned, so each built script stays one self-contained
        # file, apart from the narrow lazy-load form that scan_js handles before these
        # rules run. The rules are about the words, not the syntax: any whole-word "import" or
        # "export" fails, whatever follows it (a string, braces, a Unicode name, a paren,
        # a comment, a line break) and wherever it sits. Only import.meta is let through.
        # "important", "reimport", "exports" and "_export" are different words, so \b keeps
        # them out. Outside a lazy script a re-export (export * from "x") says "export", so it
        # needs no rule of its own and nothing here reads syntax. A lazy script may export, so
        # it gets one narrow rule instead (RE_EXPORT_FROM).
        (IMPORT_WORD, r"\bimport\b(?!\s*\.\s*meta\b)", 0),
        (EXPORT_WORD, r"\bexport\b", 0),
    ]
]
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
        self.scripts: list[str] = []  # local <script src> values
        self.text: list[str] = []
        self._hidden = 0

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        values = {name.lower(): (value or "") for name, value in attrs}

        if tag == "script":
            self._hidden += 1
            if "src" not in values:
                self.problems.append("inline <script>")
            elif not is_external(values["src"]):
                self.scripts.append(values["src"])
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


def file_key(path: Path) -> tuple[Path, str]:
    """Identity for the import rule: the folder (any case on Windows) and the exact file name.

    The name is compared exactly, so import("./ARCADE.js") does not match a built arcade.js
    even where the file system ignores case; a case-sensitive host would not find it.
    """
    return (path.parent, path.name)


def lazy_targets(js_file: Path) -> set[tuple[Path, str]]:
    """The files this script names in an exact import("./file.js")."""
    source = js_file.read_text(encoding="utf-8")
    return {file_key(js_file.parent / m.group(2)) for m in DYNAMIC_IMPORT.finditer(source)}


def scan_js(js_file: Path, built: set[tuple[Path, str]], role: str) -> list[str]:
    """Return the forbidden constructs a script contains (a pattern guard, not a sandbox).

    role is "page" (a script a page loads), "lazy" (a built file a page script names in an
exact import()) or "other". Only a page script may contain that import(), and only for a
built file. A lazy script may export its own names but not import or re-export anything.
    """
    source = js_file.read_text(encoding="utf-8")
    if role == "page":
        source = DYNAMIC_IMPORT.sub(
            lambda m: "" if file_key(js_file.parent / m.group(2)) in built else m.group(0), source
        )
    problems: list[str] = []
    for label, pattern in JS_FORBIDDEN:
        if role == "lazy" and label == EXPORT_WORD:
            continue
        if pattern.search(source):
            problems.append(f"{label} in script{MODULE_HINT if label in MODULE_LABELS else ''}")
    if role == "lazy" and RE_EXPORT_FROM.search(source):
        problems.append(f"{REEXPORT_LABEL} in script{REEXPORT_HINT}")
    return problems


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
    page_scripts: set[Path] = set()

    for html_file in sorted(dist.rglob("*.html")):
        name = html_file.relative_to(dist).as_posix()
        pages[page_url(dist, html_file)] = html_file
        scan = PageScan()
        scan.feed(html_file.read_text(encoding="utf-8"))
        failures.extend((name, problem) for problem in sorted(set(scan.problems)))

        for ref in scan.scripts:
            script = resolve_local(dist, html_file.parent, ref)
            if script is not None and script.is_file():
                page_scripts.add(script)

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

    js_files = sorted([*dist.rglob("*.js"), *dist.rglob("*.mjs")])
    built = {file_key(path) for path in js_files if path.suffix == ".js"}
    # Only a script a page loads can make another file lazy, so a string or comment elsewhere
    # that happens to say import("./x.js") grants nothing.
    lazy = {
        key
        for path in js_files
        if path.resolve() in page_scripts
        for key in lazy_targets(path)
        if key in built
    }
    for js_file in js_files:
        name = js_file.relative_to(dist).as_posix()
        is_page = js_file.resolve() in page_scripts
        role = "lazy" if file_key(js_file) in lazy else "page" if is_page else "other"
        if role == "lazy" and is_page:
            failures.append((name, "is loaded by a page and also named by import() in another page script"))
        failures.extend((name, p) for p in scan_js(js_file, built, role))

    js_total = sum(path.stat().st_size for path in js_files)
    css_total = sum(path.stat().st_size for path in css_links)
    print(f"JS total:   {js_total:>7,} bytes (limit {JS_LIMIT:,}), {len(js_files)} file(s)")
    print(f"CSS total:  {css_total:>7,} bytes (limit {CSS_LIMIT:,}), {len(css_links)} file(s)")
    if js_total > JS_LIMIT:
        failures.append(("dist", f"JavaScript totals {js_total:,} bytes, over the {JS_LIMIT:,} byte limit"))
    if css_total > CSS_LIMIT:
        failures.append(("dist", f"CSS totals {css_total:,} bytes, over the {CSS_LIMIT:,} byte limit"))

    failures.extend(check_sitemap(dist, pages))

    home = dist / "index.html"
    if not home.is_file():
        failures.append(("index.html", "missing"))
    else:
        home_size = home.stat().st_size
        if home_size > HOME_HTML_LIMIT:
            failures.append(("index.html", f"{home_size:,} bytes exceeds the {HOME_HTML_LIMIT:,} byte limit"))
        # Every font the stylesheets declare counts, whether or not this page uses it,
        # and so does anything reached through @import or url() chains, each file once.
        # A lazy script is requested only after a visitor acts, so it is not part of the first load.
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
