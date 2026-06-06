// Demo-mode UX guards that run at the document level.
//
// Disable any email/password inputs to prevent users from entering credentials into a server they don't control.

const PLACEHOLDER =
  "Disabled in demo. Don't enter credentials on a server you don't control.";

function isDemoMode() {
  return document.body && document.body.dataset.demoMode === "true";
}

function disableInputs(root) {
  const inputs = root.querySelectorAll(
    'input[type="email"], input[type="password"]',
  );

  for (const input of inputs) {
    if (input.dataset.ignisDemoDisabled === "1") {
      continue;
    }

    input.disabled = true;
    input.value = "";
    input.placeholder = PLACEHOLDER;
    input.dataset.ignisDemoDisabled = "1";
  }
}

let observer = null;

function startDemoGuards() {
  if (!isDemoMode() || observer) {
    return;
  }

  // Walk what's already there.
  disableInputs(document.body);

  // And watch for anything added later (login modals, plugin dialogs, etc.).
  observer = new MutationObserver(() => {
    disableInputs(document.body);
  });

  observer.observe(document.body, { childList: true, subtree: true });
}

function stopDemoGuards() {
  if (observer) {
    observer.disconnect();
    observer = null;
  }
}

export { startDemoGuards, stopDemoGuards, isDemoMode };
