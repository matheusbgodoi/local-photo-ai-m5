/**
 * Contract tests for the two integrations.
 *
 * Neither needs a model, a GPU or a running agent: they check that the tools
 * are registered with the shapes their hosts expect, which is the part that
 * silently breaks when a dependency changes.
 */

import { strict as assert } from "node:assert";
import { existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import { describe, test } from "node:test";

import localPhotoExtension from "../dist/pi/index.js";

const REPO = join(import.meta.dirname, "..");

describe("pi extension", () => {
  const registered: { name: string; label: string; description: string; parameters: unknown }[] = [];
  const fakePi = {
    registerTool(tool: (typeof registered)[number]) {
      registered.push(tool);
    },
  };

  test("registers the expected tools", () => {
    (localPhotoExtension as unknown as (pi: typeof fakePi) => void)(fakePi);
    const names = registered.map((t) => t.name);
    assert.deepEqual(names, [
      "image_generate",
      "image_upscale",
      "image_health",
      "image_prompt_preview",
    ]);
  });

  test("every tool has a description an LLM can act on", () => {
    for (const tool of registered) {
      assert.ok(tool.description.length > 60, `${tool.name} description too short`);
      assert.ok(tool.label, `${tool.name} has no label`);
      assert.ok(tool.parameters, `${tool.name} has no parameter schema`);
    }
  });

  test("the generate description steers away from the AI-look vocabulary", () => {
    const generate = registered.find((t) => t.name === "image_generate")!;
    assert.match(generate.description, /photorealistic|photograph/i);
    assert.match(generate.description, /8k|ultra realistic|masterpiece/i); // as things NOT to write
    assert.match(generate.description, /\bdo not\b/i);
  });

  test("parameters are a TypeBox object schema, as Pi requires", () => {
    const generate = registered.find((t) => t.name === "image_generate")!;
    const schema = generate.parameters as { type?: string; properties?: Record<string, unknown> };
    assert.equal(schema.type, "object");
    assert.ok(schema.properties?.prompt, "prompt is required for the tool to be useful");
  });
});

describe("mcp server", () => {
  test("initializes and advertises its tools over stdio", () => {
    const server = join(REPO, "dist", "mcp", "server.js");
    assert.ok(existsSync(server), "dist/mcp/server.js is missing — run npm run build");

    const request = [
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "test", version: "1" },
        },
      }),
      JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }),
    ].join("\n");

    const stdout = execFileSync(process.execPath, [server], {
      input: `${request}\n`,
      encoding: "utf8",
      timeout: 30_000,
      stdio: ["pipe", "pipe", "pipe"],
    });

    const messages = stdout
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as { id?: number; result?: Record<string, never> });

    const init = messages.find((m) => m.id === 1);
    assert.ok(init?.result, "no initialize result");

    const list = messages.find((m) => m.id === 2) as
      | { result: { tools: { name: string; description: string }[] } }
      | undefined;
    assert.ok(list, "no tools/list result");

    const names = list.result.tools.map((t) => t.name).sort();
    assert.deepEqual(names, [
      "image_generate",
      "image_health",
      "image_prompt_preview",
      "image_upscale",
    ]);

    // Advertising an edit capability we cannot deliver would be worse than
    // not having one at all.
    assert.ok(!names.includes("image_edit"));
  });
});

describe("installed pi shim", () => {
  test("points at a build that exists, when installed", () => {
    const shim = join(homedir(), ".pi", "agent", "extensions", "local-photo", "index.ts");
    if (!existsSync(shim)) return; // not installed on this machine; nothing to assert
    const target = /from "([^"]+)"/.exec(readFileSync(shim, "utf8"))?.[1];
    assert.ok(target, "shim has no import target");
    assert.ok(existsSync(target!), `shim points at a missing build: ${target}`);
  });
});
