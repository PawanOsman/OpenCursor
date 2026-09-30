/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import { expect, it } from "vitest";
import { VerificationLedger } from "./verification";
it("invalidates checks after edits and records rerun evidence", () => {
  const ledger = new VerificationLedger();
  ledger.check("npm test", { status: "completed", exitCode: 0 });
  expect(ledger.snapshot().status).toBe("checks-passed");
  ledger.changedFile("src/a.ts");
  expect(ledger.snapshot().status).toBe("untested");
  ledger.check("npm test", { status: "failed", exitCode: 1 });
  expect(ledger.snapshot().status).toBe("checks-failed");
  ledger.check("npm test", { status: "completed", exitCode: 0 });
  expect(ledger.snapshot().status).toBe("checks-passed");
  expect(ledger.snapshot().checks).toHaveLength(3);
});
it("settles background checks without certifying edits made after they started", () => {
  const ledger = new VerificationLedger();
  ledger.check("npm test", { status: "running", jobId: "job" });
  ledger.settle({ status: "completed", exitCode: 0, jobId: "job" });
  expect(ledger.snapshot().status).toBe("checks-passed");
  ledger.check("npm test", { status: "running", jobId: "job2" });
  ledger.changedFile("new.ts");
  ledger.settle({ status: "completed", exitCode: 0, jobId: "job2" });
  expect(ledger.snapshot().status).toBe("untested");
});
