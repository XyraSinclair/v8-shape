import { isoEqual } from 'isoequal'
import { describe, expect, it } from 'vitest'

import {
    newPackedDouble,
    newPackedElems,
    newPackedSmi,
    range,
    rangeBy,
    releaseCaches,
    sameShape,
    times,
} from './index.js'

describe('packed allocators', () => {
    it.each([
        ['SMI', newPackedSmi],
        ['double', newPackedDouble],
        ['elements', newPackedElems],
    ] as const)('returns independent zero-filled %s arrays', (_name, allocate) => {
        for (const length of [0, 1, 64, 2_048, 2_049, 32_768, 32_769]) {
            const first = allocate(length)
            const second = allocate(length)
            expect(first).toHaveLength(length)
            expect(first.every((value) => value === 0)).toBe(true)
            expect(first).not.toBe(second)
            if (length > 0) {
                first[0] = 12
                expect(second[0]).toBe(0)
            }
        }
    })

    it('releases templates without touching arrays already returned', () => {
        const smi = newPackedSmi(4)
        const double = newPackedDouble(4)
        const elems = newPackedElems(4)
        smi[0] = 1
        double[0] = 1.5
        elems[0] = null

        releaseCaches()

        expect(smi).toEqual([1, 0, 0, 0])
        expect(double).toEqual([1.5, 0, 0, 0])
        expect(elems).toEqual([null, 0, 0, 0])
        expect(newPackedSmi(2)).toEqual([0, 0])
        expect(newPackedDouble(2)).toEqual([0, 0])
        expect(newPackedElems(2)).toEqual([0, 0])
    })

    it.each([-1, 1.5, NaN, Infinity, 2 ** 32])('rejects invalid length %s', (length) => {
        expect(() => newPackedSmi(length)).toThrow(RangeError)
        expect(() => newPackedDouble(length)).toThrow(RangeError)
        expect(() => newPackedElems(length)).toThrow(RangeError)
    })
})

describe('range', () => {
    it('is end-exclusive and supports negative starts', () => {
        expect(range(3, 8)).toEqual([3, 4, 5, 6, 7])
        expect(range(-3, 2)).toEqual([-3, -2, -1, 0, 1])
        expect(range(4, 4)).toEqual([])
        expect(range(4, -2)).toEqual([])
        expect(range(2 ** 31 - 1, 2 ** 31)).toEqual([2 ** 31 - 1])
    })

    it('matches Array.from on 5,000 seeded cases', () => {
        let state = 0x6d2b79f5
        const random = () => {
            state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0
            return state
        }

        for (let trial = 0; trial < 5_000; trial++) {
            const start = (random() % 20_001) - 10_000
            const length = random() % 2_000
            const end = start + length
            const oracle = Array.from({ length }, (_, index) => start + index)
            expect(range(start, end)).toEqual(oracle)
        }
    })

    it.each([
        [0.5, 2],
        [0, 2.5],
        [-(2 ** 31) - 1, 0],
        [0, 2 ** 31 + 1],
    ])('rejects bounds outside its SMI contract: %s, %s', (start, end) => {
        expect(() => range(start, end)).toThrow(RangeError)
    })
})

describe('rangeBy', () => {
    it('supports positive, negative, integer, and floating steps', () => {
        expect(rangeBy(1, 6)).toEqual([1, 2, 3, 4, 5])
        expect(rangeBy(5, -2, -2)).toEqual([5, 3, 1, -1])
        expect(rangeBy(-0.5, 1, 0.25)).toEqual([-0.5, -0.25, 0, 0.25, 0.5, 0.75])
        expect(rangeBy(3, 3, 1)).toEqual([])
        expect(rangeBy(3, 8, -1)).toEqual([])
        expect(rangeBy(8, 3, 1)).toEqual([])
    })

    it('computes each float from its index instead of accumulating drift', () => {
        const start = -3.7
        const end = 101.9
        const step = 0.1
        const values = rangeBy(start, end, step)
        const oracle: number[] = []
        for (let index = 0; ; index++) {
            const value = start + index * step
            if (value >= end) break
            oracle.push(value)
        }
        expect(values).toEqual(oracle)
    })

    it('matches a per-index oracle on 5,000 seeded float cases', () => {
        let state = 0x243f6a88
        const random = () => {
            state = (Math.imul(state, 1_103_515_245) + 12_345) >>> 0
            return state / 2 ** 32
        }

        for (let trial = 0; trial < 5_000; trial++) {
            const direction = random() < 0.5 ? -1 : 1
            const start = (random() * 40 - 20) / 7
            const step = direction * (Math.floor(random() * 20) + 1) / 13
            const count = Math.floor(random() * 80)
            const end = start + step * (count + random())
            const oracle: number[] = []
            for (let index = 0; ; index++) {
                const value = start + index * step
                if (step > 0 ? value >= end : value <= end) break
                oracle.push(value)
            }
            expect(rangeBy(start, end, step)).toEqual(oracle)
        }
    })

    it.each([
        [0, 1, 0],
        [NaN, 1, 1],
        [0, Infinity, 1],
        [0, 1, -Infinity],
    ])('rejects invalid arguments: %s, %s, %s', (start, end, step) => {
        expect(() => rangeBy(start, end, step)).toThrow(RangeError)
    })
})

