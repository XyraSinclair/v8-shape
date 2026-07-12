const INITIAL_CACHE_LENGTH = 2 ** 11
const CACHE_LENGTH_LIMIT = 2 ** 15
const MAX_ARRAY_LENGTH = 2 ** 32 - 1
const SMI_MIN = -(2 ** 31)
const SMI_MAX = 2 ** 31 - 1

let packedSmiCache: number[] | undefined
let packedDoubleCache: number[] | undefined
let packedElemsCache: unknown[] | undefined

function assertArrayLength(length: number): void {
    if (!Number.isInteger(length) || length < 0 || length > MAX_ARRAY_LENGTH) {
        throw new RangeError(`length must be an integer from 0 through ${MAX_ARRAY_LENGTH}`)
    }
}

function growPackedSmi(array: number[], targetLength: number): number[] {
    for (let index = array.length; index < targetLength; index++) array[index] = 0
    return array
}

function growPackedDouble(array: number[], targetLength: number): number[] {
    for (let index = array.length; index < targetLength; index++) array[index] = 0
    return array
}

function growPackedElems(array: unknown[], targetLength: number): unknown[] {
    for (let index = array.length; index < targetLength; index++) array[index] = 0
    return array
}

function makePackedSmi(length: number): number[] {
    return growPackedSmi([], length)
}

function makePackedDouble(length: number): number[] {
    const array = [0.5]
    array.pop()
    return growPackedDouble(array, length)
}

function makePackedElems(length: number): unknown[] {
    const array: unknown[] = [null]
    array.pop()
    return growPackedElems(array, length)
}

function smiCache(): number[] {
    return (packedSmiCache ??= makePackedSmi(INITIAL_CACHE_LENGTH))
}

function doubleCache(): number[] {
    return (packedDoubleCache ??= makePackedDouble(INITIAL_CACHE_LENGTH))
}

function elemsCache(): unknown[] {
    return (packedElemsCache ??= makePackedElems(INITIAL_CACHE_LENGTH))
}

/** Return a zero-filled array born as V8 PACKED_SMI_ELEMENTS. */
export function newPackedSmi(length: number): number[] {
    assertArrayLength(length)
    const cache = smiCache()
    const cachedLength = Math.min(CACHE_LENGTH_LIMIT, length)
    growPackedSmi(cache, cachedLength)
    return growPackedSmi(cache.slice(0, cachedLength), length)
}

/** Return a zero-filled array born as V8 PACKED_DOUBLE_ELEMENTS. */
export function newPackedDouble(length: number): number[] {
    assertArrayLength(length)
    const cache = doubleCache()
    const cachedLength = Math.min(CACHE_LENGTH_LIMIT, length)
    growPackedDouble(cache, cachedLength)
    return growPackedDouble(cache.slice(0, cachedLength), length)
}

/** Return a zero-filled array born as V8 PACKED_ELEMENTS. */
export function newPackedElems(length: number): unknown[] {
    assertArrayLength(length)
    const cache = elemsCache()
    const cachedLength = Math.min(CACHE_LENGTH_LIMIT, length)
    growPackedElems(cache, cachedLength)
    return growPackedElems(cache.slice(0, cachedLength), length)
}

/** Drop the module's three retained allocation templates. Returned arrays are unaffected. */
export function releaseCaches(): void {
    packedSmiCache = undefined
    packedDoubleCache = undefined
    packedElemsCache = undefined
}

/** Return the end-exclusive integer range [start, end), in PACKED_SMI_ELEMENTS. */
export function range(start: number, end: number): number[] {
    if (
        !Number.isInteger(start) ||
        !Number.isInteger(end) ||
        start < SMI_MIN ||
        start > SMI_MAX ||
        end < SMI_MIN ||
        end > SMI_MAX + 1
    ) {
        throw new RangeError('range bounds must describe values in the signed 32-bit SMI range')
    }
    if (end <= start) return []

    const length = end - start
    assertArrayLength(length)
    const result = newPackedSmi(length)
    for (let index = 0; index < length; index++) result[index] = start + index
    return result
}

