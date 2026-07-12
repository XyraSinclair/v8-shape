import os from 'node:os'

import { compare } from 'cyclebench'

import { newPackedSmi, releaseCaches, sameShape } from '../dist/index.js'

const lengths = [64, 1_024, 16_384, 65_536]

function formatTime(ns) {
    if (ns >= 1e6) return `${(ns / 1e6).toFixed(2)}ms`
    if (ns >= 1e3) return `${(ns / 1e3).toFixed(ns >= 10_000 ? 1 : 2)}µs`
    return `${ns.toFixed(ns >= 100 ? 0 : 1)}ns`
}

function markdownTable(header, rows) {
    return [
        `| ${header.join(' | ')} |`,
        `|${header.map(() => '---').join('|')}|`,
        ...rows.map((row) => `| ${row.join(' | ')} |`),
    ].join('\n')
}

function byName(report, name) {
    const result = report.candidates.find((candidate) => candidate.name === name)
    if (!result) throw new Error(`missing cyclebench result for ${name}`)
    return result
}

function sum(values) {
    let total = 0
    for (let index = 0; index < values.length; index++) total += values[index]
    return total
}

function makeDifferentOrderObjects(count) {
    const keys = ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta', 'eta', 'theta']
    const orders = keys.map((_, offset) => keys.map((__, index) => keys[(index + offset) % keys.length]))
    return Array.from({ length: count }, (_, index) => {
        const object = {}
        const order = orders[index % orders.length]
        for (let position = 0; position < order.length; position++) {
            object[order[position]] = index + position
        }
        return object
    })
}

// Separate source functions keep the property-load feedback sites independent:
// one sees the original maps and one sees only the normalized map.
function readPolymorphic(objects) {
    let total = 0
    for (let index = 0; index < objects.length; index++) {
        const object = objects[index]
        total +=
            object.alpha +
            object.beta +
            object.gamma +
            object.delta +
            object.epsilon +
            object.zeta +
            object.eta +
            object.theta
    }
    return total
}

function readMonomorphic(objects) {
    let total = 0
    for (let index = 0; index < objects.length; index++) {
        const object = objects[index]
        total +=
            object.alpha +
            object.beta +
            object.gamma +
            object.delta +
            object.epsilon +
            object.zeta +
            object.eta +
            object.theta
    }
    return total
}

const startedAt = new Date()
const loadAtStart = os.loadavg()
console.info(
    `machine: ${os.cpus()[0]?.model ?? 'unknown CPU'} · ${process.platform}/${process.arch} · ${process.version}`
)
console.info(`started: ${startedAt.toISOString()} · load average: ${loadAtStart.map((n) => n.toFixed(2)).join('/')}`)

releaseCaches()
const allocation = await compare({
    candidates: {
        cachedSlice: (length) => newPackedSmi(length),
        'new Array(n).fill(0)': (length) => new Array(length).fill(0),
        'Array.from({length:n},()=>0)': (length) => Array.from({ length }, () => 0),
        'new Array(n) [holey]': (length) => new Array(length),
    },
    inputs: lengths.map((length) => [length]),
    // The holey allocation intentionally has different values; this receipt
    // compares allocation mechanics, not equivalent initialization semantics.
    agree: false,
    timeMs: 800,
    warmupMs: 140,
})

if (!allocation.ok) throw new Error('allocation receipt failed')
const allocationNames = [
    'cachedSlice',
    'new Array(n).fill(0)',
    'Array.from({length:n},()=>0)',
    'new Array(n) [holey]',
]
const cached = byName(allocation, 'cachedSlice')
const allocationRows = allocationNames.map((name) => {
    const candidate = byName(allocation, name)
    return [
        name,
        ...candidate.perInput.map((point, index) => {
            const ratio = point.nsPerOp / cached.perInput[index].nsPerOp
            return `${formatTime(point.nsPerOp)} (${ratio.toFixed(2)}× cached)`
        }),
    ]
})
console.info('\nALLOCATION (time/op; lower is better)')
console.info(markdownTable(['allocator', ...lengths.map((n) => `n=${n.toLocaleString('en-US')}`)], allocationRows))

const sumLength = 16_384
const sumArrays = {
    cachedSlice: newPackedSmi(sumLength),
    'new Array(n).fill(0)': new Array(sumLength).fill(0),
    'Array.from({length:n},()=>0)': Array.from({ length: sumLength }, () => 0),
}
const consumer = await compare({
    candidates: Object.fromEntries(
        Object.entries(sumArrays).map(([name, values]) => [name, () => sum(values)])
    ),
    timeMs: 1_000,
    warmupMs: 160,
})
if (!consumer.ok) throw new Error('consumer receipt disagreed')
console.info('\nCONSUMER SUM (preallocated zero arrays, n=16,384)')
consumer.print()

const polymorphic = makeDifferentOrderObjects(8_192)
const monomorphic = sameShape(polymorphic)
const shape = await compare({
    candidates: {
        'different-order objects': () => readPolymorphic(polymorphic),
        'sameShape objects': () => readMonomorphic(monomorphic),
    },
    timeMs: 1_200,
    warmupMs: 240,
})
if (!shape.ok) throw new Error('sameShape receipt disagreed')
console.info('\nPROPERTY ACCESS (8 keys × 8,192 objects)')
shape.print()

const rawShape = byName(shape, 'different-order objects')
const fixedShape = byName(shape, 'sameShape objects')
console.info(
    `sameShape access ratio: ${(rawShape.nsPerOp / fixedShape.nsPerOp).toFixed(2)}× ` +
        `(normalization itself is not included)`
)
console.info(`finished load average: ${os.loadavg().map((n) => n.toFixed(2)).join('/')}`)

