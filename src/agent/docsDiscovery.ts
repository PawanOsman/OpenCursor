/*
 * Copyright (c) 2026 Pawan Osman <https://github.com/PawanOsman>
 *
 * This file is part of OpenCursor — AI coding agent chat inside VS Code.
 * https://github.com/PawanOsman/OpenCursor
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

/** Pure, bounded discovery helpers. Fetching and crawl budgets live in docsIndex. */
export type DocCandidate = {
  url: string;
  title: string;
  source: "seed" | "navigation" | "sitemap" | "llms" | "link";
};

const MAX_LINKS = 1500;
const MAX_INPUT = 2 * 1024 * 1024;
const TRACKING_QUERY = /^(?:utm_[a-z_]+|gclid|dclid|fbclid|msclkid|mc_cid|mc_eid|ref|referrer)$/i;
const ASSET = /\.(?:avif|bmp|gif|ico|jpe?g|png|svg|webp|mp[34]|mov|webm|ogg|wav|pdf|zip|gz|tar|rar|7z|exe|dmg|apk|bin|map|css|js|mjs|cjs|woff2?|ttf|eot|otf|json|ya?ml|xml|csv|wasm)$/i;
const LOCALE = /^(?:en|en-us|en-gb|ar|bg|ca|cs|da|de|el|es|et|fa|fi|fr|he|hi|hr|hu|id|it|ja|ko|lt|lv|ms|nb|nl|no|pl|pt|pt-br|ro|ru|sk|sl|sr|sv|th|tr|uk|vi|zh|zh-cn|zh-tw)$/i;
const VERSION = /^(?:v?\d+(?:\.\d+){0,3}|latest|stable|next|canary|beta)$/i;
const DOC_NAMESPACE = /^(?:docs?|documentation|learn|handbook|manual)$/i;
const NON_DOC_SECTION = /^(?:blog|blogs|news|careers|jobs|pricing|legal|privacy|terms|contact|about|community|forum|forums|events|calendar|login|logout|signin|signout|signup|register|account|search|tags|authors|feed|rss)$/i;
const API_NAMESPACE = /^(?:api|apis|reference|endpoints|resources)$/i;

function decodedSegments(pathname: string): string[] {
  try { return pathname.split("/").filter(Boolean).map(segment => decodeURIComponent(segment)); }
  catch { return []; }
}

function canonicalUrl(raw: string, base?: string): URL | null {
  if (raw.length > 4096 || /[\u0000-\u001f\u007f]/.test(raw)) return null;
  try {
    const url = new URL(raw, base);
    if (!/^https?:$/.test(url.protocol) || url.username || url.password) return null;
    if (/%(?:2f|5c|00)/i.test(url.pathname) || /\\/.test(url.pathname)) return null;
    for (const key of url.searchParams.keys()) if (!TRACKING_QUERY.test(key)) return null;
    url.search = "";
    url.hash = "";
    url.pathname = url.pathname.replace(/%([\da-f]{2})/gi, (encoded, hex: string) => {
      const char = String.fromCharCode(parseInt(hex, 16));
      return /[a-z\d._~-]/i.test(char) ? char : encoded.toUpperCase();
    });
    url.pathname = url.pathname.replace(/\/{2,}/g, "/").replace(/\/index\.(?:html?|md)$/i, "/");
    if (url.pathname !== "/") url.pathname = url.pathname.replace(/\/+$/, "");
    if (!decodedSegments(url.pathname).length && url.pathname !== "/") return null;
    return url;
  } catch { return null; }
}

function variants(pathname: string): { locale?: string; version?: string } {
  const result: { locale?: string; version?: string } = {};
  for (const segment of decodedSegments(pathname).slice(0, 4)) {
    if (DOC_NAMESPACE.test(segment)) continue;
    if (LOCALE.test(segment) && !result.locale) result.locale = segment.toLowerCase();
    else if (VERSION.test(segment) && !result.version) result.version = segment.toLowerCase();
    else break;
  }
  return result;
}

function containsPath(pathname: string, prefix: string): boolean {
  return prefix === "/" || pathname === prefix || pathname.startsWith(`${prefix}/`);
}

