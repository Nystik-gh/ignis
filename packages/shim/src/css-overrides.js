// Injects a link to the CSS overrides stylesheet served from /assets/overrides.css.

export function installCssOverrides() {
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = "/assets/overrides.css";
  link.setAttribute("data-ignis", "css-overrides");
  document.head.appendChild(link);
}
