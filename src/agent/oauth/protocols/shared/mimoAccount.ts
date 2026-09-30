/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import type { ProtocolValue, ProtocolRecord, ProtocolError } from "../wireTypes.js";
import crypto from "node:crypto";
import { proxyAwareFetch } from "../utils/proxyFetch.js";
/**
 * Xiaomi MiMo account-session helpers (used for weekly quota).
 *
 * The weekly quota endpoint lives on the account service domain and is authorized
 * by an account session cookie, NOT the sk- API key. Acquiring that cookie is a
 * 1:1 port of MiMo Desktop's ServiceTokenManager (app.asar) — the GOLD STANDARD:
 *
 *   getServiceToken(sid) / refreshServiceToken(sid):
 *     PHASE 1: GET https://account.xiaomi.com/pass/serviceLogin
 *                ?_locale=zh_CN&_snsNone=true&sid=<clusterSid>&_json=true
 *                Cookie: {userId, passToken, cUserId}
 *              -> {code, location, ssecurity, nonce, bSecondValidation, notificationUrl}
 *              -> code !== 0 is an error (never silent)
 *     PHASE 2: GET {location}&clientSign=sha1(nonce & ssecurity), follow the
 *              redirect chain absorbing Set-Cookie -> serviceToken
 *
 * sid is per-cluster (SID_BY_REGION): CN = mimopc, SGP = mimosgp.
 */
// Account-service cluster hosts. MiMo Desktop declares five regions
// (rn = {CN, SGP, RU, IN, EU}); the EU cluster is deployed in Amsterdam.
// Host + sid naming is unified: mimo-server-<code> / sid = mimo<code>
// (ams is the only non-country code). Verified live via /api/user/xiaomi/me.
const API_BASE_BY_REGION: Record<string, string> = {
    cn: "https://mimo-server-cn.xiaomimimo.com",
    sgp: "https://mimo-server-sgp.xiaomimimo.com",
    ams: "https://mimo-server-ams.xiaomimimo.com",
    ru: "https://mimo-server-ru.xiaomimimo.com",
    in: "https://mimo-server-in.xiaomimimo.com",
};
const DEFAULT_API_BASE = API_BASE_BY_REGION.sgp;
// Cluster service sid — 1:1 with the host code: mimo<code>.
// Unknown/absent region falls back to SGP (the international/open cluster).
const SID_BY_REGION: Record<string, string> = { cn: "mimopc", sgp: "mimosgp", ams: "mimoams", ru: "mimoru", in: "mimoin" };
function sidForRegion(region: string) {
    const r = String(region || "").toLowerCase();
    return SID_BY_REGION[r] || SID_BY_REGION.sgp;
}
const API_BASE = DEFAULT_API_BASE;
const ACCOUNT_HOST = "account.xiaomi.com";
const API_UA = "miNative PC/Normal Windows_NT/10.0.19045 SDKV/1.0.0 DEVT/PC DEVS/Windows APP/miaccount_desktop APPV/0.1.0";
const SSO_UA = "MiClaw/1.0";
const COOKIE_TTL_MS = 30 * 60 * 1000;
// Per-account session caches (keyed by passToken hash) so multiple Xiaomi
// accounts / connections can rotate without clobbering each other.
const _cache = new Map(); // key -> { cookie, at }
const _inflight = new Map(); // key -> Promise<cookie|null>
function signatureClientSign(nonce: ProtocolValue, ssecurity: ProtocolValue) {
    const input = `nonce=${nonce}` + (ssecurity && ssecurity.trim() ? `&${ssecurity}` : "");
    return encodeURIComponent(crypto.createHash("sha1").update(input).digest("base64"));
}
function absorbSetCookie(jar: ProtocolValue, res: ProtocolValue) {
    for (const c of res.headers.getSetCookie?.() || []) {
        const m = /^([^=]+)=([^;]*)/.exec(c.trim());
        if (m && m[2])
            jar[m[1]] = m[2];
    }
}
function cookieHeader(jar: ProtocolValue) {
    return Object.entries(jar)
        .filter(([, v]: ProtocolValue) => v)
        .map(([k, v]: ProtocolValue) => `${k}=${v}`)
        .join("; ");
}
/**
 * Resolve the account-service base URL for a connection.
 * @param {object|null} providerSpecificData - may carry `region` ("cn"|"sgp"|"ams"|"ru"|"in")
 */
