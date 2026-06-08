import { resolve } from "node:path";
import { buildBadges } from "./core.ts";

type Env = Record<string, string | undefined>;

const BADGE_FILES = ["assets/license.svg", "assets/min-version.svg", "assets/plugin.svg"];

export type RunOptions = {
  env?: Env;
  log?: (text: string) => void;
  exec?: (cmd: string, args: string[], cwd: string) => Promise<string>;
  fetchPluginPage?: (slug: string) => Promise<string>;
};

export async function run(options: RunOptions = {}): Promise<number> {
  const env = options.env ?? process.env;
  const log = options.log ?? console.log;
  const exec = options.exec ?? execCommand;
  const sourceDir = resolve(input(env, "SOURCE_DIR") || ".");
  const pluginSlug = input(env, "PLUGIN_SLUG");
  const shouldCommit = input(env, "COMMIT").toLowerCase() !== "false";

  try {
    const result = await buildBadges({
      sourceDir,
      pluginSlug,
      fetchPluginPage: options.fetchPluginPage,
    });

    log(`wrote ${result.licensePath}`);
    log(`wrote ${result.minVersionPath}`);
    log(`wrote ${result.pluginPath}`);

    if (!shouldCommit) {
      return 0;
    }

    const status = await exec("git", ["status", "--short", "--", ...BADGE_FILES], sourceDir);

    if (!status.trim()) {
      log("no badge changes to commit");
      return 0;
    }

    await exec("git", ["config", "user.name", "github-actions[bot]"], sourceDir);
    await exec(
      "git",
      ["config", "user.email", "41898282+github-actions[bot]@users.noreply.github.com"],
      sourceDir,
    );
    await exec("git", ["add", ...BADGE_FILES], sourceDir);
    await exec("git", ["commit", "-m", "chore: update Obsidian plugin badges"], sourceDir);
    await exec("git", ["push"], sourceDir);

    return 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

function input(env: Env, name: string): string {
  return (env[`INPUT_${name}`] ?? "").trim();
}

async function execCommand(cmd: string, args: string[], cwd: string): Promise<string> {
  const proc = Bun.spawn([cmd, ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  if (code !== 0) {
    throw new Error(`${cmd} ${args.join(" ")} failed with exit ${code}: ${stderr.trim() || stdout.trim()}`);
  }

  return stdout;
}

if (import.meta.main) {
  process.exit(await run());
}
