/**
 * Scene analysis.
 *
 * Reads the (already English-normalised) intent and works out what kind of
 * photograph this is, so the engine can pick photographic language that fits.
 * A doctor in a clinic, a MacBook on a desk and a family at home are three
 * different photographic problems; using one camera and one lighting recipe
 * for all three is exactly what makes generated images look generated.
 *
 * This is pure pattern matching. It never adds facts — it only notices ones
 * the caller already stated.
 */

export type PeopleCount = "none" | "one" | "two" | "few" | "many" | "unknown";
export type AgeGroup = "child" | "young" | "adult" | "elderly";
export type Role = "medical" | "patient" | "corporate" | "family" | "casual";
export type ProductKind =
  | "phone"
  | "laptop"
  | "screen"
  | "medical-device"
  | "electronics"
  | "packaged-good"
  | "generic";
export type Setting =
  | "clinic"
  | "hospital"
  | "office"
  | "home"
  | "outdoor"
  | "studio"
  | "retail"
  | "unknown";
export type Framing = "closeup" | "portrait" | "medium" | "wide" | "unknown";

export interface SceneAnalysis {
  people: PeopleCount;
  ages: AgeGroup[];
  roles: Role[];
  products: ProductKind[];
  setting: Setting;
  indoors: boolean | null;
  lightCues: string[];
  framing: Framing;
  /** Caller already specified a camera/lens — do not override it. */
  explicitCamera: boolean;
  /** Caller already specified lighting — do not override it. */
  explicitLighting: boolean;
  lookingAtCamera: "yes" | "no" | "unspecified";
  /** AI-slop the caller typed themselves. We keep it but flag it. */
  slopTerms: string[];
  /** True when the subject is an object rather than a person. */
  objectLed: boolean;
}

