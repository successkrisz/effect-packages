/**
 * Streaming CSV decoding and encoding for Effect channels and streams.
 *
 * Records are decoded according to RFC 4180 by default: fields are separated
 * by `,`, quoted with `"`, and a quote inside a quoted field is written as
 * `""`. Records may end with `\n`, `\r\n` or `\r`. Malformed input fails with a
 * `CsvError` whose `reason` carries the line on which the record starts.
 * Relaxations of RFC 4180 are opt-in: `trim`, `comment`, `skipEmptyLines`,
 * `relaxQuotes` and `relaxColumnCount`.
 *
 * Rows can be converted into objects keyed by a header row with `toObjects`,
 * or decoded into typed values with a `Schema` by `decodeSchema` and
 * `decodeSchemaString`.
 *
 * Encoding goes the other way: `encode`, `encodeString` and `stringify` write
 * rows in the same dialect, quoting only the fields that need it, so that
 * decoding the output gives back the rows. `fromObjects` turns objects into a
 * header row followed by rows, and `encodeSchema` and `encodeSchemaString`
 * encode typed values with a `Schema` first. Encoding rows never fails.
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
import {
	Array as Arr,
	Cause,
	Channel,
	ChannelSchema,
	Effect,
	Option,
	Pull,
	type Schema,
} from 'effect'
import * as Encoder from './internal/encoder.ts'
import type { CsvError } from './internal/errors.ts'
import * as Objects from './internal/objects.ts'
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
 * `delimiter`, `quote`, `escape` and `comment` must each be exactly one
 * UTF-16 code unit other than `\r` and `\n`, `quote` and `escape` must differ
 * from `delimiter`, and `comment` must differ from `delimiter` and `quote`.
 * `maxRecordSize` must be a positive integer or `Infinity`. Invalid options
 * are defects: the decoding channel or `parse` dies with an
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
	 * Skips lines that start with this character, such as `"#"`. Defaults to
	 * none. Only the first character of a line counts, or with `trim` the
	 * first character after leading whitespace, so the character is text
	 * anywhere else, including on a line that continues a quoted field.
	 * A comment line is not a record: it does not set the column count and
	 * does not count towards `maxRecordSize`, but it does count in the line
	 * numbers of errors.
	 */
	readonly comment?: string | undefined
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
	/**
	 * Removes the whitespace around each field. Defaults to `false`.
	 *
	 * An unquoted field loses its leading and trailing whitespace. A quoted
	 * field keeps the whitespace between its quotes, but whitespace between a
	 * quote and the delimiter or line break is ignored, so `  "a b" ,c` decodes
	 * as `["a b", "c"]`. Whitespace means the characters that
	 * `String.prototype.trim` removes, except the delimiter and the quote
	 * character, so a tab delimiter is never trimmed.
	 *
	 * Leading whitespace on a line is ignored too: with `skipEmptyLines`, a
	 * line of only whitespace is skipped, and with `comment`, whitespace before
	 * the comment character still makes the line a comment.
	 */
	readonly trim?: boolean | undefined
	/**
	 * Skips lines that contain no characters, instead of decoding each as a
	 * record with one empty field. Defaults to `false`. A line that contains
	 * only `""` is a record, and with `trim`, a line of only whitespace is
	 * empty.
	 */
	readonly skipEmptyLines?: boolean | undefined
	/**
	 * Keeps a quote character inside an unquoted field as text instead of
	 * failing with `InvalidQuote`, so `a"b` decodes as `a"b`. Defaults to
	 * `false`. A field that starts with a quote is still a quoted field, and
	 * text after its closing quote still fails.
	 */
	readonly relaxQuotes?: boolean | undefined
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
 * Options for converting rows into objects.
 *
 * **Details**
 *
 * An explicit `columns` array must be non-empty and must not contain empty or
 * repeated names; otherwise the channel dies with an `IllegalArgumentError`
 * when it starts.
 *
 * @category options
 * @since 0.1.0
 */
export interface ToObjectsOptions {
	/**
	 * Names the keys of each object. `"header"` (the default) consumes the
	 * first row as the column names. An array of names consumes no row; to
	 * replace an existing header, drop its row first with `Stream.drop(1)`.
	 */
	readonly columns?: 'header' | ReadonlyArray<string> | undefined
	/**
	 * When `false` (the default), a row whose field count differs from the
	 * number of columns fails with `FieldCountMismatch`. When `true`, the keys
	 * of missing fields are omitted and extra fields are dropped.
	 */
	readonly relaxColumnCount?: boolean | undefined
}