describe('times', () => {
    it('maps fn over indices in order', () => {
        const seen: number[] = []
        expect(
            times(5, (index) => {
                seen.push(index)
                return { square: index * index }
            })
        ).toEqual([{ square: 0 }, { square: 1 }, { square: 4 }, { square: 9 }, { square: 16 }])
        expect(seen).toEqual([0, 1, 2, 3, 4])
        expect(times(0, () => 'unreachable')).toEqual([])
    })

    it('rejects invalid counts', () => {
        expect(() => times(-1, () => 0)).toThrow(RangeError)
        expect(() => times(1.5, () => 0)).toThrow(RangeError)
    })
})

describe('sameShape', () => {
    it('normalizes order, preserves values, and never mutates inputs', () => {
        const first = Object.freeze({ z: 1, a: { nested: true }, m: 'first' })
        const second = Object.freeze({ m: 'second', z: 2, a: { nested: false } })
        const before = [first, second].map((value) => ({ ...value }))

        const outputs = sameShape([first, second])

        expect(Object.keys(outputs[0])).toEqual(Object.keys(outputs[1]))
        expect(Object.keys(outputs[0])).toEqual(['a', 'm', 'z'])
        expect(isoEqual(outputs[0], first)).toBe(true)
        expect(isoEqual(outputs[1], second)).toBe(true)
        expect(outputs[0]).not.toBe(first)
        expect(outputs[1]).not.toBe(second)
        expect(isoEqual(first, before[0])).toBe(true)
        expect(isoEqual(second, before[1])).toBe(true)
    })

    it('uses the union of keys and fills missing values with undefined', () => {
        const outputs = sameShape([{ a: 1 }, { b: 2 }, {}])
        expect(outputs).toEqual([
            { a: 1, b: undefined },
            { a: undefined, b: 2 },
            { a: undefined, b: undefined },
        ])
        expect(outputs.map(Object.keys)).toEqual([
            ['a', 'b'],
            ['a', 'b'],
            ['a', 'b'],
        ])
    })

    it('leaves frozen inputs untouched across seeded key-order fuzz', () => {
        let state = 0x9e3779b9
        const random = () => {
            state ^= state << 13
            state ^= state >>> 17
            state ^= state << 5
            return state >>> 0
        }

        for (let trial = 0; trial < 500; trial++) {
            const keys = ['alpha', 'beta', 'gamma', 'delta', 'epsilon']
            keys.sort(() => (random() & 1 ? 1 : -1))
            const input: Record<string, number> = {}
            for (const key of keys) input[key] = random()
            const snapshot = { ...input }
            Object.freeze(input)

            const [output] = sameShape([input])
            expect(isoEqual(input, snapshot)).toBe(true)
            expect(isoEqual(output, input)).toBe(true)
            expect(output).not.toBe(input)
        }
    })

    it('copies only own enumerable string-keyed values', () => {
        const symbol = Symbol('outside-contract')
        const input = Object.create(null) as Record<PropertyKey, unknown>
        input.visible = 1
        input[symbol] = 2
        Object.defineProperty(input, 'hidden', { enumerable: false, value: 3 })
        Object.defineProperty(input, '__proto__', { enumerable: true, value: 4 })

        const [output] = sameShape([input]) as Array<Record<PropertyKey, unknown>>
        expect(Object.keys(output)).toEqual(['__proto__', 'visible'])
        expect(output.__proto__).toBe(4)
        expect(Object.getPrototypeOf(output)).toBe(Object.prototype)
        expect(output[symbol]).toBeUndefined()
        expect(Object.hasOwn(output, 'hidden')).toBe(false)
    })

    it('rejects objects with custom prototypes', () => {
        expect(() => sameShape([new Date()])).toThrow(TypeError)
        expect(() => sameShape([[]])).toThrow(TypeError)
    })
})

