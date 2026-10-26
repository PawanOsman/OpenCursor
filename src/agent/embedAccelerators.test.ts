/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import { describe, expect, it } from "vitest";
import { parseAcceleratorId, parseDxgiAdapters, parseNvidiaSmi, readableProviderError } from "./embedAccelerators";

describe("embedding accelerator discovery", () => {
  it("lists DXGI hardware adapters by their DirectML index and skips software adapters", () => {
    // Captured from a laptop with an integrated AMD GPU and two identical NVIDIA cards.
    const out = [
      "0\t0\t4098\t2119970816\tAMD Radeon(TM) Graphics",
      "1\t0\t4318\t50924093440\tNVIDIA RTX PRO 5000 Blackwell",
      "2\t0\t4318\t50924093440\tNVIDIA RTX PRO 5000 Blackwell",
      "3\t0\t5140\t0\tMicrosoft Basic Render Driver",
      "4\t2\t5140\t0\tMicrosoft Basic Render Driver",
      "",
    ].join("\r\n");
    expect(parseDxgiAdapters(out)).toEqual([
      { id: "dml:0", kind: "gpu", backend: "dml", deviceId: 0, name: "AMD Radeon(TM) Graphics", memoryBytes: 2119970816 },
      { id: "dml:1", kind: "gpu", backend: "dml", deviceId: 1, name: "NVIDIA RTX PRO 5000 Blackwell #1", memoryBytes: 50924093440 },
      { id: "dml:2", kind: "gpu", backend: "dml", deviceId: 2, name: "NVIDIA RTX PRO 5000 Blackwell #2", memoryBytes: 50924093440 },
    ]);
  });

  it("ignores PowerShell noise around the adapter list", () => {
    expect(parseDxgiAdapters("#< CLIXML\n<Objs Version=\"1.1.0.1\"></Objs>")).toEqual([]);
  });

  it("lists CUDA devices from nvidia-smi", () => {
    expect(parseNvidiaSmi("0, NVIDIA GeForce RTX 4060 Laptop GPU, 8188\n1, NVIDIA A100-SXM4-80GB, 81920\n")).toEqual([
      { id: "cuda:0", kind: "gpu", backend: "cuda", deviceId: 0, name: "NVIDIA GeForce RTX 4060 Laptop GPU", memoryBytes: 8188 * 1024 ** 2 },
      { id: "cuda:1", kind: "gpu", backend: "cuda", deviceId: 1, name: "NVIDIA A100-SXM4-80GB", memoryBytes: 81920 * 1024 ** 2 },
    ]);
    expect(parseNvidiaSmi("NVIDIA-SMI has failed because it couldn't communicate with the NVIDIA driver.")).toEqual([]);
  });

  it("treats unknown ids and ids from another OS as CPU", () => {
    expect(parseAcceleratorId("dml:1", "win32")).toEqual({ backend: "dml", deviceId: 1 });
    expect(parseAcceleratorId("cuda:0", "linux")).toEqual({ backend: "cuda", deviceId: 0 });
    expect(parseAcceleratorId("coreml", "darwin")).toEqual({ backend: "coreml" });
    expect(parseAcceleratorId("dml:1", "linux")).toEqual({ backend: "cpu" });
    expect(parseAcceleratorId("cuda:0", "win32")).toEqual({ backend: "cpu" });
    expect(parseAcceleratorId("webgpu", "win32")).toEqual({ backend: "cpu" });
    expect(parseAcceleratorId(undefined, "win32")).toEqual({ backend: "cpu" });
    expect(parseAcceleratorId("dml:x", "win32")).toEqual({ backend: "cpu" });
  });

  it("shortens native provider errors for the settings page", () => {
    const raw = "E:\\_work\\1\\s\\onnxruntime\\core\\providers\\dml\\dml_provider_factory.cc(513)\\onnxruntime.dll!00007FF8E2BBA588: (caller: 00007FF8E2BBA8AA) Exception(1) tid(afe0) 887A0002 The object was not found. If calling IDXGIFactory::EnumAdaptes, there is no adapter with the specified ordinal.";
    expect(readableProviderError(raw)).toBe("The object was not found. If calling IDXGIFactory::EnumAdaptes, there is no adapter with the specified ordinal.");
    expect(readableProviderError("CUDA driver version is insufficient\nstack")).toBe("CUDA driver version is insufficient");
  });
});
