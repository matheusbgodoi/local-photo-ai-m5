/**
 * Contact sheets.
 *
 * A/B judgements fall apart when the two frames are viewed minutes apart in
 * separate windows — you end up comparing your memory of one image to the
 * other. Stitching the candidates into a single labelled sheet forces an
 * honest side-by-side, which is how film contact sheets have always worked.
 *
 * Used by the benchmark and by the LoRA evaluation.
 */

import { dirname } from "node:path";
import sharp from "sharp";
import type { OverlayOptions } from "sharp";
import { ensureDir } from "./paths.js";

export interface SheetCell {
  file: string;
  label: string;
}

export interface SheetOptions {
  cells: SheetCell[];
  output: string;
  /** Width of each cell in the sheet. Height follows the source aspect. */
  cellWidth?: number;
  /** Title strip across the top. */
  title?: string;
  columns?: number;
}

const LABEL_HEIGHT = 34;
const TITLE_HEIGHT = 44;
const GAP = 10;
const BG = { r: 24, g: 24, b: 26, alpha: 1 };

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function textLayer(text: string, width: number, height: number, size: number): Buffer {
  const svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    <rect width="100%" height="100%" fill="#18181a"/>
    <text x="10" y="${Math.round(height / 2 + size / 3)}"
          font-family="-apple-system, SF Pro Text, Helvetica, sans-serif"
          font-size="${size}" fill="#e8e8ea">${escapeXml(text)}</text>
  </svg>`;
  return Buffer.from(svg);
}

export async function contactSheet(options: SheetOptions): Promise<string> {
  const cells = options.cells.filter((c) => c.file);
  if (cells.length === 0) throw new Error("contactSheet() needs at least one image");

  const cellWidth = options.cellWidth ?? 512;
  const columns = options.columns ?? cells.length;
  const rows = Math.ceil(cells.length / columns);

  // Every cell is scaled to the same width; the tallest sets the row height.
  const prepared = await Promise.all(
    cells.map(async (cell) => {
      const image = sharp(cell.file).resize({ width: cellWidth, withoutEnlargement: false });
      const buffer = await image.png().toBuffer({ resolveWithObject: true });
      return { ...cell, buffer: buffer.data, width: buffer.info.width, height: buffer.info.height };
    }),
  );

  const cellHeight = Math.max(...prepared.map((p) => p.height));
  const titleOffset = options.title ? TITLE_HEIGHT + GAP : 0;
  const sheetWidth = columns * cellWidth + (columns + 1) * GAP;
  const sheetHeight =
    titleOffset + rows * (cellHeight + LABEL_HEIGHT) + (rows + 1) * GAP;

  const composites: OverlayOptions[] = [];

  if (options.title) {
    composites.push({
      input: textLayer(options.title, sheetWidth, TITLE_HEIGHT, 20),
      top: 0,
      left: 0,
    });
  }

  prepared.forEach((cell, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const left = GAP + column * (cellWidth + GAP);
    const top = titleOffset + GAP + row * (cellHeight + LABEL_HEIGHT + GAP);

    composites.push({ input: cell.buffer, top, left });
    composites.push({
      input: textLayer(cell.label, cellWidth, LABEL_HEIGHT, 15),
      top: top + cellHeight,
      left,
    });
  });

  ensureDir(dirname(options.output));
  await sharp({
    create: {
      width: sheetWidth,
      height: sheetHeight,
      channels: 3,
      background: BG,
    },
  })
    .composite(composites)
    .jpeg({ quality: 94, chromaSubsampling: "4:4:4" })
    .toFile(options.output);

  return options.output;
}

/**
 * A 100% crop of the same region from several images.
 *
 * Skin texture, hair edges and screen reflections are where realism actually
 * lives, and a downscaled full frame hides all three. This pulls the same
 * pixel region from each candidate at native resolution.
 */
export async function detailStrip(
  cells: SheetCell[],
  output: string,
  region: { left: number; top: number; width: number; height: number },
): Promise<string> {
  const crops: SheetCell[] = [];
  const temp: string[] = [];

  for (const cell of cells) {
    const meta = await sharp(cell.file).metadata();
    const left = Math.max(0, Math.min(region.left, (meta.width ?? 0) - region.width));
    const top = Math.max(0, Math.min(region.top, (meta.height ?? 0) - region.height));
    const cropPath = `${output}.${crops.length}.crop.png`;
    await sharp(cell.file)
      .extract({ left, top, width: region.width, height: region.height })
      .png()
      .toFile(cropPath);
    crops.push({ file: cropPath, label: cell.label });
    temp.push(cropPath);
  }

  const sheet = await contactSheet({
    cells: crops,
    output,
    cellWidth: region.width,
    title: `100% detail — ${region.width}x${region.height} at (${region.left}, ${region.top})`,
  });

  const { rmSync } = await import("node:fs");
  for (const path of temp) rmSync(path, { force: true });
  return sheet;
}
