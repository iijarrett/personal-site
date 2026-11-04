// Head script: the .js marker, and a saved light theme before first paint.
document.documentElement.classList.add("js");
try {
  if (localStorage.getItem("theme") === "light") {
    document.documentElement.dataset.theme = "light";
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", "#e1e2e7");
  }
} catch {
  // Storage is blocked: the site stays dark.
}
