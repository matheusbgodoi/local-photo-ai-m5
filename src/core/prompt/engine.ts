/**
 * The Photography Prompt Engine.
 *
 * Takes a plain intent ("médica conversando com paciente idosa em uma clínica")
 * and writes the brief a photographer would be given. It adds camera, light,
 * material behaviour, texture and framing. It never adds or changes a *fact*:
 * age, gender, ethnicity, headcount, product, brand, clothing, action and
 * setting come from the caller and only from the caller.
 *
 * Determinism matters as much as quality — the same (prompt, preset, seed)
 * always produces the same brief, or `local-photo reproduce` would be fiction.
 */

import type { PresetName, SceneHints } from "../types.js";
import { analyzeScene, type SceneAnalysis } from "./analyze.js";
import { createRng, type Rng } from "./rng.js";
import { dofClauses, getPreset, grainClauses, type Preset } from "./presets.js";
import { translateToEnglish } from "./translate.js";

export interface EngineInput {
  prompt: string;
  preset?: PresetName;
  seed: number;
  hints?: SceneHints;
  /** Negative prompts are pointless at CFG 1 on a distilled model. */
  allowNegative?: boolean;
}

export interface EngineOutput {
  positive: string;
  negative: string | null;
  /** Human-readable trace of every decision, stored in the sidecar. */
  rationale: string[];
  analysis: SceneAnalysis;
  subject: string;
  translated: boolean;
}

/** Terms that reliably push the model toward the plastic AI look. */
export const SLOP_TERMS = [
  "8k", "4k uhd", "masterpiece", "ultra realistic", "hyperrealistic",
  "award winning", "insanely detailed", "perfect skin", "flawless skin",
  "trending on artstation", "octane render", "unreal engine", "hdr",
  "cinematic masterpiece", "professional 8k photography",
];

const NEGATIVE_BASE = [
  "plastic skin",
  "waxy airbrushed skin",
  "over-smoothed faces",
  "uniform poreless complexion",
  "oversharpened",
  "HDR glow",
  "heavy vignette",
  "oversaturated colours",
  "perfectly symmetrical face",
  "stock photo pose",
  "3d render",
  "CGI",
  "illustration",
  "painting",
  "watermark",
  "text overlay",
  "deformed hands",
  "extra fingers",
];

// ---------------------------------------------------------------------------
// Subject-facing modules
// ---------------------------------------------------------------------------

function behaviourClause(analysis: SceneAnalysis, preset: Preset, rng: Rng): string | null {
  if (analysis.people === "none") return null;
  if (analysis.lookingAtCamera !== "unspecified") return null;

  const candid = ["natural", "lifestyle", "clinical", "smartphone"].includes(preset.id);
  if (candid) {
    return rng.pick([
      "absorbed in what they are doing rather than posing",
      "attention on each other, not on the camera",
      "unaware of the camera, mid-action",
      "caught between moments rather than posed",
    ]);
  }
  // Being aware of the camera is fine. Presenting to it is the stock-photo
  // tell rule 18 asks us to avoid by default, and a commissioned shoot falls
  // into it more readily than a candid one.
  return rng.pick([
    "relaxed and mid-task rather than presenting to the camera",
    "comfortable with the camera present, attention still on their work",
    "glancing up briefly from what they are doing",
    "at ease, looking slightly away from the lens",
  ]);
}

