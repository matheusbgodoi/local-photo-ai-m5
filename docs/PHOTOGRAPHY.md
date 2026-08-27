# Photography

What the prompt engine does, why it does it, and what was thrown away.

This file is the project's memory. The model is a commodity; this is not.

---

## The problem

Generated images fail in a specific, recognisable way. Not "bad quality" —
usually the opposite. They fail by being *too good*: skin with no pores, faces
with no asymmetry, rooms with no clutter, light that no lamp in the building
could have produced.

A person looking at a clinic's website does not consciously audit any of that.
They just feel that something is off, and stop trusting the page.

So the target is not beauty. The target is:

> Would a normal person assume a photographer took this?

Everything below follows from that one question.

---

## The four stages

```
intent  →  translate  →  analyse  →  compose  →  brief
```

### 1. Translate (`translate.ts`)

Portuguese in, English out, by dictionary. Never by paraphrase.

Z-Image's text encoder is a Qwen 3 VL model, so Portuguese *renders*. But its
photographic vocabulary is overwhelmingly English: `jaleco branco` produces
something vaguer than `white lab coat`, reliably.

This is **semantic normalisation, not literal translation**. Idioms are matched
whole, longest first, because translating them word by word produces something
worse than either language:

| brief | word by word | normalised |
| --- | --- | --- |
| `em atendimento` | *in atendimento* | during a consultation |
| `sem retoque de beleza` | *without retoque of beleza* | no beauty retouching |
| `sem aparência de stock photo` | *without aparência of stock photo* | not looking like a stock photo |
| `luz fluorescente misturada com luz natural lateral` | *luz fluorescente misturada with natural light lateral* | fluorescent light mixed with natural light from the side |
| `linhas finas e pequenas imperfeições` | *linhas finas and pequenas imperfeições* | fine lines and small imperfections |

Four properties matter more than coverage:

- **Grammatical gender survives.** `médica` → `female doctor`, `médico` →
  `male doctor`. A translator that flattens both to "doctor" has changed the
  request, which rule 14 forbids.
- **Unknown words pass through untouched.** `ClueMed` stays `ClueMed`. The
  engine reports coverage in the sidecar rather than guessing.
- **Adjectives get reordered.** Portuguese puts them after the noun;
  `escritório real` becomes `real office`, not `office real`. Left alone, the
  model reads the trailing adjective as a *separate object in the scene*.
- **Nothing is normalised away.** Brazilian identity, the hospital, the stated
  age, the candidness and the realism clauses all survive into the final brief.
  Coverage is a measure of how much stayed *readable*, not of how much was
  removed.

There is no LLM in this path. It is a dictionary, so it is deterministic,
offline, and auditable. Coverage on the clinical vocabulary above went from
51 % to 100 %; the sidecar reports the figure for every generation.

### 2. Analyse (`analyze.ts`)

Pattern matching over the English intent: how many people, what ages, what
roles, what objects, what setting, how close the framing is, whether the caller
already specified a camera or lighting.

It **never adds facts.** It only notices ones already stated. That is what lets
the composer be contextual instead of formulaic — and what makes rule 14
enforceable rather than aspirational.

Which means a *wrong* reading is a real bug, not a cosmetic one. Three were
found by reading the rationale on ordinary clinical briefs and fixed:

| brief says | was read as | why it was wrong |
| --- | --- | --- |
| `sem olhar para a câmera` | `products=[electronics]` | the camera is where the photograph is taken *from*. The scene picked up brushed-metal product language for a doctor and a patient. |
| `de 42 anos` | `ages=[elderly]` | a bare "aged" matched the elderly pattern regardless of the number, so a 42-year-old got grey hair and age-related wrinkles — the engine inventing a fact instead of reading one. |
| `ambiente limpo` / `sala de exame` | `framing=wide` | naming the room a scene happens in is not asking for a wide shot. The lens rules already widen on a known setting, which is the honest cue. |

A stated age now decides its own bucket: under 13 child, 13–24 young, 25–64
adult, 65+ elderly. When two ages are in one frame — a doctor and an elderly
patient — the single age clause goes to the elderly face, because that is the
hardest one to render honestly and the most obvious when it is wrong.

### 3. Doctrine (`presets.ts`)

A preset is not a "style". It is the set of decisions a photographer makes
before a shoot: what kind of coverage this is, what glass to bring, how to
light it, how much of the room to let in, how much imperfection to tolerate.

Six, because a photographer does not have twenty modes either.

### 4. Compose (`engine.ts`)

Five sentences, in the order a brief is actually read:

```
1. what this is        opener + the caller's subject + behaviour
2. who/what is in it   skin, materials, environment
3. how it was shot     light, glass, depth of field
4. framing + medium    composition, grain, preset signature
5. intent              the closer
```

Length is capped around 60–120 words. Beyond that the encoder starts averaging
rather than attending, and every extra clause dilutes the ones that matter.

The opener is ours only when the brief has not already claimed it. A brief that
names its own medium — `fotografia documental de uma médica…` — keeps its
wording and the preset opener is dropped rather than stacked on top, which is
what used to produce *"A photograph taken during an ordinary working day,
showing a documentary photograph of…"*. The rationale says when this happened.