export function createDocPolicy(startUrl: string, options: {
  scope?: "section" | "page";
  scopePath?: string;
  excludePaths?: string[];
} = {}) {
  let seed = canonicalUrl(startUrl);
  if (!seed) throw new Error("Use a documentation URL without search, pagination, or account parameters.");
  let original = new URL(startUrl);
  let scopePath = seed.pathname;
  if (options.scope !== "page" && /\.(?:html?|md|mdx|txt)$/i.test(scopePath)) {
    scopePath = scopePath.slice(0, scopePath.lastIndexOf("/")) || "/";
  }
  if (options.scopePath?.trim()) {
    const requested = canonicalUrl(options.scopePath.trim(), seed.origin);
    if (!requested || requested.origin !== seed.origin || !containsPath(requested.pathname, scopePath)) {
      throw new Error("The documentation scope must stay within the source section and origin.");
    }
    if (options.scope === "page" && requested.pathname !== seed.pathname) {
      throw new Error("A single-page scope must match the source page.");
    }
    scopePath = requested.pathname;
    if (!containsPath(seed.pathname, scopePath)) {
      seed = requested;
      original = new URL(seed.href + (/\.(?:html?|md|mdx|txt)$/i.test(seed.pathname) || seed.pathname === "/" ? "" : "/"));
    }
  }
  const effectiveSeed = seed;
  const seedVariants = variants(effectiveSeed.pathname);
  const exclusions = (options.excludePaths ?? []).slice(0, 100).map(value => {
    const normalized = canonicalUrl(value.trim().replace(/\/\*.*$/, ""), effectiveSeed.origin);
    return normalized?.origin === effectiveSeed.origin ? normalized.pathname : undefined;
  }).filter((value): value is string => value !== undefined);
  const seedSegments = decodedSegments(effectiveSeed.pathname);
  const rootDocsHost = /(?:^|\.)(?:docs?|developers?|documentation)(?:\.|$)/i.test(effectiveSeed.hostname)
    || /(?:^|\.)(?:readthedocs\.io|readthedocs\.org)$/.test(effectiveSeed.hostname);
  const allowed = (url: URL): boolean => {
    if (url.origin !== effectiveSeed.origin || !containsPath(url.pathname, scopePath)) return false;
    if (options.scope === "page" && url.href !== effectiveSeed.href) return false;
    if (exclusions.some(prefix => containsPath(url.pathname, prefix))) return false;
    if (ASSET.test(url.pathname) || /\/llms(?:-full)?\.txt$/i.test(url.pathname)) return false;
    const parts = decodedSegments(url.pathname);
    if (parts.length > 16) return false;
    if (scopePath === "/" && effectiveSeed.pathname === "/" && !rootDocsHost && parts.length
      && !/^(?:docs?|documentation|learn|handbook|manual|guides?|reference|api|apis|tutorials?|examples?|quickstart|getting-started|installation)$/i.test(parts[0])) return false;
    const variant = variants(url.pathname);
    if (variant.locale !== seedVariants.locale || variant.version !== seedVariants.version) return false;
    // Route names inside an API reference can be valid endpoint documentation.
    // Elsewhere these sections are typically account pages or generated archives.
    for (let i = 0; i < parts.length; i++) {
      if (API_NAMESPACE.test(parts[i])) break;
      if (NON_DOC_SECTION.test(parts[i]) && parts[i] !== seedSegments[i]) return false;
      if (/^(?:page|pages|pagination)$/i.test(parts[i]) && /^\d+$/.test(parts[i + 1] ?? "")) return false;
    }
    return true;
  };
  return {
    startUrl: effectiveSeed.href,
    origin: effectiveSeed.origin,
    scopePath,
    normalize(raw: string, base = original.href): string | null {
      const url = canonicalUrl(raw, base);
      return url && allowed(url) ? url.href : null;
    },
    allows(raw: string): boolean {
      const url = canonicalUrl(raw, original.href);
      return !!url && allowed(url);
    },
  };
}

const ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—",
  hellip: "…", copy: "©", reg: "®", trade: "™", bull: "•", middot: "·", laquo: "«", raquo: "»",
  lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”", rarr: "→", larr: "←", times: "×",
};
function decodeEntities(text: string): string {
  return text.replace(/&(#x[\da-f]+|#\d+|[a-z][a-z\d]+);/gi, (match, value: string) => {
    if (value[0] !== "#") return ENTITIES[value.toLowerCase()] ?? match;
    const number = value[1].toLowerCase() === "x" ? parseInt(value.slice(2), 16) : parseInt(value.slice(1), 10);
    return Number.isFinite(number) && number > 0 && number <= 0x10ffff && !(number >= 0xd800 && number <= 0xdfff)
      ? String.fromCodePoint(number) : "�";
  });
}