const has = (text: string, patterns: (string | RegExp)[]): boolean =>
  patterns.some((p) =>
    typeof p === "string"
      ? new RegExp(`\\b${p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(text)
      : p.test(text),
  );

const PEOPLE_WORDS = [
  "person", "people", "man", "men", "woman", "women", "boy", "girl", "child",
  "children", "kid", "kids", "teenager", "baby", "adult", "adults", "elderly",
  "couple", "family", "families", "group", "team", "colleagues", "friends",
  "doctor", "doctors", "nurse", "nurses", "patient", "patients", "physician",
  "dentist", "surgeon", "therapist", "pharmacist", "technician", "receptionist",
  "employee", "employees", "professional", "professionals", "executive",
  "manager", "director", "student", "teacher", "client", "clients", "staff",
  "father", "mother", "parents", "son", "daughter", "grandmother", "grandfather",
  "grandparent", "grandparents", "grandchild", "grandchildren", "portrait",
  "someone", "he", "she", "they", "his", "her", "businessman", "businesswoman",
  "salesperson", "worker", "workers", "attendant", "caregiver", "hands",
];

const MEDICAL_ROLE = [
  "doctor", "doctors", "physician", "nurse", "nurses", "surgeon", "dentist",
  "therapist", "pharmacist", "healthcare", "clinician", "paramedic",
  "radiologist", "cardiologist", "lab coat", "scrubs", "stethoscope",
];

const PATIENT_ROLE = ["patient", "patients", "appointment", "consultation", "checkup", "check-up"];

const CORPORATE_ROLE = [
  "executive", "manager", "director", "businessman", "businesswoman",
  "employee", "employees", "colleagues", "team", "meeting", "corporate",
  "office worker", "consultant", "staff", "coworker", "coworkers",
];

const FAMILY_ROLE = [
  "family", "families", "father", "mother", "parents", "son", "daughter",
  "grandmother", "grandfather", "grandparent", "grandparents", "grandchild",
  "grandchildren", "couple", "kids", "children", "child", "baby",
];

export function analyzeScene(text: string): SceneAnalysis {
  const t = text.toLowerCase();

  // ---- people ------------------------------------------------------------
  // "an empty waiting room, without people" mentions people in order to
  // exclude them. Adding skin texture to that scene is not a style slip, it is
  // the engine contradicting the request.
  const peopleExcluded = has(t, [
    "without people",
    "with no people",
    "no people",
    "nobody",
    "no one",
    "unoccupied",
    "empty room",
    "empty waiting room",
    "empty office",
    "empty clinic",
    /\bempty\b(?![a-z])/,
    /\bwithout (?:any )?(?:people|persons|anyone|patients|staff)\b/,
  ]);

  const peopleMentioned = !peopleExcluded && has(t, PEOPLE_WORDS);
  let people: PeopleCount = peopleMentioned ? "unknown" : "none";
  if (peopleMentioned) {
    if (has(t, ["family", "families", "group", "team", "crowd", "colleagues", "staff", "several", "many"])) {
      people = has(t, ["crowd", "many", "audience"]) ? "many" : "few";
    } else if (has(t, ["couple", "two", "both", "pair"])) {
      people = "two";
    } else if (
      // "talking with an elderly patient" and "talking with elderly patient"
      // are the same scene; Portuguese often omits the article and the
      // translation is faithful to that.
      has(t, [
        /\b(?:with|and|beside|next to|opposite|facing)\s+(?:an?\s+|the\s+)?[a-z-]*\s*[a-z-]*\s*(patient|woman|man|person|people|client|colleague|child|children|nurse|doctor|physician|employee|student|teenager|baby)\b/,
      ])
    ) {
      people = "two";
    } else if (has(t, ["three", "four", "five", "six"])) {
      people = "few";
    } else {
      people = "one";
    }
  }

  // ---- ages --------------------------------------------------------------
  // A stated age is a fact, so it decides the bucket on its own. Treating a
  // bare "aged" as elderly gave a 42-year-old doctor grey hair and age-related
  // wrinkles — the engine inventing a fact instead of reading the one it was
  // given.
  // The lookbehind keeps "middle-aged" out of every "aged" rule: \b fires
  // between the hyphen and the 'a', so a middle-aged subject was being read as
  // elderly and handed grey hair.
  const statedAges = [
    ...t.matchAll(/(?<![-\w])aged\s+(?:about\s+|around\s+)?(\d{1,3})\b/g),
    ...t.matchAll(/\b(\d{1,3})[-\s]years?[-\s]old\b/g),
  ]
    .map((m) => Number(m[1]))
    .filter((n) => n > 0 && n < 120);
  const anyAge = (test: (n: number) => boolean): boolean => statedAges.some(test);

  const ages: AgeGroup[] = [];
  if (
    has(t, [
      "elderly", "older man", "older woman", "senior", "grandmother",
      "grandfather", "grandparent", "grandparents", "retired",
      /(?<![-\w])aged (?:man|men|woman|women|couple|person|people|patient|face|hands)\b/,
    ]) ||
    anyAge((n) => n >= 65)
  )
    ages.push("elderly");
  if (
    has(t, ["child", "children", "kid", "kids", "boy", "girl", "baby", "toddler", "infant"]) ||
    anyAge((n) => n < 13)
  )
    ages.push("child");
  if (has(t, ["young", "teenager", "student", "20s", "twenties"]) || anyAge((n) => n >= 13 && n < 25))
    ages.push("young");
  if (
    has(t, ["adult", "middle-aged", "30s", "40s", "50s", "thirties", "forties", "fifties"]) ||
    anyAge((n) => n >= 25 && n < 65)
  )
    ages.push("adult");
  if (ages.length === 0 && people !== "none") ages.push("adult");

  // ---- roles -------------------------------------------------------------
  const roles: Role[] = [];
  if (has(t, MEDICAL_ROLE)) roles.push("medical");
  if (has(t, PATIENT_ROLE)) roles.push("patient");
  if (has(t, CORPORATE_ROLE)) roles.push("corporate");
  if (has(t, FAMILY_ROLE)) roles.push("family");
  if (roles.length === 0 && people !== "none") roles.push("casual");

  // ---- products ----------------------------------------------------------
  // "not looking at the camera" is a statement about behaviour, not a request
  // for a camera in the frame. Left in, it made a doctor-and-patient scene
  // report products=[electronics] and pick up reflective-metal language that
  // belongs to a product shot.
  // Only the viewpoint idioms are stripped, and each one is named. A blanket
  // preposition list took "of a camera" with it, which is how a product shot
  // ("close-up de uma câmera sobre uma mesa") names its own subject — stripping
  // that lost the whole material-realism sentence.
  const productText = t
    .replace(/\b(?:at|to|into|toward|towards|for)\s+(?:the\s+|a\s+|an\s+)?cameras?\b/g, " ")
    .replace(/\b(?:unaware|aware|conscious)\s+of\s+(?:the\s+|a\s+)?cameras?\b/g, " ")
    .replace(/\baway\s+from\s+(?:the\s+|a\s+)?cameras?\b/g, " ")
    .replace(/\bcameras?\s+(?:present|angle|position|roll)\b/g, " ")
    .replace(/\b(?:film|phone|iphone|digital|dslr|mirrorless|hidden)\s+cameras?\b/g, " ");

  const products: ProductKind[] = [];
  if (has(productText, ["smartphone", "phone", "iphone", "mobile", "cellphone", "cell phone"])) products.push("phone");
  if (has(productText, ["laptop", "macbook", "notebook computer", "ultrabook", "computer"])) products.push("laptop");
  if (has(productText, ["screen", "monitor", "display", "tablet", "ipad"])) products.push("screen");
  if (has(productText, ["medical equipment", "medical device", "ultrasound", "blood pressure monitor", "x-ray", "stethoscope", "syringe", "thermometer", "defibrillator", "infusion pump", "ecg", "ekg", "hospital bed", "examination table"]))
    products.push("medical-device");
  if (has(productText, ["keyboard", "mouse", "headphones", "earbuds", "camera", "smartwatch", "charger", "cable", "electronics", "device"]))
    products.push("electronics");
  if (has(productText, ["packaging", "box", "bottle", "jar", "label", "package", "tube", "sachet"]))
    products.push("packaged-good");
  if (products.length === 0 && has(productText, ["product", "object", "item"])) products.push("generic");

  // ---- setting -----------------------------------------------------------
  let setting: Setting = "unknown";
  if (has(t, ["clinic", "doctor's office", "medical center", "exam room", "waiting room", "dental office", "consultation room"]))
    setting = "clinic";
  else if (has(t, ["hospital", "ward", "operating room", "emergency room", "intensive care", "icu", "nursing station", "infirmary"]))
    setting = "hospital";
  else if (has(t, ["office", "coworking", "meeting room", "conference", "boardroom", "workspace", "desk", "workplace", "company"]))
    setting = "office";
  else if (has(t, ["home", "house", "living room", "kitchen", "bedroom", "apartment", "dining table", "sofa", "couch"]))
    setting = "home";
  else if (has(t, ["street", "park", "outdoor", "outside", "garden", "sidewalk", "beach", "square", "balcony", "terrace"]))
    setting = "outdoor";
  else if (has(t, ["studio", "seamless backdrop", "white background", "grey background", "gray background"]))
    setting = "studio";
  else if (has(t, ["shop", "store", "pharmacy", "retail", "cafe", "coffee shop", "restaurant", "counter"]))
    setting = "retail";

  const indoors =
    setting === "outdoor" ? false
    : setting === "unknown" ? null
    : true;

  // ---- light -------------------------------------------------------------
  const lightCues: string[] = [];
  if (has(t, ["window", "window light", "daylight", "natural light"])) lightCues.push("window");
  if (has(t, ["night", "evening", "dark", "lamp", "lamplight"])) lightCues.push("night");
  if (has(t, ["morning", "sunrise", "afternoon", "sunset", "golden hour", "sunlight", "sunny"])) lightCues.push("sun");
  if (has(t, ["fluorescent", "overhead light", "ceiling light", "led panel", "artificial light"])) lightCues.push("artificial");

  const explicitLighting =
    lightCues.length > 0 ||
    has(t, ["backlit", "rim light", "softbox", "flash", "strobe", "silhouette", "high key", "low key", "lighting"]);

  // ---- framing -----------------------------------------------------------
  let framing: Framing = "unknown";
  if (has(t, ["close-up", "closeup", "macro", "detail shot", "extreme close"])) framing = "closeup";
  else if (has(t, ["portrait", "headshot", "head and shoulders", "face"])) framing = "portrait";
  // Naming the room a scene happens in is not asking for a wide shot. "room"
  // and "environment" appear in almost every clinical brief, so reading them
  // as framing made the engine claim a shot the caller never described. The
  // lens rules already widen on a known `setting`, which is the honest cue.
  else if (has(t, ["wide", "wide shot", "full scene", "establishing", "landscape", "full body"])) framing = "wide";
  else if (has(t, ["waist up", "medium shot", "half body"])) framing = "medium";

  const explicitCamera = has(t, [
    /\b\d{2,3}\s?mm\b/, "wide angle", "telephoto", "macro lens", "fisheye",
    "dslr", "mirrorless", "leica", "hasselblad", "canon", "nikon", "sony a7",
    "fujifilm", "iphone camera", "shot on", "film camera", "polaroid",
  ]);

  const lookingAtCamera: SceneAnalysis["lookingAtCamera"] = has(t, [
    "not looking at the camera", "looking away", "unaware of the camera",
    "candid", "not posing", "without looking at the camera",
  ])
    ? "no"
    : has(t, ["looking at the camera", "facing the camera", "eye contact", "posing for the camera", "headshot"])
      ? "yes"
      : "unspecified";

  const SLOP = [
    "8k", "4k", "masterpiece", "ultra realistic", "ultra-realistic", "hyperrealistic",
    "hyper realistic", "award winning", "award-winning", "insanely detailed",
    "highly detailed", "perfect skin", "flawless", "trending on artstation",
    "cinematic masterpiece", "photorealistic render", "octane render", "unreal engine",
    "hdr", "sharp focus", "bokeh",
  ];
  const slopTerms = SLOP.filter((term) => new RegExp(`\\b${term}\\b`, "i").test(t));

  const objectLed = people === "none" && products.length > 0;

  return {
    people,
    ages,
    roles,
    products,
    setting,
    indoors,
    lightCues,
    framing,
    explicitCamera,
    explicitLighting,
    lookingAtCamera,
    slopTerms,
    objectLed,
  };
}