function skinClauses(analysis: SceneAnalysis, preset: Preset, rng: Rng): string[] {
  if (preset.humanRealism === 0 || analysis.people === "none") return [];

  const closeEnough = analysis.framing === "closeup" || analysis.framing === "portrait";
  // Age-appropriate texture is guaranteed, not sampled: an elderly face rendered
  // with default generated skin is the single most obvious tell in this domain.
  const pool: string[] = [];

  const elderly = analysis.ages.includes("elderly")
    ? [
        "skin that shows their age honestly: fine lines, softened contours and thinner skin on the hands",
        "natural age-related wrinkles and an ordinary, unretouched complexion",
        "grey hair that is not uniformly styled, and a face with real years in it",
      ]
    : null;
  const child = analysis.ages.includes("child")
    ? [
        "soft young skin and hair that is not perfectly tidy",
        "a child's ordinary, slightly untidy appearance",
      ]
    : null;
  const grown =
    analysis.ages.includes("adult") || analysis.ages.includes("young")
      ? [
          "ordinary, unretouched skin texture",
          "a face with mild asymmetry and an everyday complexion",
          "slight shine on the forehead and unsmoothed skin",
        ]
      : null;

  // A doctor and an elderly patient are two age groups in one frame, and only
  // one age clause is emitted. It goes to the hardest face to render honestly,
  // not to whichever the seed happens to land on.
  const ageSpecific = elderly ?? child ?? grown ?? [];

  // Micro-texture only when the framing would actually resolve it.
  if (closeEnough) {
    pool.push(
      "visible pores and fine facial hair at this distance",
      "faint under-eye shadows and a small blemish or two",
      "individual strands of hair catching the light",
      "natural teeth with slightly uneven colour",
    );
  } else {
    pool.push(
      "natural hair that moves in separate strands",
      "hands in a relaxed, physically plausible position",
    );
  }

  pool.push(
    "clothing with real folds and slight creasing",
    "an ordinary, unforced expression",
  );

  const count = preset.humanRealism === 2 ? 3 : 2;
  const out: string[] = [];
  if (ageSpecific.length > 0) out.push(rng.pick([...new Set(ageSpecific)]));
  const remaining = Math.max(0, count - out.length);
  const rest = [...new Set(pool)].filter((c) => !out.includes(c));
  out.push(...rng.sample(rest, Math.min(remaining, rest.length)));
  return out;
}

function materialClauses(analysis: SceneAnalysis, preset: Preset, rng: Rng): string[] {
  if (!preset.materialRealism || analysis.products.length === 0) return [];

  const byKind: Record<string, string[]> = {
    phone: [
      "faint fingerprints and smudges on the glass",
      "a soft reflection of the room across the screen glass",
      "the screen bright but still showing a soft reflection",
    ],
    laptop: [
      "soft, diffuse reflections across the aluminium",
      "slight wear on the most-used keys",
      "a faint smudge on the display and dust visible in raking light",
    ],
    screen: [
      "the display reflecting the room as well as showing its own image",
      "a slight moiré and pixel structure visible up close",
    ],
    "medical-device": [
      "moulded plastic with visible seams and printed labels",
      // Not "worn" or "scuffed": clinical kit is wiped down constantly, and
      // wear language on a close shot of a machine produced visible rust.
      "a clean casing carrying the faint marks of daily wiping down",
      "cables that hang the way cables actually hang",
      "an indicator light and a small screen that is genuinely lit",
    ],
    electronics: [
      "matte plastic and brushed metal responding differently to the light",
      "edges catching a thin specular highlight",
    ],
    "packaged-good": [
      "printed packaging with a slight sheen and small imperfections",
      "the label sitting very slightly askew",
    ],
    generic: [
      "materials that respond to light according to their actual roughness",
      "a soft contact shadow where the object meets the surface",
    ],
  };

  const pool = analysis.products.flatMap((k) => byKind[k] ?? byKind.generic!);
  return rng.sample([...new Set(pool)], Math.min(2, pool.length));
}

function environmentClause(analysis: SceneAnalysis, preset: Preset, rng: Rng): string | null {
  // The clinical preset already carries this in its signature.
  if (preset.id === "clinical") return null;
  if (analysis.setting === "unknown" || analysis.setting === "studio") return null;

  const bySetting: Record<string, string[]> = {
    clinic: [
      "a real clinic with paperwork, equipment and objects left where staff put them",
      "an ordinary consulting room, tidy but clearly in use",
    ],
    hospital: [
      "a working hospital space with cables, signage and scuffed surfaces",
      "an ordinary ward, functional rather than photogenic",
    ],
    office: [
      "an ordinary office with loose papers, mugs and a little clutter",
      "a real workspace with cables, notes and a little clutter",
    ],
    home: [
      "a lived-in home where things sit where people actually leave them",
      "an ordinary domestic room, comfortable rather than styled",
    ],
    outdoor: [
      "an ordinary street or outdoor space with everyday background detail",
      "the background busy with real, unremarkable surroundings",
    ],
    retail: ["an ordinary shop interior with real stock on the shelves"],
  };

  const pool = bySetting[analysis.setting];
  return pool ? rng.pick(pool) : null;
}

