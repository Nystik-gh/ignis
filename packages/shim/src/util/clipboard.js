// Copy a string to the clipboard via a hidden textarea + execCommand("copy").
// Works on insecure origins where navigator.clipboard is unavailable.
export function execCommandCopy(text) {
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.select();

  let ok = false;

  try {
    ok = document.execCommand("copy");
  } finally {
    document.body.removeChild(ta);
  }

  return ok;
}

// Copy html + plain-text alternates in one clipboard entry.
export function execCommandCopyHTML(html, text) {
  const listener = (e) => {
    e.preventDefault();
    e.clipboardData.setData("text/html", html);
    e.clipboardData.setData("text/plain", text);
  };

  document.addEventListener("copy", listener, true);

  try {
    return execCommandCopy(text);
  } finally {
    document.removeEventListener("copy", listener, true);
  }
}

export function copyText(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    return navigator.clipboard.writeText(text);
  }

  return new Promise((resolve, reject) => {
    try {
      if (execCommandCopy(text)) {
        resolve();
      } else {
        reject(new Error("copy command rejected"));
      }
    } catch (e) {
      reject(e);
    }
  });
}
