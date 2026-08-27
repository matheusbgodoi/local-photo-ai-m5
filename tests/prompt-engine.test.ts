import { strict as assert } from "node:assert";
import { test, describe } from "node:test";

import { buildPrompt, SLOP_TERMS } from "../dist/core/prompt/engine.js";
import { analyzeScene } from "../dist/core/prompt/analyze.js";
import { translateToEnglish } from "../dist/core/prompt/translate.js";
import { PRESETS } from "../dist/core/prompt/presets.js";
import { resolveSize, SIZE_PRESETS } from "../dist/core/sizes.js";

const build = (prompt: string, preset = "natural", seed = 42) =>
  buildPrompt({ prompt, preset: preset as never, seed, allowNegative: false });

describe("translate", () => {
  test("recognises Portuguese and preserves grammatical gender", () => {
    const r = translateToEnglish("médica conversando com paciente idosa em uma clínica");
    assert.equal(r.wasPortuguese, true);
    assert.match(r.text, /female doctor/);
    assert.match(r.text, /elderly female patient/);
    assert.match(r.text, /clinic/);
  });

  test("distinguishes masculine from feminine subjects", () => {
    assert.match(translateToEnglish("um médico idoso na clínica").text, /male doctor/);
    assert.match(translateToEnglish("uma médica idosa na clínica").text, /female doctor/);
  });

  test("leaves English untouched", () => {
    const input = "a physician talking with an elderly patient in a clinic";
    const r = translateToEnglish(input);
    assert.equal(r.wasPortuguese, false);
    assert.equal(r.text, input);
  });

  test("keeps unknown words verbatim instead of guessing", () => {
    const r = translateToEnglish("uma médica da ClueMed em uma clínica");
    assert.match(r.text, /ClueMed/);
  });

  test("handles the negation the brief specifically asks for", () => {
    const r = translateToEnglish("duas pessoas não olhando para a câmera");
    assert.match(r.text, /not looking at the camera/);
  });

  test("carries gender agreement onto gender-neutral person nouns", () => {
    // "jovem" is neutral in Portuguese; the gender lives in the article and
    // the adjective. Dropping it made the model render a man for "jovem
    // brasileira", which changes a fact about the subject.
    assert.match(translateToEnglish("uma jovem brasileira sorrindo").text, /young woman/);
    assert.match(translateToEnglish("um jovem brasileiro sorrindo").text, /young man/);
    assert.match(translateToEnglish("uma profissional brasileira").text, /female professional/);
    assert.match(translateToEnglish("um profissional brasileiro").text, /male professional/);
    assert.match(translateToEnglish("o paciente idoso").text, /elderly male patient/);
  });

  test("leaves a neutral noun neutral when nothing states the gender", () => {
    assert.match(translateToEnglish("dois jovens conversando").text, /young people/);
  });

  test("does not read gender off an adjective that has none", () => {
    // "realista" ends in -a for every gender. Reading agreement off it turned
    // "profissional realista" into a *female* professional — a fact the brief
    // never stated.
    for (const [pt, forbidden] of [
      ["profissional realista", /female|male/],
      ["jovem realista", /woman|man\b/],
      ["estudante realista", /female|male/],
    ] as const) {
      assert.doesNotMatch(translateToEnglish(pt).text, forbidden, pt);
    }
    // Real agreement still gets through.
    assert.match(translateToEnglish("uma profissional realista").text, /female professional/);
  });

  test("preserves an age qualifier without inventing precision", () => {
    assert.match(translateToEnglish("homem de 55 anos trabalhando").text, /aged 55/);
    assert.match(
      translateToEnglish("médica de aproximadamente 40 anos").text,
      /aged about 40/,
    );
  });

  test("normalises idioms whole rather than word by word", () => {
    const cases: [string, RegExp][] = [
      ["fotografia documental", /^documentary photograph$/],
      ["em atendimento", /^during a consultation$/],
      ["hospital público", /^public hospital$/],
      ["luz fluorescente", /^fluorescent light$/],
      ["misturada com luz natural lateral", /^mixed with natural light from the side$/],
      ["pele com textura normal", /^skin with ordinary texture$/],
      ["sem retoque de beleza", /^no beauty retouching$/],
      ["sem aparência de stock photo", /^not looking like a stock photo$/],
      ["jaleco branco usado normalmente", /^white lab coat worn normally$/],
      ["linhas finas e pequenas imperfeições", /^fine lines and small imperfections$/],
      ["ambiente limpo, funcional e vivido", /^clean environment, functional and lived-in$/],
    ];
    for (const [pt, expected] of cases) {
      assert.match(translateToEnglish(pt).text, expected, pt);
    }
  });

  test("leaves no Portuguese behind in a full clinical brief", () => {
    // A half-translated brief ("without retoque of beleza") is worse than
    // either language on its own: the model reads the leftovers as noise.
    const brief =
      "fotografia documental de uma médica brasileira de 42 anos em atendimento " +
      "com uma paciente idosa em um hospital público, luz fluorescente misturada " +
      "com luz natural lateral, pele com textura normal, sem retoque de beleza, " +
      "ambiente limpo, funcional e vivido, sem aparência de stock photo, " +
      "sem olhar para a câmera, jaleco branco usado normalmente, " +
      "linhas finas e pequenas imperfeições";
    const result = translateToEnglish(brief);
    assert.equal(result.coverage, 1, `unrecognised: ${result.unknown.join(", ")}`);
    assert.deepEqual(result.unknown, []);
    assert.doesNotMatch(
      result.text,
      /\b(atendimento|documental|público|luz|pele|textura|retoque|beleza|apar[eê]ncia|jaleco|usado|normalmente|linhas|finas|pequenas|imperfei|funcional|vivido|misturada|lateral)\b/i,
      result.text,
    );
  });

  test("keeps the facts the brief states about the people", () => {
    const text = translateToEnglish(
      "médica brasileira de 42 anos em atendimento com uma paciente idosa em um hospital público",
    ).text;
    for (const fact of [
      /Brazilian/,
      /female doctor/,
      /aged 42/,
      /elderly female patient/,
      /public hospital/,
    ]) {
      assert.match(text, fact, text);
    }
  });
});

