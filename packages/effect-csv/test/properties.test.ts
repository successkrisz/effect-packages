import { assert, describe, it } from '@effect/vitest'
import { Arbitrary, Cause, Effect, Exit, Result, Schema, Stream } from 'effect'
import * as Csv from '../src/Csv.ts'
import { type Outcome, parseChunks, reasonFields } from './utils.ts'

// Every character that is special in some generated dialect, plus ordinary text and a surrogate pair.
const Token = Schema.Literals([
	'a',
	'b',
	',',
	';',
	'\t',
	'"',
	"'",
	'\\',
	'\r',
	'\n',
	'\uFEFF',
	'😀',
])

const text = (maxLength: number) =>
	Arbitrary.array(Arbitrary.schema(Token), { maxLength }).pipe(
		Arbitrary.map((tokens) => tokens.join('')),
	)

const chunks = Arbitrary.array(text(8), { maxLength: 12 })

const dialect: Arbitrary.Arbitrary<Csv.DecodeOptions> = Arbitrary.all({
	delimiter: Arbitrary.schema(Schema.Literals([',', ';', '\t'])),
	quote: Arbitrary.schema(Schema.NullOr(Schema.Literals(['"', "'"]))),
	escape: Arbitrary.schema(Schema.UndefinedOr(Schema.Literal('\\'))),
	relaxColumnCount: Arbitrary.schema(Schema.Boolean),
	maxRecordSize: Arbitrary.schema(
		Schema.UndefinedOr(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 12 }))),
	),
})

const cuts = Arbitrary.schema(
	Schema.Array(Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 1000 }))),
)

/** Start and end offsets of the pieces obtained by cutting `length` units at `positions`. */
const pieces = (length: number, positions: ReadonlyArray<number>) => {
	const sorted = positions.map((position) => position % (length + 1)).sort((a, b) => a - b)
	return [0, ...sorted].map((start, i) => [start, sorted[i] ?? length] as const)
}

const splitString = (input: string, positions: ReadonlyArray<number>) =>
	pieces(input.length, positions).map(([start, end]) => input.slice(start, end))

const splitBytes = (input: Uint8Array, positions: ReadonlyArray<number>) =>
	pieces(input.length, positions).map(([start, end]) => input.subarray(start, end))

const joined = (alphabet: ReadonlyArray<string>, maxLength: number) =>
	Arbitrary.array(Arbitrary.schema(Schema.Literals(alphabet)), { maxLength }).pipe(
		Arbitrary.map((tokens) => tokens.join('')),
	)

const field = Arbitrary.all({
	quoted: Arbitrary.schema(Schema.Boolean),
	unquoted: joined(['a', 'b', ' ', '😀'], 4),
	quotedValue: joined(['a', ',', ';', '\t', '"', '\\', '\r', '\n'], 6),
}).pipe(
	Arbitrary.map(({ quoted, unquoted, quotedValue }) => ({
		quoted,
		value: quoted ? quotedValue : unquoted,
	})),
)

/**
 * Well-formed records with 1 to 4 fields in a random dialect, where quoted
 * fields may contain line breaks, with the rows computed from the generated
 * structure.
 */
const records = Arbitrary.all({
	records: Arbitrary.array(Arbitrary.array(field, { minLength: 1, maxLength: 4 }), {
		maxLength: 6,
	}),
	terminator: Arbitrary.schema(Schema.Literals(['\n', '\r\n', '\r'])),
	delimiter: Arbitrary.schema(Schema.Literals([',', ';', '\t'])),
	escape: Arbitrary.schema(Schema.Literals(['"', '\\'])),
}).pipe(
	Arbitrary.map(({ records, terminator, delimiter, escape: escapeChar }) => {
		const quote = (value: string) =>
			escapeChar === '"'
				? `"${value.replaceAll('"', '""')}"`
				: `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`
		return {
			input: records
				.map(
					(fields) =>
						fields.map((f) => (f.quoted ? quote(f.value) : f.value)).join(delimiter) + terminator,
				)
				.join(''),
			options: { delimiter, escape: escapeChar } satisfies Csv.DecodeOptions,
			rows: records.map((fields): Csv.Row => fields.map((f) => f.value)),
		}
	}),
)

/**
 * Well-formed records followed by an unclosed quote, with the line of the
 * failing record computed from the generated structure.
 */
const document = records.pipe(
	Arbitrary.map(({ input, options, rows }) => ({
		input: `${input}"unclosed`,
		options: { ...options, relaxColumnCount: true },
		rows,
		line: 1 + (input.match(/\r\n|\r|\n/g)?.length ?? 0),
	})),
)

