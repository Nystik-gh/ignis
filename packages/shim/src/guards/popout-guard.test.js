import { describe, it, expect, beforeEach } from "vitest";
import {
  initPopoutGuard,
  installPopoutOverrides,
  isLayoutPath,
} from "./popout-guard.js";
import {
  applyReadTransform,
  applyWriteTransform,
  _reset,
} from "../fs/transforms.js";

const WORKSPACE = ".obsidian/workspace.json";
const NAMED = ".obsidian/workspace.Work.json";
const WORKSPACES = ".obsidian/workspaces.json";

const FLOATING = {
  id: "f1",
  type: "split",
  children: [
    {
      id: "w1",
      type: "window",
      children: [
        {
          id: "t1",
          type: "tabs",
          children: [
            {
              id: "l1",
              type: "leaf",
              state: { type: "markdown", state: { file: "Ref.md" } },
            },
          ],
        },
      ],
      direction: "vertical",
      x: 100,
      y: 100,
      width: 800,
      height: 600,
      maximize: false,
      zoom: 0,
    },
  ],
  direction: "horizontal",
};

function layout(extra = {}) {
  return {
    main: { id: "m1", type: "split", children: [], direction: "vertical" },
    left: { id: "s1", type: "split", children: [], direction: "horizontal" },
    right: { id: "s2", type: "split", children: [], direction: "horizontal" },
    active: "l1",
    ...extra,
  };
}

beforeEach(() => {
  _reset();
  initPopoutGuard();
});

describe("isLayoutPath", () => {
  it("matches workspace.json and the per-workspace files only", () => {
    expect(isLayoutPath(WORKSPACE)).toBe(true);
    expect(isLayoutPath(NAMED)).toBe(true);
    expect(isLayoutPath(".obsidian/workspace.My Space 1.json")).toBe(true);
    expect(isLayoutPath(WORKSPACES)).toBe(false);
    expect(isLayoutPath(".obsidian/workspace-mobile.json")).toBe(false);
    expect(isLayoutPath("notes/workspace.json")).toBe(false);
  });
});

describe("layout files", () => {
  it("loads a layout without its floating windows", () => {
    const read = JSON.parse(
      applyReadTransform(
        WORKSPACE,
        JSON.stringify(layout({ floating: FLOATING })),
      ),
    );

    expect(read.floating).toBeUndefined();
    expect(read.main).toEqual(layout().main);
    expect(read.active).toBe("l1");
  });

  it("puts the floating windows back on save", () => {
    applyReadTransform(
      WORKSPACE,
      JSON.stringify(layout({ floating: FLOATING })),
    );

    const saved = JSON.parse(
      applyWriteTransform(WORKSPACE, JSON.stringify(layout({ active: "x" }))),
    );

    expect(saved.floating).toEqual(FLOATING);
    expect(saved.active).toBe("x");
  });

  it("leaves a save untouched when the file had no floating windows", () => {
    applyReadTransform(WORKSPACE, JSON.stringify(layout()));

    const text = JSON.stringify(layout(), null, 2);

    expect(applyWriteTransform(WORKSPACE, text)).toBe(text);
  });

  it("forgets the floating windows once a read shows them gone", () => {
    applyReadTransform(
      WORKSPACE,
      JSON.stringify(layout({ floating: FLOATING })),
    );
    applyReadTransform(WORKSPACE, JSON.stringify(layout()));

    const text = JSON.stringify(layout());

    expect(applyWriteTransform(WORKSPACE, text)).toBe(text);
  });

  it("treats an empty floating split as no windows", () => {
    const empty = { ...FLOATING, children: [] };

    applyReadTransform(WORKSPACE, JSON.stringify(layout({ floating: empty })));

    const text = JSON.stringify(layout());

    expect(applyWriteTransform(WORKSPACE, text)).toBe(text);
  });

  it("remembers per file", () => {
    applyReadTransform(NAMED, JSON.stringify(layout({ floating: FLOATING })));
    applyReadTransform(WORKSPACE, JSON.stringify(layout()));

    const plain = JSON.stringify(layout());

    expect(applyWriteTransform(WORKSPACE, plain)).toBe(plain);
    expect(JSON.parse(applyWriteTransform(NAMED, plain)).floating).toEqual(
      FLOATING,
    );
  });

  it("reads bytes as well as text", () => {
    const bytes = new TextEncoder().encode(
      JSON.stringify(layout({ floating: FLOATING })),
    );

    expect(JSON.parse(applyReadTransform(WORKSPACE, bytes)).floating).toBe(
      undefined,
    );
  });
});

