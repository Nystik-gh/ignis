export class notificationShim {
  constructor(options = {}) {
    this.title = options.title || "";
    this.body = options.body || "";
    this.silent = options.silent || false;
    this._handlers = {};
  }

  show() {
    if ("Notification" in window && Notification.permission === "granted") {
      new Notification(this.title, { body: this.body, silent: this.silent });
    } else if (
      "Notification" in window &&
      Notification.permission !== "denied"
    ) {
      Notification.requestPermission().then((perm) => {
        if (perm === "granted") {
          new Notification(this.title, {
            body: this.body,
            silent: this.silent,
          });
        }
      });
    }
  }

  close() {}

  on(event, handler) {
    this._handlers[event] = handler;
    return this;
  }

  static isSupported() {
    return "Notification" in window;
  }
}
