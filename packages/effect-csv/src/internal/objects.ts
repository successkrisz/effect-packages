import { Cause } from 'effect'
import type { Row, ToObjectsOptions } from '../Csv.ts'
import { CsvError, type CsvErrorReason, FieldCountMismatch, InvalidHeader } from './errors.ts'

/** @internal */
export type CsvRecord = Readonly<Record<string, string>>

/** @internal */
export interface Objects {
	readonly feed: (row: Row) => CsvError | undefined
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

const invalidOption = (message: string): never => {
	throw new Cause.IllegalArgumentError(`Invalid CSV options: ${message}`)
}

const resolveColumns = (
	columns: ToObjectsOptions['columns'],
): ReadonlyArray<string> | undefined => {
	if (columns === undefined || columns === 'header') return undefined
	if (!Array.isArray(columns) || columns.length === 0) {
		invalidOption('`columns` must be "header" or a non-empty array of names')
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
 * Rows carry no line numbers, so the line of each row is counted from the
 * first row, including the line breaks inside its fields.
 *
 * @internal
 */
export const make = (
	options: ToObjectsOptions | undefined,
	onRecord: (record: CsvRecord) => void,
): Objects => {
	const relaxColumnCount = options?.relaxColumnCount ?? false
	let names = resolveColumns(options?.columns)
	let line = 1
	let failure: CsvError | undefined

	const fail = (reason: CsvErrorReason): CsvError => {
		failure = new CsvError({ reason })
		return failure
	}

	const feed = (row: Row): CsvError | undefined => {
		if (failure !== undefined) return failure
		const rowLine = line
		// With `relaxColumnCount`, only the header can fail, and it is always the first row.
		if (!relaxColumnCount) line += 1 + lineBreaks(row)
		if (names === undefined) {
			const invalid = findInvalidName(row)
			if (invalid !== undefined) {
				return fail(new InvalidHeader({ line: rowLine, name: row[invalid.fieldIndex], ...invalid }))
			}
			names = row
			return undefined
		}
		if (row.length !== names.length && !relaxColumnCount) {
			return fail(
				new FieldCountMismatch({ line: rowLine, expected: names.length, actual: row.length }),
			)
		}
		onRecord(toRecord(names, row, Math.min(row.length, names.length)))
		return undefined
	}

	return { feed }
}
