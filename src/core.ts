import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export type ManifestInfo = {
  id: string;
  name: string;
  minAppVersion: string;
};

export type PluginInfo = {
  currentVersion: string;
  lastUpdated: string;
  downloads: string;
  score: number;
};

export type BuildResult = {
  assetsDir: string;
  licensePath: string;
  minVersionPath: string;
  pluginPath: string;
  pluginSlug: string;
};

export type BuildOptions = {
  sourceDir: string;
  pluginSlug?: string;
  fetchPluginPage?: (slug: string) => Promise<string>;
};

const OBSIDIAN = "#7C3AED";
const VERSION = "#2563EB";
const DOWNLOADS = "#EA580C";
const LICENSE = "#007EC6";
const LABEL = "#555";
const TEXT = "#fff";

export function parseManifest(text: string): ManifestInfo {
  let value: unknown;

  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new Error(`manifest.json is not valid JSON: ${message(error)}`);
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("manifest.json must be an object");
  }

  const manifest = value as Record<string, unknown>;

  return {
    id: readString(manifest, "id"),
    name: readString(manifest, "name"),
    minAppVersion: readString(manifest, "minAppVersion"),
  };
}

export function parsePackageLicense(text: string): string {
  let value: unknown;

  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new Error(`package.json is not valid JSON: ${message(error)}`);
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("package.json must be an object");
  }

  const license = (value as Record<string, unknown>).license;

  if (typeof license !== "string" || !license.trim()) {
    throw new Error("package.json must contain a non-empty license");
  }

  return license.trim();
}

export function parsePluginPage(html: string): PluginInfo {
  const ssr = parseSsrDetails(html);
  const currentVersion = ssr.currentVersion ?? readFlightValue(html, "Current version");
  const lastUpdated = ssr.lastUpdated ?? readFlightTitle(html, "Last updated");
  const downloads = ssr.downloads ?? readFlightValue(html, "Downloads");
  const score = ssr.score ?? readFlightScore(html);

  if (!currentVersion) {
    throw new Error("Could not find Current version on plugin page");
  }
  if (!lastUpdated) {
    throw new Error("Could not find Last updated on plugin page");
  }
  if (!downloads) {
    throw new Error("Could not find Downloads on plugin page");
  }
  if (score === undefined) {
    throw new Error("Could not find Score on plugin page");
  }

  return { currentVersion, lastUpdated, downloads, score };
}

export function generateMinVersionSvg(minAppVersion: string): string {
  return badgeSvg("Obsidian minimal version", `${minAppVersion}+`, OBSIDIAN);
}

export function generateLicenseSvg(license: string): string {
  return badgeSvg("license", license, LICENSE);
}

export function generatePluginSvg(pluginName: string, info: PluginInfo): string {
  return segmentedBadgeSvg(pluginName, [
    { text: `v${info.currentVersion}`, color: VERSION },
    { text: info.lastUpdated, color: OBSIDIAN },
    { text: `${info.downloads} downloads`, color: DOWNLOADS },
    { text: `${info.score} score`, color: scoreColor(info.score) },
  ]);
}

export async function buildBadges(options: BuildOptions): Promise<BuildResult> {
  const manifest = parseManifest(await readFile(join(options.sourceDir, "manifest.json"), "utf8"));
  const license = parsePackageLicense(await readFile(join(options.sourceDir, "package.json"), "utf8"));
  const pluginSlug = options.pluginSlug?.trim() || manifest.id;
  const fetchPluginPage = options.fetchPluginPage ?? fetchCommunityPluginPage;
  const pluginInfo = parsePluginPage(await fetchPluginPage(pluginSlug));
  const assetsDir = join(options.sourceDir, "assets");
  const licensePath = join(assetsDir, "license.svg");
  const minVersionPath = join(assetsDir, "min-version.svg");
  const pluginPath = join(assetsDir, "plugin.svg");

  await mkdir(assetsDir, { recursive: true });
  await writeFile(licensePath, `${generateLicenseSvg(license)}\n`);
  await writeFile(minVersionPath, `${generateMinVersionSvg(manifest.minAppVersion)}\n`);
  await writeFile(pluginPath, `${generatePluginSvg(manifest.name, pluginInfo)}\n`);

  return { assetsDir, licensePath, minVersionPath, pluginPath, pluginSlug };
}

