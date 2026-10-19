/**
 * Errors raised while decoding CSV.
 *
 * @since 0.1.0
 */
import { Data, Predicate } from 'effect'

const TypeId = '~effect-csv/Csv/CsvError'

/**
 * Error reason raised when the input ends inside a quoted field.
 *
 * @category errors
 * @since 0.1.0
 */
export class UnclosedQuote extends Data.TaggedError('UnclosedQuote')<{
	readonly line: number
}> {
	override get message() {
		return `Unclosed quote in the record starting on line ${this.line}`
	}
}

/**
 * Error reason raised when a quote appears where RFC 4180 does not allow one.
 *
 * **Details**
 *
 * That is either a character other than a delimiter or line break after a
 * closing quote, or a quote inside an unquoted field. `fieldIndex` is the
 * 0-based index of the field within its record.
 *
 * @category errors
 * @since 0.1.0
 */
export class InvalidQuote extends Data.TaggedError('InvalidQuote')<{
	readonly line: number
	readonly fieldIndex: number
}> {
	override get message() {
		return `Invalid quote in field ${this.fieldIndex} of the record starting on line ${this.line}`
	}
}

/**
 * Error reason raised when a record has a different number of fields than the
 * first record and `relaxColumnCount` is off.
 *
 * @category errors
 * @since 0.1.0
 */
export class FieldCountMismatch extends Data.TaggedError('FieldCountMismatch')<{
	readonly line: number
	readonly expected: number
	readonly actual: number
}> {
	override get message() {
		return `Expected ${this.expected} fields but found ${this.actual} in the record starting on line ${this.line}`
	}
}

/**
 * Error reason raised when a record grows beyond `maxRecordSize` UTF-16 code
 * units.
 *
 * @category errors
 * @since 0.1.0
 */
export class RecordTooLarge extends Data.TaggedError('RecordTooLarge')<{
	readonly line: number
	readonly maxRecordSize: number
}> {
	override get message() {
		return `The record starting on line ${this.line} exceeds the maximum size of ${this.maxRecordSize} UTF-16 code units`
	}
}

/**
 * Union of CSV decoding error reasons.
 *
 * @category errors
 * @since 0.1.0
 */
export type CsvErrorReason = UnclosedQuote | InvalidQuote | FieldCountMismatch | RecordTooLarge

/**
 * Error raised when CSV input is malformed.
 *
 * **Details**
 *
 * The `reason` identifies the problem. Every reason carries `line`, the
 * 1-based physical line on which the failing record starts, counting line
 * breaks inside quoted fields. Use `Effect.catchReason` or
 * `Stream.catchReason` to handle one reason.
 *
 * @category errors
 * @since 0.1.0
 */
export class CsvError extends Data.TaggedError('CsvError')<{
	readonly reason: CsvErrorReason
}> {
	/**
	 * Marks this value as a CSV error for runtime guards.
	 *
	 * @since 0.1.0
	 */
	readonly [TypeId] = TypeId

	/**
	 * Delegates the public message to the underlying reason.
	 *
	 * @since 0.1.0
	 */
	override get message() {
		return this.reason.message
	}
}

/**
 * Checks whether a value is a `CsvError`.
 *
 * @category guards
 * @since 0.1.0
 */
export const isCsvError = (u: unknown): u is CsvError => Predicate.hasProperty(u, TypeId)
