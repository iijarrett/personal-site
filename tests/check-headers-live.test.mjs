import assert from "node:assert/strict";
import { execFile, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

// Runs `check_headers.py --url` against a small local server that plays the deployed site, so
// each live check is proven to pass on a good site and to fail on a deliberate weakening.

const script = join(import.meta.dirname, "..", "scripts", "check_headers.py");
const python = process.env.PYTHON ?? "python";
const MISSING = "/check-headers-no-such-page/";

const CSP =
  "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; font-src 'self'; " +
  "connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; " +
  "upgrade-insecure-requests; require-trusted-types-for 'script'";

const SECURITY = {
  "Content-Security-Policy": CSP,
  "Strict-Transport-Security": "max-age=63072000; includeSubDomains; preload",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  "Permissions-Policy": "camera=(), geolocation=(), microphone=(), payment=(), usb=()",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Resource-Policy": "same-origin",
};

function securityTxt(days = 180) {
  const expires = new Date(Date.now() + days * 86_400_000).toISOString();
  return [
    "Contact: mailto:security@example.com",
    `Expires: ${expires}`,
    "Canonical: https://example.com/.well-known/security.txt",
    "",
  ].join("\n");
}

/** The routes of a good site. Each has a status, extra headers and a body. */
function goodRoutes() {
  return {
    "/": { type: "text/html", body: '<link rel="stylesheet" href="/_astro/app.abc123.css">' },
    "/about/": { type: "text/html", body: "<p>about</p>" },
    "/_astro/app.abc123.css": {
      type: "text/css",
      cache: "public, max-age=31536000, immutable",
      body: "a{}",
    },
    "/theme-init.js": { type: "text/javascript", cache: "no-cache", body: "1" },
    "/.well-known/security.txt": {
      type: "text/plain; charset=utf-8",
      cache: "no-cache",
      body: securityTxt(),
    },
    [MISSING]: { status: 404, type: "text/html", body: "not found" },
  };
}

/**
 * Starts a server for the routes, after `edit` has changed them. A route's `drop` lists headers
 * it must not send, and `set` adds or replaces headers on it.
 */
async function withSite(edit, run) {
  const routes = goodRoutes();
  edit?.(routes);
  const server = createServer((request, response) => {
    const route = routes[request.url] ?? { status: 404, type: "text/html", body: "x" };
    const headers = { ...SECURITY, ...route.set };
    for (const name of route.drop ?? []) delete headers[name];
    if (route.type) headers["Content-Type"] = route.type;
    if (route.cache) headers["Cache-Control"] = route.cache;
    response.writeHead(route.status ?? 200, headers);
    response.end(route.body ?? "");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    return await run(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

/** Runs the script. It must be async: a blocking spawn would stop the server answering. */
function check(args) {
  return new Promise((resolve) => {
    execFile(
      python,
      [script, ...args],
      { cwd: tmpdir(), timeout: 60_000 },
      (error, stdout, stderr) => {
        resolve({
          code: error ? (typeof error.code === "number" ? error.code : 1) : 0,
          stdout,
          stderr,
        });
      },
    );
  });
}

const live = (edit) => withSite(edit, (url) => check(["--url", url]));

test("live: a good site passes, and the build output is not needed", async () => {
  const result = await live();
  assert.equal(result.code, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /live:\s+6 request\(s\)/);
  assert.match(result.stdout, /0 failure\(s\), 0 warning\(s\)/);
});

test("live: an unsafe-inline CSP on the home page fails", async () => {
  const result = await live((r) => {
    r["/"].set = {
      "Content-Security-Policy": CSP.replace(
        "style-src 'self'",
        "style-src 'self' 'unsafe-inline'",
      ),
    };
  });
  assert.equal(result.code, 1);
  assert.match(result.stdout, /FAIL live \/: .*'unsafe-inline'/);
});

test("live: a page without HSTS fails", async () => {
  const result = await live((r) => {
    r["/about/"].drop = ["Strict-Transport-Security"];
  });
  assert.equal(result.code, 1);
  assert.match(result.stdout, /FAIL live \/about\/: strict-transport-security is missing/);
});

test("live: a repeated header, as a double rule would send, fails", async () => {
  const result = await live((r) => {
    r["/"].set = { "X-Frame-Options": "DENY, DENY" };
  });
  assert.equal(result.code, 1);
  assert.match(result.stdout, /x-frame-options must be DENY/);
});

test("live: the 404 page must carry the headers too", async () => {
  const result = await live((r) => {
    r[MISSING].drop = ["Content-Security-Policy", "X-Frame-Options"];
  });
  assert.equal(result.code, 1);
  assert.match(
    result.stdout,
    /FAIL live \/check-headers-no-such-page\/: content-security-policy is missing/,
  );
});

test("live: a missing page that answers 200 fails", async () => {
  const result = await live((r) => {
    r[MISSING].status = 200;
  });
  assert.equal(result.code, 1);
  assert.match(result.stdout, /status 200, expected 404/);
});

test("live: a redirect on the home page fails (redirects are not followed)", async () => {
  const result = await live((r) => {
    r["/"].status = 301;
  });
  assert.equal(result.code, 1);
  assert.match(result.stdout, /FAIL live \/: status 301, expected 200/);
});

test("live: hashed files that are not immutable fail", async () => {
  const result = await live((r) => {
    r["/_astro/app.abc123.css"].cache = "public, max-age=3600";
  });
  assert.equal(result.code, 1);
  assert.match(
    result.stdout,
    /live \/_astro\/app\.abc123\.css: Cache-Control must be max-age of a year or more with immutable/,
  );
});

test("live: a theme script that can be cached for a year fails", async () => {
  const result = await live((r) => {
    r["/theme-init.js"].cache = "public, max-age=31536000, immutable";
  });
  assert.equal(result.code, 1);
  assert.match(result.stdout, /live \/theme-init\.js: Cache-Control must be no-cache/);
});

test("live: a home page that links no hashed file fails, so the caching is never skipped", async () => {
  const result = await live((r) => {
    r["/"].body = "<p>no assets</p>";
  });
  assert.equal(result.code, 1);
  assert.match(result.stdout, /links no \/_astro\/ file/);
});

test("live: security.txt must be served as text/plain", async () => {
  const result = await live((r) => {
    r["/.well-known/security.txt"].type = "text/html";
  });
  assert.equal(result.code, 1);
  assert.match(result.stdout, /Content-Type must be text\/plain/);
});

test("live: an expired security.txt fails and one near expiry warns", async () => {
  const expired = await live((r) => {
    r["/.well-known/security.txt"].body = securityTxt(-2);
  });
  assert.equal(expired.code, 1);
  assert.match(expired.stdout, /FAIL live \/\.well-known\/security\.txt: expired on/);

  const soon = await live((r) => {
    r["/.well-known/security.txt"].body = securityTxt(10);
  });
  assert.equal(soon.code, 0, soon.stdout);
  assert.match(soon.stdout, /WARN live \/\.well-known\/security\.txt: expires on .*renew it soon/);
});

test("live: plain http is refused for any host but localhost", async () => {
  const result = await check(["--url", "http://example.com"]);
  assert.equal(result.code, 2);
  assert.match(result.stderr, /needs an https URL/);
});

test("live: something that is not a URL is refused", async () => {
  const result = await check(["--url", "jarrettd.com"]);
  assert.equal(result.code, 2);
  assert.match(result.stderr, /is not an http\(s\) URL/);
});

test("live: a site that cannot be reached exits 2, not 0", async () => {
  const url = await withSite(undefined, async (u) => u);
  const result = await check(["--url", url]);
  assert.equal(result.code, 2);
  assert.match(result.stderr, /cannot reach/);
});

test("live: the http-to-https rule accepts only a redirect to https", () => {
  const code = `
import sys
sys.path.insert(0, ${JSON.stringify(join(import.meta.dirname, "..", "scripts"))})
import check_headers as c
print(c.check_http_redirect(301, "https://jarrettd.com/"))
print(c.check_http_redirect(308, "HTTPS://jarrettd.com/"))
print(c.check_http_redirect(301, "http://jarrettd.com/"))
print(c.check_http_redirect(301, None))
print(c.check_http_redirect(200, None))
`;
  const run = spawnSync(python, ["-I", "-c", code], { encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
  const [ok1, ok2, plain, none, served] = run.stdout.trim().split(/\r?\n/);
  assert.equal(ok1, "[]");
  assert.equal(ok2, "[]");
  assert.match(plain, /not https/);
  assert.match(none, /redirects to nowhere/);
  assert.match(served, /answers 200 instead of redirecting/);
});