async function fetchCommunityPluginPage(slug: string): Promise<string> {
  const response = await fetch(`https://community.obsidian.md/plugins/${encodeURIComponent(slug)}`);

  if (!response.ok) {
    throw new Error(`Plugin page request failed for ${slug}: ${response.status} ${response.statusText}`);
  }

  return await response.text();
}

function parseSsrDetails(html: string): Partial<PluginInfo> {
  return {
    currentVersion: readSsrValue(html, "Current version"),
    lastUpdated: readSsrValue(html, "Last updated", true),
    downloads: readSsrValue(html, "Downloads"),
    score: readSsrScore(html),
  };
}

function readSsrValue(html: string, label: string, preferTitle = false): string | undefined {
  const source = html.replace(/<script[\s\S]*?<\/script>/gi, "");
  const pattern = new RegExp(
    `<div\\b[^>]*>\\s*${escapeRegExp(label)}\\s*<\\/div>\\s*<div\\b([^>]*)>([\\s\\S]*?)<\\/div>`,
    "i",
  );
  const match = source.match(pattern);

  if (!match) {
    return undefined;
  }

  if (preferTitle) {
    const title = match[1]?.match(/\btitle="([^"]+)"/);
    if (title?.[1]) {
      return decodeHtml(title[1]).trim();
    }
  }

  return textFromHtml(match[2]);
}

function readFlightValue(html: string, label: string): string | undefined {
  const flight = decodeFlight(html);
  const index = flight.indexOf(`"children":"${label}"`);

  if (index === -1) {
    return undefined;
  }

  const tail = flight.slice(index);
  const values = [...tail.matchAll(/"children":"([^"]+)"/g)].map((item) => decodeJsonText(item[1]));

  return values[1]?.trim() || undefined;
}

function readFlightTitle(html: string, label: string): string | undefined {
  const flight = decodeFlight(html);
  const index = flight.indexOf(`"children":"${label}"`);

  if (index === -1) {
    return undefined;
  }

  const title = flight.slice(index).match(/"title":"([^"]+)"/);

  return title?.[1] ? decodeJsonText(title[1]).trim() : undefined;
}

function readSsrScore(html: string): number | undefined {
  const source = html.replace(/<script[\s\S]*?<\/script>/gi, "");
  const match = source.match(/class="[^"]*\btext-3xl\b[^"]*\btabular-nums\b[^"]*"[^>]*>\s*(\d+)\s*(?:<!--\s*-->)?\s*%/);

  return match?.[1] ? Number(match[1]) : undefined;
}

function readFlightScore(html: string): number | undefined {
  const flight = decodeFlight(html);
  const match = flight.match(/"className":"[^"]*\btext-3xl\b[^"]*\btabular-nums\b[^"]*"[^}]*"children":\[(\d+),"%"\]/);

  return match?.[1] ? Number(match[1]) : undefined;
}

function badgeSvg(label: string, value: string, color: string): string {
  const labelWidth = textWidth(label);
  const valueWidth = textWidth(value);
  const width = labelWidth + valueWidth;
  const xLabel = Math.floor(labelWidth / 2);
  const xValue = labelWidth + Math.floor(valueWidth / 2);

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="20" role="img" aria-label="${xml(label)}: ${xml(value)}">`,
    `<title>${xml(label)}: ${xml(value)}</title>`,
    `<linearGradient id="s" x2="0" y2="100%"><stop offset="0" stop-color="#bbb" stop-opacity=".1"/><stop offset="1" stop-opacity=".1"/></linearGradient>`,
    `<clipPath id="r"><rect width="${width}" height="20" rx="3" fill="#fff"/></clipPath>`,
    `<g clip-path="url(#r)">`,
    `<rect width="${labelWidth}" height="20" fill="${LABEL}"/>`,
    `<rect x="${labelWidth}" width="${valueWidth}" height="20" fill="${xml(color)}"/>`,
    `<rect width="${width}" height="20" fill="url(#s)"/>`,
    `</g>`,
    `<g fill="${TEXT}" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" text-rendering="geometricPrecision" font-size="11">`,
    `<text x="${xLabel}" y="15" fill="#010101" fill-opacity=".3">${xml(label)}</text>`,
    `<text x="${xLabel}" y="14">${xml(label)}</text>`,
    `<text x="${xValue}" y="15" fill="#010101" fill-opacity=".3">${xml(value)}</text>`,
    `<text x="${xValue}" y="14">${xml(value)}</text>`,
    `</g>`,
    `</svg>`,
  ].join("");
}

