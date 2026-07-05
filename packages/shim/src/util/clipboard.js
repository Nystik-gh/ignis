// Copy a string to the clipboard, resolving on success and rejecting on failure.
// navigator.clipboard needs a secure context, so fall back to a textarea + execCommand for plain-HTTP deployments.
export function copyText(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    return navigator.clipboard.writeText(text);
  }

  return new Promise((resolve, reject) => {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);

      if (ok) {
        resolve();
      } else {
        reject(new Error("copy command rejected"));
      }
    } catch (e) {
      reject(e);
    }
  });
}