function isBeforeEnd(value: number, end: number, step: number): boolean {
    return step > 0 ? value < end : value > end
}

function rangeByLength(start: number, end: number, step: number): number {
    let length = Math.ceil((end - start) / step)
    if (!Number.isFinite(length)) {
        throw new RangeError('rangeBy result length exceeds the maximum array length')
    }
    // Reject huge FINITE estimates BEFORE the correction loops: when step is
    // far below ulp(end), the decrement loop walks a rounding plateau one
    // step at a time (~ulp(end)/(2·step) iterations — an effective hang for
    // counts like 1e284). The estimate tracks the true count to within a
    // few ULPs, so any over-max estimate is already invalid.
    assertArrayLength(length)

    // Make the end-exclusive rule depend on the documented per-index value,
    // even when the division used for the first estimate rounds at a boundary.
    while (length > 0 && !isBeforeEnd(start + (length - 1) * step, end, step)) length--
    while (isBeforeEnd(start + length * step, end, step)) length++
    assertArrayLength(length)
    return length
}

/**
 * Return an end-exclusive arithmetic range. Every value is computed as
 * `start + index * step`, rather than by accumulating `step`.
 */
export function rangeBy(start: number, end: number, step = 1): number[] {
    if (!Number.isFinite(start) || !Number.isFinite(end) || !Number.isFinite(step)) {
        throw new RangeError('rangeBy arguments must be finite numbers')
    }
    if (step === 0) throw new RangeError('rangeBy step must not be zero')
    if (!isBeforeEnd(start, end, step)) return []

    const length = rangeByLength(start, end, step)
    const last = start + (length - 1) * step
    const canUseSmi =
        Number.isInteger(start) &&
        Number.isInteger(step) &&
        start >= SMI_MIN &&
        start <= SMI_MAX &&
        last >= SMI_MIN &&
        last <= SMI_MAX
    const result = canUseSmi ? newPackedSmi(length) : newPackedDouble(length)

    for (let index = 0; index < length; index++) result[index] = start + index * step
    return result
}

/** Map `fn` over integer indices 0 through n - 1, starting from a packed base. */
export function times<T>(n: number, fn: (index: number) => T): T[] {
    assertArrayLength(n)
    if (typeof fn !== 'function') throw new TypeError('times fn must be a function')

    const result = newPackedSmi(n) as T[]
    for (let index = 0; index < n; index++) result[index] = fn(index)
    return result
}

type PlainObject = Record<string, unknown>

function assertPlainObject(value: object, index: number): void {
    if (value === null || typeof value !== 'object') {
        throw new TypeError(`sameShape value at index ${index} is not an object`)
    }
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) {
        throw new TypeError(`sameShape object at index ${index} is not a plain object`)
    }
}

function createKey(out: PlainObject, key: string): void {
    if (key === '__proto__') {
        Object.defineProperty(out, key, {
            configurable: true,
            enumerable: true,
            value: undefined,
            writable: true,
        })
    } else {
        out[key] = undefined
    }
}

/**
 * Clone plain objects through one normalized enumerable-string-key insertion
 * sequence. Missing union keys become `undefined`; symbols, descriptors,
 * non-enumerables, accessors, and input prototypes are not preserved.
 */
export function sameShape<T extends object>(objects: readonly T[]): T[] {
    const keySet = new Set<string>()
    for (let index = 0; index < objects.length; index++) {
        const object = objects[index]
        assertPlainObject(object, index)
        for (const key of Object.keys(object)) keySet.add(key)
    }

    const keys = [...keySet].sort()
    const results = new Array<T>(objects.length)

    // Seeding every field with undefined fixes the field representation as a
    // tagged value before heterogeneous real values are assigned. On V8 this
    // avoids value-type specialization splitting otherwise identical maps.
    for (let index = 0; index < objects.length; index++) {
        const output: PlainObject = {}
        for (const key of keys) createKey(output, key)
        results[index] = output as T
    }

    for (let index = 0; index < objects.length; index++) {
        const input = objects[index] as PlainObject
        const output = results[index] as PlainObject
        for (const key of Object.keys(input)) output[key] = input[key]
    }

    return results
}
