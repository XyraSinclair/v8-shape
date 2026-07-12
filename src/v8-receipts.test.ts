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

interface V8Natives {
    hasDoubleElements(value: unknown[]): boolean
    hasHoleyElements(value: unknown[]): boolean
    hasObjectElements(value: unknown[]): boolean
    hasSmiElements(value: unknown[]): boolean
    haveSameMap(a: object, b: object): boolean
}

function loadV8Natives(): V8Natives | undefined {
    try {
        const unary = (name: string) =>
            new Function('value', `return %${name}(value)`) as (value: unknown[]) => boolean
        const binary = (name: string) =>
            new Function('a', 'b', `return %${name}(a, b)`) as (a: object, b: object) => boolean
        const natives = {
            hasDoubleElements: unary('HasDoubleElements'),
            hasHoleyElements: unary('HasHoleyElements'),
            hasObjectElements: unary('HasObjectElements'),
            hasSmiElements: unary('HasSmiElements'),
            haveSameMap: binary('HaveSameMap'),
        }
        natives.hasSmiElements([])
        return natives
    } catch (error) {
        console.warn(
            `LOUD WARNING: V8 native-syntax receipts are unavailable; engine assertions skipped (${String(error)})`
        )
        return undefined
    }
}

const v8 = loadV8Natives()

function expectPacked(array: unknown[]): void {
    expect(v8?.hasHoleyElements(array)).toBe(false)
}

describe.skipIf(!v8)('V8 engine receipts', () => {
    it.each([0, 1, 64, 2_048])('newPackedSmi(%i) is PACKED_SMI_ELEMENTS', (length) => {
        const value = newPackedSmi(length)
        expect(v8?.hasSmiElements(value)).toBe(true)
        expect(v8?.hasDoubleElements(value)).toBe(false)
        expect(v8?.hasObjectElements(value)).toBe(false)
        expectPacked(value)
    })

    it.each([0, 1, 64, 2_048])('newPackedDouble(%i) is PACKED_DOUBLE_ELEMENTS', (length) => {
        const value = newPackedDouble(length)
        expect(v8?.hasSmiElements(value)).toBe(false)
        expect(v8?.hasDoubleElements(value)).toBe(true)
        expect(v8?.hasObjectElements(value)).toBe(false)
        expectPacked(value)
    })

    it.each([0, 1, 64, 2_048])('newPackedElems(%i) is PACKED_ELEMENTS', (length) => {
        const value = newPackedElems(length)
        expect(v8?.hasSmiElements(value)).toBe(false)
        expect(v8?.hasDoubleElements(value)).toBe(false)
        expect(v8?.hasObjectElements(value)).toBe(true)
        expectPacked(value)
    })

    it('keeps each kind packed while growing templates and returned arrays', () => {
        releaseCaches()
        const smiAtInitial = newPackedSmi(2_048)
        const smiPastInitial = newPackedSmi(2_049)
        const smiPastCeiling = newPackedSmi(32_769)
        expect(v8?.hasSmiElements(smiAtInitial)).toBe(true)
        expect(v8?.hasSmiElements(smiPastInitial)).toBe(true)
        expect(v8?.hasSmiElements(smiPastCeiling)).toBe(true)
        expectPacked(smiAtInitial)
        expectPacked(smiPastInitial)
        expectPacked(smiPastCeiling)

        releaseCaches()
        const doubleAtInitial = newPackedDouble(2_048)
        const doublePastInitial = newPackedDouble(2_049)
        const doublePastCeiling = newPackedDouble(32_769)
        expect(v8?.hasDoubleElements(doubleAtInitial)).toBe(true)
        expect(v8?.hasDoubleElements(doublePastInitial)).toBe(true)
        expect(v8?.hasDoubleElements(doublePastCeiling)).toBe(true)
        expectPacked(doubleAtInitial)
        expectPacked(doublePastInitial)
        expectPacked(doublePastCeiling)

        releaseCaches()
        const elemsAtInitial = newPackedElems(2_048)
        const elemsPastInitial = newPackedElems(2_049)
        const elemsPastCeiling = newPackedElems(32_769)
        expect(v8?.hasObjectElements(elemsAtInitial)).toBe(true)
        expect(v8?.hasObjectElements(elemsPastInitial)).toBe(true)
        expect(v8?.hasObjectElements(elemsPastCeiling)).toBe(true)
        expectPacked(elemsAtInitial)
        expectPacked(elemsPastInitial)
        expectPacked(elemsPastCeiling)
    })

    it('gives ranges the promised kinds', () => {
        const integers = range(-5, 20)
        const integerStep = rangeBy(-5, 20, 2)
        const floatStep = rangeBy(-5, 20, 0.25)
        expect(v8?.hasSmiElements(integers)).toBe(true)
        expect(v8?.hasSmiElements(integerStep)).toBe(true)
        expect(v8?.hasDoubleElements(floatStep)).toBe(true)
        expectPacked(integers)
        expectPacked(integerStep)
        expectPacked(floatStep)
    })

    it('lets times transition naturally without becoming holey', () => {
        const smis = times(8, (index) => index)
        const doubles = times(8, (index) => index + 0.5)
        const objects = times(8, (index) => ({ index }))
        expect(v8?.hasSmiElements(smis)).toBe(true)
        expect(v8?.hasDoubleElements(doubles)).toBe(true)
        expect(v8?.hasObjectElements(objects)).toBe(true)
        expectPacked(smis)
        expectPacked(doubles)
        expectPacked(objects)
    })

    it('proves native probes observe real transitions and the holey contrast', () => {
        const packed = newPackedSmi(8)
        packed[0] = 0.5
        expect(v8?.hasDoubleElements(packed)).toBe(true)
        expect(v8?.hasSmiElements(packed)).toBe(false)
        expectPacked(packed)

        const holey = new Array(8)
        expect(v8?.hasHoleyElements(holey)).toBe(true)

        const filled = new Array(8).fill(0)
        expect(v8?.hasSmiElements(filled)).toBe(true)
        expect(v8?.hasHoleyElements(filled)).toBe(false)
    })

    it('normalizes heterogeneous values onto one hidden class', () => {
        const outputs = sameShape([
            { z: 1, a: 'text', m: null },
            { m: 2.5, z: {}, a: 4 },
            { a: undefined, m: true, z: Symbol('z') },
        ])
        expect(v8?.haveSameMap(outputs[0], outputs[1])).toBe(true)
        expect(v8?.haveSameMap(outputs[0], outputs[2])).toBe(true)
    })
})

