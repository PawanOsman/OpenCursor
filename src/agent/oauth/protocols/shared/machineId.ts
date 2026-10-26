/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { hostname } from "node:os";

// 9router uses the `node-machine-id` package (machineIdSync(), i.e. the
// sha256 of the OS machine GUID). We do not ship that dependency, so this is
// a dependency-free port of the same lookup. Where 9router falls back to a
// random per-process UUID, we fall back to the hostname so the id stays stable
// across restarts.
let cachedRawId: string | null = null;

const EXEC_OPTIONS = {
  encoding: "utf8" as const,
  windowsHide: true,
  timeout: 5000,
  stdio: ["ignore", "pipe", "ignore"] as ["ignore", "pipe", "ignore"],
};

function readOsMachineId(): string {
  switch (process.platform) {
    case "win32": {
      const out = execSync("REG QUERY HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Cryptography /v MachineGuid", EXEC_OPTIONS);
      return (out.split("REG_SZ")[1] || "").replace(/\r+|\n+|\s+/gi, "").toLowerCase();
    }
    case "darwin": {
      const out = execSync("ioreg -rd1 -c IOPlatformExpertDevice", EXEC_OPTIONS);
      return (out.split("IOPlatformUUID")[1] || "").split("\n")[0].replace(/=|\s+|"/gi, "").toLowerCase();
    }
    case "linux": {
      for (const file of ["/var/lib/dbus/machine-id", "/etc/machine-id"]) {
        try {
          const id = readFileSync(file, "utf8").split("\n")[0].trim();
          if (id) return id.toLowerCase();
        } catch {
          // try next source
        }
      }
      return hostname().toLowerCase();
    }
    case "freebsd": {
      const out = execSync("kenv -q smbios.system.uuid || sysctl -n kern.hostuuid", EXEC_OPTIONS);
      return out.split("\n")[0].replace(/\r+|\n+|\s+/gi, "").toLowerCase();
    }
    default:
      return "";
  }
}

function loadRawMachineId(): string {
  if (cachedRawId) return cachedRawId;
  let id = "";
  try {
    id = readOsMachineId();
  } catch {
    id = "";
  }
  if (!id) id = hostname();
  // node-machine-id's machineIdSync() returns sha256(id) unless `original` is requested.
  cachedRawId = createHash("sha256").update(id).digest("hex");
  return cachedRawId;
}

export async function getConsistentMachineId(salt = "endpoint-proxy-salt") {
  const rawId = loadRawMachineId();
  return createHash("sha256").update(rawId + salt).digest("hex").substring(0, 16);
}