interface ElementNode { tag: string; attrs: Record<string, string>; children: HtmlNode[]; }
type HtmlNode = ElementNode | string;
const VOID_TAGS = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);
const SKIP_TAGS = new Set(["script", "style", "noscript", "template", "svg", "canvas", "iframe", "form"]);

/** A small inert tokenizer: never evaluates markup or resolves external entities. */
function parseHtml(input: string): ElementNode {
  const body = input.slice(0, MAX_INPUT);
  const root: ElementNode = { tag: "root", attrs: {}, children: [] };
  const stack = [root];
  let offset = 0;
  let count = 0;
  while (offset < body.length && count++ < 60000) {
    const start = body.indexOf("<", offset);
    if (start < 0) { stack[stack.length - 1].children.push(body.slice(offset)); break; }
    if (start > offset) stack[stack.length - 1].children.push(body.slice(offset, start));
    if (body.startsWith("<!--", start)) {
      const end = body.indexOf("-->", start + 4);
      offset = end < 0 ? body.length : end + 3;
      continue;
    }
    let end = start + 1;
    let quote = "";
    for (; end < body.length; end++) {
      const char = body[end];
      if (quote) { if (char === quote) quote = ""; }
      else if (char === '"' || char === "'") quote = char;
      else if (char === ">") break;
    }
    if (end === body.length) { stack[stack.length - 1].children.push(body.slice(start)); break; }
    const token = body.slice(start + 1, end);
    offset = end + 1;
    if (/^\s*[!?]/.test(token)) continue;
    const match = /^\s*(\/?)\s*([a-z][a-z\d:-]*)\b/i.exec(token);
    if (!match) { stack[stack.length - 1].children.push(body.slice(start, end + 1)); continue; }
    const tag = match[2].toLowerCase();
    if (match[1]) {
      for (let i = stack.length - 1; i > 0; i--) {
        if (stack[i].tag === tag) { stack.length = i; break; }
      }
      continue;
    }
    const attrs: Record<string, string> = {};
    const attributes = token.slice(match[0].length);
    const attrPattern = /([^\s=/'">]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
    let attr: RegExpExecArray | null;
    while ((attr = attrPattern.exec(attributes))) attrs[attr[1].toLowerCase()] = decodeEntities(attr[2] ?? attr[3] ?? attr[4] ?? "");
    const node: ElementNode = { tag, attrs, children: [] };
    stack[stack.length - 1].children.push(node);
    if (tag === "script" || tag === "style") {
      const close = new RegExp(`</${tag}\\s*>`, "ig");
      close.lastIndex = offset;
      const closing = close.exec(body);
      offset = closing ? close.lastIndex : body.length;
      continue;
    }
    if (!VOID_TAGS.has(tag) && !/\/\s*$/.test(token) && stack.length < 100) stack.push(node);
  }
  return root;
}

function rawText(node: HtmlNode): string {
  if (typeof node === "string") return decodeEntities(node);
  return node.children.map(rawText).join("");
}
function isNavigation(node: ElementNode): boolean {
  return /^(?:nav|aside|header)$/.test(node.tag) || /^(?:navigation|complementary)$/.test(node.attrs.role ?? "")
    || /(?:^|[\s_-])(?:sidebar|navigation|navbar|toc|breadcrumb|breadcrumbs|pagination|menu)(?:$|[\s_-])/.test(node.attrs.class ?? "");
}
function isHidden(node: ElementNode): boolean {
  return "hidden" in node.attrs || node.attrs["aria-hidden"] === "true" || SKIP_TAGS.has(node.tag);
}
function visit(node: ElementNode, fn: (node: ElementNode, navigation: boolean) => void, navigation = false): void {
  if (isHidden(node)) return;
  navigation ||= isNavigation(node);
  fn(node, navigation);
  for (const child of node.children) if (typeof child !== "string") visit(child, fn, navigation);
}
function httpLink(raw: string, base: string): string | null {
  try {
    if (raw.length > 4096) return null;
    const url = new URL(raw, base);
    return /^https?:$/.test(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

export function extractDocPage(body: string, url: string, isHtml: boolean): {
  title: string; text: string; links: DocCandidate[]; canonical?: string; noindex: boolean;
} {
  if (!isHtml) {
    const text = body.slice(0, MAX_INPUT).replace(/^\uFEFF/, "").trim();
    const title = /^#\s+(.+?)\s*#*\s*$/m.exec(text)?.[1]?.trim() ?? new URL(url).pathname;
    return { title, text, links: extractLlmsLinks(text, url).map(link => ({ ...link, source: "link" })), noindex: false };
  }
  const root = parseHtml(body);
  const links: DocCandidate[] = [];
  const seen = new Set<string>();
  const content: { node: ElementNode; priority: number }[] = [];
  let title = "";
  let canonical: string | undefined;
  let noindex = false;
  visit(root, (node, navigation) => {
    if (node.tag === "title" && !title) title = rawText(node).replace(/\s+/g, " ").trim();
    if (node.tag === "meta" && /^(?:robots|googlebot)$/i.test(node.attrs.name ?? "") && /(?:^|[\s,])(?:noindex|none)(?:$|[\s,])/i.test(node.attrs.content ?? "")) noindex = true;
    if (node.tag === "link" && /(?:^|\s)canonical(?:$|\s)/i.test(node.attrs.rel ?? "")) canonical = httpLink(node.attrs.href ?? "", url) ?? undefined;
    const priority = node.tag === "main" || node.attrs.role === "main" ? 3 : node.tag === "article" ? 2
      : /(?:^|\s)(?:markdown-body|theme-doc-markdown|docs-content|documentation-content)(?:$|\s)/.test(node.attrs.class ?? "") ? 1 : 0;
    if (priority) content.push({ node, priority });
    if (node.tag !== "a" || !node.attrs.href || node.attrs.href.startsWith("#") || links.length >= MAX_LINKS) return;
    const href = httpLink(node.attrs.href, url);
    if (!href || seen.has(href)) return;
    seen.add(href);
    links.push({ url: href, title: rawText(node).replace(/\s+/g, " ").trim().slice(0, 240), source: navigation ? "navigation" : "link" });
  });
  const selected = content.sort((a, b) => b.priority - a.priority)[0]?.node ?? root;
  let heading = "";
  visit(selected, node => { if (node.tag === "h1" && !heading) heading = rawText(node).replace(/\s+/g, " ").trim(); });
  const codeBlocks: string[] = [];
  function render(node: HtmlNode): string {
    if (typeof node === "string") return decodeEntities(node).replace(/\s+/g, " ");
    if (isHidden(node) || node.tag === "head" || node.tag === "footer"
      || (node !== selected && isNavigation(node) && !(node.tag === "header" && selected !== root))) return "";
    if (node.tag === "pre") {
      const code = rawText(node).replace(/\r\n/g, "\n").replace(/^\n|\n$/g, "");
      const languageNode = node.children.find(child => typeof child !== "string" && child.tag === "code");
      const language = typeof languageNode === "object" ? /(?:^|\s)language-([\w+-]+)/.exec(languageNode.attrs.class ?? "")?.[1] ?? "" : "";
      let fenceLength = 3;
      for (const match of code.matchAll(/`+/g)) fenceLength = Math.max(fenceLength, match[0].length + 1);
      const fence = "`".repeat(fenceLength);
      const index = codeBlocks.push(`${fence}${language}\n${code}\n${fence}`) - 1;
      return `\n\n\u0000CODE${index}\u0000\n\n`;
    }
    const text = node.children.map(render).join("");
    if (node.tag === "code") return text.trim() ? `\`${text.trim()}\`` : "";
    if (node.tag === "br" || node.tag === "hr") return "\n";
    if (node.tag === "li") return `\n- ${text.trim()}\n`;
    if (/^h[1-6]$/.test(node.tag)) return `\n\n${"#".repeat(Number(node.tag[1]))} ${text.trim()}\n\n`;
    if (/^(?:p|div|section|article|main|blockquote|ul|ol|table|tr|dl|dt|dd)$/.test(node.tag)) return `\n${text}\n`;
    if (node.tag === "td" || node.tag === "th") return `${text.trim()} | `;
    return text;
  }
  const text = render(selected).replace(/[ \t]+\n/g, "\n").replace(/\n[ \t]+/g, "\n").replace(/\n{3,}/g, "\n\n").trim()
    .replace(/\u0000CODE(\d+)\u0000/g, (_, index: string) => codeBlocks[Number(index)] ?? "");
  return { title: heading || title, text, links, canonical, noindex };
}

export function extractSitemapUrls(xml: string, base: string): { pages: string[]; sitemaps: string[] } {
  const result: { pages: string[]; sitemaps: string[] } = { pages: [], sitemaps: [] };
  if (xml.length > MAX_INPUT || /<!\s*(?:DOCTYPE|ENTITY)\b/i.test(xml)) return result;
  const root = /^\s*(?:<\?xml[^>]*>\s*)?(?:<!--[\s\S]*?-->\s*)*<(?:[\w-]+:)?(urlset|sitemapindex)\b/i.exec(xml)?.[1].toLowerCase();
  if (!root) return result;
  const kind = root === "urlset" ? "url" : "sitemap";
  const blocks = new RegExp(`<(?:[\\w-]+:)?${kind}\\b[^>]*>([\\s\\S]*?)<\\/(?:[\\w-]+:)?${kind}\\s*>`, "gi");
  const seen = new Set<string>();
  let block: RegExpExecArray | null;
  while (seen.size < MAX_LINKS && (block = blocks.exec(xml))) {
    const raw = /<(?:[\w-]+:)?loc\b[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?loc\s*>/i.exec(block[1])?.[1];
    if (!raw) continue;
    const href = httpLink(decodeEntities(raw.replace(/^\s*<!\[CDATA\[([\s\S]*)\]\]>\s*$/, "$1").trim()), base);
    if (!href || seen.has(href)) continue;
    seen.add(href);
    (kind === "url" ? result.pages : result.sitemaps).push(href);
  }
  return result;
}

export function extractLlmsLinks(markdown: string, base: string): DocCandidate[] {
  const result: DocCandidate[] = [];
  const seen = new Set<string>();
  // Code samples are content, not a source of routes to fetch.
  const body = markdown.slice(0, MAX_INPUT).replace(/^\s*(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\s*\1\s*$/gm, "");
  const pattern = /(?<!!)\[([^\]\n]*)\]\(\s*(?:<([^>\n]+)>|([^\s)]+))(?:\s+["'][^\n]*?["'])?\s*\)/g;
  let match: RegExpExecArray | null;
  while (result.length < MAX_LINKS && (match = pattern.exec(body))) {
    const href = httpLink(decodeEntities(match[2] ?? match[3]), base);
    if (!href || seen.has(href)) continue;
    seen.add(href);
    result.push({ url: href, title: match[1].replace(/[*_`]/g, "").trim().slice(0, 240), source: "llms" });
  }
  return result;
}

export function rankDocCandidates(candidates: DocCandidate[], focus: string, limit: number): DocCandidate[] {
  const terms = [...new Set(focus.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}_+#-]{1,}/gu) ?? [])]
    .filter(term => !/^(?:the|and|for|with|from|that|this|docs|documentation|how|use|using|only|about|all|to|of|in|on|is|an|as|at|by|or|be)$/.test(term)).slice(0, 30);
  const weights: Record<DocCandidate["source"], number> = { seed: 10000, navigation: 120, llms: 130, sitemap: 50, link: 20 };
  const unique = new Map<string, { candidate: DocCandidate; score: number; order: number; matches: boolean; setup: boolean }>();
  for (const [order, candidate] of candidates.slice(0, MAX_LINKS * 4).entries()) {
    const url = canonicalUrl(candidate.url);
    if (!url) continue;
    const words = `${candidate.title} ${decodeURIComponent(url.pathname)}`.toLowerCase();
    const tokens = new Set(words.match(/[\p{L}\p{N}_+#-]+/gu) ?? []);
    const hits = terms.reduce((count, term) => count + ((term.length <= 2 ? tokens.has(term) : words.includes(term)) ? 1 : 0), 0);
    const score = weights[candidate.source] + hits * 200
      + (/getting[- ]started|quickstart|introduction|overview|installation/.test(words) ? 40 : 0)
      + (/\/reference(?:\/|$)|\/guides?(?:\/|$)|\/tutorials?(?:\/|$)/.test(url.pathname) ? 20 : 0)
      - decodedSegments(url.pathname).length;
    const setup = /\/(?:getting-started|quickstart|installation|introduction)(?:\.(?:html?|md|mdx|txt))?$/i.test(url.pathname);
    if (!unique.has(url.href) || unique.get(url.href)!.score < score) unique.set(url.href, { candidate: { ...candidate, url: url.href }, score, order, matches: hits > 0, setup });
  }
  const ranked = [...unique.values()].sort((a, b) => b.score - a.score || a.order - b.order);
  const hasMatches = terms.length > 0 && ranked.some(item => item.matches && item.candidate.source !== "seed");
  let setupCount = 0;
  return ranked.filter(item => !hasMatches || item.matches || item.candidate.source === "seed" || (item.setup && setupCount++ < 3))
    .slice(0, Math.max(0, Math.min(MAX_LINKS, Math.floor(Number.isFinite(limit) ? limit : 0))))
    .map(item => item.candidate);
}
