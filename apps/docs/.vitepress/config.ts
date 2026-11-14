import { defineConfig } from "vitepress";

export default defineConfig({
  title: "effect-native-query",
  description: "TanStack-Query-style server state for React, built on Effect and Effect Atoms.",
  cleanUrls: true,
  themeConfig: {
    nav: [
      { text: "Guide", link: "/guide/getting-started" },
      { text: "Examples", link: "/examples" },
      { text: "From TanStack Query", link: "/guide/from-tanstack" },
    ],
    sidebar: [
      {
        text: "Introduction",
        items: [
          { text: "Getting started", link: "/guide/getting-started" },
          { text: "Coming from TanStack Query", link: "/guide/from-tanstack" },
        ],
      },
      {
        text: "Guides",
        items: [
          { text: "Queries", link: "/guide/queries" },
          { text: "React hooks", link: "/guide/react" },
          { text: "Mutations", link: "/guide/mutations" },
          { text: "Infinite queries", link: "/guide/infinite-queries" },
          { text: "Suspense & error boundaries", link: "/guide/suspense" },
          { text: "The QueryClient", link: "/guide/query-client" },
          { text: "Persistence & offline", link: "/guide/persistence" },
          { text: "Devtools", link: "/guide/devtools" },
          { text: "Testing", link: "/guide/testing" },
        ],
      },
      { text: "Examples", link: "/examples" },
    ],
    search: { provider: "local" },
  },
});
