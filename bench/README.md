# Benchmarks

```bash
local-photo benchmark --suite variants          # which quantisation to ship
local-photo benchmark --suite lora              # raw vs adapter, at several strengths
local-photo benchmark --suite realism           # all ten scenarios, current config
local-photo benchmark --suite quick             # three scenarios, fast sanity pass
local-photo benchmark --suite variants --apply q8p   # write the winner to config
```

Results land in `bench/results/<timestamp>/` — git-ignored, because generated
imagery does not belong in a repository. Each run writes:

| file | what |
| --- | --- |
| `report.json` | every measurement, machine-readable |
| `report.md` | the same as a table |
| `<scenario>__<config>__s<seed>.png` | the frames |
| `sheet__<scenario>__s<seed>.jpg` | the candidates side by side, labelled |

## What is measured and what is not

**Measured, by the machine:** wall time, cold-start cost, peak memory delta
during generation, swap, file size.

**Not measured:** realism. There is no local scorer that can tell you whether a
photograph of a doctor looks like a photograph of a doctor, and installing a
second large model to produce a number that correlates weakly with the
judgement you actually care about would be a waste of 10 GB.

So the harness's real job is to make the comparison *fair* — same scenes, same
seeds, one variable at a time, laid out side by side — and the judging is done
by looking. [`../docs/PHOTOGRAPHY.md`](../docs/PHOTOGRAPHY.md) lists the tells
worth checking.

## Scenarios

Ten, chosen against the actual use case rather than against what is easy to
generate:

| id | scene |
| --- | --- |
| `medical` | doctor and elderly patient in a clinic |
| `elderly` | elderly couple at home |
| `family` | family in a kitchen, nobody posing |
| `man` | middle-aged man working in an office |
| `nurse` | nurse and patient in a hospital |
| `product` | smartphone on a desk |
| `laptop` | MacBook with plausible wear |
| `device` | medical equipment in a clinic |
| `corporate` | professional in a modern office |
| `lifestyle` | candid scene in natural light |

Deliberately **not** ten portraits of a young woman. That set would make almost
any realism LoRA look excellent and would predict nothing about how the system
performs on the images this project actually has to produce.

## Reading a run

```bash
local-photo benchmark --suite lora --scenarios medical,elderly,laptop
open bench/results/<timestamp>/sheet__medical__s101.jpg
```

Judge the sheet before the table. If two candidates are visually equivalent,
*then* the numbers decide — and the tie-break order is the one from the brief:
quality, naturalness, stability, memory, speed.
