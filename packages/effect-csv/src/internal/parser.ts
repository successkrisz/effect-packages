import type { DecodeOptions, Row } from '../Csv.ts'
import {
	CsvError,
	type CsvErrorReason,
	FieldCountMismatch,
	InvalidQuote,
	RecordTooLarge,
	UnclosedQuote,
} from './errors.ts'
import { invalidOption, resolveDialect } from './options.ts'

/** @internal */
export const defaultMaxRecordSize = 10 * 1024 * 1024

/** @internal */
export interface Parser {
	readonly feed: (chunk: string) => CsvError | undefined
	readonly end: () => CsvError | undefined
}

/**
 * Receives each record with the line on which it starts. Returning an error
 * fails the parser with it.
 *
 * @internal
 */
export type OnRow = (row: Row, line: number) => CsvError | undefined

const CR = 13
const LF = 10
const BOM = 0xfeff

// The characters that `String.prototype.trim` removes.
const whitespace = /\s/

// Nothing of the current line has been seen yet.
const RecordStart = 0
// A field is about to start: either a delimiter just ended a field, so an empty field is pending, or no field of the
// line has been seen yet, apart from whitespace skipped by `trim`.
const FieldStart = 1
const Unquoted = 2
const Quoted = 3
// A quote inside a quoted field: either the closing quote or, with RFC 4180 doubling, the first half of an escaped quote.
const QuoteInQuoted = 4
// An escape character (other than the quote) inside a quoted field.
const EscapeInQuoted = 5
// Whitespace after the closing quote of a field, which `trim` skips.
const AfterQuoted = 6
// A `\r` ended a line, so a following `\n` belongs to the same line break.
const AfterCR = 7
// A line that starts with the comment character, up to its line break.
const Comment = 8

type State =
	| typeof RecordStart
	| typeof FieldStart
	| typeof Unquoted
	| typeof Quoted
	| typeof QuoteInQuoted
	| typeof EscapeInQuoted
	| typeof AfterQuoted
	| typeof AfterCR
	| typeof Comment

const resolveOptions = (options: DecodeOptions | undefined) => {
	const { delimiter, quote, escapeChar, comment } = resolveDialect(options, true)
	const maxRecordSize = options?.maxRecordSize ?? defaultMaxRecordSize
	if (
		!(Number.isInteger(maxRecordSize) && maxRecordSize > 0) &&
		maxRecordSize !== Number.POSITIVE_INFINITY
	) {
		invalidOption('`maxRecordSize` must be a positive integer or Infinity')
	}
	return {
		delimiter,
		quote,
		escapeChar,
		comment,
		maxRecordSize,
		relaxColumnCount: options?.relaxColumnCount ?? false,
		trim: options?.trim ?? false,
		skipEmptyLines: options?.skipEmptyLines ?? false,
		relaxQuotes: options?.relaxQuotes ?? false,
	}
}

/**
 * Creates a CSV parser that calls `onRow` for each complete record.
 *
 * `feed` and `end` return the `CsvError` for malformed input, or the error
 * returned by `onRow`, instead of throwing; after an error, both keep
 * returning it. Invalid options throw an `IllegalArgumentError` here, which
 * callers run inside an Effect so that it surfaces as a defect.
 *
 * @internal
 */
