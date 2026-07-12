import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

// Generate the docs Changelog page from the repo-root CHANGELOG.md.
// Drop the top-level heading and intro line, and use frontmatter instead.
// Fix relative links to absolute.

const REPO = "https://github.com/Nystik-gh/ignis/blob/main/";

const here = dirname(fileURLToPath(import.meta.url));
const source = resolve(here, "../../../CHANGELOG.md");
const target = resolve(here, "../src/content/docs/changelog.md");

const frontmatter = `---
title: Changelog
description: Notable changes to Ignis.
tableOfContents:
  minHeadingLevel: 2
  maxHeadingLevel: 2
---

`;

const raw = readFileSync(source, "utf8");

const start = raw.indexOf("\n## [");

if (start === -1) {
  throw new Error("gen-changelog: no version headings found in CHANGELOG.md");
}

let body = raw.slice(start + 1).trimEnd() + "\n";

body = body.replace(
  /\]\((?!https?:\/\/|\/|#|mailto:)([^)]+)\)/g,
  (_, path) => `](${REPO}${path})`,
);

writeFileSync(target, frontmatter + body);

console.log(`gen-changelog: wrote ${target.replace(/\\/g, "/")}`);