export function resolveMimoServerBase(providerSpecificData: ProtocolValue = null) {
    const region = String(providerSpecificData?.region || "").toLowerCase();
    return API_BASE_BY_REGION[region] || DEFAULT_API_BASE;
}
/**
 * Exchange a passToken for a mimo-server service session cookie.
 * Primary path mirrors the Desktop ServiceTokenManager (app.asar):
 *   PHASE 1: GET /pass/serviceLogin?_locale=zh_CN&_snsNone=true&sid=<clusterSid>&_json=true
 *            Cookie {userId,passToken,cUserId} -> {code,location,ssecurity,nonce}
 *   PHASE 2: GET {location}&clientSign=sha1(nonce&ssecurity), follow the chain
 *            (manual, absorbing Set-Cookie) -> serviceToken
 * sid is per-cluster (SID_BY_REGION): cn=mimopc, sgp=mimosgp, ams=mimoams, ru=mimoru, in=mimoin.
 * @returns {Promise<string|null>} Cookie header value, or null on failure.
 */
async function acquireServiceCookie(passJar: ProtocolValue, proxyOptions: ProtocolValue, apiBase: ProtocolValue = DEFAULT_API_BASE, region = "sgp") {
    const r = String(region || "").toLowerCase();
    // Hard constraint: CN is ALWAYS direct (ignores proxy even if set)
    const effectiveProxy = r === "cn" ? null : proxyOptions;
    const sid = sidForRegion(r);
    const viaDesktop = await acquireViaDesktopPhases(passJar, effectiveProxy, apiBase, sid);
    if (viaDesktop)
        (void 0);
    return viaDesktop;
}
async function acquireViaDesktopPhases(passJar: ProtocolValue, proxyOptions: ProtocolValue, apiBase: ProtocolValue, sid: ProtocolValue) {
    const failLog = (reason: ProtocolValue) => (void 0);
    const jar: ProtocolRecord = { ...passJar };
    // PHASE 1 — single serviceLogin call with the TARGET sid (no passportapi
    // prelude; ssecurity/nonce come straight from this response).
    // Desktop only sends: userId, passToken, cUserId (no extra cookies)
    const p1Jar: ProtocolRecord = {};
    if (jar.userId)
        p1Jar.userId = jar.userId;
    if (jar.passToken)
        p1Jar.passToken = jar.passToken;
    if (jar.cUserId)
        p1Jar.cUserId = jar.cUserId;
    const p1Url = `https://${ACCOUNT_HOST}/pass/serviceLogin?_locale=zh_CN&_snsNone=true&sid=${encodeURIComponent(sid)}&_json=true`;
    const p1 = await proxyAwareFetch(p1Url, { headers: { Cookie: cookieHeader(p1Jar), "User-Agent": SSO_UA, Accept: "application/json" } }, proxyOptions);
    const raw = await p1.text();
    const clean = raw.replace(/^&&&START&&&/, "");
    // Nonce > 2^53 loses precision in JSON.parse — extract raw literal for signing
    const rawNonce = clean.match(/"nonce"\s*:\s*(\d+)/)?.[1];
    let j: ProtocolValue = null;
    try {
        j = JSON.parse(clean);
    }
    catch { /* handled below */ }
    if (rawNonce && j)
        j.nonce = rawNonce;
    if (!j || typeof j.code !== "number" || j.code !== 0 || !j.location || !j.nonce || !j.ssecurity) {
        failLog(`phase1 sid=${sid} http=${p1.status} code=${j?.code ?? "?"} hasLoc=${!!j?.location}`
            + ` secondValidation=${j?.bSecondValidation ?? "?"} notificationUrl=${j?.notificationUrl ? "present" : "no"}`
            + ` body=${JSON.stringify(raw.slice(0, 200))}`);
        return null;
    }
    absorbSetCookie(jar, p1);
    // PHASE 2 — clientSign the redirect, follow the redirect chain server-side.
    // ⚠️ CRITICAL DESKTOP SPEC (app.asar / SSO_curl.cpp line 728: cookies.clear()):
    // Phase 2 MUST NOT send ANY Cookie header! The server returns 200 OK with Set-Cookie: serviceToken!
    const sep = j.location.includes("?") ? "&" : "?";
    let current = `${j.location}${sep}clientSign=${signatureClientSign(rawNonce || j.nonce, j.ssecurity)}`;
    for (let hop = 0; hop < 8; hop++) {
        const res = await proxyAwareFetch(current, { redirect: "manual", headers: { "User-Agent": SSO_UA } }, proxyOptions);
        absorbSetCookie(jar, res);
        const loc = res.headers.get("location");
        if (res.status >= 300 && res.status < 400 && loc) {
            current = new URL(loc, current).toString();
            continue;
        }
        break;
    }
    const sidKey = `${sid}_serviceToken`;
    if (!jar.serviceToken && jar[sidKey]) {
        jar.serviceToken = jar[sidKey];
    }
    if (!jar.serviceToken) {
        failLog(`phase2 no serviceToken sid=${sid} jar=[${Object.keys(jar).join(",")}]`);
        return null;
    }
    const out: ProtocolRecord = {};
    for (const [k, v] of Object.entries(jar)) {
        if (!v)
            continue;
        if (k === "serviceToken" || k === "userId" || /_(ph|slh)$/.test(k))
            out[k] = v;
    }
    return cookieHeader(out);
}
/**
 * Get (and cache) the mimo-server account cookie.
 * @param {object|null} providerSpecificData - may carry `mimoPassToken` override
 */