describe("analyze", () => {
  test("detects an elderly medical two-person clinic scene", () => {
    const a = analyzeScene("a female doctor talking with an elderly female patient in a clinic");
    assert.equal(a.people, "two");
    assert.ok(a.ages.includes("elderly"));
    assert.ok(a.roles.includes("medical"));
    assert.equal(a.setting, "clinic");
    assert.equal(a.objectLed, false);
  });

  test("detects an object-led product scene", () => {
    const a = analyzeScene("a MacBook open on an office desk");
    assert.equal(a.people, "none");
    assert.ok(a.products.includes("laptop"));
    assert.equal(a.objectLed, true);
  });

  test("notices a caller-specified camera so we do not override it", () => {
    assert.equal(analyzeScene("portrait shot on a 85mm lens").explicitCamera, true);
    assert.equal(analyzeScene("a doctor in a clinic").explicitCamera, false);
  });

  test("counts two people even when the article is dropped", () => {
    // Portuguese often omits the article ("com paciente idosa"), and the
    // translation is faithful to that. The scene is still two people.
    for (const text of [
      "Brazilian female doctor talking with elderly female patient in a clinic",
      "a female doctor talking with an elderly female patient in a clinic",
      "a male nurse talking with patient in a hospital",
    ]) {
      assert.equal(analyzeScene(text).people, "two", text);
    }
    assert.equal(analyzeScene("a professional in a modern office").people, "one");
  });

  test("does not find people in a scene that excludes them", () => {
    // "sem pessoas" mentions people in order to rule them out. Treating that
    // as a populated scene made the engine add skin texture to an empty room.
    for (const text of [
      "a reception area of a modern clinic, without people",
      "an empty waiting room",
      "an office with no people",
    ]) {
      assert.equal(analyzeScene(text).people, "none", text);
    }
    assert.equal(analyzeScene("a reception area with two people").people, "two");
  });

  test("flags AI-look terms the caller typed", () => {
    assert.deepEqual(analyzeScene("8k masterpiece portrait").slopTerms.sort(), ["8k", "masterpiece"]);
  });

  test("a camera the subject is not looking at is not a product in the scene", () => {
    // "sem olhar para a câmera" made a doctor-and-patient scene report
    // products=[electronics] and pick up brushed-metal product language.
    for (const text of [
      "two people not looking at the camera in an office",
      "a female doctor unaware of the camera",
      "an elderly man looking at the camera",
      "a candid shot, nobody posing for the camera",
    ]) {
      assert.deepEqual(analyzeScene(text).products, [], text);
    }
    // A camera that is genuinely in the frame still counts — including when
    // the brief names it with a genitive, which is how a product shot usually
    // states its own subject.
    for (const text of [
      "a camera on a wooden table",
      "a table with a camera on it",
      "a close-up of a camera on a wooden table",
      "a photograph of a camera and a lens",
    ]) {
      assert.ok(analyzeScene(text).products.includes("electronics"), text);
    }
  });

  test("a stated age lands in the right bucket", () => {
    // "aged" matched as elderly regardless of the number, which gave a
    // 42-year-old doctor grey hair and age-related wrinkles.
    assert.deepEqual(analyzeScene("a female doctor aged 42").ages, ["adult"]);
    assert.deepEqual(analyzeScene("a woman aged 70 at home").ages, ["elderly"]);
    assert.deepEqual(analyzeScene("a child aged 8 playing").ages, ["child"]);
    assert.deepEqual(analyzeScene("a 55-year-old man working").ages, ["adult"]);
    assert.ok(analyzeScene("an elderly female patient").ages.includes("elderly"));
    // "middle-aged" contains "aged", and a word boundary fires after the
    // hyphen. Reading that as elderly handed a 45-year-old grey hair.
    for (const text of [
      "a middle-aged woman in a clinic",
      "a middle-aged man at his desk",
      "a middle-aged couple at home",
    ]) {
      assert.deepEqual(analyzeScene(text).ages, ["adult"], text);
    }
    assert.deepEqual(analyzeScene("an aged man on a bench").ages, ["elderly"]);
    // Both ages are read when both are stated.
    const mixed = analyzeScene("a female doctor aged 42 with an elderly female patient");
    assert.ok(mixed.ages.includes("elderly") && mixed.ages.includes("adult"));
  });

  test("naming the room is not asking for a wide shot", () => {
    for (const text of [
      "a female doctor in an exam room",
      "a clean environment, functional and lived-in",
    ]) {
      assert.equal(analyzeScene(text).framing, "unknown", text);
    }
    assert.equal(analyzeScene("a wide shot of a clinic").framing, "wide");
  });
});

