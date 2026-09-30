/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import { createHash } from 'node:crypto';
import { hostname } from 'node:os';
export async function getConsistentMachineId(salt = 'opencursor') { return createHash('sha256').update(hostname() + salt).digest('hex').slice(0, 16); }
