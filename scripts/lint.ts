import { readdir, readFile } from "node:fs/promises";
import { extname, join, relative } from "node:path";

const root = process.cwd();
const ignored = new Set([".git", "node_modules"]);
const bannedExtensions = new Set([".js", ".mjs", ".cjs"]);
const requiredFiles = [
  "action.yml",
  "package.json",
  "src/core.ts",
  "src/cli.ts",
  "test/core.test.ts",
  "scripts/lint.ts",
  ".github/workflows/ci.yml",
  "README.md",
];

const failures: string[] = [];

for (const file of requiredFiles) {
  await requireFile(file);
}

for (const file of await files(root)) {
  const path = relative(root, file);
  const extension = extname(path);

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
await checkAction();
await checkCi();

if (failures.length > 0) {
  for (const failure of failures) {
    console.error(failure);
  }
  process.exit(1);
}

console.log("lint ok");

async function requireFile(path: string): Promise<void> {
  try {
    await readFile(join(root, path), "utf8");
  } catch {
    failures.push(`missing required file: ${path}`);
  }
}

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
  const text = await readFile(join(root, "package.json"), "utf8");
  const pkg = JSON.parse(text) as {
    scripts?: Record<string, string>;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };

  if (pkg.dependencies && Object.keys(pkg.dependencies).length > 0) {
    failures.push("package.json must not declare dependencies");
  }
  if (pkg.devDependencies && Object.keys(pkg.devDependencies).length > 0) {
    failures.push("package.json must not declare devDependencies");
  }
  if (pkg.scripts?.lint !== "bun run scripts/lint.ts") {
    failures.push("package.json lint script must run scripts/lint.ts");
  }
  if (pkg.scripts?.test !== "bun test") {
    failures.push("package.json test script must run bun test");
  }
}

async function checkAction(): Promise<void> {
  const text = await readFile(join(root, "action.yml"), "utf8");

  for (const needle of [
    "using: composite",
    "source-dir:",
    "plugin-slug:",
    "commit:",
    "bun run \"$GITHUB_ACTION_PATH/src/cli.ts\"",
  ]) {
    if (!text.includes(needle)) {
      failures.push(`action.yml missing ${needle}`);
    }
  }
}

async function checkCi(): Promise<void> {
  const text = await readFile(join(root, ".github/workflows/ci.yml"), "utf8");

  for (const needle of ["bun run lint", "bun test", "oven-sh/setup-bun"]) {
    if (!text.includes(needle)) {
      failures.push(`ci.yml missing ${needle}`);
    }
  }
}
