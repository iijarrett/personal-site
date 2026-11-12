import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, test } from "node:test";

// Runs scripts/check_headers.py against small fixture builds, so each rule is proven to pass on
// a clean build and to fail on a deliberate weakening of the headers or security.txt.

const script = join(import.meta.dirname, "..", "scripts", "check_headers.py");
const python = process.env.PYTHON ?? "python";
const roots = [];

after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

const CSP =
  "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; font-src 'self'; " +
  "connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; " +
  "upgrade-insecure-requests; require-trusted-types-for 'script'";

const DEFAULTS = {
  csp: CSP,
  hsts: "max-age=63072000; includeSubDomains; preload",
  nosniff: "nosniff",
  frame: "DENY",
  referrer: "no-referrer",
  permissions: "camera=(), geolocation=(), microphone=(), payment=(), usb=(), browsing-topics=()",
  coop: "same-origin",
  corp: "same-origin",
  astro: "public, max-age=31536000, immutable",
  theme: "no-cache",
  txt: "no-cache",
};

/** A _headers file in the shape the real one has; `over` replaces individual values. */
function headersFile(over = {}) {
  const v = { ...DEFAULTS, ...over };
  return [
    "# comment",
    "/*",
    `  Content-Security-Policy: ${v.csp}`,
    `  Strict-Transport-Security: ${v.hsts}`,
    `  X-Content-Type-Options: ${v.nosniff}`,
    `  X-Frame-Options: ${v.frame}`,
    `  Referrer-Policy: ${v.referrer}`,
    `  Permissions-Policy: ${v.permissions}`,
    `  Cross-Origin-Opener-Policy: ${v.coop}`,
    `  Cross-Origin-Resource-Policy: ${v.corp}`,
    "",
    "/_astro/*",
    `  Cache-Control: ${v.astro}`,
    "",
    "/theme-init.js",
    `  Cache-Control: ${v.theme}`,
    "",
    "/.well-known/security.txt",
    `  Cache-Control: ${v.txt}`,
    "",
  ].join("\n");
}

const iso = (days) => new Date(Date.now() + days * 86_400_000).toISOString();

const securityTxt = (over = {}) => {
  const fields = {
    Contact: "mailto:security@example.com",
    Expires: iso(300),
    "Preferred-Languages": "en",
    Canonical: "https://example.com/.well-known/security.txt",
    ...over,
  };
  return `${Object.entries(fields)
    .filter(([, value]) => value !== null)
    .map(([key, value]) => `${key}: ${value}`)
    .join("\n")}\n`;
};

/** Builds a fixture dist (clean by default), applies overrides, runs the checker. */
function run(overrides = {}) {
  const root = mkdtempSync(join(tmpdir(), "check-headers-"));
  roots.push(root);
  const files = {
    _headers: headersFile(),
    ".well-known/security.txt": securityTxt(),
    "theme-init.js": "var a=1;",
    "_astro/a.css": "body{color:red}",
    ...overrides,
  };
  for (const [name, content] of Object.entries(files)) {
    if (content === null) continue;
    const target = join(root, name);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content);
  }
  const result = spawnSync(python, [script, root], { encoding: "utf8" });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

function fails(overrides, expected) {
  const { status, output } = run(overrides);
  assert.equal(status, 1, output);
  assert.match(output, expected);
}

test("a clean build passes", () => {
  const { status, output } = run();
  assert.equal(status, 0, output);
  assert.match(output, /0 failure\(s\), 0 warning\(s\)/);
});

test("a missing build output is an error, not a pass", () => {
  const result = spawnSync(python, [script, join(tmpdir(), "no-such-dist-folder")], {
    encoding: "utf8",
  });
  assert.equal(result.status, 2);
});

// ---------- _headers ----------

test("fails when _headers is missing", () => {
  fails({ _headers: null }, /_headers: missing/);
});

