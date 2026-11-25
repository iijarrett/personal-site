// Head script: .js marker and saved light theme.
document.documentElement.classList.add("js");
try {
  if (localStorage.getItem("theme") === "light") {
    document.documentElement.dataset.theme = "light";
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", "#e1e2e7");
  }
} catch {
  // Storage blocked: stays dark.
}
