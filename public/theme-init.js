// Head script: applies a saved light theme before first paint (see tests/theme.test.mjs).
try {
  if (localStorage.getItem("theme") === "light") {
    document.documentElement.dataset.theme = "light";
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", "#e1e2e7");
  }
} catch {
  // Storage is blocked: the site stays dark.
}