async function getServiceCookie(providerSpecificData: ProtocolValue, proxyOptions: ProtocolValue) {
    const apiBase = resolveMimoServerBase(providerSpecificData);
    const passJar = providerSpecificData?.mimoPassToken
        ? { passToken: providerSpecificData.mimoPassToken, userId: providerSpecificData.mimoUserId, cUserId: providerSpecificData.mimoCUserId }
        : null;
    if (!passJar)
        return { cookie: null, reason: "no-pass-token" };
    // One cached session per passToken+cluster — accounts/connections rotate
    // independently, and the same passToken maps to different sessions per region.
    const key = crypto.createHash("sha256").update(`${apiBase}|${passJar.passToken}`).digest("hex");
    const cached = _cache.get(key);
    if (cached && Date.now() - cached.at < COOKIE_TTL_MS) {
        return { cookie: cached.cookie };
    }
    // De-dupe concurrent handshakes for the same account: a burst of requests must
    // not each run the full 5-step SSO chain.
    const inflight = _inflight.get(key);
    if (inflight) {
        const cookie = await inflight;
        return cookie ? { cookie } : { cookie: null, reason: "sso-failed" };
    }
    const promise = (async () => {
        try {
            return await acquireServiceCookie(passJar, proxyOptions, apiBase, providerSpecificData?.region);
        }
        catch (caughtError) {
            const e = caughtError as ProtocolError;
            (void 0);
            return null; // network/parse failure — callers degrade, never throw
        }
        finally {
            _inflight.delete(key);
        }
    })();
    _inflight.set(key, promise);
    const cookie = await promise;
    if (!cookie)
        return { cookie: null, reason: "sso-failed" };
    _cache.set(key, { cookie, at: Date.now() });
    return { cookie };
}
/** Drop cached sessions so the next call re-runs the handshake (e.g. after a 401). */
export function invalidateMimoAccountCookieCache() {
    _cache.clear();
}
/** mimo-server account API base + the User-Agent its backend expects. */
export const MIMO_API_BASE = API_BASE;
export const MIMO_API_UA = API_UA;
/**
 * Resolve the mimo-server account-session cookie, for upstream /api/route/* calls.
 * @returns {Promise<string|null>} Cookie header value, or null when unavailable.
 */
export async function getMimoAccountCookie(providerSpecificData: ProtocolValue = null, proxyOptions: ProtocolValue = null) {
    try {
        const { cookie } = await getServiceCookie(providerSpecificData, proxyOptions);
        return cookie;
    }
    catch (caughtError) {
        const e = caughtError as ProtocolError;
        (void 0);
        return null;
    }
}
/**
 * Fetch the weekly quota from the account service.
 * @returns {Promise<{percent?:number, resetDate?:string, resetAt?:number, error?:string}>}
 */
export async function getMimoAccountUsage(providerSpecificData: ProtocolValue = null, proxyOptions: ProtocolValue = null) {
    const { cookie, reason } = await getServiceCookie(providerSpecificData, proxyOptions);
    if (!cookie) {
        return { error: reason === "no-pass-token" ? "no-session" : "session-failed" };
    }
    try {
        const res = await proxyAwareFetch(`${resolveMimoServerBase(providerSpecificData)}/api/user/usage`, { headers: { "User-Agent": API_UA, Cookie: cookie, Accept: "application/json" }, signal: AbortSignal.timeout(10000) }, proxyOptions);
        if (!res.ok)
            return { error: `http-${res.status}` };
        const data: ProtocolValue = await res.json().catch(() => null);
        if (!data || data.code !== 0 || !data.data)
            return { error: "bad-response" };
        return { percent: data.data.percent, resetDate: data.data.resetDate, resetAt: data.data.resetAt };
    }
    catch (caughtError) {
        const e = caughtError as ProtocolError;
        return { error: e.message };
    }
}
