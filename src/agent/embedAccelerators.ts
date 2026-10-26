/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import { execFile } from "child_process";

/**
 * Devices the local embedding model can run on. The id is persisted in
 * settings: "cpu", "dml:<adapter>" (Windows/DirectML), "cuda:<index>"
 * (Linux x64/CUDA) or "coreml" (macOS). Indexes are the ones the ONNX Runtime
 * provider expects as `deviceId`, so the picker and the session agree.
 */
export interface EmbedAccelerator {
  id: string;
  kind: "cpu" | "gpu";
  backend: "cpu" | "dml" | "cuda" | "coreml";
  deviceId?: number;
  name: string;
  memoryBytes?: number;
}

export const CPU_ACCELERATOR: EmbedAccelerator = { id: "cpu", kind: "cpu", backend: "cpu", name: "CPU" };

/** Parse a stored id; anything unknown (or from another OS) means CPU. */
export function parseAcceleratorId(id: string | undefined, platform: NodeJS.Platform = process.platform): Pick<EmbedAccelerator, "backend" | "deviceId"> {
  const m = /^(dml|cuda):(\d{1,2})$/.exec(id ?? "");
  if (m) {
    const backend = m[1] as "dml" | "cuda";
    if ((backend === "dml" && platform === "win32") || (backend === "cuda" && platform === "linux")) return { backend, deviceId: Number(m[2]) };
  }
  if (id === "coreml" && platform === "darwin") return { backend: "coreml" };
  return { backend: "cpu" };
}

/** ORT provider errors start with a native source path and an HRESULT; keep the readable part. */
export function readableProviderError(message: string): string {
  const line = message.split(/\r?\n/)[0];
  const hresult = /\b[0-9A-F]{8}\s+(.+)$/.exec(line);
  return (hresult ? hresult[1] : line).trim().slice(0, 300);
}

/** Duplicate model names (two identical cards) get "#2", "#3" so the picker stays unambiguous. */
function disambiguate(list: EmbedAccelerator[]): EmbedAccelerator[] {
  const counts = new Map<string, number>();
  for (const a of list) counts.set(a.name, (counts.get(a.name) ?? 0) + 1);
  const seen = new Map<string, number>();
  return list.map((a) => {
    if ((counts.get(a.name) ?? 0) < 2) return a;
    const n = (seen.get(a.name) ?? 0) + 1;
    seen.set(a.name, n);
    return { ...a, name: `${a.name} #${n}` };
  });
}

const DXGI_SOFTWARE_FLAG = 2;
const MICROSOFT_VENDOR_ID = 0x1414; // Basic Render Driver / WARP

/** Lines: "<adapter>\t<flags>\t<vendorId>\t<dedicatedVram>\t<description>". */
export function parseDxgiAdapters(text: string): EmbedAccelerator[] {
  const out: EmbedAccelerator[] = [];
  for (const line of text.split(/\r?\n/)) {
    const m = /^(\d+)\t(\d+)\t(\d+)\t(\d+)\t(.+)$/.exec(line.trim());
    if (!m) continue;
    const flags = Number(m[2]);
    const vendor = Number(m[3]);
    if (flags & DXGI_SOFTWARE_FLAG || vendor === MICROSOFT_VENDOR_ID) continue;
    const memory = Number(m[4]);
    out.push({ id: `dml:${m[1]}`, kind: "gpu", backend: "dml", deviceId: Number(m[1]), name: m[5].trim(), memoryBytes: memory > 0 ? memory : undefined });
  }
  return disambiguate(out);
}

/** `nvidia-smi --query-gpu=index,name,memory.total --format=csv,noheader,nounits` */
export function parseNvidiaSmi(text: string): EmbedAccelerator[] {
  const out: EmbedAccelerator[] = [];
  for (const line of text.split(/\r?\n/)) {
    const parts = line.split(",").map((p) => p.trim());
    if (parts.length < 3 || !/^\d+$/.test(parts[0])) continue;
    const mib = Number(parts[parts.length - 1]);
    const name = parts.slice(1, -1).join(",").trim();
    out.push({ id: `cuda:${parts[0]}`, kind: "gpu", backend: "cuda", deviceId: Number(parts[0]), name, memoryBytes: mib > 0 ? mib * 1024 ** 2 : undefined });
  }
  return disambiguate(out);
}

