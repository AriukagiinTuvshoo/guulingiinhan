import { bindings, defineConfig, defineWorker } from "cf/config";

export default defineConfig({
  worker: defineWorker({
    name: "guulingiinhan-staging",
    entrypoint: "vinext/server/fetch-handler",
    compatibilityDate: "2026-09-28",
    compatibilityFlags: ["nodejs_compat"],
    assets: { notFoundHandling: "none" },
    env: {
      ASSETS: bindings.assets(),
    },
  }),
});
