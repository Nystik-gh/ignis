import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";

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
              badge: { text: "v0.8.8", variant: "note" },
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
          items: [{ label: "Troubleshooting", slug: "troubleshooting" }],
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
