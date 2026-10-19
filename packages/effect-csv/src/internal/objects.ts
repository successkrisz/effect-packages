import { Array as Arr } from 'effect'
import type { FromObjectsOptions, Row, ToObjectsOptions } from '../Csv.ts'
import { CsvError, type CsvErrorReason, FieldCountMismatch, InvalidHeader } from './errors.ts'
import { invalidOption } from './options.ts'

/** @internal */
export type CsvRecord = Readonly<Record<string, string>>

/** @internal */
export interface Objects {
	/** Converts a row that starts on `line`. */
	readonly feed: (row: Row, line: number) => CsvError | undefined
}

const CR = 13

interface InvalidName {
	readonly fieldIndex: number
	readonly problem: InvalidHeader['problem']
}

const findInvalidName = (names: ReadonlyArray<string>): InvalidName | undefined => {
	const seen = new Set<string>()
	for (const [fieldIndex, name] of names.entries()) {
		if (name === '') return { fieldIndex, problem: 'Empty' }
		if (seen.has(name)) return { fieldIndex, problem: 'Duplicate' }
		seen.add(name)
	}
	return undefined
}

/** Validates and copies explicit column names; `expected` describes the valid values of `columns`. */
const validateColumns = (
	columns: ReadonlyArray<string>,
	expected: string,
): ReadonlyArray<string> => {
	if (!Array.isArray(columns) || columns.length === 0) {
		invalidOption(`\`columns\` must be ${expected}`)
	}
	const invalid = findInvalidName(columns)
	if (invalid?.problem === 'Empty') {
		invalidOption('`columns` must not contain an empty name')
	}
	if (invalid?.problem === 'Duplicate') {
		invalidOption(`\`columns\` must not repeat the name "${columns[invalid.fieldIndex]}"`)
	}
	return [...columns]
}

const resolveColumns = (columns: ToObjectsOptions['columns']): ReadonlyArray<string> | undefined =>
	columns === undefined || columns === 'header'
		? undefined
		: validateColumns(columns, '"header" or a non-empty array of names')

/** Counts the line breaks inside a row's fields, counting `\r\n` once, as the parser does. */
const lineBreaks = (row: Row): number => {
	let count = 0
	for (const field of row) {
		for (let i = field.indexOf('\r'); i !== -1; i = field.indexOf('\r', i + 1)) count++
		for (let i = field.indexOf('\n'); i !== -1; i = field.indexOf('\n', i + 1)) {
			if (i === 0 || field.charCodeAt(i - 1) !== CR) count++
		}
	}
	return count
}

/**
 * Creates a function that returns the line on which each successive row
 * starts, for rows that carry no line numbers.
 *
 * Lines are counted from the first row: one per row, plus the line breaks
 * inside its fields. That is the input line when no lines were skipped
 * before the rows were decoded.
 *
 * @internal
 */
export const makeLineCounter = (): ((row: Row) => number) => {
	let line = 1
	return (row) => {
		const rowLine = line
		line += 1 + lineBreaks(row)
		return rowLine
	}
}

const toRecord = (names: ReadonlyArray<string>, row: Row, length: number): CsvRecord => {
	const record: Record<string, string> = {}
	for (let i = 0; i < length; i++) {
		const name = names[i]
		if (name === '__proto__') {
			// Assigning `__proto__` would call the inherited setter instead of creating a property.
			Object.defineProperty(record, name, {
				value: row[i],
				enumerable: true,
				writable: true,
				configurable: true,
			})
		} else {
			record[name] = row[i]
		}
	}
	return record
}

/**
 * Creates a converter that calls `onRecord` with an object for each row.
 *
 * `feed` returns the `CsvError` for an invalid header or a row with the wrong
 * number of fields instead of throwing; after an error, it keeps returning it.
 * Invalid options throw an `IllegalArgumentError` here, which callers run
 * inside an Effect so that it surfaces as a defect.
 *
 * @internal
 */
export const make = (
	options: ToObjectsOptions | undefined,
	onRecord: (record: CsvRecord) => void,
): Objects => {
	const relaxColumnCount = options?.relaxColumnCount ?? false
	let names = resolveColumns(options?.columns)
	let failure: CsvError | undefined

	const fail = (reason: CsvErrorReason): CsvError => {
		failure = new CsvError({ reason })
		return failure
	}

	const feed = (row: Row, line: number): CsvError | undefined => {
		if (failure !== undefined) return failure
		if (names === undefined) {
			const invalid = findInvalidName(row)
			if (invalid !== undefined) {
				return fail(new InvalidHeader({ line, name: row[invalid.fieldIndex], ...invalid }))
			}
			names = row
			return undefined
		}
		if (row.length !== names.length && !relaxColumnCount) {
			return fail(new FieldCountMismatch({ line, expected: names.length, actual: row.length }))
		}
		onRecord(toRecord(names, row, Math.min(row.length, names.length)))
		return undefined
	}

	return { feed }
}

/** @internal */
export interface Rows {
	/** Converts values into rows, preceded by the header row before the first value. */
	readonly feed: (values: ReadonlyArray<CsvRecord | Row>) => Array<Row>
	/** Returns the header row if no value arrived but the columns are known. */
	readonly end: () => Row | undefined
}

const toRow = (names: ReadonlyArray<string>, record: CsvRecord): Row =>
	// Only own properties count, so a `toString` or `__proto__` column is not read from the prototype.
	names.map((name) => (Object.hasOwn(record, name) ? (record[name] ?? '') : ''))

/**
 * Creates a converter from objects into rows for `fromObjects`.
 *
 * Without explicit columns, the keys of the first object name the columns.
 * Arrays pass through as rows, so that one converter serves schemas whose
 * encoded type is either an object or a row. Invalid options throw an
 * `IllegalArgumentError` here, which callers run inside an Effect so that it
 * surfaces as a defect.
 *
 * @internal
 */
export const makeRows = (options: FromObjectsOptions | undefined): Rows => {
	let names =
		options?.columns === undefined
			? undefined
			: validateColumns(options.columns, 'a non-empty array of names')
	let headerPending = options?.header ?? true

	const takeHeader = (): Row | undefined => {
		if (!headerPending) return undefined
		headerPending = false
		// A copy, so that changing the emitted row cannot change the columns of later rows.
		return names === undefined ? undefined : [...names]
	}

	const rowOf = (value: CsvRecord | Row): Row => {
		if (Arr.isArray<CsvRecord | Row>(value)) return value
		names ??= Object.keys(value)
		return toRow(names, value)
	}

	const feed = (values: ReadonlyArray<CsvRecord | Row>): Array<Row> => {
		const rows: Array<Row> = []
		for (const value of values) {
			const row = rowOf(value)
			const header = takeHeader()
			if (header !== undefined) rows.push(header)
			rows.push(row)
		}
		return rows
	}

	return { feed, end: takeHeader }
}
