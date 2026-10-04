import { Modal, Notice } from "obsidian";

// Paired with the shim's proxy-block reporter, which dispatches this event.
const PROXY_BLOCK_EVENT = "ignis:proxy-blocked";

const DOCS_URL =
  "https://ignis.thiefling.com/docs/sync/#servers-on-a-private-address";

function noticeText({ code, host }) {
  switch (code) {
    case "private-host":
    case "private-resolve":
      return `Ignis blocked a connection to ${host} (private address).`;
    case "dns":
      return `Ignis could not resolve ${host}.`;
    case "allowlist":
      return `Ignis blocked ${host}: not in the proxy host allowlist.`;
    case "disabled":
      return "Ignis blocked a connection: proxy access is disabled.";
    default:
      return "Ignis blocked a connection.";
  }
}

class ProxyBlockModal extends Modal {
  constructor(app, detail) {
    super(app);
    this.detail = detail;
  }

  onOpen() {
    const { contentEl } = this;
    const { code, host, address } = this.detail;

    this.setTitle("Connection blocked");
    contentEl.addClass("ignis-block-modal");

    if (code === "private-host" || code === "private-resolve") {
      const intro = contentEl.createEl("p");
      intro.appendText(
        "Ignis relays plugin requests through the server, which blocks private addresses unless they are explicitly allowed. ",
      );
      intro.createEl("code", { text: host });
      intro.appendText(
        code === "private-resolve"
          ? " resolves to the private address "
          : " is a private address.",
      );

      if (code === "private-resolve") {
        intro.createEl("code", { text: address });
        intro.appendText(".");
      }

      intro.appendText(" Allow it in one of two ways:");

      const list = contentEl.createEl("ul");

      const envItem = list.createEl("li");
      envItem.appendText("Set the ");
      envItem.createEl("code", { text: "PROXY_ALLOW_PRIVATE_HOSTS" });
      envItem.appendText(" environment variable on the server to include ");
      envItem.createEl("code", { text: address || host });
      envItem.appendText(".");

      const directItem = list.createEl("li");
      directItem.appendText("Add ");
      directItem.createEl("code", { text: host });
      directItem.appendText(
        " to direct-fetch hosts (Settings > Ignis > General > Security), so the browser connects to it directly. The target must allow cross-origin requests (CORS).",
      );

      const docs = contentEl.createEl("p");
      docs.createEl("a", {
        text: "Docs: sync connectivity",
        href: DOCS_URL,
        attr: { target: "_blank", rel: "noopener noreferrer" },
      });
    } else if (code === "dns") {
      contentEl.createEl("p", {
        text: `The server could not resolve ${host}. Check the hostname, or use an IP address instead. The name must resolve on the Ignis server.`,
      });
    } else if (code === "allowlist") {
      contentEl.createEl("p", {
        text: `Proxy access is restricted to an allowlist, and ${host} is not on it. Add it under Settings > Ignis > General > Security > Proxy host allowlist.`,
      });
    } else if (code === "disabled") {
      contentEl.createEl("p", {
        text: "Proxy access is disabled under Settings > Ignis > General > Security. Cross-origin plugin requests are blocked while it is disabled.",
      });
    } else {
      // fallback to server error if unknown code.
      contentEl.createEl("p", {
        text: this.detail.message || "Ignis blocked the connection.",
      });
    }
  }

  onClose() {
    this.contentEl.empty();
  }
}

export function initProxyBlockNotice(app) {
  const handler = (event) => {
    const detail = event.detail || {};

    const frag = document.createDocumentFragment();
    frag.appendChild(document.createTextNode(noticeText(detail) + " "));

    const details = document.createElement("button");
    details.textContent = "Details";
    details.addEventListener("click", () => {
      new ProxyBlockModal(app, detail).open();
    });
    frag.appendChild(details);

    new Notice(frag, 10000);
  };

  window.addEventListener(PROXY_BLOCK_EVENT, handler);

  return () => window.removeEventListener(PROXY_BLOCK_EVENT, handler);
}