/**
 * DirectML's `deviceId` is the DXGI adapter index, which WMI does not expose
 * (its order can differ, and it caps VRAM at 4 GB), so ask DXGI directly.
 * IDXGIFactory1::EnumAdapters1 is vtable slot 12, IDXGIAdapter1::GetDesc1 slot 10.
 */
const DXGI_SCRIPT = `$ProgressPreference = 'SilentlyContinue'
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class OcDxgi {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct DESC1 {
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)] public string Description;
    public uint VendorId; public uint DeviceId; public uint SubSysId; public uint Revision;
    public UIntPtr DedicatedVideoMemory; public UIntPtr DedicatedSystemMemory; public UIntPtr SharedSystemMemory;
    public uint LuidLow; public int LuidHigh; public uint Flags;
  }
  [DllImport("dxgi.dll")] static extern int CreateDXGIFactory1(ref Guid riid, out IntPtr factory);
  delegate int EnumAdapters1Fn(IntPtr self, uint index, out IntPtr adapter);
  delegate int GetDesc1Fn(IntPtr self, out DESC1 desc);
  delegate uint ReleaseFn(IntPtr self);
  static T Slot<T>(IntPtr obj, int slot) {
    IntPtr vtbl = Marshal.ReadIntPtr(obj);
    return (T)(object)Marshal.GetDelegateForFunctionPointer(Marshal.ReadIntPtr(vtbl, slot * IntPtr.Size), typeof(T));
  }
  public static string List() {
    Guid iid = new Guid("770aae78-f26f-4dba-a829-253c83d1b387");
    IntPtr factory;
    if (CreateDXGIFactory1(ref iid, out factory) != 0) return "";
    var sb = new System.Text.StringBuilder();
    try {
      var enumAdapters = Slot<EnumAdapters1Fn>(factory, 12);
      for (uint i = 0; i < 16; i++) {
        IntPtr adapter;
        if (enumAdapters(factory, i, out adapter) != 0) break;
        try {
          DESC1 d;
          if (Slot<GetDesc1Fn>(adapter, 10)(adapter, out d) == 0)
            sb.AppendLine(i + "\\t" + d.Flags + "\\t" + d.VendorId + "\\t" + d.DedicatedVideoMemory.ToUInt64() + "\\t" + d.Description);
        } finally { Slot<ReleaseFn>(adapter, 2)(adapter); }
      }
    } finally { Slot<ReleaseFn>(factory, 2)(factory); }
    return sb.ToString();
  }
}
"@
[OcDxgi]::List()
`;

function run(file: string, args: string[], timeout: number): Promise<string> {
  return new Promise((resolve) => {
    execFile(file, args, { timeout, windowsHide: true, maxBuffer: 256 * 1024 }, (error, stdout) => resolve(error ? "" : String(stdout)));
  });
}

async function probe(): Promise<EmbedAccelerator[]> {
  switch (process.platform) {
    case "win32": {
      const encoded = Buffer.from(DXGI_SCRIPT, "utf16le").toString("base64");
      return parseDxgiAdapters(await run("powershell.exe", ["-NoProfile", "-NonInteractive", "-EncodedCommand", encoded], 15_000));
    }
    case "linux":
      if (process.arch !== "x64") return [];
      return parseNvidiaSmi(await run("nvidia-smi", ["--query-gpu=index,name,memory.total", "--format=csv,noheader,nounits"], 5_000));
    case "darwin":
      return [{ id: "coreml", kind: "gpu", backend: "coreml", name: "Apple GPU / Neural Engine (Core ML)" }];
    default:
      return [];
  }
}

let cached: Promise<EmbedAccelerator[]> | null = null;

/** CPU first, then every GPU the embedding runtime can target. Probed once per session. */
export function listEmbedAccelerators(refresh = false): Promise<EmbedAccelerator[]> {
  if (refresh || !cached) cached = probe().catch(() => []).then((gpus) => [CPU_ACCELERATOR, ...gpus]);
  return cached;
}