const csp = (edit) => CSP.replace(...edit);
const cspCases = [
  [
    "script-src allows unsafe-inline",
    csp(["script-src 'self'", "script-src 'self' 'unsafe-inline'"]),
    /script-src allows 'unsafe-inline'/,
  ],
  [
    "style-src allows unsafe-inline",
    csp(["style-src 'self'", "style-src 'self' 'unsafe-inline'"]),
    /style-src allows 'unsafe-inline'/,
  ],
  [
    "script-src allows unsafe-eval",
    csp(["script-src 'self'", "script-src 'self' 'unsafe-eval'"]),
    /allows 'unsafe-eval'/,
  ],
  ["img-src allows data:", csp(["img-src 'self'", "img-src 'self' data:"]), /img-src allows data:/],
  [
    "connect-src allows a wildcard",
    csp(["connect-src 'self'", "connect-src *"]),
    /connect-src is \*|allows \*/,
  ],
  [
    "script-src allows a CDN as a scheme",
    csp(["script-src 'self'", "script-src 'self' https:"]),
    /allows https:/,
  ],
  [
    "default-src is 'self' instead of 'none'",
    csp(["default-src 'none'", "default-src 'self'"]),
    /default-src is 'self'/,
  ],
  ["frame-ancestors is dropped", csp(["frame-ancestors 'none'; ", ""]), /has no frame-ancestors/],
  [
    "trusted types is dropped",
    csp(["; require-trusted-types-for 'script'", ""]),
    /has no require-trusted-types-for/,
  ],
  [
    "upgrade-insecure-requests is dropped",
    csp(["upgrade-insecure-requests; ", ""]),
    /has no upgrade-insecure-requests/,
  ],
  [
    "form-action is opened up",
    csp(["form-action 'none'", "form-action 'self'"]),
    /form-action is 'self'/,
  ],
  ["a directive is repeated", `${CSP}; script-src 'self'`, /repeats script-src/],
];
for (const [name, policy, expected] of cspCases) {
  test(`fails when the CSP ${name}`, () => {
    fails({ _headers: headersFile({ csp: policy }) }, expected);
  });
}

test("fails when the CSP header is missing from /*", () => {
  const without = headersFile().replace(/^ {2}Content-Security-Policy:.*\n/m, "");
  fails({ _headers: without }, /needs exactly one content-security-policy header, found 0/);
});

test("fails when another rule sets its own CSP, which Cloudflare would join with the first", () => {
  const extra = `${headersFile()}\n/game/*\n  Content-Security-Policy: default-src 'none'\n`;
  fails({ _headers: extra, "game/x.js": "1" }, /sets its own Content-Security-Policy/);
});

const headerCases = [
  [
    "HSTS is under a year",
    { hsts: "max-age=300; includeSubDomains; preload" },
    /max-age must be at least 31,536,000/,
  ],
  ["HSTS drops preload", { hsts: "max-age=63072000; includeSubDomains" }, /missing preload/],
  [
    "HSTS drops includeSubDomains",
    { hsts: "max-age=63072000; preload" },
    /missing includesubdomains/,
  ],
  ["nosniff is wrong", { nosniff: "sniff" }, /x-content-type-options must be nosniff/],
  ["X-Frame-Options is SAMEORIGIN", { frame: "SAMEORIGIN" }, /x-frame-options must be DENY/],
  [
    "Referrer-Policy leaks the origin",
    { referrer: "origin" },
    /referrer-policy must be no-referrer/,
  ],
  ["COOP is relaxed", { coop: "unsafe-none" }, /cross-origin-opener-policy must be same-origin/],
  [
    "CORP is cross-origin",
    { corp: "cross-origin" },
    /cross-origin-resource-policy must be same-origin/,
  ],
  [
    "Permissions-Policy leaves the camera on",
    { permissions: "microphone=(), geolocation=(), payment=(), usb=()" },
    /does not turn off camera/,
  ],
  [
    "Permissions-Policy allows geolocation for self",
    { permissions: "camera=(), microphone=(), geolocation=(self), payment=(), usb=()" },
    /does not turn off geolocation/,
  ],
];
for (const [name, over, expected] of headerCases) {
  test(`fails when ${name}`, () => {
    fails({ _headers: headersFile(over) }, expected);
  });
}

// ---------- caching and shape ----------

test("fails when /* sets Cache-Control", () => {
  const bad = headersFile().replace("/*\n", "/*\n  Cache-Control: no-store\n");
  fails({ _headers: bad }, /\/\* must not set Cache-Control/);
});

test("fails when hashed files are not immutable", () => {
  fails(
    { _headers: headersFile({ astro: "public, max-age=3600" }) },
    /\/_astro\/\*: Cache-Control must be max-age of a year or more with immutable/,
  );
});