describe("workspaces.json presets", () => {
  const file = (presets) =>
    JSON.stringify({ workspaces: presets, active: "A" });

  it("loads every preset without its floating windows", () => {
    const read = JSON.parse(
      applyReadTransform(
        WORKSPACES,
        file({ A: layout({ floating: FLOATING }), B: layout() }),
      ),
    );

    expect(read.workspaces.A.floating).toBeUndefined();
    expect(read.workspaces.B.floating).toBeUndefined();
    expect(read.active).toBe("A");
  });

  it("puts a preset's floating windows back when it is saved", () => {
    applyReadTransform(
      WORKSPACES,
      file({ A: layout({ floating: FLOATING }), B: layout() }),
    );

    const saved = JSON.parse(
      applyWriteTransform(
        WORKSPACES,
        file({ A: layout({ active: "x" }), B: layout(), C: layout() }),
      ),
    );

    expect(saved.workspaces.A.floating).toEqual(FLOATING);
    expect(saved.workspaces.A.active).toBe("x");
    expect(saved.workspaces.B.floating).toBeUndefined();
    expect(saved.workspaces.C.floating).toBeUndefined();
  });

  it("does not resurrect a deleted preset", () => {
    applyReadTransform(WORKSPACES, file({ A: layout({ floating: FLOATING }) }));

    const saved = JSON.parse(
      applyWriteTransform(WORKSPACES, file({ B: layout() })),
    );

    expect(saved.workspaces.A).toBeUndefined();
  });

  it("leaves a save untouched when no preset had floating windows", () => {
    applyReadTransform(WORKSPACES, file({ A: layout() }));

    const text = file({ A: layout() });

    expect(applyWriteTransform(WORKSPACES, text)).toBe(text);
  });
});

describe("installPopoutOverrides", () => {
  function fakeObsidian() {
    const notices = [];

    class Notice {
      constructor(text) {
        notices.push(text);
      }
    }

    class Workspace {
      constructor() {
        this.rootSplit = { id: "root" };
        this.tabs = [];
      }

      getLeaf(kind) {
        const leaf = { kind };
        this.tabs.push(leaf);
        return leaf;
      }

      moveLeafToPopout() {
        throw new Error("original");
      }

      openPopoutLeaf() {
        throw new Error("original");
      }

      openPopout() {
        throw new Error("original");
      }

      isWorkspaceFocused() {
        return false;
      }
    }

    const Platform = {
      isDesktopApp: true,
      isDesktop: true,
      get canPopoutWindow() {
        return this.isDesktopApp && this.isDesktop;
      },
    };

    return { Workspace, Platform, Notice, notices };
  }

  it("turns the pop-out flag off", () => {
    const obsidian = fakeObsidian();

    installPopoutOverrides(obsidian);

    expect(obsidian.Platform.canPopoutWindow).toBe(false);
  });

  it("opens a pop-out leaf as a tab", () => {
    const obsidian = fakeObsidian();
    installPopoutOverrides(obsidian);
    const workspace = new obsidian.Workspace();

    const leaf = workspace.openPopoutLeaf();

    expect(leaf.kind).toBe("tab");
    expect(workspace.tabs).toEqual([leaf]);
  });

  it("leaves a moved tab where it is", () => {
    const obsidian = fakeObsidian();
    installPopoutOverrides(obsidian);
    const workspace = new obsidian.Workspace();
    const parent = { children: ["leaf"] };

    expect(workspace.moveLeafToPopout({ parent })).toBeUndefined();
    expect(parent.children).toEqual(["leaf"]);
    expect(workspace.tabs).toEqual([]);
  });

  it("hands a direct openPopout caller the main pane", () => {
    const obsidian = fakeObsidian();
    installPopoutOverrides(obsidian);
    const workspace = new obsidian.Workspace();

    expect(workspace.openPopout()).toBe(workspace.rootSplit);
  });

  it("reports the workspace as focused", () => {
    const obsidian = fakeObsidian();
    installPopoutOverrides(obsidian);
    const workspace = new obsidian.Workspace();

    expect(workspace.isWorkspaceFocused()).toBe(true);
  });

  it("shows the notice once", () => {
    const obsidian = fakeObsidian();
    installPopoutOverrides(obsidian);
    const workspace = new obsidian.Workspace();

    workspace.openPopoutLeaf();
    workspace.moveLeafToPopout({});
    workspace.openPopout();

    expect(obsidian.notices).toEqual([
      "Pop-out windows aren't available in the browser.",
    ]);
  });
});
