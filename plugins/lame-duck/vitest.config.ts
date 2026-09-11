import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "lame-duck-server",
          include: ["server.test.ts"],
          isolate: false,
        },
      },
      {
        test: {
          name: "lame-duck-app",
          include: ["app.test.tsx"],
          environment: "jsdom",
          isolate: true,
        },
      },
    ],
  },
});