describe("prompt engine", () => {
  test("is deterministic for the same prompt/preset/seed", () => {
    const a = build("médica conversando com paciente idosa em uma clínica", "clinical", 7);
    const b = build("médica conversando com paciente idosa em uma clínica", "clinical", 7);
    assert.equal(a.positive, b.positive);
  });

  test("varies across seeds so --count 4 is not four clones", () => {
    const a = build("médica conversando com paciente idosa", "clinical", 1);
    const b = build("médica conversando com paciente idosa", "clinical", 2);
    assert.notEqual(a.positive, b.positive);
  });

  test("never emits the AI-slop vocabulary on its own", () => {
    const prompts = [
      "médica conversando com paciente idosa em uma clínica",
      "casal idoso na sala de estar",
      "MacBook aberto sobre mesa de escritório real",
      "celular sobre uma mesa de escritório",
      "família na cozinha",
      "equipamento médico em um hospital",
      "profissional em um escritório",
    ];
    for (const preset of Object.keys(PRESETS)) {
      for (const prompt of prompts) {
        for (let seed = 1; seed <= 8; seed++) {
          const out = build(prompt, preset, seed).positive.toLowerCase();
          for (const term of SLOP_TERMS) {
            assert.ok(
              !out.includes(term.toLowerCase()),
              `preset=${preset} seed=${seed} leaked "${term}": ${out}`,
            );
          }
        }
      }
    }
  });

  test("preserves the caller's facts", () => {
    const out = build("médica conversando com paciente idosa em uma clínica", "clinical", 3);
    const p = out.positive.toLowerCase();
    assert.ok(p.includes("female doctor"), p);
    assert.ok(p.includes("elderly female patient"), p);
    assert.ok(p.includes("clinic"), p);
  });

  test("does not add human-skin language to a scene that excludes people", () => {
    for (let seed = 1; seed <= 6; seed++) {
      const out = build("recepção de uma clínica brasileira moderna, sem pessoas", "clinical", seed);
      const p = out.positive.toLowerCase();
      assert.ok(!p.includes("skin"), p);
      assert.ok(!p.includes("expression"), p);
      assert.ok(!p.includes("on the camera"), p);
    }
  });

  test("does not add human-skin language to an object-only scene", () => {
    const out = build("MacBook aberto sobre uma mesa de escritório", "product", 5);
    const p = out.positive.toLowerCase();
    assert.ok(!p.includes("pores"), p);
    assert.ok(!p.includes("wrinkles"), p);
    assert.ok(/reflection|aluminium|material|shadow|wear|smudge|dust/.test(p), p);
  });

  test("does not add its own lens when the caller already chose one", () => {
    const out = build("a portrait shot on a 85mm lens", "natural", 9);
    assert.ok(!/35mm|50mm|28mm|40mm/.test(out.positive), out.positive);
  });

  test("uses different glass for a product than for an environment", () => {
    const product = build("um celular sobre uma mesa de escritório", "product", 4).positive;
    const room = build("recepção de uma clínica moderna", "clinical", 4).positive;
    assert.notEqual(product, room);
  });

  test("smartphone preset reads like a phone snapshot, not a camera", () => {
    const out = build("família na cozinha", "smartphone", 11).positive.toLowerCase();
    assert.ok(/phone/.test(out), out);
    assert.ok(!/full-frame/.test(out), out);
  });

  test("elderly subjects get age-appropriate texture, children do not get pores", () => {
    const elderly = build("casal idoso em casa", "natural", 6).positive.toLowerCase();
    assert.ok(/age|wrinkl|grey hair|years/.test(elderly), elderly);

    for (let seed = 1; seed <= 12; seed++) {
      const kid = build("uma criança brincando na sala de estar", "lifestyle", seed).positive.toLowerCase();
      assert.ok(!kid.includes("age-related wrinkles"), kid);
    }
  });

  test("brief stays a brief (not a wall of tokens)", () => {
    for (const preset of Object.keys(PRESETS)) {
      const out = build("médica conversando com paciente idosa em uma clínica", preset, 2);
      const words = out.positive.split(/\s+/).length;
      assert.ok(words >= 35 && words <= 140, `${preset}: ${words} words -> ${out.positive}`);
    }
  });

  test("negative prompt only appears when it can actually do something", () => {
    assert.equal(build("um médico", "natural", 1).negative, null);
    const withNeg = buildPrompt({ prompt: "um médico", preset: "natural", seed: 1, allowNegative: true });
    assert.ok(withNeg.negative?.includes("plastic skin"));
  });

  test("does not describe a photograph of a photograph", () => {
    // "fotografia documental de X" already names the medium. Wrapping it in a
    // preset opener produced "A photograph …, showing a documentary photograph
    // of X".
    for (const preset of Object.keys(PRESETS)) {
      for (let seed = 1; seed <= 4; seed++) {
        const out = build("fotografia documental de uma médica em um hospital público", preset, seed);
        const p = out.positive;
        assert.ok(p.startsWith("A documentary photograph of"), `${preset}/${seed}: ${p}`);
        // Exactly one "<something> photograph of" — the caller's, not ours on
        // top of theirs.
        assert.equal((p.match(/\bphotograph of\b/gi) ?? []).length, 1, `${preset}/${seed}: ${p}`);
        assert.ok(out.rationale.some((r) => r.includes("already names the medium")), preset);
      }
    }
    // A brief that does not name the medium still gets the preset's opener.
    const plain = build("uma médica em um hospital público", "clinical", 1);
    assert.ok(/^(A|An)\s/.test(plain.positive), plain.positive);
    assert.ok(!plain.rationale.some((r) => r.includes("already names the medium")));

    // A picture or an image is usually an object in the scene, not the medium.
    // Treating "um quadro de família sobre a mesa" as the medium changed what
    // the photograph was of.
    for (const brief of [
      "um quadro de família sobre a mesa de escritório",
      "uma imagem de ultrassom na tela",
    ]) {
      const out = build(brief, "clinical", 2);
      assert.ok(
        !out.rationale.some((r) => r.includes("already names the medium")),
        `${brief}: ${out.positive}`,
      );
    }
  });

  test("keeps a whole pt-BR brief intact through the engine", () => {
    const out = build(
      "fotografia documental de uma médica brasileira de 42 anos em atendimento com uma " +
        "paciente idosa em um hospital público, luz fluorescente misturada com luz natural " +
        "lateral, pele com textura normal, sem retoque de beleza, sem olhar para a câmera, " +
        "jaleco branco usado normalmente, linhas finas e pequenas imperfeições",
      "clinical",
      3,
    );
    const p = out.positive;
    for (const fact of [
      "Brazilian female doctor",
      "aged 42",
      "elderly female patient",
      "public hospital",
      "fluorescent light",
      "no beauty retouching",
      "not looking at the camera",
      "white lab coat",
      "fine lines and small imperfections",
    ]) {
      assert.ok(p.includes(fact), `lost "${fact}": ${p}`);
    }
    // The elderly patient still gets age-appropriate texture even though the
    // brief also states an adult age for the doctor.
    assert.match(p, /age|wrinkl|grey hair|years/);
    // And the scene is people, not products.
    assert.deepEqual(out.analysis.products, []);
  });

  test("records an auditable rationale", () => {
    const out = build("médica conversando com paciente idosa em uma clínica", "clinical", 3);
    assert.ok(out.rationale.some((r) => r.startsWith("Scene:")));
    assert.ok(out.rationale.some((r) => r.includes("Translated pt-BR")));
  });
});

describe("sizes", () => {
  test("every preset is on the model's 64px stride", () => {
    // Draw Things rejects off-stride dimensions after loading the model, so a
    // bad preset costs a full generation before it fails.
    for (const name of SIZE_PRESETS) {
      const size = resolveSize({ size: name });
      assert.equal(size.genWidth % 64, 0, `${name} width ${size.genWidth}`);
      assert.equal(size.genHeight % 64, 0, `${name} height ${size.genHeight}`);
    }
  });

  test("stays near the model's trained area", () => {
    for (const name of SIZE_PRESETS) {
      const { genWidth, genHeight } = resolveSize({ size: name });
      const area = genWidth * genHeight;
      assert.ok(area > 0.7 * 1024 ** 2 && area < 1.35 * 1024 ** 2, `${name}: ${genWidth}x${genHeight}`);
    }
  });

  test("snaps explicit pixels and records the delivery size", () => {
    const s = resolveSize({ width: 1080, height: 1350 });
    assert.equal(s.genWidth % 64, 0);
    assert.equal(s.genHeight % 64, 0);
    assert.equal(s.targetWidth, 1080);
    assert.equal(s.targetHeight, 1350);
  });
});
