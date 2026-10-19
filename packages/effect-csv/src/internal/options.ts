import { Cause, Predicate } from 'effect'

/** @internal */
export interface Dialect {
	readonly delimiter: string
	readonly quote: string | null
	/** The escape character, or `""` when `quote` is `null`. */
	readonly escapeChar: string
}

/** @internal */
export const invalidOption: (message: string) => never = (message) => {
	throw new Cause.IllegalArgumentError(`Invalid CSV options: ${message}`)
}

const isFieldCharacter = (u: unknown): u is string =>
	Predicate.isString(u) && u.length === 1 && u !== '\r' && u !== '\n'

interface DialectOptions {
	readonly delimiter?: string | undefined
	readonly quote?: string | null | undefined
	readonly escape?: string | undefined
}

/**
 * Resolves and validates `delimiter`, `quote` and `escape`, which decoding and
 * encoding share. Only decoding accepts a `null` quote.
 *
 * @internal
 */
export function resolveDialect(options: DialectOptions | undefined, nullableQuote: true): Dialect
export function resolveDialect(
	options: DialectOptions | undefined,
	nullableQuote: false,
): Dialect & { readonly quote: string }
export function resolveDialect(
	options: DialectOptions | undefined,
	nullableQuote: boolean,
): Dialect {
	const delimiter = options?.delimiter ?? ','
	const quote = options?.quote === undefined ? '"' : options.quote
	const escapeChar = options?.escape ?? quote ?? ''
	if (!isFieldCharacter(delimiter)) {
		invalidOption('`delimiter` must be one UTF-16 code unit other than "\\r" and "\\n"')
	}
	if (quote === null && nullableQuote) return { delimiter, quote, escapeChar }
	if (!isFieldCharacter(quote)) {
		invalidOption(
			`\`quote\` must be ${nullableQuote ? 'null or ' : ''}one UTF-16 code unit other than "\\r" and "\\n"`,
		)
	}
	if (quote === delimiter) {
		invalidOption('`quote` must differ from `delimiter`')
	}
	if (!isFieldCharacter(escapeChar)) {
		invalidOption('`escape` must be one UTF-16 code unit other than "\\r" and "\\n"')
	}
	if (escapeChar === delimiter) {
		invalidOption('`escape` must differ from `delimiter`')
	}
	return { delimiter, quote, escapeChar }
}
