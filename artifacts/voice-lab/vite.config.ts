import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";

const rawPort = process.env.PORT;

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const basePath = process.env.BASE_PATH;

if (!basePath) {
  throw new Error(
    "BASE_PATH environment variable is required but was not provided.",
  );
}

// Server-side proxy for ElevenLabs. The API key stays in Node — never sent to the browser.
function elevenlabsProxyPlugin(): Plugin {
  return {
    name: "elevenlabs-proxy",
    configureServer(server) {
      const proxyPath = `${basePath.replace(/\/$/, "")}/api/tts`;
      server.middlewares.use(proxyPath, async (req, res) => {
        if (req.method !== "POST") {
          res.statusCode = 405;
          res.end("Method not allowed");
          return;
        }
        try {
          const chunks: Buffer[] = [];
          for await (const chunk of req as AsyncIterable<Buffer>) {
            chunks.push(chunk);
          }
          const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));

          const apiKey = process.env.ELEVENLABS_API_KEY;
          if (!apiKey) {
            res.statusCode = 500;
            res.setHeader("Content-Type", "text/plain");
            res.end(
              "ELEVENLABS_API_KEY is not set in Replit Secrets. Add it under the Secrets tab and restart the workflow.",
            );
            return;
          }

          const voiceId = body.voice_id || process.env.ELEVENLABS_VOICE_ID;
          if (!voiceId) {
            res.statusCode = 400;
            res.setHeader("Content-Type", "text/plain");
            res.end(
              "voice_id is required. Either type a voice ID into the column, or add ELEVENLABS_VOICE_ID to Replit Secrets.",
            );
            return;
          }

          const elResponse = await fetch(
            `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(
              String(voiceId),
            )}`,
            {
              method: "POST",
              headers: {
                Accept: "audio/mpeg",
                "Content-Type": "application/json",
                "xi-api-key": apiKey,
              },
              body: JSON.stringify({
                text: body.text,
                model_id: body.model_id,
                voice_settings: body.voice_settings,
              }),
            },
          );

          if (!elResponse.ok) {
            const errText = await elResponse.text();
            res.statusCode = elResponse.status;
            res.setHeader("Content-Type", "text/plain");
            res.end(`ElevenLabs ${elResponse.status}: ${errText}`);
            return;
          }

          const buf = Buffer.from(await elResponse.arrayBuffer());
          res.statusCode = 200;
          res.setHeader("Content-Type", "audio/mpeg");
          res.setHeader("Content-Length", String(buf.length));
          res.setHeader("Cache-Control", "no-store");
          res.end(buf);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          res.statusCode = 500;
          res.setHeader("Content-Type", "text/plain");
          res.end(`Proxy error: ${msg}`);
        }
      });
    },
  };
}

export default defineConfig({
  base: basePath,
  plugins: [
    react(),
    tailwindcss(),
    runtimeErrorOverlay(),
    elevenlabsProxyPlugin(),
    ...(process.env.NODE_ENV !== "production" &&
    process.env.REPL_ID !== undefined
      ? [
          await import("@replit/vite-plugin-cartographer").then((m) =>
            m.cartographer({
              root: path.resolve(import.meta.dirname, ".."),
            }),
          ),
          await import("@replit/vite-plugin-dev-banner").then((m) =>
            m.devBanner(),
          ),
        ]
      : []),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      "@assets": path.resolve(import.meta.dirname, "..", "..", "attached_assets"),
    },
    dedupe: ["react", "react-dom"],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
  },
  server: {
    port,
    strictPort: true,
    host: "0.0.0.0",
    allowedHosts: true,
    fs: {
      strict: true,
    },
  },
  preview: {
    port,
    host: "0.0.0.0",
    allowedHosts: true,
  },
});
