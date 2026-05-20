export class menuShim {
  constructor() {
    this.items = [];
  }

  static buildFromTemplate(template) {
    const menu = new menuShim();
    menu.items = (template || []).map((item) => new menuItemShim(item));

    return menu;
  }

  static setApplicationMenu(menu) {
    console.log("[shim:Menu] setApplicationMenu (stub)");
  }

  static getApplicationMenu() {
    return null;
  }

  popup(options) {
    console.log("[shim:Menu] popup (stub)", options);
  }

  append(menuItem) {
    this.items.push(menuItem);
  }

  insert(pos, menuItem) {
    this.items.splice(pos, 0, menuItem);
  }

  closePopup() {}
}

export class menuItemShim {
  constructor(options = {}) {
    this.label = options.label || "";
    this.type = options.type || "normal";
    this.click = options.click || null;
    this.role = options.role || null;
    this.accelerator = options.accelerator || "";
    this.enabled = options.enabled !== false;
    this.visible = options.visible !== false;
    this.checked = !!options.checked;
    this.submenu = options.submenu
      ? menuShim.buildFromTemplate(
          Array.isArray(options.submenu) ? options.submenu : [],
        )
      : null;
    this.id = options.id || "";
  }
}