function segmentedBadgeSvg(label: string, segments: { text: string; color: string }[]): string {
  const labelWidth = textWidth(label);
  const widths = segments.map((segment) => textWidth(segment.text));
  const width = widths.reduce((sum, item) => sum + item, labelWidth);
  const ariaValue = segments.map((segment) => segment.text).join(" | ");
  let x = labelWidth;

  const rects = [
    `<rect width="${labelWidth}" height="20" fill="${LABEL}"/>`,
    ...segments.map((segment, index) => {
      const rect = `<rect x="${x}" width="${widths[index]}" height="20" fill="${xml(segment.color)}"/>`;
      x += widths[index];
      return rect;
    }),
  ];

  x = labelWidth;

  const texts = [
    shadowedText(Math.floor(labelWidth / 2), label),
    ...segments.map((segment, index) => {
      const center = x + Math.floor(widths[index] / 2);
      x += widths[index];
      return shadowedText(center, segment.text);
    }),
  ];

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="20" role="img" aria-label="${xml(label)}: ${xml(ariaValue)}">`,
    `<title>${xml(label)}: ${xml(ariaValue)}</title>`,
    `<linearGradient id="s" x2="0" y2="100%"><stop offset="0" stop-color="#bbb" stop-opacity=".1"/><stop offset="1" stop-opacity=".1"/></linearGradient>`,
    `<clipPath id="r"><rect width="${width}" height="20" rx="3" fill="#fff"/></clipPath>`,
    `<g clip-path="url(#r)">`,
    ...rects,
    `<rect width="${width}" height="20" fill="url(#s)"/>`,
    `</g>`,
    `<g fill="${TEXT}" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" text-rendering="geometricPrecision" font-size="11">`,
    ...texts,
    `</g>`,
    `</svg>`,
  ].join("");
}

function shadowedText(x: number, text: string): string {
  return [
    `<text x="${x}" y="15" fill="#010101" fill-opacity=".3">${xml(text)}</text>`,
    `<text x="${x}" y="14">${xml(text)}</text>`,
  ].join("");
}

function scoreColor(score: number): string {
  if (score > 80) {
    return "#16A34A";
  }
  if (score >= 60) {
    return "#CA8A04";
  }
  return "#DC2626";
}

function textWidth(text: string): number {
  return Math.ceil(text.length * 6 + 10);
}

function readString(value: Record<string, unknown>, key: string): string {
  const field = value[key];

  if (typeof field !== "string" || !field.trim()) {
    throw new Error(`manifest.json must contain a non-empty ${key}`);
  }

  return field.trim();
}

function textFromHtml(html: string | undefined): string | undefined {
  const text = decodeHtml((html ?? "").replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();

  return text || undefined;
}

function decodeFlight(text: string): string {
  return decodeHtml(text)
    .replace(/\\"/g, `"`)
    .replace(/\\u([0-9a-fA-F]{4})/g, (_match, code: string) => String.fromCharCode(parseInt(code, 16)));
}

function decodeJsonText(text: string): string {
  return text
    .replace(/\\u([0-9a-fA-F]{4})/g, (_match, code: string) => String.fromCharCode(parseInt(code, 16)))
    .replace(/\\"/g, `"`);
}

function decodeHtml(text: string): string {
  return text.replace(/&(#x[0-9a-fA-F]+|#\d+|nbsp|amp|lt|gt|quot|apos);/g, (entity, body: string) => {
    if (body === "nbsp") {
      return " ";
    }
    if (body === "amp") {
      return "&";
    }
    if (body === "lt") {
      return "<";
    }
    if (body === "gt") {
      return ">";
    }
    if (body === "quot") {
      return `"`;
    }
    if (body === "apos") {
      return "'";
    }
    if (body.startsWith("#x")) {
      return String.fromCodePoint(parseInt(body.slice(2), 16));
    }
    if (body.startsWith("#")) {
      return String.fromCodePoint(parseInt(body.slice(1), 10));
    }

    return entity;
  });
}

function xml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
