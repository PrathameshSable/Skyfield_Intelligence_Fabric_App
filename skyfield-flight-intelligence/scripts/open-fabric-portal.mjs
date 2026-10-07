#!/usr/bin/env node
// Composes the Fabric portal embed URL (pointed at your local dev server) from
// the env that `npx rayfin up` writes, prints it, and tries to open it in your
// default browser. Rayfin apps only render inside the portal, so this is the
// local dev loop: run `npm run dev` in one terminal, `npm run test:fabric` here.
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { spawn } from "node:child_process";
import { platform } from "node:os";

function parseEnvFile(file) {
  return Object.fromEntries(
    readFileSync(file, "utf8")
      .split("\n")
      .filter((l) => l && !l.startsWith("#") && l.includes("="))
      .map((l) => {
        const i = l.indexOf("=");
        return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")];
      }),
  );
}

const cwd = process.cwd();
const files = [".env.local", ".env.fabric", "rayfin/.env"].map((f) => resolve(cwd, f)).filter(existsSync);
if (files.length === 0) {
  console.error("Missing .env.local / .env.fabric / rayfin/.env — run `npx rayfin up` first.");
  process.exit(1);
}
const env = files.reduce((acc, f) => ({ ...parseEnvFile(f), ...acc }), {});

const portal = (env.VITE_FABRIC_PORTAL_URL || "https://app.fabric.microsoft.com").replace(/\/$/, "");
const ws = env.VITE_FABRIC_WORKSPACE_ID;
const item = env.VITE_FABRIC_ITEM_ID;
const dev = process.env.DEV_URL || "http://localhost:5174";

if (!ws || !item) {
  console.error("Need VITE_FABRIC_WORKSPACE_ID and VITE_FABRIC_ITEM_ID (written by `npx rayfin up`).");
  process.exit(1);
}

const url = `${portal}/groups/${ws}/appbackends/${item}?experience=power-bi&devUri=${encodeURIComponent(dev)}`;
console.log(`Opening Fabric portal embed → ${url}`);
console.log("Sign in to Microsoft if prompted. Make sure `npm run dev` is running.");

const opener = platform() === "darwin" ? "open" : platform() === "win32" ? "start" : "xdg-open";
spawn(opener, [url], { stdio: "ignore", shell: true, detached: true }).unref();
