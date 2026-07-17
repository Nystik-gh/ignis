// Activates Obsidian's mobile UI on small viewports via the EmulateMobile flag.

export function installEmulateMobile() {
  if (window.innerWidth < 600) {
    localStorage.setItem("EmulateMobile", "true");
    stripEmulateMobileClass();
  } else {
    localStorage.removeItem("EmulateMobile");
  }
}

// The emulate-mobile class only gates plugin requires.
// strip to allow desktop plugins to load on mobile UI.
function stripEmulateMobileClass() {
  const strip = () => {
    // only remove if present, otherwise observer loops forever
    if (document.body.classList.contains("emulate-mobile")) {
      document.body.classList.remove("emulate-mobile");
    }
  };

  const observer = new MutationObserver(strip);
  observer.observe(document.body, {
    attributes: true,
    attributeFilter: ["class"],
  });
}