/**
 * Options for encoding rows as CSV text.
 *
 * **Details**
 *
 * `delimiter`, `quote`, `escape` and `comment` follow the rules of
 * `DecodeOptions`, so that the same values decode the output, except that
 * `quote` cannot be `null`: a field that contains the delimiter or a line
 * break could not be written otherwise. Invalid options are defects: the
 * encoding channel dies with an `IllegalArgumentError` when it starts, and
 * `stringify` throws it.
 *
 * @category options
 * @since 0.1.0
 */
export interface EncodeOptions {
	/**
	 * Separates fields. Defaults to `","`; use `"\t"` for TSV.
	 */
	readonly delimiter?: string | undefined
	/**
	 * Encloses fields that need quoting. Defaults to `'"'`.
	 */
	readonly quote?: string | undefined
	/**
	 * Escapes a quote inside a quoted field. Defaults to `quote`, which writes a
	 * quote as `""` (RFC 4180). With a different character such as `"\\"`,
	 * quotes and escape characters inside quoted fields are both prefixed with
	 * it.
	 */
	readonly escape?: string | undefined
	/**
	 * Quotes the fields that start with this character, also after leading
	 * whitespace, so that a decoder with the same `comment` does not skip
	 * their rows as comments, even with `trim`. Defaults to none.
	 */
	readonly comment?: string | undefined
	/**
	 * Ends every record, including the last. Defaults to `"\r\n"`, as in
	 * RFC 4180.
	 */
	readonly recordDelimiter?: '\n' | '\r\n' | undefined
	/**
	 * With `"needed"` (the default), a field is quoted only when it contains the
	 * delimiter, the quote character, `\r` or `\n`, when it starts with U+FEFF,
	 * when it starts with the `comment` character after any whitespace, or when
	 * it is the only field of its row and is empty or only whitespace, so that
	 * decoders that skip blank lines keep the row, even when they trim fields.
	 * With `"all"`, every field is quoted.
	 */
	readonly quoteMode?: 'needed' | 'all' | undefined
	/**
	 * Prepends a U+FEFF byte-order mark to the output, which helps spreadsheet
	 * programs such as Excel detect UTF-8. Defaults to `false`.
	 */
	readonly bom?: boolean | undefined
	/**
	 * Prefixes `'` to fields that start with `=`, `+`, `-`, `@`, a tab, `\r`,
	 * `\n` or a full-width `＝`, `＋`, `－` or `＠`, so that spreadsheet programs
	 * show them as text instead of evaluating them as formulas (CSV injection).
	 * Defaults to `false`. The prefix is part of the field when the output is
	 * decoded.
	 */
	readonly escapeFormulae?: boolean | undefined
}

/**
 * Options for converting objects into rows.
 *
 * **Details**
 *
 * An explicit `columns` array must be non-empty and must not contain empty or
 * repeated names; otherwise the channel dies with an `IllegalArgumentError`
 * when it starts.
 *
 * @category options
 * @since 0.1.0
 */
export interface FromObjectsOptions {
	/**
	 * Names the columns, in order. Defaults to the keys of the first object.
	 */
	readonly columns?: ReadonlyArray<string> | undefined
	/**
	 * When `true` (the default), a header row with the column names comes
	 * first.
	 */
	readonly header?: boolean | undefined
}

/**
 * Parses text chunks with a parser whose row handler comes from `makeOnRow`,
 * which receives a function that emits a value. The values emitted while
 * parsing one upstream batch are emitted as one batch.
 */
const parseWith = <A, IE, Done>(
	options: DecodeOptions | undefined,
	makeOnRow: (emit: (value: A) => void) => Parser.OnRow,
): Channel.Channel<
	Arr.NonEmptyReadonlyArray<A>,
	CsvError | IE,
	Done,
	Arr.NonEmptyReadonlyArray<string>,
	IE,
	Done
