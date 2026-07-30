import { readFileSync } from "node:fs";
import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";

// The sidebar badge tracks the released server version.
const { version } = JSON.parse(
  readFileSync(new URL("../../package.json", import.meta.url), "utf-8"),
);

// Docs are served under the /docs base path; the site root is reserved for a separate landing page.
export default defineConfig({
  site: "https://ignis.thiefling.com",
  base: "/docs",
  outDir: "./dist/docs",
  integrations: [
    starlight({
      title: "Ignis",
      logo: { src: "./src/assets/ignis.png" },
      favicon: "/favicon.png",
      social: [
        {
          icon: "github",
          label: "GitHub",
          href: "https://github.com/Nystik-gh/ignis",
        },
      ],
      customCss: ["./src/styles/theme.css"],
      components: {
        // Preload the fonts
        Head: "./src/components/Head.astro",
        // Custom header.
        Header: "./src/components/Header.astro",
        // Custom breadcrumbs
        PageTitle: "./src/components/PageTitle.astro",
        // remove previous/next pagination.
        Pagination: "./src/components/EmptyPagination.astro",
      },
      sidebar: [
        {
          label: "Getting started",
          items: [
            { label: "Overview", link: "/" },
            { label: "Requirements", slug: "requirements" },
          ],
        },
        {
          label: "Using Ignis",
          items: [
            { label: "Features", slug: "using/features" },
            { label: "Limitations", slug: "using/limitations" },
            {
              label: "Plugin compatibility",
              slug: "using/plugin-compatibility",
            },
            { label: "Settings", slug: "using/settings" },
            { label: "Server plugins", slug: "using/server-plugins" },
          ],
        },
        {
          label: "Running Ignis",
          items: [
            {
              label: "Self-hosted server",
              badge: { text: `v${version}`, variant: "note" },
              items: [
                { label: "Deploy with Docker", slug: "server/deploy" },
                { label: "Environment variables", slug: "server/environment" },
                { label: "Updating", slug: "server/updating" },
              ],
            },
          ],
        },
        {
          label: "Security",
          items: [
            { label: "Remote access", slug: "security/remote-access" },
            { label: "Authentication", slug: "security/authentication" },
            { label: "Hardening", slug: "security/hardening" },
          ],
        },
        {
          label: "Help",
          items: [
            { label: "Troubleshooting", slug: "troubleshooting" },
            { label: "Sync connectivity", slug: "sync" },
          ],
        },
        {
          label: "About",
          items: [
            { label: "Changelog", slug: "changelog" },
            { label: "Roadmap", slug: "roadmap" },
          ],
        },
      ],
    }),
  ],
});
