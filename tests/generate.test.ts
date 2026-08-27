/**
 * The delivery pipeline: what actually lands on disk after a generation.
 *
 * The backend is stubbed, so this needs neither a model nor a GPU. What is
 * under test is the part that decides file names and the upscale policy — the
 * part an agent wires into a web page — not diffusion.
 */

import { strict as assert } from "node:assert";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import sharp from "sharp";

import { LocalPhotoService, rawSiblingFor } from "../dist/core/service.js";
import { loadConfig } from "../dist/core/config.js";
import { imageSize } from "../dist/core/finish.js";
import { repoRoot } from "../dist/core/paths.js";

let dir: string;

before(() => {
  dir = mkdtempSync(join(tmpdir(), "local-photo-generate-"));
});
after(() => {
  rmSync(dir, { recursive: true, force: true });
});

/**
 * Stands in for draw-things-cli. Writes a real image with real structure at
 * exactly the requested size, so the sanity check and the resize maths are
 * exercised for real.
 */
function stubBackend() {
  const requests: { width: number; height: number; output: string }[] = [];
  return {
    requests,
    isInstalled: () => true,
    available: () => true,
    version: async () => "stub",
    async generate(request: { width: number; height: number; output: string }) {
      requests.push({ width: request.width, height: request.height, output: request.output });
      const { width, height } = request;
      const svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
        <rect width="100%" height="100%" fill="#8a8478"/>
        <circle cx="${width * 0.35}" cy="${height * 0.45}" r="${height * 0.25}" fill="#d8c9b4"/>
        <rect x="${width * 0.6}" y="${height * 0.2}" width="${width * 0.3}" height="${height * 0.6}" fill="#2f3a3a"/>
      </svg>`;
      await sharp(Buffer.from(svg)).png().toFile(request.output);
      return { file: request.output, durationMs: 1, command: "stub" };
    },
  };
}

function service(overrides: (config: ReturnType<typeof loadConfig>) => void = () => {}) {
  const config = loadConfig();
  overrides(config);
  const backend = stubBackend();
  return {
    backend,
    config,
    instance: new LocalPhotoService({ config, backend: backend as never, cwd: dir }),
  };
}

describe("default delivery", () => {
  test("the shipped default is Lanczos 1.5x, on", () => {
    const shipped = JSON.parse(
      readFileSync(join(repoRoot(), "config", "default.json"), "utf8"),
    ) as { upscale: { mode: string; upscaler: string; scale: number } };
    assert.equal(shipped.upscale.mode, "final");
    assert.equal(shipped.upscale.upscaler, "lanczos");
    assert.equal(shipped.upscale.scale, 1.5);
  });

  test("delivers the Lanczos result and keeps the raw render beside it", async () => {
    const output = join(dir, "doctor.jpg");
    const { instance } = service((c) => {
      c.upscale.mode = "final";
    });

    const result = await instance.generate({ prompt: "uma médica em uma clínica", output, seed: 7 });

    // The requested path is the final artifact, never the raw one.
    assert.deepEqual(result.files, [output]);
    assert.deepEqual(result.rawFiles, [join(dir, "doctor.raw.jpg")]);
    assert.ok(existsSync(output));
    assert.ok(existsSync(join(dir, "doctor.raw.jpg")));

    const final = await imageSize(output);
    const raw = await imageSize(join(dir, "doctor.raw.jpg"));
    assert.equal(final.width, Math.round(raw.width * 1.5));
    assert.equal(final.height, Math.round(raw.height * 1.5));

    const record = result.records[0]!;
    assert.equal(record.file, output);
    assert.equal(record.raw_file, join(dir, "doctor.raw.jpg"));
    assert.equal(record.upscaled, true);
    assert.equal(record.upscaler, "lanczos");
    assert.equal(record.upscale_scale, 1.5);
    assert.ok((result.timings.upscaleMs ?? 0) >= 0);
  });

  test("the sidecar points at both files, absolutely", async () => {
    const output = join(dir, "sidecar.jpg");
    const { instance } = service((c) => {
      c.upscale.mode = "final";
    });
    const result = await instance.generate({ prompt: "uma médica em uma clínica", output, seed: 8 });

    assert.deepEqual(result.metadataFiles, [join(dir, "sidecar.json")]);
    const sidecar = JSON.parse(readFileSync(join(dir, "sidecar.json"), "utf8")) as {
      file: string;
      raw_file: string | null;
    };
    assert.equal(sidecar.file, output);
    assert.equal(sidecar.raw_file, join(dir, "sidecar.raw.jpg"));
    for (const path of [sidecar.file, sidecar.raw_file!]) {
      assert.ok(path.startsWith("/"), `${path} is not absolute`);
      assert.ok(existsSync(path), `${path} does not exist`);
    }
  });

  test("--upscale off delivers the raw render alone", async () => {
    const output = join(dir, "plain.jpg");
    const { instance, backend } = service((c) => {
      c.upscale.mode = "final";
    });

    const result = await instance.generate({
      prompt: "uma médica em uma clínica",
      output,
      seed: 9,
      upscale: "off",
    });

    assert.deepEqual(result.files, [output]);
    assert.deepEqual(result.rawFiles, []);
    assert.equal(existsSync(join(dir, "plain.raw.jpg")), false);

    const record = result.records[0]!;
    assert.equal(record.upscaled, false);
    assert.equal(record.raw_file, null);

    // What was delivered *is* the model's frame, at the size it was made.
    const delivered = await imageSize(output);
    assert.equal(delivered.width, backend.requests[0]!.width);
    assert.equal(delivered.height, backend.requests[0]!.height);
  });

  test("a delivery size is still honoured with the upscale on", async () => {
    const output = join(dir, "post.jpg");
    const { instance } = service((c) => {
      c.upscale.mode = "final";
    });

    const result = await instance.generate({
      prompt: "família na cozinha",
      output,
      size: "post-portrait",
      seed: 10,
    });

    const final = await imageSize(result.files[0]!);
    assert.equal(final.width, 1080);
    assert.equal(final.height, 1350);
    // The raw stays what the model made, not what was delivered.
    const raw = await imageSize(result.rawFiles[0]!);
    assert.equal(raw.width, 1024);
    assert.equal(raw.height, 1280);
  });

  test("every frame of a batch gets its own raw render", async () => {
    const output = join(dir, "batch.jpg");
    const { instance } = service((c) => {
      c.upscale.mode = "final";
    });

    const result = await instance.generate({
      prompt: "uma médica em uma clínica",
      output,
      count: 2,
      seed: 11,
    });

    assert.deepEqual(result.files, [join(dir, "batch-1.jpg"), join(dir, "batch-2.jpg")]);
    assert.deepEqual(result.rawFiles, [join(dir, "batch-1.raw.jpg"), join(dir, "batch-2.raw.jpg")]);
    for (const path of [...result.files, ...result.rawFiles]) assert.ok(existsSync(path));
  });

  test("the raw name can never be the name the caller asked for", () => {
    for (const path of ["/a/hero.jpg", "/a/hero.png", "/a/b.c/hero", "/a/hero.raw.jpg"]) {
      assert.notEqual(rawSiblingFor(path), path);
    }
    assert.equal(rawSiblingFor("/a/hero.jpg"), "/a/hero.raw.jpg");
    assert.equal(rawSiblingFor("/a/hero.png"), "/a/hero.raw.png");
  });
});
