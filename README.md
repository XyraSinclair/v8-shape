# v8-shape

Mechanical-sympathy primitives for V8: allocate arrays that are born packed,
and normalize plain-object construction so hot property loads can stay
monomorphic. The claims are tested against V8 itself with
`%HasSmiElements`, `%HasDoubleElements`, `%HasHoleyElements`, and
`%HaveSameMap`—not inferred from timings.

ESM-only, zero runtime dependencies, TypeScript declarations included.

```ts
import {
    newPackedDouble,
    newPackedElems,
    newPackedSmi,
    range,
    rangeBy,
    releaseCaches,
    sameShape,
    times,
} from 'v8-shape'

newPackedSmi(4)       // [0, 0, 0, 0] — PACKED_SMI_ELEMENTS
newPackedDouble(4)    // [0, 0, 0, 0] — PACKED_DOUBLE_ELEMENTS
newPackedElems(4)     // [0, 0, 0, 0] — PACKED_ELEMENTS
range(-2, 3)          // [-2, -1, 0, 1, 2]
rangeBy(0, 1, 0.25)  // [0, 0.25, 0.5, 0.75]
times(4, (i) => i * i) // [0, 1, 4, 9]

sameShape([{ z: 1, a: 2 }, { a: 3, z: 4 }])
// [{ a: 2, z: 1 }, { a: 3, z: 4 }] — new objects, one insertion sequence

releaseCaches() // drop the retained allocation templates
```

## The honest value proposition

`new Array(n).fill(0)` **also produces packed SMI elements on Node 24's V8**.
There, `fill` converts the initially holey array to packed. (The Node 18 and 22
builds in this package's CI retain holey SMI after `fill`; the receipt asserts
that version boundary.) On the benchmarked Node 24 there is no downstream
elements-kind advantage to `newPackedSmi` over that expression, and sums over
the resulting arrays are statistical ties. The allocator's advantage is
allocation speed at cache-friendly sizes and staying packed while it grows.

The original 2026-07-11 gate on Node 24 measured cached slicing 3.0–3.5×
faster than `new Array(n).fill(0)` at 64–1,024 elements and about 1.4× at
16,384. A fresh package receipt on a busier M5 Max measured a smaller
2.29–2.35× advantage at 64–1,024, 1.47× at 16,384, and a **loss** at 65,536:

| allocator | n=64 | n=1,024 | n=16,384 | n=65,536 |
|---|---:|---:|---:|---:|
| **cachedSlice** | **26.0ns** | **285ns** | **13.3µs** | 151.3µs |
| `new Array(n).fill(0)` | 59.4ns (2.29×) | 670ns (2.35×) | 19.5µs (1.47×) | **64.7µs (0.43×)** |
| `Array.from({length:n},()=>0)` | 1.32µs (50.76×) | 20.4µs (71.51×) | 338.9µs (25.57×) | 1.35ms (8.93×) |
| `new Array(n)` *(holey, not equivalent)* | 35.5ns (1.37×) | 408ns (1.43×) | 14.7µs (1.11×) | **46.0µs (0.30×)** |

Ratios are time relative to cached slice. The 65,536 case grows each returned
array past the 32,768-entry cache ceiling, so direct V8 allocation wins there.
`new Array(n)` is shown only as a lower-work contrast: it returns holes, not
zeros, and the native receipt confirms it is holey.

The consumer-side receipt over preallocated 16,384-element zero arrays was
5.07–5.10µs for all three initialized allocators, with overlapping quartile
bands: a statistical tie.

`sameShape` has a different payoff. Over 8,192 objects with the same eight
keys inserted in eight orders, reading all properties took 117µs before and
37.7µs after normalization: **3.10× faster**. That is an access-only hot-loop
receipt; it excludes normalization cost. Cold objects, small lists, or objects
read only once may never repay the copy.

