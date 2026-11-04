import { defineConfig } from "astro/config";

// Static output only. Nothing may be inlined: the CSP forbids inline scripts and styles.
export default defineConfig({
  site: "https://jarrettd.com",
  output: "static",
  trailingSlash: "always",
  devToolbar: { enabled: false },
  build: { inlineStylesheets: "never" },
  vite: { build: { assetsInlineLimit: 0 } },
});
