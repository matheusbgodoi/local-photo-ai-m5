/**
 * Photographic doctrines.
 *
 * A preset is not a "style". It is a set of decisions a real photographer
 * would make before a shoot: what kind of coverage this is, what glass they'd
 * bring, how they'd light it, how much of the room they'd let in, and how much
 * imperfection they'd tolerate. Six of them, because a photographer does not
 * have twenty modes either.
 *
 * Every string here is deliberately plain. No "masterpiece", no "8k", no
 * "award winning" — those tokens pull the model toward the glossy render
 * aesthetic we are specifically trying to avoid.
 */

import type { PresetName } from "../types.js";

export type DofPolicy = "deep" | "natural" | "moderate" | "shallow";
export type GrainPolicy = "none" | "faint" | "subtle" | "visible";

export interface LensChoice {
  /** e.g. "35mm lens on a full-frame camera" */
  text: string;
  /** Which subjects this glass suits. Empty = any. */
  suits?: string[];
}

export interface Preset {
  id: PresetName;
  label: string;
  summary: string;
  /** Sentence openers. One is picked deterministically per seed. */
  openers: string[];
  /** Lens pool, filtered by subject at compose time. */
  lenses: LensChoice[];
  /** Lighting clauses by setting; `default` is the fallback. */
  lighting: Record<string, string[]>;
  dof: DofPolicy;
  grain: GrainPolicy;
  /** Composition clauses; the engine picks one or two. */
  composition: string[];
  /** Closing intent clauses. */
  closers: string[];
  /** How strongly to push human micro-texture. 0 disables the module. */
  humanRealism: 0 | 1 | 2;
  /** Whether to emit material/reflection language for objects. */
  materialRealism: boolean;
  /** Extra clauses always appended for this preset. */
  signature: string[];
  /** Used instead of signature when the subject is an object, not a person. */
  signatureObject?: string[];
  /** Model sampling nudges. Undefined = use the model variant default. */
  steps?: number;
  guidance?: number;
}

const DOF_TEXT: Record<DofPolicy, string[]> = {
  deep: [
    "deep depth of field with the whole scene readable",
    "most of the scene in focus, background still legible",
  ],
  natural: [
    "natural depth of field, background softened only slightly",
    "moderate depth of field, the room still recognisable behind the subject",
    "background gently out of focus but not dissolved",
  ],
  moderate: [
    "moderate subject separation, background soft but readable",
    "background falls off softly without turning into abstract blur",
  ],
  shallow: [
    "shallow focus on the subject, background softly rendered",
    "subject separated from a softly defocused background",
  ],
};

const GRAIN_TEXT: Record<GrainPolicy, string[]> = {
  none: [],
  faint: ["very faint sensor noise in the shadows"],
  subtle: [
    "slight sensor grain in the shadows",
    "a trace of luminance noise, as from a moderate ISO",
  ],
  visible: [
    "visible sensor noise from a high ISO",
    "grainy shadows and slightly muddy blacks, as from a small sensor at high ISO",
  ],
};

