// Head script: .js marker, saved light theme, won colour.
document.documentElement.classList.add("js");
try {
  if (localStorage.getItem("theme") === "light") {
    document.documentElement.dataset.theme = "light";
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", "#e1e2e7");
  }
} catch {
  // Storage blocked: stays dark.
}
try {
  const a = sessionStorage.getItem("accent");
  if (/^[a-z]+(,#[0-9a-f]{6}){4}$/.test(a)) {
    const h = document.documentElement;
    const [n, ...c] = a.split(",");
    h.dataset.accent = n;
    c.forEach((v, i) => {
      h.style.setProperty(`--x${i}`, v);
    });
  }
} catch {}
