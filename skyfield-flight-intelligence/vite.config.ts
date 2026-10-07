import { defineConfig, type PluginOption } from "vite";
import react from "@vitejs/plugin-react-swc";
import { resolve } from "path";

const projectRoot = process.env.PROJECT_ROOT || import.meta.dirname;

// Dev-only: lets the Fabric portal (a public origin) embed http://localhost in
// an iframe under browsers enforcing Local Network Access checks.
const localNetworkAccessPlugin: PluginOption = {
  name: "local-network-access-headers",
  configureServer(server) {
    server.middlewares.use((req, res, next) => {
      res.setHeader("Access-Control-Allow-Private-Network", "true");
      if (req.method === "OPTIONS" && req.headers["access-control-request-private-network"]) {
        const origin = req.headers.origin || "*";
        res.setHeader("Access-Control-Allow-Origin", origin);
        res.setHeader("Access-Control-Allow-Credentials", "true");
        res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
        res.setHeader("Access-Control-Allow-Headers", req.headers["access-control-request-headers"] || "*");
        res.statusCode = 204;
        res.end();
        return;
      }
      next();
    });
  },
};

export default defineConfig({
  plugins: [react(), localNetworkAccessPlugin],
  resolve: {
    alias: { "@": resolve(projectRoot, "src") },
  },
  server: { port: 5174 },
  optimizeDeps: {
    include: [
      "@microsoft/fabric-app-data",
      "@microsoft/fabric-app-data-embed-client",
      "@microsoft/fabric-app-data-proxy",
    ],
  },
  build: {
    commonjsOptions: { include: [/node_modules/] },
  },
});