function pickLens(analysis: SceneAnalysis, preset: Preset, rng: Rng): string | null {
  if (analysis.explicitCamera) return null;

  const subject =
    analysis.objectLed ? "object"
    : analysis.people !== "none" && (analysis.framing === "wide" || analysis.setting !== "unknown")
      ? "people"
      : analysis.people !== "none" ? "people"
      : "scene";

  // 85mm only where portrait compression genuinely makes sense.
  const usable = preset.lenses.filter((lens) => {
    if (!lens.suits) return true;
    const matches = lens.suits.includes(subject) || lens.suits.includes("scene");
    if (/\b85mm\b/.test(lens.text)) {
      const portraitish = analysis.framing === "portrait" || analysis.framing === "closeup";
      return matches && (portraitish || analysis.objectLed);
    }
    if (/\b28mm\b/.test(lens.text)) {
      return matches && (analysis.framing === "wide" || analysis.setting !== "unknown");
    }
    return matches;
  });

  const pool = usable.length > 0 ? usable : preset.lenses;
  return rng.pick(pool).text;
}

function pickLight(analysis: SceneAnalysis, preset: Preset, rng: Rng): string | null {
  if (analysis.explicitLighting) return null;
  const bySetting = preset.lighting[analysis.setting];
  const pool = bySetting && bySetting.length > 0 ? bySetting : preset.lighting.default!;
  return rng.pick(pool);
}

// ---------------------------------------------------------------------------
// Composition
// ---------------------------------------------------------------------------

/** Words that keep their capital even at the start of a subject clause. */
const ALWAYS_CAPITALISED = new Set([
  "brazilian", "portuguese", "japanese", "chinese", "korean", "italian",
  "spanish", "french", "german", "american", "african", "european", "asian",
  "latin", "indian", "arab", "jewish", "muslim", "christian",
]);

/** Uncountable heads that must not take an indefinite article. */
const MASS_NOUNS = [
  "equipment",
  "furniture",
  "clothing",
  "medication",
  "packaging",
  "paperwork",
  "lighting",
  "machinery",
  "glassware",
  "signage",
];

/** Determiners that already introduce a noun phrase, so we must not add one. */
const DETERMINERS = new Set([
  "a", "an", "the", "some", "several", "many", "two", "three", "four", "five",
  "his", "her", "their", "this", "that", "these", "those", "one", "no",
]);

function normaliseSubject(text: string): string {
  let subject = text.trim().replace(/\s+/g, " ").replace(/[.]+$/, "");

  const first = subject.split(" ")[0] ?? "";
  const firstLower = first.toLowerCase();

  // Lowercase a sentence-initial capital, but never flatten a brand or an
  // acronym: "MacBook" and "ICU" must survive intact.
  const isProperNoun =
    /[A-Z]/.test(first.slice(1)) ||
    /^[A-Z]{2,}/.test(first) ||
    ALWAYS_CAPITALISED.has(firstLower);
  if (!isProperNoun && /^[A-Z]/.test(first)) {
    subject = subject.charAt(0).toLowerCase() + subject.slice(1);
  }

  // Openers end in "of", so the subject needs its own article unless it
  // already has one, is plural, is a mass noun, or is a proper noun.
  const massHead = MASS_NOUNS.some((noun) => new RegExp(`\\b${noun}\\b`, "i").test(subject.split(/[,.]/)[0] ?? ""));
  const needsArticle =
    !DETERMINERS.has(firstLower) &&
    !isProperNoun &&
    !massHead &&
    !/s$/.test(firstLower) &&
    !/^\d/.test(firstLower);

  if (needsArticle) {
    const article = /^[aeiou]/i.test(subject) ? "an" : "a";
    subject = `${article} ${subject}`;
  }
  return subject;
}

/**
 * A brief is allowed to name its own medium ("fotografia documental de uma
 * médica…"). Wrapping that in a preset opener produced "A photograph taken
 * during an ordinary working day, showing a documentary photograph of …" — a
 * photograph of a photograph. When the caller has already framed it, theirs
 * wins and ours is dropped rather than nested.
 *
 * Only "photograph" and "photo" count. "picture" and "image" are far more often
 * an object *in* the scene than the medium — "um quadro de família sobre a
 * mesa" is a framed picture on a desk, not a brief about a picture — and
 * dropping the opener for those silently changed what the photograph is of.
 */
const CALLER_FRAMED_AS_PHOTOGRAPH =
  /^(?:an?|the)\s+(?:[\p{L}][\p{L}-]*\s+){0,3}(?:photographs?|photos?)\s+of\b/iu;

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function joinSentence(parts: (string | null | undefined)[]): string {
  const kept = parts.filter((p): p is string => Boolean(p && p.trim()));
  if (kept.length === 0) return "";
  const text = kept.join(", ").replace(/\s+/g, " ").trim();
  return text.endsWith(".") ? text : `${text}.`;
}