---

## What actually works

### Age-appropriate texture is guaranteed, not sampled

The single most obvious tell in this project's domain is an elderly face
rendered with default generated skin. So when the scene contains an elderly
person, an age-appropriate clause is **always** emitted — the composer picks
*which* one at random, never *whether*, and in a mixed-age frame it is the
elderly clause that is emitted rather than whichever the seed lands on.

Children are the mirror image: they get "soft young skin, hair not perfectly
tidy" and can never receive age-related wrinkles.

### Pore-level language only at pore-level framing

`visible pores and fine facial hair` is emitted only when the framing is
`portrait` or `closeup`. At a medium or wide distance the model cannot resolve
pores, so it renders the instruction as *noise* instead — which reads as a bad
sensor, not as skin.

This is the difference between rule 17 (natural) and its failure mode
(degraded).

### Different glass for different subjects

- **35mm** — the default for environmental work. Takes in the room.
- **50mm** — people at conversational distance, product on a surface.
- **85mm** — *only* when the framing is portrait or closeup, or for a product.
  It is filtered out otherwise. Unconditional 85mm is one of the reasons
  generated images feel like advertising.
- **28mm** — only when the setting is known and the framing is wide.
- **phone camera** — the `smartphone` preset never gets a full-frame body.

### Environments carry their clutter

`the room shows everyday use: paperwork, cables, worn surfaces and objects left
where people put them` does more for believability than any skin instruction.
Real clinics are beige and slightly untidy. Impossibly clean rooms are an AI
tell that people notice without knowing why.

### Say who is in the picture

**The single highest-leverage word in this whole system is a nationality.**

Z-Image Turbo is a Tongyi (Alibaba) model, and its unstated demographic prior
is East Asian. The same prompt, same preset, same seed, differing only by one
adjective:

| prompt | what came out |
| --- | --- |
| `médica … conversando com paciente idosa em uma clínica` | an East Asian doctor in a generic modern consulting room |
| `médica **brasileira** … com paciente idosa **brasileira** …` | a Brazilian clinic: fluorescent tube overhead, notices taped to a painted wall, a floral tank top, freckles, sun-damaged skin on the patient's arms, gold earrings |

The second is not merely "a different face". Naming the nationality moved the
*entire scene* — architecture, lighting fixtures, clothing, signage, skin — to
a plausible Brazilian public-health clinic. That is a change in believability,
not in aesthetics.

The prompt engine will **not** insert this for you. Rule 14 forbids it:
ethnicity is a fact about the subject, and inventing facts about people is
exactly the line the engine does not cross. So it is on the caller, and it is
worth being explicit about every time:

```bash
local-photo generate --preset clinical \
  -p "médica brasileira conversando com paciente idosa brasileira em uma clínica"
```

The same applies to any other unstated attribute the model will otherwise
default on: age, build, hair, and the kind of building the scene happens in.

### Deterministic variety

The composer's choices come from a seeded PRNG keyed on
`prompt|preset|seed`. Same request replayed → same brief. `--count 4` → four
different briefs, because the seeds differ. Both properties are needed:
reproducibility without variety gives you four identical images.

---

## What was thrown away

### Negations in positive prompts

The first version of the `natural` preset ended with:

```
realistic dynamic range without any HDR look
```

A test caught it, and the test was right. Diffusion text encoders handle
negation poorly — the tokens `HDR look` are present and attended to; `without`
is a weak modifier. The clause was arguing *for* the thing it meant to forbid.

Rewritten positively:

```
realistic dynamic range with a gentle highlight rolloff
```

The same edit was applied throughout:

| removed | replacement |
| --- | --- |
| `A real photograph, not a staged stock image.` | `An ordinary real-world photograph.` |
| `A real object photographed on a real surface, not a 3D render.` | `A physical object photographed on a real surface under real light.` |
| `An ordinary phone snapshot, not a professional photograph.` | `An ordinary phone snapshot straight from a camera roll.` |
| `the room reflected in the screen instead of an impossibly clean display` | `a soft reflection of the room across the screen glass` |
| `soft reflections across the aluminium, not mirror-perfect` | `soft, diffuse reflections across the aluminium` |

Comparatives survive, because they name only the thing you want:
"caught rather than arranged" is safe; "not arranged" is not.

Negative prompts are a different matter — they are the correct place for
"plastic skin". But Z-Image Turbo is distilled and runs at CFG 1, where the
negative branch is not evaluated at all. So the engine emits a negative prompt
only when guidance is above 1, and records in the rationale why it did not.
Shipping a decorative negative prompt would be theatre.

### The AI-slop vocabulary

Never emitted, at any preset, any seed:

```
8k · 4k uhd · masterpiece · ultra realistic · hyperrealistic · award winning
insanely detailed · perfect skin · flawless skin · trending on artstation
octane render · unreal engine · HDR · cinematic masterpiece
```

