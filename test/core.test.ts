import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, test } from "bun:test";

import {
  buildBadges,
  generateMinVersionSvg,
  generatePluginSvg,
  parseManifest,
  parsePluginPage,
} from "../src/core.ts";
import { run } from "../src/cli.ts";

const nameGuardPage = String.raw`
<a href="#scorecard" class="block w-full no-underline text-normal hover:text-white">
  <div class="text-3xl font-bold tabular-nums">99<!-- -->%</div>
</a>
<div class="w-full text-sm grid grid-cols-2 gap-2">
  <div class="text-muted">Current version</div>
  <div class="">0.0.5</div>
  <div class="text-muted">Last updated</div>
  <div title="Jun 8, 2026">30 minutes ago</div>
  <div class="text-muted">Downloads</div>
  <div class="">3</div>
</div>`;

const dataviewPage = String.raw`
<script>self.__next_f.push([1,"[[\"$\",\"div\",null,{\"className\":\"text-3xl font-bold tabular-nums\",\"children\":[95,\"%\"]}],[[\"$\",\"div\",null,{\"className\":\"text-muted\",\"children\":\"Current version\"}],[\"$\",\"div\",null,{\"className\":\"\",\"children\":\"0.5.68\"}],[\"$\",\"div\",null,{\"className\":\"text-muted\",\"children\":\"Last updated\"}],[\"$\",\"div\",null,{\"title\":\"Apr 7, 2025\",\"children\":\"Last year\"}],[[\"$\",\"div\",null,{\"className\":\"text-muted\",\"children\":\"Downloads\"}],[\"$\",\"div\",null,{\"className\":\"\",\"children\":\"4.3M\"}]]]"])</script>`;

describe("parseManifest", () => {
  test("reads required Obsidian plugin fields", () => {
    expect(
      parseManifest(`{
        "id": "name-guard",
        "name": "NameGuard",
        "version": "0.0.5",
        "minAppVersion": "1.8.7"
      }`),
    ).toEqual({
      id: "name-guard",
      name: "NameGuard",
      minAppVersion: "1.8.7",
    });
  });

  test("rejects a manifest without id", () => {
    expect(() => parseManifest(`{"name":"X","minAppVersion":"1.0.0"}`)).toThrow("id");
  });

  test("rejects a manifest without minAppVersion", () => {
    expect(() => parseManifest(`{"id":"x","name":"X"}`)).toThrow("minAppVersion");
  });
});

describe("parsePluginPage", () => {
  test("extracts details from SSR HTML", () => {
    expect(parsePluginPage(nameGuardPage)).toEqual({
      currentVersion: "0.0.5",
      lastUpdated: "Jun 8, 2026",
      downloads: "3",
      score: 99,
    });
  });

  test("falls back to React Flight payload", () => {
    expect(parsePluginPage(dataviewPage)).toEqual({
      currentVersion: "0.5.68",
      lastUpdated: "Apr 7, 2025",
      downloads: "4.3M",
      score: 95,
    });
  });
});

describe("svg generation", () => {
  test("generates the Obsidian minimum version badge", () => {
    const svg = generateMinVersionSvg("1.8.7");

    expect(svg).toContain("Obsidian minimal version");
    expect(svg).toContain("1.8.7+");
    expect(svg).toContain("#7C3AED");
    expect(Number(svg.match(/width="(\d+)"/)?.[1])).toBeLessThanOrEqual(210);
  });

  test("generates one plugin badge with version, date, and downloads", () => {
    const svg = generatePluginSvg("NameGuard", {
      currentVersion: "0.0.5",
      lastUpdated: "Jun 8, 2026",
      downloads: "3",
      score: 99,
    });

    expect(svg).toContain("NameGuard");
    expect(svg).not.toContain("Plugin:");
    expect(svg).toContain("v0.0.5");
    expect(svg).toContain("Jun 8, 2026");
    expect(svg).toContain("3 downloads");
    expect(svg).toContain("99 score");
    expect(svg).toContain('fill="#2563EB"');
    expect(svg).toContain('fill="#7C3AED"');
    expect(svg).toContain('fill="#EA580C"');
    expect(svg).toContain('fill="#16A34A"');
  });

  test("escapes XML text", () => {
    const svg = generatePluginSvg(`Name&Guard`, {
      currentVersion: `1<2`,
      lastUpdated: `A&B`,
      downloads: `"7"`,
      score: 99,
    });

    expect(svg).toContain("Name&amp;Guard");
    expect(svg).toContain("v1&lt;2");
    expect(svg).toContain("A&amp;B");
    expect(svg).toContain("&quot;7&quot; downloads");
  });

  test("uses score color thresholds", () => {
    expect(
      generatePluginSvg("NameGuard", {
        currentVersion: "0.0.5",
        lastUpdated: "Jun 8, 2026",
        downloads: "3",
        score: 81,
      }),
    ).toContain('fill="#16A34A"');
    expect(
      generatePluginSvg("NameGuard", {
        currentVersion: "0.0.5",
        lastUpdated: "Jun 8, 2026",
        downloads: "3",
        score: 80,
      }),
    ).toContain('fill="#CA8A04"');
  });
});

describe("buildBadges", () => {
  test("writes both SVG files into assets", async () => {
    const dir = await mkdtemp(join(tmpdir(), "badges-action-"));
    try {
      await writeFile(
        join(dir, "manifest.json"),
        `{"id":"name-guard","name":"NameGuard","version":"0.0.5","minAppVersion":"1.8.7"}`,
      );

      const result = await buildBadges({
        sourceDir: dir,
        fetchPluginPage: async (slug) => {
          expect(slug).toBe("name-guard");
          return nameGuardPage;
        },
      });

      expect(result).toEqual({
        assetsDir: join(dir, "assets"),
        minVersionPath: join(dir, "assets", "min-version.svg"),
        pluginPath: join(dir, "assets", "plugin.svg"),
        pluginSlug: "name-guard",
      });
      expect(await readFile(result.minVersionPath, "utf8")).toContain("1.8.7+");
      expect(await readFile(result.minVersionPath, "utf8")).toContain("Obsidian minimal version");
      expect(await readFile(result.pluginPath, "utf8")).toContain("NameGuard");
      expect(await readFile(result.pluginPath, "utf8")).not.toContain("Plugin:");
      expect(await readFile(result.pluginPath, "utf8")).toContain("v0.0.5");
      expect(await readFile(result.pluginPath, "utf8")).toContain("99 score");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("run", () => {
  test("honors commit=false", async () => {
    const dir = await mkdtemp(join(tmpdir(), "badges-action-"));
    const commands: string[][] = [];

    try {
      await writeFile(
        join(dir, "manifest.json"),
        `{"id":"name-guard","name":"NameGuard","version":"0.0.5","minAppVersion":"1.8.7"}`,
      );

      const code = await run({
        env: {
          INPUT_SOURCE_DIR: dir,
          INPUT_COMMIT: "false",
        },
        log: () => {},
        exec: async (cmd, args) => {
          commands.push([cmd, ...args]);
          return "";
        },
        fetchPluginPage: async () => nameGuardPage,
      });

      expect(code).toBe(0);
      expect(commands).toEqual([]);
      expect(await readFile(join(dir, "assets", "min-version.svg"), "utf8")).toContain("Obsidian minimal version");
      expect(await readFile(join(dir, "assets", "plugin.svg"), "utf8")).toContain("NameGuard");
      expect(await readFile(join(dir, "assets", "plugin.svg"), "utf8")).toContain("v0.0.5");
      expect(await readFile(join(dir, "assets", "plugin.svg"), "utf8")).toContain("99 score");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
