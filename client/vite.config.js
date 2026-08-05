import { defineConfig } from "vite";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const clientDirectory = path.dirname(fileURLToPath(import.meta.url));
const serverDirectory = path.resolve(clientDirectory, "../server");

async function apiIsOnline() {
  try {
    const response = await fetch("http://127.0.0.1:5000/api/health", {
      signal: AbortSignal.timeout(1200),
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function waitForApi() {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (await apiIsOnline()) return true;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("WebMatrix API did not become ready within 15 seconds");
}

function managedApi() {
  let apiProcess;
  let closing = false;
  let restartTimer;
  const startApi = (viteServer) => {
    apiProcess = spawn(process.execPath, ["--use-system-ca", "src/server.js"], {
      cwd: serverDirectory,
      env: process.env,
      stdio: "inherit",
    });
    apiProcess.once("exit", (code) => {
      apiProcess = undefined;
      if (closing) return;
      if (code) console.error(`WebMatrix API stopped with code ${code}`);
      restartTimer = setTimeout(async () => {
        if (!closing && !(await apiIsOnline())) startApi(viteServer);
      }, 1500);
    });
  };
  return {
    name: "webmatrix-managed-api",
    apply: "serve",
    async configureServer(viteServer) {
      if (!(await apiIsOnline())) {
        startApi(viteServer);
        await waitForApi();
      }
      viteServer.httpServer?.once("close", () => {
        closing = true;
        clearTimeout(restartTimer);
        if (apiProcess && !apiProcess.killed) apiProcess.kill();
      });
    },
  };
}

export default defineConfig({
  plugins: [managedApi()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: false,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:5000",
        changeOrigin: true,
      },
    },
  },
});