const runChannel = Effect.fnUntraced(function* <E>(stream: Stream.Stream<Csv.Row, E>) {
	const rows: Array<Csv.Row> = []
	const exit = yield* stream.pipe(
		Stream.runForEach((row) =>
			Effect.sync(() => {
				rows.push(row)
			}),
		),
		Effect.exit,
	)
	if (Exit.isSuccess(exit)) return { rows, error: undefined } satisfies Outcome
	const error = Cause.findError(exit.cause)
	assert.isTrue(Result.isSuccess(error), Cause.pretty(exit.cause))
	return {
		rows,
		error:
			Result.isSuccess(error) && Csv.isCsvError(error.success)
				? reasonFields(error.success)
				: undefined,
	} satisfies Outcome
})

describe('chunk invariance', () => {
	it.prop(
		'decodes well-formed records and reports the line of the failing record for any split',
		{ document, cuts },
		({ document: { input, options, rows, line }, cuts }) => {
			const expected: Outcome = { rows, error: { _tag: 'UnclosedQuote', line } }
			assert.deepStrictEqual(parseChunks([input], options), expected)
			assert.deepStrictEqual(parseChunks(input.split(''), options), expected)
			assert.deepStrictEqual(parseChunks(splitString(input, cuts), options), expected)
		},
		{ arbitrary: { runs: 1000, size: 20 } },
	)

	it.prop(
		'parsing chunks matches parsing their concatenation',
		{ chunks, options: dialect },
		({ chunks, options }) => {
			assert.deepStrictEqual(parseChunks(chunks, options), parseChunks([chunks.join('')], options))
		},
		{ arbitrary: { runs: 2000, size: 20 } },
	)

	it.prop(
		'parsing one code unit at a time matches parsing the whole input',
		{ input: text(60), options: dialect },
		({ input, options }) => {
			assert.deepStrictEqual(parseChunks(input.split(''), options), parseChunks([input], options))
		},
		{ arbitrary: { runs: 2000, size: 20 } },
	)

	it.effect.prop(
		'decodeString matches the parser on the whole input',
		{ chunks, options: dialect },
		Effect.fnUntraced(function* ({ chunks, options }) {
			const outcome = yield* runChannel(
				Stream.fromIterable(chunks).pipe(
					Stream.rechunk(1),
					Stream.pipeThroughChannel(Csv.decodeString(options)),
				),
			)
			assert.deepStrictEqual(outcome, parseChunks([chunks.join('')], options))
		}),
		{ arbitrary: { runs: 300, size: 20 } },
	)

	it.effect.prop(
		'decode matches the parser for any byte split',
		{ input: text(40), cuts, options: dialect },
		Effect.fnUntraced(function* ({ input, cuts, options }) {
			const outcome = yield* runChannel(
				Stream.fromIterable(splitBytes(new TextEncoder().encode(input), cuts)).pipe(
					Stream.rechunk(1),
					Stream.pipeThroughChannel(Csv.decode(options)),
				),
			)
			assert.deepStrictEqual(outcome, parseChunks([input], options))
		}),
		{ arbitrary: { runs: 300, size: 20 } },
	)

	it.effect.prop(
		'toObjects reports the rows and the field count mismatch of the strict parser',
		{ records },
		Effect.fnUntraced(function* ({ records: { input, options, rows } }) {
			const [first] = rows
			if (first === undefined) return
			const columns = first.map((_, i) => `c${i}`)
			const outcome = yield* runChannel(
				Stream.fromIterable(rows).pipe(
					Stream.rechunk(2),
					Stream.pipeThroughChannel(Csv.toObjects({ columns })),
					Stream.map(Object.values),
				),
			)
			assert.deepStrictEqual(outcome, parseChunks([input], options))
		}),
		{ arbitrary: { runs: 1000, size: 20 } },
	)

	it.effect.prop(
		'parse matches the parser on the whole input',
		{ input: text(60), options: dialect },
		Effect.fnUntraced(function* ({ input, options }) {
			const expected = parseChunks([input], options)
			const exit = yield* Effect.exit(Csv.parse(input, options))
			if (expected.error === undefined) {
				assert.deepStrictEqual(exit, Exit.succeed(expected.rows))
			} else {
				assert.isTrue(Exit.isFailure(exit))
				const error = Exit.isFailure(exit) ? Cause.findError(exit.cause) : undefined
				assert.isTrue(error !== undefined && Result.isSuccess(error))
				if (error !== undefined && Result.isSuccess(error)) {
					assert.deepStrictEqual(reasonFields(error.success), expected.error)
				}
			}
		}),
		{ arbitrary: { runs: 300, size: 20 } },
	)
})