Numbers above are `cyclebench` medians from Node 24.13.1 on an Apple M5 Max,
2026-07-11 America/Los_Angeles (2026-07-12 UTC). The machine was busy: load
average 12.74/13.33/13.77 at start and 12.32/13.22/13.73 at finish. Run
`npm run bench` on the deployment machine; microbenchmarks are local facts.

## API

### Packed allocation

```ts
newPackedSmi(n: number): number[]
newPackedDouble(n: number): number[]
newPackedElems(n: number): unknown[]
releaseCaches(): void
```

All allocators return independent, zero-filled arrays. `n` must be an integer
from 0 through `2**32 - 1`. The three functions deliberately begin with
different V8 element stores; later writes can transition them naturally.
For example, writing `0.5` into a SMI result changes it to packed doubles
without making it holey.

The module lazily retains one template per kind, initially 2,048 entries and
growing to at most 32,768. V8's backing-store capacity and accounting are
engine details, but the three caches can retain roughly 0.8-1.6 MB at ceiling depending
on the V8 build (0.84 MB measured on Node 24). `releaseCaches()` clears all three module references; arrays
already returned are independent and unaffected. A later allocation recreates
the cache it needs.

### Ranges and mapping

```ts
range(start: number, end: number): number[]
rangeBy(start: number, end: number, step?: number): number[]
times<T>(n: number, fn: (index: number) => T): T[]
```

- `range` is end-exclusive and accepts integer bounds whose emitted values fit
  signed 32-bit SMI range. A descending interval returns `[]`.
- `rangeBy` is end-exclusive in the direction of `step`; a direction mismatch
  returns `[]`, and zero or non-finite arguments throw. Every output is
  computed independently as `start + i * step`, never by repeated addition,
  so accumulation drift does not compound. Integral SMI-safe sequences start
  from a packed SMI allocation; other sequences start from packed doubles.
- `times` calls `fn(0)` through `fn(n - 1)` in order. It begins from a packed
  SMI base, then V8 transitions the returned array if the callback produces
  doubles or objects.

### `sameShape`

```ts
sameShape<T extends object>(objects: readonly T[]): T[]
```

`sameShape` builds the sorted union of all own enumerable string keys, creates
every output through that exact insertion sequence, then copies the values.
Missing union keys are present with value `undefined`; this is necessary when
different key sets are to converge on one shape. Every result is a new,
ordinary object and inputs are never mutated, including frozen inputs.

The exact boundary matters:

- inputs must be plain objects with `Object.prototype` or `null` prototype;
  custom prototypes, arrays, dates, class instances, and proxy behavior are
  outside the contract;
- inherited properties, symbol keys, and non-enumerable properties are
  ignored;
- prototypes and property descriptors are not preserved; enumerable getters
  are read once and become writable data properties;
- all outputs expose the same `Object.keys` order and the native suite asserts
  one V8 map, but V8 hidden classes are an engine implementation detail—not a
  JavaScript-language guarantee.

## Verification

`npm test` runs both the functional suite and the engine receipt. Vitest forks
Node with `--allow-natives-syntax`; if those intrinsics are unavailable, the
engine-only block skips with a loud warning while the functional suite still
runs. The receipt checks each allocator and range kind, zero-length results,
cache growth past 2,048 and 32,768, non-holey status, a real SMI→double
transition, the `new Array(n)` holey contrast, versioned `fill(0)` behavior,
and `%HaveSameMap` after normalization.

Functional coverage includes 5,000 seeded `range` cases against `Array.from`,
5,000 seeded `rangeBy` cases against the per-index oracle, cache release,
input validation, value preservation through `isoequal`, and frozen-input
shape fuzzing. CI runs Node 18, 22, and 24.

V8 claims are verified only on V8. JavaScriptCore and SpiderMonkey receive
correct arrays and objects, but their representations and performance are
unverified.

For the implementation and measurement rationale, see [DESIGN.md](./DESIGN.md).

## License

MIT © Xyra Sinclair
