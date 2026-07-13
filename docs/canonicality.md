# Publication canonicality

This file is the release gate for `v8-shape@0.1.0`.

| Area | Requirement | Status | Evidence |
|---|---|---|---|
| Truth | Representation claims are observed from V8, not inferred from timing | covered | native intrinsic receipt on Node 18/22/24 |
| Truth | Array/range/object outputs preserve documented values | covered | seeded functional and `isoequal` batteries |
| First contact | A stranger can install and run every primitive | covered | README install command and first-screen example |
| Depth | Engine boundaries, cache retention, descriptors, and crossover costs are explicit | covered | README and DESIGN.md |
| Craft | Losses to direct allocation and normalization cost are stated | covered | dated benchmark receipts and limits |
| Stewardship | Tests, build, and packed exports are release-gated | covered | CI on Node 18/22/24 plus publication lifecycle checks |

## Named gaps

- Representation and performance claims apply only to the tested V8 builds.
- `sameShape` copies plain objects and does not preserve descriptors, symbols, or prototypes.
- Cached slicing loses to direct allocation above the retained-template ceiling.

## Ruled out

- JavaScriptCore/SpiderMonkey layout claims: ruled out; only value correctness is claimed there.
- Universal allocation-speed superiority: ruled out by the published 65,536-element loss.