> =>
	Channel.fromTransform((upstream, _scope) =>
		Effect.sync(() => {
			let values: Array<A> = []
			let failure: CsvError | undefined
			let done = Option.none<Done>()
			const parser = Parser.make(
				options,
				makeOnRow((value) => {
					values.push(value)
				}),
			)

			const pull: Pull.Pull<Arr.NonEmptyReadonlyArray<A>, CsvError | IE, Done> = Effect.suspend(
				() => {
					if (Arr.isArrayNonEmpty(values)) {
						const out = values
						values = []
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
 * Creates a channel that decodes CSV text chunks into rows.
 *
 * **Details**
 *
 * Records, fields and line breaks may span input chunks; the output does not
 * depend on how the input is split. A U+FEFF byte-order mark at the start of
 * the input is removed. A line break at the end of the input does not produce
 * an extra record, but a blank line elsewhere is a record with one empty
 * field, unless `skipEmptyLines` is set.
 *
 * Rows decoded before malformed input are emitted before the channel fails
 * with the `CsvError`.
 *
 * **Example** (Decoding a commented, padded file)
 *
 * ```ts
 * import { Stream } from 'effect'
 * import { Csv } from 'effect-csv'
 *
 * const rows = Stream.make('# exported 2026-10-19\nname, age\n\nAda , 36\n').pipe(
 * 	Stream.pipeThroughChannel(Csv.decodeString({ comment: '#', skipEmptyLines: true, trim: true })),
 * 	Stream.runCollect,
 * )
 * // Effect<Array<Csv.Row>, Csv.CsvError> that succeeds with [["name", "age"], ["Ada", "36"]]
 * ```
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
	parseWith(options, (emit) => (row) => {
		emit(row)
		return undefined
	})

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
 * Creates a channel that converts rows into objects keyed by column name.
 *
 * **Details**
 *
 * With `columns: "header"` (the default), the first row names the columns and
 * is not emitted; a header with an empty or repeated name fails with
 * `InvalidHeader`. The keys of each object follow the column order.
 *
 * Errors carry the line on which the failing row starts, counted from the
 * first row the channel receives, including line breaks inside fields. That
 * is the input line when the rows come straight from `decode` or
 * `decodeString` and no lines were skipped as comments or empty lines;
 * `decodeSchema` and `decodeSchemaString` report the input line in every
 * case. Objects converted before an invalid row are emitted before the
 * channel fails.
 *
 * **Example** (Decoding CSV text into objects)
 *
 * ```ts
 * import { Stream } from 'effect'
 * import { Csv } from 'effect-csv'
 *
 * const people = Stream.make('name,age\nAda,36\n').pipe(
 * 	Stream.pipeThroughChannel(Csv.decodeString()),
 * 	Stream.pipeThroughChannel(Csv.toObjects()),
 * 	Stream.runCollect,
 * )
 * // Effect<Array<Readonly<Record<string, string>>>, Csv.CsvError> that succeeds with [{ name: "Ada", age: "36" }]
 * ```
 *
 * @category decoding
 * @since 0.1.0
 */
export const toObjects = <IE = never, Done = unknown>(
	options?: ToObjectsOptions,
): Channel.Channel<
	Arr.NonEmptyReadonlyArray<Readonly<Record<string, string>>>,
	CsvError | IE,
	Done,
	Arr.NonEmptyReadonlyArray<Row>,
	IE,
	Done
> =>
	Channel.fromTransform((upstream, _scope) =>
		Effect.sync(() => {
			let records: Array<Readonly<Record<string, string>>> = []
			let failure: CsvError | undefined
			const objects = Objects.make(options, (record) => {
				records.push(record)
			})
			// With `relaxColumnCount`, only the header can fail, and it is always the first row.
			const lineOf = options?.relaxColumnCount === true ? () => 1 : Objects.makeLineCounter()

			const pull: Pull.Pull<
				Arr.NonEmptyReadonlyArray<Readonly<Record<string, string>>>,
				CsvError | IE,
				Done
			> = Effect.suspend(() => {
				if (Arr.isArrayNonEmpty(records)) {
					const out = records
					records = []
					return Effect.succeed(out)
				}
				if (failure !== undefined) return Effect.fail(failure)
				return Effect.flatMap(upstream, (rows) => {
					for (const row of rows) {
						failure = objects.feed(row, lineOf(row))
						if (failure !== undefined) break
					}
					return pull
				})
			})
			return pull
		}),
	)

/**
 * Decodes text chunks into values of a schema. Unlike `decodeString` piped
 * into `toObjects`, the objects are converted as the parser emits each row,
 * so their errors carry the input line even when lines were skipped.
 */
const decodeStringSchema = <S extends Schema.Constraint, IE, Done>(
	schema: S,
	options: (DecodeOptions & (ToObjectsOptions | { readonly columns: 'none' })) | undefined,
): Channel.Channel<
	Arr.NonEmptyReadonlyArray<S['Type']>,
	CsvError | Schema.SchemaError | IE,
	Done,
	Arr.NonEmptyReadonlyArray<string>,
	IE,
	Done,
	S['DecodingServices']
> => {
	const values: Channel.Channel<
		Arr.NonEmptyReadonlyArray<unknown>,
		CsvError | IE,
		Done,
		Arr.NonEmptyReadonlyArray<string>,
		IE,
		Done
	> = options?.columns === 'none'
		? decodeString(options)
		: parseWith(options, (emit) => Objects.make(options, emit).feed)
	return Channel.pipeTo(values, ChannelSchema.decodeUnknown(schema)<CsvError | IE, Done>())
}

/**
 * Creates a channel that decodes CSV text chunks into values of a schema.
 *
 * **Details**
 *
 * By default, rows are converted into objects as in `toObjects` and each
 * object is decoded with the schema. Use a schema whose encoded fields are
 * strings, such as a `Schema.Struct` of `Schema.String` and
 * `Schema.FiniteFromString`.
 *
 * With `columns: "none"`, each row is decoded as it is. That overload is
 * selected by a schema whose encoded type is an array of strings, such as a
 * `Schema.Tuple`, and requires the option.
 *
 * A `CsvError` carries the input line on which the failing record starts,
 * counting lines skipped by `comment` and `skipEmptyLines`. A value that does
 * not match the schema fails the channel with a `SchemaError`, and the other
 * values decoded from the same upstream chunk are not emitted.
 *
 * **Example** (Decoding rows into tuples)
 *
 * ```ts
 * import { Schema, Stream } from 'effect'
 * import { Csv } from 'effect-csv'
 *
 * const Point = Schema.Tuple([Schema.FiniteFromString, Schema.FiniteFromString])
 *
 * const points = Stream.make('1,2\n3,4\n').pipe(
 * 	Stream.pipeThroughChannel(Csv.decodeSchemaString(Point)({ columns: 'none' })),
 * 	Stream.runCollect,
 * )
 * // Effect<Array<readonly [number, number]>, Csv.CsvError | Schema.SchemaError> that succeeds with [[1, 2], [3, 4]]
 * ```
 *
 * @category decoding
 * @since 0.1.0
 */
export const decodeSchemaString: {
	<S extends Schema.Constraint & { readonly Encoded: Row }>(
		schema: S,
	): <IE = never, Done = unknown>(
		options: DecodeOptions & { readonly columns: 'none' },
	) => Channel.Channel<
		Arr.NonEmptyReadonlyArray<S['Type']>,
		CsvError | Schema.SchemaError | IE,
		Done,
		Arr.NonEmptyReadonlyArray<string>,
		IE,
		Done,
		S['DecodingServices']
	>
	<S extends Schema.Constraint>(
		schema: S,
	): <IE = never, Done = unknown>(
		options?: DecodeOptions & ToObjectsOptions,
	) => Channel.Channel<
		Arr.NonEmptyReadonlyArray<S['Type']>,
		CsvError | Schema.SchemaError | IE,
		Done,
		Arr.NonEmptyReadonlyArray<string>,
		IE,
		Done,
		S['DecodingServices']
	>
} =
	<S extends Schema.Constraint>(schema: S) =>
	<IE = never, Done = unknown>(
		options?: DecodeOptions & (ToObjectsOptions | { readonly columns: 'none' }),
	) =>
		decodeStringSchema<S, IE, Done>(schema, options)

/**
 * Creates a channel that decodes CSV bytes into values of a schema.
 *
 * **Details**
 *
 * Bytes are decoded as in `decode`, and rows are decoded with the schema as in
 * `decodeSchemaString`.
 *
 * **Example** (Decoding a byte stream into typed objects)
 *
 * ```ts
 * import { Schema, Stream } from 'effect'
 * import { Csv } from 'effect-csv'
 *
 * const Person = Schema.Struct({ name: Schema.String, age: Schema.FiniteFromString })
 *
 * const people = Stream.make(new TextEncoder().encode('name,age\nAda,36\n')).pipe(
 * 	Stream.pipeThroughChannel(Csv.decodeSchema(Person)()),
 * 	Stream.runCollect,
 * )
 * // Effect<Array<{ readonly name: string; readonly age: number }>, Csv.CsvError | Schema.SchemaError> that succeeds with [{ name: "Ada", age: 36 }]
 * ```
 *
 * @category decoding
 * @since 0.1.0
 */
export const decodeSchema: {
	<S extends Schema.Constraint & { readonly Encoded: Row }>(
		schema: S,
	): <IE = never, Done = unknown>(
		options: DecodeBytesOptions & { readonly columns: 'none' },
	) => Channel.Channel<
		Arr.NonEmptyReadonlyArray<S['Type']>,
		CsvError | Schema.SchemaError | IE,
		Done,
		Arr.NonEmptyReadonlyArray<Uint8Array>,
		IE,
		Done,
		S['DecodingServices']
	>
	<S extends Schema.Constraint>(
		schema: S,
	): <IE = never, Done = unknown>(
		options?: DecodeBytesOptions & ToObjectsOptions,
	) => Channel.Channel<
		Arr.NonEmptyReadonlyArray<S['Type']>,
		CsvError | Schema.SchemaError | IE,
		Done,
		Arr.NonEmptyReadonlyArray<Uint8Array>,
		IE,
		Done,
		S['DecodingServices']
	>
} =
	<S extends Schema.Constraint>(schema: S) =>
	<IE = never, Done = unknown>(
		options?: DecodeBytesOptions & (ToObjectsOptions | { readonly columns: 'none' }),
	) =>
		Channel.pipeTo(
			Channel.decodeText<IE, Done>(options?.encoding, { ignoreBOM: true }),
			decodeStringSchema<S, IE, Done>(schema, options),
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
			return undefined
		})
		const failure = parser.feed(input) ?? parser.end()
		return failure === undefined ? Effect.succeed(rows) : Effect.fail(failure)
	})

const textEncoder = new TextEncoder()

/**
 * Creates a channel that encodes rows as CSV text.
 *
 * **Details**
 *
 * Each upstream chunk of rows becomes one string, and every record ends with
 * `recordDelimiter`, including the last. Fields are quoted as described for
 * `quoteMode`, which makes the output decode to the same rows with the same
 * `delimiter`, `quote` and `escape`. A row without fields is written as a
 * blank line, which decodes as one empty field.
 *
 * With `bom`, U+FEFF starts the first output chunk. Without rows, the channel
 * emits nothing.
 *
 * **Example** (Encoding rows as CSV text)
 *
 * ```ts
 * import { Stream } from 'effect'
 * import { Csv } from 'effect-csv'
 *
 * const text = Stream.make(['name', 'note'], ['Ada', 'said "hi", twice']).pipe(
 * 	Stream.pipeThroughChannel(Csv.encodeString()),
 * 	Stream.mkString,
 * )
 * // Effect<string> that succeeds with 'name,note\r\nAda,"said ""hi"", twice"\r\n'
 * ```
 *
 * @category encoding
 * @since 0.1.0
 */
export const encodeString = <IE = never, Done = unknown>(
	options?: EncodeOptions,
): Channel.Channel<
	Arr.NonEmptyReadonlyArray<string>,
	IE,
	Done,
	Arr.NonEmptyReadonlyArray<Row>,
	IE,
	Done
> =>
	Channel.fromTransform((upstream, _scope) =>
		Effect.sync(() => {
			const encoder = Encoder.make(options)
			return Effect.map(upstream, (rows) => Arr.of(encoder.encode(rows)))
		}),
	)

/**
 * Creates a channel that encodes rows as UTF-8 CSV bytes.
 *
 * **Details**
 *
 * Rows are encoded as in `encodeString` and then with a `TextEncoder`. With
 * `bom`, the output starts with the bytes `EF BB BF`.
 *
 * @category encoding
 * @since 0.1.0
 */
export const encode = <IE = never, Done = unknown>(
	options?: EncodeOptions,
): Channel.Channel<
	Arr.NonEmptyReadonlyArray<Uint8Array>,
	IE,
	Done,
	Arr.NonEmptyReadonlyArray<Row>,
	IE,
	Done
> =>
	Channel.map(
		encodeString<IE, Done>(options),
		Arr.map((text) => textEncoder.encode(text)),
	)

const rowsFromValues = <In extends Readonly<Record<string, string>> | Row, IE, Done>(
	options: FromObjectsOptions | undefined,
): Channel.Channel<
	Arr.NonEmptyReadonlyArray<Row>,
	IE,
	Done,
	Arr.NonEmptyReadonlyArray<In>,
	IE,
	Done
> =>
	Channel.fromTransform((upstream, _scope) =>
		Effect.sync(() => {
			const converter = Objects.makeRows(options)
			let done = Option.none<Done>()

			const pull: Pull.Pull<Arr.NonEmptyReadonlyArray<Row>, IE, Done> = Effect.suspend(() => {
				if (Option.isSome(done)) return Cause.done(done.value)
				return Pull.matchEffect(upstream, {
					onSuccess: (values) => {
						const rows = converter.feed(values)
						return Arr.isArrayNonEmpty(rows) ? Effect.succeed(rows) : pull
					},
					onFailure: Effect.failCause,
					onDone: (leftover) => {
						done = Option.some(leftover)
						const header = converter.end()
						return header === undefined ? Cause.done(leftover) : Effect.succeed(Arr.of(header))
					},
				})
			})
			return pull
		}),
	)

/**
 * Creates a channel that converts objects into rows, after a header row by
 * default.
 *
 * **Details**
 *
 * Without `columns`, the keys of the first object name the columns. Each row
 * has one field per column, in column order: keys that an object lacks become
 * empty fields, as do `undefined` values, and keys that are not columns are
 * dropped. Only own properties are read.
 *
 * With `header: true` (the default), the header row is emitted before the
 * first row. With explicit `columns`, it is emitted even when there are no
 * objects, so that the output still names the columns.
 *
 * **Example** (Encoding objects as CSV text)
 *
 * ```ts
 * import { Stream } from 'effect'
 * import { Csv } from 'effect-csv'
 *
 * const text = Stream.make({ name: 'Ada', age: '36' }, { name: 'Alan', age: '41' }).pipe(
 * 	Stream.pipeThroughChannel(Csv.fromObjects()),
 * 	Stream.pipeThroughChannel(Csv.encodeString({ recordDelimiter: '\n' })),
 * 	Stream.mkString,
 * )
 * // Effect<string> that succeeds with 'name,age\nAda,36\nAlan,41\n'
 * ```
 *
 * @category encoding
 * @since 0.1.0
 */
export const fromObjects = <IE = never, Done = unknown>(
	options?: FromObjectsOptions,
): Channel.Channel<
	Arr.NonEmptyReadonlyArray<Row>,
	IE,
	Done,
	Arr.NonEmptyReadonlyArray<Readonly<Record<string, string>>>,
	IE,
	Done
> => rowsFromValues(options)

const encodeRowsSchema = <
	S extends Schema.Constraint & { readonly Encoded: Readonly<Record<string, string>> | Row },
	IE,
	Done,
>(
	schema: S,
	options: FromObjectsOptions | undefined,
): Channel.Channel<
	Arr.NonEmptyReadonlyArray<Row>,
	Schema.SchemaError | IE,
	Done,
	Arr.NonEmptyReadonlyArray<S['Type']>,
	IE,
	Done,
	S['EncodingServices']
> =>
	Channel.pipeTo(
		ChannelSchema.encode(schema)<IE, Done>(),
		rowsFromValues<S['Encoded'], Schema.SchemaError | IE, Done>(options),
	)

/**
 * Creates a channel that encodes values of a schema as CSV text.
 *
 * **Details**
 *
 * The overload is selected by the encoded type of the schema. When it is an
 * object of strings, such as that of a `Schema.Struct` of `Schema.String` and
 * `Schema.FiniteFromString`, each value is encoded with the schema and the
 * objects are converted into rows as in `fromObjects`. When it is an array of
 * strings, such as that of a `Schema.Tuple`, each encoded value is written as
 * a row. The rows are then encoded as in `encodeString`.
 *
 * Without `columns`, the keys of the first encoded object name the columns,
 * so pass `columns` when an optional key may be absent from it.
 *
 * A value that the schema cannot encode fails the channel with a
 * `SchemaError`, and the other values of the same upstream chunk are not
 * emitted.
 *
 * **Example** (Encoding typed objects as CSV text)
 *
 * ```ts
 * import { Schema, Stream } from 'effect'
 * import { Csv } from 'effect-csv'
 *
 * const Person = Schema.Struct({ name: Schema.String, age: Schema.FiniteFromString })
 *
 * const text = Stream.make({ name: 'Ada', age: 36 }).pipe(
 * 	Stream.pipeThroughChannel(Csv.encodeSchemaString(Person)()),
 * 	Stream.mkString,
 * )
 * // Effect<string, Schema.SchemaError> that succeeds with 'name,age\r\nAda,36\r\n'
 * ```
 *
 * @category encoding
 * @since 0.1.0
 */
export const encodeSchemaString: {
	<S extends Schema.Constraint & { readonly Encoded: Row }>(
		schema: S,
	): <IE = never, Done = unknown>(
		options?: EncodeOptions,
	) => Channel.Channel<
		Arr.NonEmptyReadonlyArray<string>,
		Schema.SchemaError | IE,
		Done,
		Arr.NonEmptyReadonlyArray<S['Type']>,
		IE,
		Done,
		S['EncodingServices']
	>
	<S extends Schema.Constraint & { readonly Encoded: Readonly<Record<string, string>> }>(
		schema: S,
	): <IE = never, Done = unknown>(
		options?: EncodeOptions & FromObjectsOptions,
	) => Channel.Channel<
		Arr.NonEmptyReadonlyArray<string>,
		Schema.SchemaError | IE,
		Done,
		Arr.NonEmptyReadonlyArray<S['Type']>,
		IE,
		Done,
		S['EncodingServices']
	>
} =
	<S extends Schema.Constraint & { readonly Encoded: Readonly<Record<string, string>> | Row }>(
		schema: S,
	) =>
	<IE = never, Done = unknown>(options?: EncodeOptions & FromObjectsOptions) =>
		Channel.pipeTo(
			encodeRowsSchema<S, IE, Done>(schema, options),
			encodeString<Schema.SchemaError | IE, Done>(options),
		)

/**
 * Creates a channel that encodes values of a schema as UTF-8 CSV bytes.
 *
 * **Details**
 *
 * Values are encoded as in `encodeSchemaString` and then with a
 * `TextEncoder`, as in `encode`.
 *
 * @category encoding
 * @since 0.1.0
 */
export const encodeSchema: {
	<S extends Schema.Constraint & { readonly Encoded: Row }>(
		schema: S,
	): <IE = never, Done = unknown>(
		options?: EncodeOptions,
	) => Channel.Channel<
		Arr.NonEmptyReadonlyArray<Uint8Array>,
		Schema.SchemaError | IE,
		Done,
		Arr.NonEmptyReadonlyArray<S['Type']>,
		IE,
		Done,
		S['EncodingServices']
	>
	<S extends Schema.Constraint & { readonly Encoded: Readonly<Record<string, string>> }>(
		schema: S,
	): <IE = never, Done = unknown>(
		options?: EncodeOptions & FromObjectsOptions,
	) => Channel.Channel<
		Arr.NonEmptyReadonlyArray<Uint8Array>,
		Schema.SchemaError | IE,
		Done,
		Arr.NonEmptyReadonlyArray<S['Type']>,
		IE,
		Done,
		S['EncodingServices']
	>
} =
	<S extends Schema.Constraint & { readonly Encoded: Readonly<Record<string, string>> | Row }>(
		schema: S,
	) =>
	<IE = never, Done = unknown>(options?: EncodeOptions & FromObjectsOptions) =>
		Channel.pipeTo(
			encodeRowsSchema<S, IE, Done>(schema, options),
			encode<Schema.SchemaError | IE, Done>(options),
		)

/**
 * Encodes rows as a CSV string.
 *
 * **Details**
 *
 * Gives the same text as `encodeString` given the same rows in any number of
 * chunks. Invalid options throw an `IllegalArgumentError`.
 *
 * **Example** (Writing TSV)
 *
 * ```ts
 * import { Csv } from 'effect-csv'
 *
 * const text = Csv.stringify(
 * 	[
 * 		['id', 'note'],
 * 		['1', 'tab\tinside'],
 * 	],
 * 	{ delimiter: '\t', recordDelimiter: '\n' },
 * )
 * // 'id\tnote\n1\t"tab\tinside"\n'
 * ```
 *
 * @category encoding
 * @since 0.1.0
 */
export const stringify = (rows: ReadonlyArray<Row>, options?: EncodeOptions): string =>
	Encoder.make(options).encode(rows)
