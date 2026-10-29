// Usage: npm run build
// Bundles src/cli.ts into the skill folder, so the folder works on its own (Claude Code plugin or Codex skill).
import { build } from "esbuild";

await build({
  entryPoints: ["src/cli.ts"],
  outfile: "plugin/skills/kol-find/scripts/kol-find.mjs",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  banner: {
    // apify-client is CommonJS and calls require() at load time; an ES module has none of its own.
    js: [
      "#!/usr/bin/env node",
      'import { createRequire as __kfCreateRequire } from "node:module";',
      "const require = __kfCreateRequire(import.meta.url);",
    ].join("\n"),
  },
});