// Every character that is special in some generated encoding dialect, plus ordinary text, a formula start and a surrogate pair.
const encodedField = joined(
	['a', ' ', '=', ',', ';', '\t', '|', '"', "'", '$', '\\', '\r', '\n', '\uFEFF', '😀'],
	5,
)

/** Rows that all have the same number of fields, from 1 to 4. */
const table = Arbitrary.schema(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 4 }))).pipe(
	Arbitrary.flatMap((width) =>
		Arbitrary.array(Arbitrary.array(encodedField, { minLength: width, maxLength: width }), {
			maxLength: 6,
		}),
	),
)

/** Every lossless encoding option; `escapeFormulae` changes fields, so it is tested with examples. */
const encodeDialect: Arbitrary.Arbitrary<Csv.EncodeOptions> = Arbitrary.all({
	delimiter: Arbitrary.schema(Schema.Literals([',', ';', '\t', '|'])),
	quote: Arbitrary.schema(Schema.Literals(['"', "'", '$'])),
	escape: Arbitrary.schema(Schema.UndefinedOr(Schema.Literal('\\'))),
	recordDelimiter: Arbitrary.schema(Schema.Literals(['\n', '\r\n'])),
	quoteMode: Arbitrary.schema(Schema.Literals(['needed', 'all'])),
	bom: Arbitrary.schema(Schema.Boolean),
})

const decodeOptions = ({
	delimiter,
	quote,
	escape: escapeChar,
}: Csv.EncodeOptions): Csv.DecodeOptions => ({ delimiter, quote, escape: escapeChar })

describe('round trip', () => {
	it.prop(
		'parsing the output of stringify gives back the rows in any dialect',
		{ rows: table, options: encodeDialect },
		({ rows, options }) => {
			const outcome = parseChunks([Csv.stringify(rows, options)], decodeOptions(options))
			assert.deepStrictEqual(outcome, { rows, error: undefined })
		},
		{ arbitrary: { runs: 3000, size: 20 } },
	)

	it.effect.prop(
		'encodeString matches stringify for any chunking of the rows',
		{
			rows: table,
			options: encodeDialect,
			chunkSize: Arbitrary.schema(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 4 }))),
		},
		Effect.fnUntraced(function* ({ rows, options, chunkSize }) {
			const text = yield* Stream.fromIterable(rows).pipe(
				Stream.rechunk(chunkSize),
				Stream.pipeThroughChannel(Csv.encodeString(options)),
				Stream.mkString,
			)
			assert.strictEqual(text, Csv.stringify(rows, options))
		}),
		{ arbitrary: { runs: 300, size: 20 } },
	)

	it.effect.prop(
		'decode gives back the rows encoded by encode for any byte split',
		{ rows: table, options: encodeDialect, cuts },
		Effect.fnUntraced(function* ({ rows, options, cuts }) {
			const chunks = yield* Stream.fromIterable(rows).pipe(
				Stream.pipeThroughChannel(Csv.encode(options)),
				Stream.runCollect,
			)
			const bytes = new Uint8Array(chunks.flatMap((chunk) => [...chunk]))
			const outcome = yield* runChannel(
				Stream.fromIterable(splitBytes(bytes, cuts)).pipe(
					Stream.rechunk(1),
					Stream.pipeThroughChannel(Csv.decode(decodeOptions(options))),
				),
			)
			assert.deepStrictEqual(outcome, { rows, error: undefined })
		}),
		{ arbitrary: { runs: 300, size: 20 } },
	)

	it.effect.prop(
		'toObjects gives back the objects converted by fromObjects',
		{ rows: table },
		Effect.fnUntraced(function* ({ rows }) {
			const objects = rows.map((row) => Object.fromEntries(row.map((value, i) => [`c${i}`, value])))
			const decoded = yield* Stream.fromIterable(objects).pipe(
				Stream.pipeThroughChannel(Csv.fromObjects()),
				Stream.pipeThroughChannel(Csv.encodeString()),
				Stream.pipeThroughChannel(Csv.decodeString()),
				Stream.pipeThroughChannel(Csv.toObjects()),
				Stream.runCollect,
			)
			assert.deepStrictEqual(decoded, objects)
		}),
		{ arbitrary: { runs: 300, size: 20 } },
	)
})
