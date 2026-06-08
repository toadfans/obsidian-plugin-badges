import { readFile } from "node:fs/promises";
import { describe, expect, test } from "bun:test";

describe("README", () => {
  test("is English and uses the toadfans action owner", async () => {
    const readme = await readFile("README.md", "utf8");

    expect(readme).not.toMatch(/[\u3400-\u9fff]/);
    expect(readme).toContain("toadfans/obsidian-plugin-badges-action@v1");
    expect(readme).not.toContain("owner/obsidian-plugin-badges-action");
  });
});
