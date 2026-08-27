/**
 * The command line surface.
 *
 * Everything here runs the real binary in a subprocess. None of it needs a
 * model: what is under test is argument handling and help, which is the part a
 * person meets first and the part that used to be wrong.
 */

import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";

const CLI = join(import.meta.dirname, "..", "dist", "cli", "index.js");

function cli(args: string[]): { status: number; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [CLI, ...args], {
    encoding: "utf8",
    timeout: 30_000,
  });
  return { status: result.status ?? -1, stdout: result.stdout, stderr: result.stderr };
}

/** Every command the brief asks to be documented, plus the rest of the surface. */
const COMMANDS = [
  "generate",
  "prompt",
  "upscale",
  "reproduce",
  "benchmark",
  "lora",
  "verify",
  "prune",
  "serve",
  "render-html",
  "health",
  "doctor",
  "install-model",
  "install-upscaler",
  "presets",
  "sizes",
  "manifest",
];

describe("help", () => {
  test("the top level explains itself", () => {
    for (const args of [[], ["--help"], ["-h"], ["help"]]) {
      const { status, stdout } = cli(args);
      assert.equal(status, 0, `local-photo ${args.join(" ")} exited ${status}`);
      assert.match(stdout, /USAGE/, `local-photo ${args.join(" ")}`);
      assert.match(stdout, /generate/);
    }
  });

  test("every command answers --help, -h and `help <command>`", () => {
    for (const command of COMMANDS) {
      for (const args of [[command, "--help"], [command, "-h"], ["help", command]]) {
        const { status, stdout } = cli(args);
        assert.equal(status, 0, `local-photo ${args.join(" ")} exited ${status}`);
        assert.match(
          stdout,
          new RegExp(`local-photo ${command}\\b`),
          `local-photo ${args.join(" ")} did not describe ${command}`,
        );
        assert.match(stdout, /USAGE/, `local-photo ${args.join(" ")}`);
      }
    }
  });

  test("generate --help describes the behaviour it actually has", () => {
    const { stdout } = cli(["generate", "--help"]);
    // The two-file delivery and the way to switch it off are the things
    // someone reading this needs to know.
    assert.match(stdout, /\.raw\./);
    assert.match(stdout, /--upscale off/);
    assert.match(stdout, /final \(default\)/);
    assert.match(stdout, /-p, --prompt/);
    assert.match(stdout, /local-photo generate "<brief>"/);
  });

  test("an unknown command still points at the usage", () => {
    const { status, stderr } = cli(["nonsense"]);
    assert.equal(status, 1);
    assert.match(stderr, /Unknown command/);
    assert.match(stderr, /USAGE/);
  });

  test("a typo fails even when --help came with it", () => {
    // Otherwise a script probing `local-photo <cmd> --help` to check a command
    // exists gets a clean exit for every command that does not.
    for (const args of [["genrate", "--help"], ["genrate", "-h"], ["help", "genrate"]]) {
      const { status, stderr } = cli(args);
      assert.equal(status, 1, `local-photo ${args.join(" ")} exited 0`);
      assert.match(stderr, /Unknown command/, args.join(" "));
    }
  });

  test("help does not fall through to Object.prototype", () => {
    // `HELP[topic]` finds Object.prototype.toString for these, which is truthy
    // and then crashes stdout.write.
    for (const topic of ["toString", "constructor", "hasOwnProperty", "__proto__"]) {
      const { status, stderr } = cli(["help", topic]);
      assert.equal(status, 1, `help ${topic} exited 0`);
      assert.match(stderr, /Unknown command/, topic);
      assert.doesNotMatch(stderr, /TypeError|ERR_INVALID_ARG_TYPE/, topic);
    }
  });

  test("every upscaler named in help exists in the manifest", () => {
    // A copy-pasteable example that errors out is worse than no example.
    const manifest = JSON.parse(
      readFileSync(join(import.meta.dirname, "..", "config", "models.json"), "utf8"),
    ) as { upscalers: { id: string }[] };
    const known = new Set(manifest.upscalers.map((u) => u.id));
    const { stdout } = cli(["upscale", "--help"]);
    for (const [, id] of stdout.matchAll(/--upscaler\s+([a-z0-9][a-z0-9.-]*)/g)) {
      if (id === "<id>") continue;
      assert.ok(known.has(id), `help names upscaler "${id}", which is not in config/models.json`);
    }
  });
});

describe("prompt", () => {
  test("takes the brief as a positional argument", () => {
    const { status, stdout } = cli(["prompt", "médica conversando com paciente idosa"]);
    assert.equal(status, 0);
    assert.match(stdout, /female doctor/);
    assert.match(stdout, /elderly female patient/);
  });

  test("still takes --prompt", () => {
    const { status, stdout } = cli(["prompt", "--prompt", "médica conversando com paciente idosa"]);
    assert.equal(status, 0);
    assert.match(stdout, /female doctor/);
  });

  test("--json is machine-readable", () => {
    const { status, stdout } = cli(["prompt", "um médico", "--json"]);
    assert.equal(status, 0);
    const parsed = JSON.parse(stdout) as { preset: string; positive: string }[];
    assert.ok(parsed[0]?.positive.length > 0);
  });
});

describe("generate argument handling", () => {
  // Nothing here reaches the model: a bad --seed is rejected while parsing,
  // which is *after* the brief has been accepted. If the positional were
  // ignored we would see the "brief is required" error instead.
  test("accepts a positional brief", () => {
    const { status, stderr } = cli(["generate", "uma médica em uma clínica", "--seed", "abc"]);
    assert.equal(status, 1);
    assert.match(stderr, /--seed must be a number/);
  });

  test("still accepts --prompt", () => {
    const { status, stderr } = cli(["generate", "--prompt", "uma médica", "--seed", "abc"]);
    assert.equal(status, 1);
    assert.match(stderr, /--seed must be a number/);
  });

  test("still accepts -p", () => {
    const { status, stderr } = cli(["generate", "-p", "uma médica", "--seed", "abc"]);
    assert.equal(status, 1);
    assert.match(stderr, /--seed must be a number/);
  });

  test("says what is missing when no brief is given", () => {
    const { status, stderr } = cli(["generate"]);
    assert.equal(status, 1);
    assert.match(stderr, /brief is required/);
    assert.match(stderr, /generate --help/);
  });
});