export const PRESETS: Record<PresetName, Preset> = {
  // -------------------------------------------------------------------------
  natural: {
    id: "natural",
    label: "Natural",
    summary:
      "Plausible everyday photograph. The default. Nothing about it announces itself.",
    openers: [
      "A photograph of",
      "An unposed photograph of",
      "A candid photograph of",
      "A documentary-style photograph of",
    ],
    lenses: [
      { text: "shot on a full-frame camera with a 35mm lens", suits: ["environment", "people", "scene"] },
      { text: "shot on a full-frame camera with a 50mm lens", suits: ["people", "object", "scene"] },
      { text: "shot with a 40mm lens at eye level", suits: ["people", "scene"] },
      { text: "shot on a 28mm lens, taking in the room", suits: ["environment"] },
    ],
    lighting: {
      default: [
        "lit by ordinary available light",
        "mixed daylight and ordinary interior lighting",
        "soft indirect daylight",
      ],
      home: [
        "window light from one side, mixed with a warm lamp",
        "ordinary afternoon light through a nearby window",
      ],
      office: [
        "daylight from a window mixed with overhead office lighting",
        "flat ambient office light with daylight spill",
      ],
      outdoor: [
        "overcast daylight, soft and even",
        "open shade with plain daylight",
      ],
    },
    dof: "natural",
    grain: "subtle",
    composition: [
      "framed slightly off-centre",
      "eye-level viewpoint, framing a little loose",
      "the subject placed off to one side with room around them",
      "slightly imperfect framing, as if taken quickly",
    ],
    closers: [
      "An ordinary real-world photograph.",
      "Looks like an ordinary photograph taken by a competent photographer.",
      "Plain, believable photography rather than advertising imagery.",
    ],
    humanRealism: 1,
    materialRealism: true,
    signature: ["realistic dynamic range with a gentle highlight rolloff"],
  },

  // -------------------------------------------------------------------------
  professional: {
    id: "professional",
    label: "Professional",
    summary:
      "Commissioned commercial photography that still reads as real. Cleaner, never glossy.",
    openers: [
      "A professional photograph of",
      "A commissioned editorial photograph of",
      "A corporate photograph of",
    ],
    lenses: [
      { text: "shot on a full-frame camera with a 50mm lens", suits: ["people", "object", "scene"] },
      { text: "shot on a full-frame camera with a 35mm lens", suits: ["environment", "people", "scene"] },
      { text: "shot on an 85mm lens at a comfortable working distance", suits: ["people"] },
    ],
    lighting: {
      default: [
        "large soft key light from one side with the room's own light filling in",
        "controlled but soft lighting that still matches the room",
      ],
      office: [
        "window light shaped with a large diffuser, overhead office light left visible",
        "soft directional light with the office's own ambience preserved",
      ],
      studio: [
        "one large softbox and a subtle fill, shadows left intact",
      ],
      outdoor: ["open shade with a soft reflector fill"],
    },
    dof: "moderate",
    grain: "faint",
    composition: [
      "clean but not symmetrical framing",
      "subject placed thoughtfully off-centre with negative space for layout",
      "composed with headroom to the side, as a photographer would for a website",
    ],
    closers: [
      "Commercial photography that still looks like a real photograph.",
      "Polished but honest, with retouching kept invisible.",
    ],
    humanRealism: 1,
    materialRealism: true,
    signature: ["natural colour, no heavy grading"],
  },

  // -------------------------------------------------------------------------
  lifestyle: {
    id: "lifestyle",
    label: "Lifestyle",
    summary: "Spontaneous, in-the-moment coverage. People busy being people.",
    openers: [
      "A candid lifestyle photograph of",
      "An unposed, in-the-moment photograph of",
      "A reportage-style photograph of",
    ],
    lenses: [
      { text: "shot on a 35mm lens, close to the action", suits: ["people", "environment", "scene"] },
      { text: "shot on a 28mm lens from within the room", suits: ["environment", "scene"] },
      { text: "shot on a 50mm lens, handheld", suits: ["people", "object", "scene"] },
    ],
    lighting: {
      default: ["available light only, no added lighting", "whatever light the room happens to have"],
      home: ["warm domestic light mixed with daylight from a window"],
      outdoor: ["plain daylight, sometimes a little harsh"],
    },
    dof: "natural",
    grain: "subtle",
    composition: [
      "loose, slightly crooked framing",
      "someone partially cut off at the edge of the frame",
      "shot from wherever the photographer happened to be standing",
      "a foreground object partially blocking the view",
    ],
    closers: [
      "Feels like a moment that was caught rather than arranged.",
      "Unposed and a little untidy, like real life.",
    ],
    humanRealism: 2,
    materialRealism: false,
    signature: ["nobody is performing for the camera"],
  },

  // -------------------------------------------------------------------------
  clinical: {
    id: "clinical",
    label: "Clinical",
    summary:
      "Healthcare documentary. Real clinics are busy, worn and beige — not advertising sets.",
    openers: [
      "A documentary photograph of",
      "An observational photograph of",
      "A photograph taken during an ordinary working day, showing",
    ],
    lenses: [
      { text: "shot on a full-frame camera with a 35mm lens at eye level", suits: ["people", "environment", "scene"] },
      { text: "shot on a 50mm lens from across the consulting room", suits: ["people", "scene"] },
      { text: "shot on a 35mm lens from the doorway", suits: ["environment"] },
    ],
    lighting: {
      default: [
        "mixed window light and ordinary ceiling lighting, slightly uneven",
        "flat clinical lighting softened by daylight from a window",
      ],
      hospital: [
        "cool overhead hospital lighting with daylight from a corridor window",
        "even fluorescent light, unflattering but honest",
      ],
      clinic: [
        "soft window light on one side, ceiling light filling the rest",
        "ordinary consulting-room lighting, neither dramatic nor flattering",
      ],
    },
    dof: "natural",
    grain: "subtle",
    composition: [
      "eye-level, slightly off to one side, as an observer in the room",
      "framed with the room's clutter left in",
      "shot at working distance, not intruding on the consultation",
    ],
    closers: [
      "Documentary healthcare photography, not medical advertising.",
      "An ordinary clinical moment, recorded rather than staged.",
    ],
    humanRealism: 2,
    materialRealism: true,
    signature: [
      "the room shows everyday use: paperwork, cables, worn surfaces and objects left where people put them",
    ],
    // Clinical equipment is wiped down constantly. "Worn surfaces" applied to
    // a close shot of a machine produced visible rust, which is not realism —
    // it is a different, wrong claim about the room.
    signatureObject: [
      "a working clinical room around it: cables routed along the wall, printed labels, a clipboard left nearby",
      "the ordinary surroundings of a room where this equipment is used every day",
    ],
  },

  // -------------------------------------------------------------------------
  product: {
    id: "product",
    label: "Product",
    summary:
      "A real object photographed on a real surface. Physical materials, not a CGI render.",
    openers: [
      "A photograph of",
      "A product photograph of",
      "A still-life photograph of",
    ],
    lenses: [
      { text: "shot on a 50mm lens on a full-frame camera", suits: ["object"] },
      { text: "shot on an 85mm lens from a low angle", suits: ["object"] },
      { text: "shot on a 35mm lens showing the object in its setting", suits: ["object", "environment"] },
    ],
    lighting: {
      default: [
        "large soft window light from one side with a soft natural falloff",
        "one broad soft source and the room's own bounce",
        "diffused daylight, with soft-edged shadows on the surface",
      ],
      studio: ["a single large diffused source, with the shadow left visible"],
    },
    dof: "moderate",
    grain: "faint",
    composition: [
      "placed slightly off-centre on the surface",
      "photographed at a natural angle rather than dead-on",
      "the surface and its surroundings visible around the object",
    ],
    closers: [
      "A physical object photographed on a real surface under real light.",
      "Product photography with physically plausible materials.",
    ],
    humanRealism: 0,
    materialRealism: true,
    signature: [
      "physically correct reflections and material roughness",
      "the object sits on the surface with a contact shadow",
    ],
  },

  // -------------------------------------------------------------------------
  smartphone: {
    id: "smartphone",
    label: "Smartphone",
    summary: "A snapshot someone actually took on their phone. Convenience over craft.",
    openers: [
      "A smartphone snapshot of",
      "A photo taken on a phone showing",
      "A quick phone photo of",
    ],
    lenses: [
      { text: "taken on a modern smartphone's main camera", suits: ["people", "object", "environment", "scene"] },
      { text: "taken handheld on a phone, wide main lens", suits: ["environment", "scene"] },
    ],
    lighting: {
      default: [
        "whatever light was available, uncorrected",
        "mixed indoor lighting with a slight colour cast",
      ],
      outdoor: ["plain daylight, slightly blown highlights"],
    },
    dof: "deep",
    grain: "visible",
    composition: [
      "framed casually, slightly tilted",
      "taken quickly, framing not quite level",
      "held at chest height without much thought about composition",
    ],
    closers: [
      "An ordinary phone snapshot straight from a camera roll.",
      "Looks like it came straight out of someone's camera roll.",
    ],
    humanRealism: 2,
    materialRealism: false,
    signature: [
      "the aggressive contrast and sharpening a phone applies by default",
      "slightly flat, over-processed phone colour",
    ],
  },
};

export function dofClauses(policy: DofPolicy): string[] {
  return DOF_TEXT[policy];
}

export function grainClauses(policy: GrainPolicy): string[] {
  return GRAIN_TEXT[policy];
}

export function getPreset(name: string | undefined): Preset {
  const key = (name ?? "natural") as PresetName;
  const preset = PRESETS[key];
  if (!preset) {
    throw new Error(
      `Unknown preset "${name}". Available: ${Object.keys(PRESETS).join(", ")}`,
    );
  }
  return preset;
}