export const make = (options: DecodeOptions | undefined, onRow: OnRow): Parser => {
	const {
		delimiter,
		quote,
		escapeChar,
		comment,
		maxRecordSize,
		relaxColumnCount,
		trim,
		skipEmptyLines,
		relaxQuotes,
	} = resolveOptions(options)
	const quoting = quote !== null
	const delimiterCode = delimiter.charCodeAt(0)
	const quoteCode = quoting ? quote.charCodeAt(0) : -1
	const escapeCode = quoting ? escapeChar.charCodeAt(0) : -1
	const commentCode = comment === undefined ? -1 : comment.charCodeAt(0)
	const escapeIsQuote = escapeCode === quoteCode
	// Whether a quote ends the text of an unquoted field, to fail with `InvalidQuote`.
	const quoteEndsUnquoted = quoting && !relaxQuotes

	let state: State = RecordStart
	let atStreamStart = true
	let previousChunkEndsWithCR = false
	let line = 1
	let recordLine = 1
	// Code units of the current record consumed by earlier chunks.
	let recordSize = 0
	let fields: Array<string> = []
	// Pieces of the current field: spans from earlier chunks, or split around escapes.
	let parts: Array<string> = []
	let expectedFields = -1
	let failure: CsvError | undefined

	const fail = (reason: CsvErrorReason): CsvError => {
		failure = new CsvError({ reason })
		return failure
	}

	const takeParts = (): string => {
		const field = parts.length === 1 ? parts[0] : parts.join('')
		parts = []
		return field
	}

	// The delimiter and the quote keep their meaning with `trim`, even when they are whitespace.
	const isTrimmable = (code: number, char: string): boolean =>
		code !== delimiterCode && code !== quoteCode && whitespace.test(char)

	// Leading whitespace never reaches an unquoted field, because `FieldStart` skips it.
	const unquotedField = (field: string): string => {
		if (!trim) return field
		let end = field.length
		while (end > 0 && isTrimmable(field.charCodeAt(end - 1), field.charAt(end - 1))) end--
		return end === field.length ? field : field.slice(0, end)
	}

	const endRecord = (): CsvError | undefined => {
		const record = fields
		fields = []
		if (expectedFields === -1) {
			expectedFields = record.length
		} else if (!relaxColumnCount && record.length !== expectedFields) {
			return fail(
				new FieldCountMismatch({
					line: recordLine,
					expected: expectedFields,
					actual: record.length,
				}),
			)
		}
		failure = onRow(record, recordLine)
		return failure
	}

	const feed = (chunk: string): CsvError | undefined => {
		if (failure !== undefined) return failure
		const length = chunk.length
		if (length === 0) return undefined

		let i = 0
		if (atStreamStart) {
			atStreamStart = false
			if (chunk.charCodeAt(0) === BOM) i = 1
		}

		const find = (s: string, from: number): number => {
			const index = chunk.indexOf(s, from)
			return index === -1 ? length : index
		}
		// Next position of each special character at or after the last lookup, or `length` when there is none.
		// A position below `i` is stale and is looked up again; this keeps scanning linear.
		let nextDelimiter = -1
		let nextQuote = quoting ? -1 : length
		let nextEscape = escapeIsQuote ? length : -1
		let nextCR = -1
		let nextLF = -1

		// Index of the current record's first code unit; negative when the record started in an earlier chunk.
		let recordStart = -recordSize
		// Index of the first code unit that does not fit in the current record.
		let limit = recordStart + maxRecordSize
		let segmentStart = i

		const tooLarge = () => fail(new RecordTooLarge({ line: recordLine, maxRecordSize }))

		const endLine = (code: number) => {
			line++
			state = code === CR ? AfterCR : RecordStart
		}

		const endRecordAt = (code: number): CsvError | undefined => {
			const error = endRecord()
			endLine(code)
			return error
		}

		while (i < length) {
			switch (state) {
				case AfterCR: {
					state = RecordStart
					if (chunk.charCodeAt(i) === LF) i++
					break
				}
				case RecordStart: {
					recordStart = i
					limit = i + maxRecordSize
					recordLine = line
					state = FieldStart
					break
				}
				case FieldStart: {
					const code = chunk.charCodeAt(i)
					// No field before this one, so the line is empty so far, or holds only whitespace that `trim` skipped.
					const lineStart = fields.length === 0
					if (code === CR || code === LF) {
						if (lineStart && skipEmptyLines) {
							i++
							endLine(code)
						} else {
							// Whitespace that `trim` skipped is checked here, once the line turns out to be a record.
							if (i > limit) return tooLarge()
							fields.push('')
							i++
							const error = endRecordAt(code)
							if (error !== undefined) return error
						}
					} else if (lineStart && code === commentCode) {
						state = Comment
						i++
					} else if (trim && isTrimmable(code, chunk.charAt(i))) {
						i++
					} else if (i >= limit) {
						return tooLarge()
					} else if (code === delimiterCode) {
						fields.push('')
						i++
					} else if (code === quoteCode) {
						state = Quoted
						i++
						segmentStart = i
					} else {
						state = Unquoted
						segmentStart = i
					}
					break
				}
				case Unquoted: {
					if (nextDelimiter < i) nextDelimiter = find(delimiter, i)
					if (nextCR < i) nextCR = find('\r', i)
					if (nextLF < i) nextLF = find('\n', i)
					if (quoteEndsUnquoted && nextQuote < i) nextQuote = find(quote ?? '', i)
					const end = Math.min(
						nextDelimiter,
						nextCR,
						nextLF,
						quoteEndsUnquoted ? nextQuote : length,
					)
					const code = end === length ? -1 : chunk.charCodeAt(end)
					const isLineBreak = code === CR || code === LF
					// A line break ends the record, so it is the only special character that is not content.
					const contentEnd = end === length || isLineBreak ? end : end + 1
					if (contentEnd > limit) return tooLarge()
					if (end === length) {
						i = length
						break
					}
					if (code === quoteCode) {
						return fail(new InvalidQuote({ line: recordLine, fieldIndex: fields.length }))
					}
					const span = chunk.slice(segmentStart, end)
					if (parts.length === 0) {
						fields.push(unquotedField(span))
					} else {
						parts.push(span)
						fields.push(unquotedField(takeParts()))
					}
					i = end + 1
					if (isLineBreak) {
						const error = endRecordAt(code)
						if (error !== undefined) return error
					} else {
						state = FieldStart
					}
					break
				}
				case Quoted: {
					if (nextQuote < i) nextQuote = find(quote ?? '', i)
					if (nextEscape < i) nextEscape = find(escapeChar, i)
					const end = Math.min(nextQuote, nextEscape)
					for (let from = i; ; ) {
						if (nextCR < from) nextCR = find('\r', from)
						if (nextLF < from) nextLF = find('\n', from)
						const lineBreak = Math.min(nextCR, nextLF)
						if (lineBreak >= end) break
						const isCRLF =
							lineBreak === nextLF &&
							(lineBreak === 0 ? previousChunkEndsWithCR : chunk.charCodeAt(lineBreak - 1) === CR)
						if (!isCRLF) line++
						from = lineBreak + 1
					}
					if ((end === length ? end : end + 1) > limit) return tooLarge()
					if (end === length) {
						i = length
						break
					}
					if (segmentStart < end) parts.push(chunk.slice(segmentStart, end))
					state = chunk.charCodeAt(end) === quoteCode ? QuoteInQuoted : EscapeInQuoted
					i = end + 1
					break
				}
				case QuoteInQuoted:
				case AfterQuoted: {
					const code = chunk.charCodeAt(i)
					if (code === CR || code === LF) {
						fields.push(takeParts())
						i++
						const error = endRecordAt(code)
						if (error !== undefined) return error
					} else if (i >= limit) {
						return tooLarge()
					} else if (state === QuoteInQuoted && code === quoteCode && escapeIsQuote) {
						state = Quoted
						segmentStart = i
						i++
					} else if (code === delimiterCode) {
						fields.push(takeParts())
						state = FieldStart
						i++
					} else if (trim && isTrimmable(code, chunk.charAt(i))) {
						state = AfterQuoted
						i++
					} else {
						return fail(new InvalidQuote({ line: recordLine, fieldIndex: fields.length }))
					}
					break
				}
				case EscapeInQuoted: {
					if (i >= limit) return tooLarge()
					const code = chunk.charCodeAt(i)
					state = Quoted
					segmentStart = i
					if (code === quoteCode || code === escapeCode) {
						i++
					} else {
						parts.push(escapeChar)
					}
					break
				}
				case Comment: {
					if (nextCR < i) nextCR = find('\r', i)
					if (nextLF < i) nextLF = find('\n', i)
					const end = Math.min(nextCR, nextLF)
					if (end === length) {
						i = length
					} else {
						i = end + 1
						endLine(chunk.charCodeAt(end))
					}
					break
				}
			}
		}

		// The field continues in the next chunk. Escapes can leave a segment pending even when no span was scanned.
		if ((state === Unquoted || state === Quoted) && segmentStart < length) {
			parts.push(chunk.slice(segmentStart, length))
		}
		recordSize =
			state === RecordStart || state === AfterCR || state === Comment ? 0 : length - recordStart
		previousChunkEndsWithCR = chunk.charCodeAt(length - 1) === CR
		return undefined
	}

	const end = (): CsvError | undefined => {
		if (failure !== undefined) return failure
		const last = state
		state = RecordStart
		switch (last) {
			case RecordStart:
			case AfterCR:
			case Comment:
				return undefined
			case Quoted:
			case EscapeInQuoted:
				return fail(new UnclosedQuote({ line: recordLine }))
			case FieldStart:
				if (fields.length === 0 && skipEmptyLines) return undefined
				// Whitespace that `trim` skipped at the end of the input has not been checked yet.
				if (recordSize > maxRecordSize) {
					return fail(new RecordTooLarge({ line: recordLine, maxRecordSize }))
				}
				fields.push('')
				break
			case Unquoted:
				fields.push(unquotedField(takeParts()))
				break
			case QuoteInQuoted:
			case AfterQuoted:
				fields.push(takeParts())
				break
		}
		return endRecord()
	}

	return { feed, end }
}
