# v8-shape — design

## Scope and origin

This package is a clean restatement of Xyra Sinclair's original packed-array
and hidden-class utilities from the priorsio codebase. The source material was
the cached allocation core in `utils/array/newArray`, its `range`, `rangeBy`,
and `times` helpers, and `utils/object/hiddenClassUtils`. The unfinished
`v8elementsKindUtils.ts` experiment was deliberately excluded.

The package has two narrow jobs:

1. construct ordinary arrays without ever introducing holes, while selecting
   a requested V8 elements kind at birth;
2. reconstruct batches of plain objects through the same key transition path
   so repeated property access can use one inline-cache map.

It does not ask callers to trust a benchmark as proof of representation. The
test process directly invokes V8's native predicates. Benchmarks answer only
the separate question of whether those representations pay on one machine.

## Packed arrays

### Why a template slice

`new Array(n)` creates an array with `length` but no stored elements, so V8
classifies it as holey. Assigning each boundary index in increasing order:

```ts
for (let i = array.length; i < target; i++) array[i] = 0
```

grows the logical array without skipping an index and therefore stays packed.
Doing that for every requested array is unnecessary work, though. v8-shape
grows one module template per representation and returns a slice. A request
beyond the retained ceiling slices the first 32,768 entries and continues the
same boundary-write loop on the independent result.

Each template is seeded differently before growth:

- SMI begins as `[]`;
- double begins as `[0.5]`, then pops the seed;
- elements begins as `[null]`, then pops the seed.

Popping changes the length but does not narrow the backing representation.
Writing zero thereafter preserves the selected representation, which lets all
three public allocators return the original API's zero values.

Templates are lazy. Each starts at 2,048 entries, may grow to 32,768, and is
held until `releaseCaches()` clears its module reference. Approximate retained
memory measured 0.84 MB (Node 24) to ~1.6 MB for all three at their ceilings depending on the V8 build, in the
origin code; exact backing capacity and tagged-value width belong to V8 and
can vary. Returned arrays never alias a template.

### What `fill(0)` changed

The early origin comments assumed `new Array(n).fill(0)` remained holey. That
is false on the tested Node 24.13.1 V8: `fill` converts the array to packed SMI.
The compatibility run also found the statement is versioned—Node 18.20.8 and
22.23.1 retain holey SMI after `fill`. Accordingly, this package makes no
consumer-performance claim over `fill(0)` on the benchmarked Node 24. The
native suite locks in the version boundary, and the Node 24 consumer receipt
reports a statistical tie.

Cached slicing still avoids some initialization overhead at small and medium
sizes. It is not universally fastest: above the 32,768 cache ceiling it pays
for a slice and a growth loop, and the 65,536-element receipt loses to direct
allocation. The ceiling bounds retention rather than pretending one strategy
wins at every size.

## Ranges

`range` allocates packed SMI storage, then overwrites every existing slot with
`start + i`. Its contract restricts emitted values to signed 32-bit integers,
which matches the V8 SMI receipt on supported Node versions.

`rangeBy` first determines the end-exclusive count from the direction and
step. Division supplies an estimate, then the boundary is checked using the
same expression as output construction. This absorbs a floating-point round
at an exact-looking endpoint. Every stored value is independently computed:

```ts
result[i] = start + i * step
```

Repeated `current += step` was rejected because its rounding error accumulates
across the range. Integral sequences whose first and last values are SMI-safe
use the SMI allocator; every other sequence uses the double allocator. This is
an allocation choice, not a promise that later caller mutations preserve it.

`times` similarly starts from packed SMI zeros and overwrites in order. V8 is
allowed to transition the result to doubles or tagged elements as callback
values require; the only invariant retained is that sequential writes do not
make it holey.

## Object-shape normalization

Property insertion order alone is not quite enough for a strong batch claim.
V8 may specialize a field representation from the first value written, so two
objects following the same key order but receiving different value types can
temporarily diverge. `sameShape` uses two passes:

1. gather and sort the union of own enumerable string keys;
2. construct every ordinary output and seed every key with `undefined`;
3. after all transition paths exist, assign each input's enumerable values to
   the already-created fields.

The `undefined` seed establishes tagged fields before heterogeneous values are
seen. `%HaveSameMap` is asserted across string, SMI, double, object, boolean,
symbol-value, `null`, and `undefined` payloads.

