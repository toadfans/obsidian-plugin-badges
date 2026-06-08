import { readdir, readFile } from "node:fs/promises";
import { extname, join, relative } from "node:path";

const root = process.cwd();
const ignored = new Set([".git", "node_modules"]);
const bannedExtensions = new Set([".js", ".mjs", ".cjs"]);

const failures: string[] = [];

for (const file of await files(root)) {
  const path = relative(root, file);
  const extension = extname(path);

  // The action is run straight from TypeScript by bun; committed JS would be a build artifact.
  if (bannedExtensions.has(extension)) {
    failures.push(`forbidden file extension: ${path}`);
  }

  if (extension === ".ts") {
    const text = await readFile(file, "utf8");

    if (/\bdebugger\s*;/.test(text)) {
      failures.push(`debugger statement: ${path}`);
    }
    if (/\b(?:describe|test|it)\.only\s*\(/.test(text)) {
      failures.push(`focused test: ${path}`);
    }
  }
}

await checkPackage();

if (failures.length > 0) {
  for (const failure of failures) {
    console.error(failure);
  }
  process.exit(1);
}

console.log("lint ok");

async function files(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const result: string[] = [];

  for (const entry of entries) {
    if (ignored.has(entry.name)) {
      continue;
    }

    const path = join(dir, entry.name);

    if (entry.isDirectory()) {
      result.push(...(await files(path)));
      continue;
    }

    result.push(path);
  }

  return result;
}

async function checkPackage(): Promise<void> {
  const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8")) as {
    version?: unknown;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };

  // action.yml runs `bun run src/cli.ts` with no install step, so any declared
  // dependency would simply be missing at runtime. Keep it zero-dependency.
  if (pkg.dependencies && Object.keys(pkg.dependencies).length > 0) {
    failures.push("package.json must not declare dependencies (action has no install step)");
  }
  if (pkg.devDependencies && Object.keys(pkg.devDependencies).length > 0) {
    failures.push("package.json must not declare devDependencies (action has no install step)");
  }

  // The release workflow derives the git tag (vX.Y.Z) from this field.
  if (!/^\d+\.\d+\.\d+$/.test(String(pkg.version ?? ""))) {
    failures.push("package.json version must be X.Y.Z");
  }
}
