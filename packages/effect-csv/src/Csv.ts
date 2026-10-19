/**
 * Streaming CSV decoding for Effect channels and streams.
 *
 * Records are decoded according to RFC 4180 by default: fields are separated
 * by `,`, quoted with `"`, and a quote inside a quoted field is written as
 * `""`. Records may end with `\n`, `\r\n` or `\r`. Malformed input fails with a
 * `CsvError` whose `reason` carries the line on which the record starts.
 *
 * The module uses no Node-specific APIs, so it runs on any JavaScript runtime.
 *
 * **Example** (Decoding a byte stream into rows)
 *
 * ```ts
 * import { Stream } from 'effect'
 * import { Csv } from 'effect-csv'
 *
 * const rows = Stream.make(new TextEncoder().encode('name,age\nAda,36\n')).pipe(
 * 	Stream.pipeThroughChannel(Csv.decode()),
 * 	Stream.runCollect,
 * )
 * // Effect<Array<Csv.Row>, Csv.CsvError> that succeeds with [["name", "age"], ["Ada", "36"]]
 * ```
 *
 * @since 0.1.0
 */
import { Array as Arr, Cause, Channel, Effect, Option, Pull } from 'effect'
import type { CsvError } from './internal/errors.ts'
import * as Parser from './internal/parser.ts'

/**
 * @since 0.1.0
 */
export * from './internal/errors.ts'

/**
 * A decoded CSV record, with one string per field.
 *
 * @category models
 * @since 0.1.0
 */
export type Row = ReadonlyArray<string>

/**
 * Options for decoding CSV text.
 *
 * **Details**
 *
 * `delimiter`, `quote` and `escape` must each be exactly one UTF-16 code unit
 * other than `\r` and `\n`, and `quote` and `escape` must differ from
 * `delimiter`. `maxRecordSize` must be a positive integer or `Infinity`.
 * Invalid options are defects: the decoding channel or `parse` dies with an
 * `IllegalArgumentError` when it starts.
 *
 * @category options
 * @since 0.1.0
 */
export interface DecodeOptions {
	/**
	 * Separates fields. Defaults to `","`; use `"\t"` for TSV.
	 */
	readonly delimiter?: string | undefined
	/**
	 * Encloses fields that contain delimiters, quotes or line breaks. Defaults
	 * to `'"'`. `null` disables quoting, so quote characters are ordinary text
	 * and `escape` is ignored.
	 */
	readonly quote?: string | null | undefined
	/**
	 * Escapes a quote inside a quoted field. Defaults to `quote`, which gives
	 * RFC 4180 `""` doubling. With a different character such as `"\\"`, the
	 * escape character also escapes itself, and before any other character it
	 * is kept as text.
	 */
	readonly escape?: string | undefined
	/**
	 * When `false` (the default), a record whose field count differs from the
	 * first record fails with `FieldCountMismatch`.
	 */
	readonly relaxColumnCount?: boolean | undefined
	/**
	 * Maximum number of UTF-16 code units in one record, not counting the line
	 * break that ends it. A larger record fails with `RecordTooLarge` as soon as
	 * the limit is crossed, so an unclosed quote cannot buffer the whole input.
	 * Defaults to 10 MiB. `Infinity` disables the limit.
	 */
	readonly maxRecordSize?: number | undefined
}

/**
 * Options for decoding CSV bytes.
 *
 * @category options
 * @since 0.1.0
 */
export interface DecodeBytesOptions extends DecodeOptions {
	/**
	 * Text encoding label passed to `TextDecoder`. Defaults to `"utf-8"`. An
	 * unsupported label is a defect.
	 */
	readonly encoding?: string | undefined
}

/**
 * Creates a channel that decodes CSV text chunks into rows.
 *
 * **Details**
 *
 * Records, fields and line breaks may span input chunks; the output does not
 * depend on how the input is split. A U+FEFF byte-order mark at the start of
 * the input is removed. A line break at the end of the input does not produce
 * an extra record, but a blank line elsewhere is a record with one empty field.
 *
 * Rows decoded before malformed input are emitted before the channel fails
 * with the `CsvError`.
 *
 * @category decoding
 * @since 0.1.0
 */
export const decodeString = <IE = never, Done = unknown>(
	options?: DecodeOptions,
): Channel.Channel<
	Arr.NonEmptyReadonlyArray<Row>,
	CsvError | IE,
	Done,
	Arr.NonEmptyReadonlyArray<string>,
	IE,
	Done
> =>
	Channel.fromTransform((upstream, _scope) =>
		Effect.sync(() => {
			let rows: Array<Row> = []
			let failure: CsvError | undefined
			let done = Option.none<Done>()
			const parser = Parser.make(options, (row) => {
				rows.push(row)
			})

			const pull: Pull.Pull<Arr.NonEmptyReadonlyArray<Row>, CsvError | IE, Done> = Effect.suspend(
				() => {
					if (Arr.isArrayNonEmpty(rows)) {
						const out = rows
						rows = []
						return Effect.succeed(out)
					}
					if (failure !== undefined) return Effect.fail(failure)
					if (Option.isSome(done)) return Cause.done(done.value)
					return Pull.matchEffect(upstream, {
						onSuccess: (chunks) => {
							for (const chunk of chunks) {
								failure = parser.feed(chunk)
								if (failure !== undefined) break
							}
							return pull
						},
						onFailure: Effect.failCause,
						onDone: (leftover) => {
							done = Option.some(leftover)
							failure = parser.end()
							return pull
						},
					})
				},
			)
			return pull
		}),
	)

/**
 * Creates a channel that decodes CSV bytes into rows.
 *
 * **Details**
 *
 * Bytes are decoded with a streaming `TextDecoder`, so multi-byte characters
 * may span input chunks, and then parsed as in `decodeString`. Exactly one
 * byte-order mark is removed from the start of the input.
 *
 * @category decoding
 * @since 0.1.0
 */
export const decode = <IE = never, Done = unknown>(
	options?: DecodeBytesOptions,
): Channel.Channel<
	Arr.NonEmptyReadonlyArray<Row>,
	CsvError | IE,
	Done,
	Arr.NonEmptyReadonlyArray<Uint8Array>,
	IE,
	Done
> =>
	Channel.pipeTo(
		Channel.decodeText<IE, Done>(options?.encoding, { ignoreBOM: true }),
		decodeString(options),
	)

/**
 * Parses a complete CSV string into rows.
 *
 * **Details**
 *
 * Produces the same rows as `decodeString` given the same text in any number
 * of chunks.
 *
 * **Example** (Parsing a string and handling one error reason)
 *
 * ```ts
 * import { Effect } from 'effect'
 * import { Csv } from 'effect-csv'
 *
 * const rows = Csv.parse('a;"b;c"\r\n1;2', { delimiter: ';' }).pipe(
 * 	Effect.catchReason('CsvError', 'FieldCountMismatch', (reason) =>
 * 		Effect.die(`line ${reason.line} has ${reason.actual} fields`),
 * 	),
 * )
 * // Effect<ReadonlyArray<Csv.Row>, Csv.CsvError> that succeeds with [["a", "b;c"], ["1", "2"]]
 * ```
 *
 * @category decoding
 * @since 0.1.0
 */
export const parse = (
	input: string,
	options?: DecodeOptions,
): Effect.Effect<ReadonlyArray<Row>, CsvError> =>
	Effect.suspend(() => {
		const rows: Array<Row> = []
		const parser = Parser.make(options, (row) => {
			rows.push(row)
		})
		const failure = parser.feed(input) ?? parser.end()
		return failure === undefined ? Effect.succeed(rows) : Effect.fail(failure)
	})