There is a test that asserts this across every preset × prompt × seed
combination. It is not a style preference; those tokens are strongly associated
with rendered and heavily-retouched imagery in training data, and they pull the
output straight toward it.

The engine does **not** strip these from *your* text — rewriting your request
is not its job. It flags them in the rationale instead:

```bash
local-photo prompt "8k ultra realistic doctor"
# → Caller supplied AI-look terms (8k, ultra realistic); kept verbatim…
```

### "Worn" applied to a machine

The `clinical` preset's signature ends with *"the room shows everyday use:
paperwork, cables, worn surfaces and objects left where people put them"*, and
the material module offered *"a lightly scuffed casing that has clearly been
used"*. Both are right for a room with people in it. Compounded on a close shot
of equipment, the model rendered **a rusted, corroded machine** — which is not
realism, it is a different and wrong claim about the clinic.

Fixed two ways: object-led clinical scenes now get their own signature
(`signatureObject`), and the medical-device material clauses talk about a
*clean* casing with the marks of daily wiping down, plus a lit indicator and
screen. Same seed, same prompt, the result went from a corroded box to a
plausible patient monitor on a pole.

The general lesson: **imperfection language has to match the object's real
maintenance regime.** A clinic's equipment is wiped down every day; its
paperwork is not.

### Aware of the camera, not presenting to it

The `professional` and `corporate` scenes kept producing a subject facing the
lens with a gentle smile — the exact stock-photo pose rule 18 asks us to avoid
by default. The behaviour clause said "relaxed and natural rather than posed",
which does not discourage addressing the camera at all.

Rewritten so a commissioned shoot still reads as commissioned without becoming
a headshot:

```
relaxed and mid-task rather than presenting to the camera
comfortable with the camera present, attention still on their work
glancing up briefly from what they are doing
at ease, looking slightly away from the lens
```

### One camera for everything

An early version picked a lens from the preset pool without consulting the
scene. A MacBook on a desk got the same 35mm environmental treatment as a
family in a kitchen. The subject-aware filter fixed it, and rule 16 of the
brief says exactly this: product ≠ family ≠ doctor ≠ selfie.

---

## Reading the rationale

Every generation records why the brief looks the way it does:

```
Translated pt-BR -> EN (100% of content words recognised)
Scene: people=two, ages=[elderly], roles=[medical/patient], products=[-], setting=clinic, framing=unknown
Human realism: 3 clause(s), age-aware.
Preset "clinical": Healthcare documentary. Real clinics are busy, worn and beige…
Brief length: 123 words.
Negative prompt omitted: the model runs distilled at CFG 1, where it has no effect.
```

Anything below 100 % coverage names the words that stayed in Portuguese, and a
`products=` or `framing=` value the brief never asked for is the thing to
report — it means the scene was misread before the model ever ran.

If an image is wrong, this tells you whether the *scene* was misread or the
*model* misfired. Those need completely different fixes, and guessing between
them wastes a lot of generations.

```bash
local-photo prompt "your intent" --all     # every preset, side by side
```

---

## What still needs you

Two things the engine cannot decide, seen across the full ten-scenario run:

**Clothing, in domestic scenes.** "família brasileira na cozinha" produces a
plausible Brazilian home — which sometimes means people in vests or shirtless.
Entirely realistic, rarely what a marketing brief wants. Say what they are
wearing.

**Framing, for products.** "MacBook aberto sobre uma mesa de trabalho" drifts
toward a tight crop of the laptop rather than the laptop *in* a workspace. Say
how much room you want: *"MacBook aberto sobre uma mesa de trabalho, com o
escritório visível ao fundo"*.

**Whose face carries the years, in a mixed-age frame.** One age clause is
emitted per brief and it does not name a subject, so *"médica de 42 anos com
paciente idosa"* can put the grey hair on either face. The clause goes to the
elderly one by policy, but the model decides who wears it. If it matters, say
so: *"médica de 42 anos, cabelo escuro, com paciente idosa de cabelos grisalhos"*.

Neither is a fault in the system; both are the model exploring an
under-specified request. `--count 3` is the cheap answer, and being one clause
more specific is the cheaper one.

## Judging output

Not "is it beautiful". Not "is it sharp". The question is the one at the top of
this file, and these are the tells worth checking against:

| tell | where it shows up first |
| --- | --- |
| waxy, poreless skin | cheeks and forehead at 100% |
| over-smoothed faces | the transition from jaw to neck |
| strange teeth | any open-mouth smile |
| perfect symmetry | eyes and eyebrows |
| overdone bokeh | background at mid-distance |
| HDR lighting | shadows that are lit from nowhere |
| impossible reflections | screens, glass, metal |
| wrong device geometry | keyboards, ports, buttons |
| wrong fingers | hands at rest, especially in laps |
| uniform pore pattern | forehead — a *repeating* texture is worse than none |
| over-sharpening | hair edges against a background |
| background nonsense | signage, small objects, other people's faces |
| unnaturally clean spaces | desks, counters, floors |
| stock-photo poses | anyone facing the camera and presenting |

When two candidates disagree, the one that looks more *ordinary* wins. More
detail is not more real.
