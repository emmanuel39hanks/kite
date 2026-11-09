import path from "node:path";
import { Config } from "@remotion/cli/config";
import { enableTailwind } from "@remotion/tailwind-v4";

// Kite's real components live in apps/web; the film imports them through the same `@/` alias and swaps the two
// Next-only pieces (next/image, next/link) for plain elements that Remotion can wait on.
Config.setPublicDir(path.join(process.cwd(), "../web/public"));
// Lossless frames: every frame is captured as PNG before encoding, so text and hairlines stay crisp.
Config.setVideoImageFormat("png");
Config.overrideWebpackConfig((config) => {
  const withTw = enableTailwind(config);
  return {
    ...withTw,
    resolve: {
      ...withTw.resolve,
      alias: {
        ...(withTw.resolve?.alias as Record<string, string>),
        "@": path.join(process.cwd(), "../web/src"),
        "next/image": path.join(process.cwd(), "src/shims/next-image.tsx"),
        "next/link": path.join(process.cwd(), "src/shims/next-link.tsx"),
      },
    },
  };
});
