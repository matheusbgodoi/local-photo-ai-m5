/**
 * The finishing pass and the sanity check.
 *
 * These matter more than they look: the finish is the last thing that touches
 * a delivery asset, and the sanity check is the only thing standing between a
 * corrupt generation and an agent wiring it into a web page.
 */

import { strict as assert } from "node:assert";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import sharp from "sharp";

import { finishImage, imageSize, resampleUpscale, sanityCheck } from "../dist/core/finish.js";

let dir: string;

before(() => {
  dir = mkdtempSync(join(tmpdir(), "local-photo-finish-"));
});
after(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** A deterministic test image with real structure, not a flat field. */
async function makeSource(path: string, width = 512, height = 384): Promise<string> {
  const svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    <rect width="100%" height="100%" fill="#8a8478"/>
    <circle cx="${width * 0.35}" cy="${height * 0.45}" r="${height * 0.28}" fill="#d8c9b4"/>
    <rect x="${width * 0.6}" y="${height * 0.2}" width="${width * 0.3}" height="${height * 0.6}" fill="#2f3a3a"/>
    <line x1="0" y1="${height * 0.8}" x2="${width}" y2="${height * 0.8}" stroke="#111" stroke-width="3"/>
  </svg>`;
  await sharp(Buffer.from(svg)).png().toFile(path);
  return path;
}

describe("finish", () => {
  test("encodes without touching anything when every knob is zero", async () => {
    const src = await makeSource(join(dir, "src.png"));
    const out = await finishImage({
      input: src,
      output: join(dir, "plain.jpg"),
      grain: 0,
      sharpen: 0,
      tone: 0,
    });
    assert.deepEqual(out.applied, ["encode jpg q92"]);
    assert.equal(out.width, 512);
    assert.equal(out.height, 384);
  });

  test("honours the output extension over any configured format", async () => {
    const src = await makeSource(join(dir, "src2.png"));
    const out = await finishImage({ input: src, output: join(dir, "as.png") });
    const meta = await sharp(out.file).metadata();
    assert.equal(meta.format, "png");
  });

  test("grain is luminance-only — it must not tint the image", async () => {
    const src = await makeSource(join(dir, "src3.png"));
    const plain = await finishImage({
      input: src,
      output: join(dir, "nograin.png"),
      grain: 0,
      sharpen: 0,
    });
    const grainy = await finishImage({
      input: src,
      output: join(dir, "grain.png"),
      grain: 0.2,
      sharpen: 0,
    });

    const a = await sharp(plain.file).stats();
    const b = await sharp(grainy.file).stats();

    // Every channel should shift by roughly the same tiny amount. A colour
    // cast would show up as the channels drifting apart.
    const drift = a.channels.map((c, i) => b.channels[i]!.mean - c.mean);
    const spread = Math.max(...drift) - Math.min(...drift);
    assert.ok(spread < 1.5, `channels drifted apart by ${spread.toFixed(2)}`);

    // And it must actually do something.
    const noisier = b.channels[0]!.stdev > a.channels[0]!.stdev;
    assert.ok(noisier, "grain did not increase variance");
  });

  test("the default grain stays subtle", async () => {
    const src = await makeSource(join(dir, "src4.png"));
    const plain = await finishImage({ input: src, output: join(dir, "p.png"), grain: 0, sharpen: 0 });
    const finished = await finishImage({ input: src, output: join(dir, "f.png"), grain: 0.2, sharpen: 0 });

    const a = (await sharp(plain.file).greyscale().stats()).channels[0]!;
    const b = (await sharp(finished.file).greyscale().stats()).channels[0]!;
    // Calibrated by eye at 100%: 0.2 reads as sensor character. If a change
    // ever pushes it far past that, this fails rather than shipping quietly.
    assert.ok(b.stdev - a.stdev < 6, `grain added ${(b.stdev - a.stdev).toFixed(2)} of stdev`);
  });

  test("resample upscale enlarges without inventing a new aspect", async () => {
    const src = await makeSource(join(dir, "src5.png"));
    const out = await resampleUpscale(src, join(dir, "up.png"), 1.5);
    const size = await imageSize(out.file);
    assert.equal(size.width, 768);
    assert.equal(size.height, 576);
  });
});

describe("sanity check", () => {
  test("passes a real image", async () => {
    const src = await makeSource(join(dir, "ok.png"));
    const report = await sanityCheck(src);
    assert.equal(report.ok, true, report.issues.join("; "));
  });

  test("catches an all-black frame", async () => {
    const path = join(dir, "black.png");
    await sharp({ create: { width: 64, height: 64, channels: 3, background: "#000" } })
      .png()
      .toFile(path);
    const report = await sanityCheck(path);
    assert.equal(report.ok, false);
    assert.match(report.issues.join(" "), /black|featureless/);
  });

  test("catches a flat, featureless field", async () => {
    const path = join(dir, "flat.png");
    await sharp({ create: { width: 64, height: 64, channels: 3, background: "#777" } })
      .png()
      .toFile(path);
    const report = await sanityCheck(path);
    assert.equal(report.ok, false);
    assert.match(report.issues.join(" "), /featureless/);
  });
});
