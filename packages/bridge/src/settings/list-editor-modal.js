import { Modal, Setting, Notice } from "obsidian";

// Modal editor for a list of string entries (the proxy host allowlist).
class ListEditorModal extends Modal {
  constructor(app, opts) {
    super(app);
    this.opts = opts;
    this.values = [...(opts.values || [])];
  }

  onOpen() {
    this.titleEl.setText(this.opts.title);

    if (this.opts.recommended) {
      new Setting(this.contentEl)
        .setDesc(this.opts.recommended.note)
        .addButton((btn) =>
          btn
            .setButtonText(
              this.opts.recommended.buttonText || "Add recommended",
            )
            .onClick(() => this.addRecommended()),
        );
    }

    this.listEl = this.contentEl.createDiv("ignis-list-editor");
    this.renderList();

    new Setting(this.contentEl)
      .setName("Add entry")
      .addText((text) => {
        this.input = text;
        text.setPlaceholder(this.opts.placeholder || "");

        text.inputEl.addEventListener("keydown", (e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            this.addCurrent();
          }
        });
      })
      .addButton((btn) =>
        btn
          .setButtonText("Add")
          .setCta()
          .onClick(() => this.addCurrent()),
      );
  }

  addEntry(entry) {
    if (this.values.includes(entry)) {
      return false;
    }

    this.values.push(entry);
    return true;
  }

  addCurrent() {
    const entry = this.input.getValue().trim();

    if (!entry) {
      return;
    }

    if (!this.addEntry(entry)) {
      new Notice("That entry is already in the list.");
      return;
    }

    this.input.setValue("");
    this.input.inputEl.focus();
    this.commit();
    this.renderList();
  }

  addRecommended() {
    let added = 0;

    for (const host of this.opts.recommended.hosts) {
      if (this.addEntry(host)) {
        added++;
      }
    }

    if (added > 0) {
      this.commit();
      this.renderList();
    }

    new Notice(
      added > 0
        ? `Added ${added} host${added === 1 ? "" : "s"}.`
        : "All recommended hosts are already in the list.",
    );
  }

  remove(entry) {
    this.values = this.values.filter((v) => v !== entry);
    this.commit();
    this.renderList();
  }

  renderList() {
    this.listEl.empty();

    if (this.values.length === 0) {
      this.listEl.createDiv({
        text: this.opts.emptyNote,
        cls: "ignis-list-empty",
      });
      return;
    }

    for (const entry of this.values) {
      new Setting(this.listEl).setName(entry).addExtraButton((btn) =>
        btn
          .setIcon("trash-2")
          .setTooltip("Remove")
          .onClick(() => this.remove(entry)),
      );
    }
  }

  commit() {
    this.opts.onChange([...this.values]);
  }

  onClose() {
    this.contentEl.empty();
  }
}

export { ListEditorModal };