export function buildPrompt(input: EngineInput): EngineOutput {
  const preset = getPreset(input.preset);
  const rationale: string[] = [];

  const translation = translateToEnglish(input.prompt);
  if (translation.wasPortuguese) {
    rationale.push(
      `Translated pt-BR -> EN (${Math.round(translation.coverage * 100)}% of content words recognised)` +
        (translation.unknown.length > 0 ? `; kept verbatim: ${translation.unknown.join(", ")}` : ""),
    );
  }

  const subject = normaliseSubject(translation.text);
  const analysis = analyzeScene(translation.text);
  const rng = createRng(`${input.prompt}|${preset.id}|${input.seed}`);

  rationale.push(
    `Scene: people=${analysis.people}, ages=[${analysis.ages.join("/") || "-"}], ` +
      `roles=[${analysis.roles.join("/") || "-"}], products=[${analysis.products.join("/") || "-"}], ` +
      `setting=${analysis.setting}, framing=${analysis.framing}`,
  );

  if (analysis.slopTerms.length > 0) {
    rationale.push(
      `Caller supplied AI-look terms (${analysis.slopTerms.join(", ")}); kept verbatim ` +
        `because rewriting the request is not our job, but nothing similar was added.`,
    );
  }

  // --- sentence 1: what this is ------------------------------------------
  // The opener is drawn either way, so the deterministic rng stream stays
  // aligned with every other clause whether or not it ends up being used.
  const opener = rng.pick(preset.openers);
  const callerFramed = CALLER_FRAMED_AS_PHOTOGRAPH.test(subject);
  if (callerFramed) {
    rationale.push("Brief already names the medium; the preset opener was dropped rather than nested.");
  }
  const behaviour = behaviourClause(analysis, preset, rng);
  const sentence1 = joinSentence([
    callerFramed ? capitalise(subject) : `${opener} ${subject}`,
    behaviour,
  ]);

  // --- sentence 2: who/what is in it -------------------------------------
  const skin = skinClauses(analysis, preset, rng);
  const materials = materialClauses(analysis, preset, rng);
  const environment = environmentClause(analysis, preset, rng);
  const sentence2 = joinSentence([...skin, ...materials, environment]);
  if (skin.length > 0) rationale.push(`Human realism: ${skin.length} clause(s), age-aware.`);
  if (materials.length > 0) rationale.push(`Material realism for: ${analysis.products.join(", ")}.`);

  // --- sentence 3: how it was shot ---------------------------------------
  const light = pickLight(analysis, preset, rng);
  const lens = pickLens(analysis, preset, rng);
  const dof = rng.pick(dofClauses(preset.dof));
  const sentence3 = joinSentence([light, lens, dof]);
  if (analysis.explicitCamera) rationale.push("Caller specified camera/lens; ours was not added.");
  if (analysis.explicitLighting) rationale.push("Caller specified lighting; ours was not added.");

  // --- sentence 4: framing + medium --------------------------------------
  const composition = rng.pick(preset.composition);
  const grainPool = grainClauses(preset.grain);
  const grain = grainPool.length > 0 ? rng.pick(grainPool) : null;
  const signaturePool =
    analysis.objectLed && preset.signatureObject ? preset.signatureObject : preset.signature;
  const signature = signaturePool.length > 0 ? rng.pick(signaturePool) : null;
  const sentence4 = joinSentence([composition, grain, signature]);

  // --- sentence 5: intent -------------------------------------------------
  const closer = rng.pick(preset.closers);

  const positive = [sentence1, sentence2, sentence3, sentence4, closer]
    .filter((s) => s && s.trim())
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();

  rationale.push(`Preset "${preset.id}": ${preset.summary}`);
  rationale.push(`Brief length: ${positive.split(/\s+/).length} words.`);

  const negative = input.allowNegative ? NEGATIVE_BASE.join(", ") : null;
  if (!input.allowNegative) {
    rationale.push("Negative prompt omitted: the model runs distilled at CFG 1, where it has no effect.");
  }

  return {
    positive,
    negative,
    rationale,
    analysis,
    subject,
    translated: translation.wasPortuguese,
  };
}