test("fails when theme-init.js can be cached without revalidating", () => {
  fails(
    { _headers: headersFile({ theme: "public, max-age=86400" }) },
    /\/theme-init\.js: Cache-Control must be no-cache/,
  );
});

test("fails when the theme script has no caching rule at all", () => {
  const bad = headersFile().replace("/theme-init.js\n  Cache-Control: no-cache\n", "");
  fails({ _headers: bad }, /no Cache-Control rule for \/theme-init\.js/);
});

test("fails when a rule names a file the build does not have", () => {
  fails(
    { _headers: headersFile(), "theme-init.js": null },
    /\/theme-init\.js matches nothing in the build/,
  );
});

test("fails when there are two /* rules or none", () => {
  fails({ _headers: `${headersFile()}\n/*\n  X-Test: 1\n` }, /exactly one \/\* rule, found 2/);
  fails({ _headers: headersFile().replace("/*\n", "/other\n") }, /exactly one \/\* rule, found 0/);
});

test("fails on a line over Cloudflare's 2,000 character limit", () => {
  fails(
    { _headers: `${headersFile()}\n/x\n  X-Long: ${"a".repeat(2_000)}\n` },
    /is 2,0\d\d characters, over Cloudflare's 2,000/,
  );
});

test("fails on a header line that is not Name: value, or comes before any path", () => {
  fails({ _headers: `${headersFile()}\n/x\n  not a header\n` }, /is not 'Name: value'/);
  fails({ _headers: `  X-Test: 1\n${headersFile()}` }, /comes before any path/);
});

test("a comment, a blank line and a detach line are not errors", () => {
  const ok = `${headersFile()}\n# more\n/theme-init.js\n  ! X-Test\n`;
  const { status, output } = run({ _headers: ok });
  assert.equal(status, 0, output);
});

// ---------- security.txt ----------

test("fails when security.txt is missing", () => {
  fails({ ".well-known/security.txt": null }, /security\.txt: missing/);
});

test("fails when security.txt has no Contact, or a Contact that is not a URI", () => {
  fails({ ".well-known/security.txt": securityTxt({ Contact: null }) }, /no Contact field/);
  fails(
    { ".well-known/security.txt": securityTxt({ Contact: "security@example.com" }) },
    /Contact 'security@example\.com' must be a mailto:/,
  );
});

test("fails when security.txt has no Expires, two, or one that is not a dated time zone", () => {
  fails(
    { ".well-known/security.txt": securityTxt({ Expires: null }) },
    /exactly one Expires field, found 0/,
  );
  fails(
    { ".well-known/security.txt": `${securityTxt()}Expires: ${iso(200)}\n` },
    /exactly one Expires field, found 2/,
  );
  fails(
    { ".well-known/security.txt": securityTxt({ Expires: "next year" }) },
    /is not an ISO 8601 date/,
  );
  fails(
    { ".well-known/security.txt": securityTxt({ Expires: "2030-01-01T00:00:00" }) },
    /is not an ISO 8601 date with a time zone/,
  );
});

test("fails once security.txt has expired", () => {
  fails(
    { ".well-known/security.txt": securityTxt({ Expires: iso(-1) }) },
    /expired on \d{4}-\d\d-\d\d: renew it/,
  );
});

test("warns, without failing, when it expires within 30 days or is dated over a year ahead", () => {
  const soon = run({ ".well-known/security.txt": securityTxt({ Expires: iso(10) }) });
  assert.equal(soon.status, 0, soon.output);
  assert.match(soon.output, /WARN .*expires on .*renew it soon/);
  const far = run({ ".well-known/security.txt": securityTxt({ Expires: iso(500) }) });
  assert.equal(far.status, 0, far.output);
  assert.match(far.output, /WARN .*more than a year away/);
});

test("fails when Canonical is not an https .well-known/security.txt URL", () => {
  fails(
    {
      ".well-known/security.txt": securityTxt({
        Canonical: "http://example.com/.well-known/security.txt",
      }),
    },
    /Canonical .* must be an https URL/,
  );
  fails(
    { ".well-known/security.txt": securityTxt({ Canonical: "https://example.com/security.txt" }) },
    /Canonical .* must be an https URL/,
  );
});