Union keys make the claim meaningful for differing key sets: a missing input
key becomes an own enumerable property containing `undefined`. The operation
is therefore shape normalization, not a descriptor-preserving clone. It
returns ordinary `Object.prototype` objects, accepts only plain
`Object.prototype` or null-prototype inputs, ignores inherited/symbol/
non-enumerable keys, snapshots enumerable getters, and does not preserve
setters, accessors, writability, configurability, or input prototypes.

The special string `__proto__` is installed as a data property so hostile or
unusual input keys cannot mutate the output prototype. Integer-index keys obey
JavaScript's standard enumeration order; all outputs still expose identical
`Object.keys` sequences.

This establishes one map on the V8 versions in CI. It cannot turn hidden
classes into a language-level promise, defeat proxies, or guarantee a speedup
for cold access. Copy cost is intentionally outside the access receipt: a
caller should normalize only when future hot reads can amortize it.

## Engine receipts

Vitest uses fork workers whose `execArgv` includes
`--allow-natives-syntax`. Intrinsics are compiled at runtime with the Function
constructor so a parser without native syntax can still load the test module.
If compilation or a smoke call fails, the V8 block uses `describe.skipIf` and
prints a loud warning; functional tests remain runnable.

The receipt asserts:

- `%HasSmiElements`, `%HasDoubleElements`, and `%HasObjectElements` for every
  allocator, including empty results;
- `!%HasHoleyElements` at ordinary sizes, immediately across the 2,048 cache
  growth boundary, and beyond the 32,768 retained ceiling;
- SMI and float-step range allocation, plus natural `times` transitions;
- mutation of a packed SMI result to a double really changes the observed
  kind, proving the predicates are live;
- `new Array(n)` is holey; `fill(0)` remains SMI and is packed on Node 24 but
  stays holey on the Node 18 and 22 builds in CI;
- `%HaveSameMap` across normalized heterogeneous objects.

These names are internal V8 debugging interfaces, not stable ECMAScript APIs.
The guard prevents their absence from suppressing ordinary correctness tests,
while CI on Node 18, 22, and 24 makes a missing receipt visible in logs.

## Functional verification

The deterministic suite compares `range` with an `Array.from` oracle on 5,000
seeded cases. A second 5,000-case suite constructs each floating range from
`start + i * step`, catching both count and drift errors. Allocators are tested
at zero, initial-cache, cache-growth, ceiling, and post-ceiling lengths.

`sameShape` tests equality through `isoequal`, equal key enumeration, union-key
semantics, symbols and non-enumerables outside scope, null prototypes,
`__proto__`, rejection of custom prototypes, and 500 frozen seeded inputs.

## Benchmark receipts

`npm run bench` builds the package and uses cyclebench 0.1.x. Candidates run in
interleaved slices to reduce drift; results escape through the harness sink;
equivalent consumer and access candidates are cross-validated. The allocation
table disables equality checking only because the intentionally included
holey `new Array(n)` contrast does not compute initialized zeros.

The recorded 2026-07-11 America/Los_Angeles run used Node 24.13.1 on an Apple
M5 Max under high load (12.74/13.33/13.77 start, 12.32/13.22/13.73 finish):

| receipt | result |
|---|---|
| cached slice vs `fill(0)`, n=64 | 26.0ns vs 59.4ns — 2.29× faster |
| cached slice vs `fill(0)`, n=1,024 | 285ns vs 670ns — 2.35× faster |
| cached slice vs `fill(0)`, n=16,384 | 13.3µs vs 19.5µs — 1.47× faster |
| cached slice vs `fill(0)`, n=65,536 | 151.3µs vs 64.7µs — **2.34× slower** |
| sum over preallocated n=16,384 arrays | 5.07–5.10µs — statistical tie |
| eight property reads over 8,192 objects | 117µs polymorphic vs 37.7µs normalized — 3.10× faster |

The earlier priorsio gate on Node 24 observed 3.0–3.5× allocation wins at
64–1,024 and roughly 1.4× at 16,384. The difference between that run and this
one is itself useful evidence: publish the benchmark, the load, and the
crossover—not a context-free constant.

## Portability limits

The implementation uses standard JavaScript and returns correct values on
other engines. Representation and speed claims apply only to tested V8 builds.
JavaScriptCore and SpiderMonkey may make different allocation, transition, and
inline-cache choices; none are claimed here.
