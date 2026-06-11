import { readFile } from "node:fs/promises";
import { describe, expect, test } from "bun:test";

describe("action metadata", () => {
  test("runs only for public repositories and writes to the wiki checkout", async () => {
    const action = await readFile("action.yml", "utf8");

    expect(action).toContain("github.event.repository.private == false");
    expect(action).toContain("repository: ${{ github.repository }}.wiki");
    expect(action).toContain("INPUT_OUTPUT_DIR: ${{ github.workspace }}/.obsidian-plugin-badges-wiki");
  });
});
