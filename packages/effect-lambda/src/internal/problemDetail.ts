import { type Schema, SchemaIssue } from 'effect'
import { type HttpStatusCode, httpStatusMessages } from './http-status-codes.ts'

export const problemJsonContentType = 'application/problem+json'
export const validationProblemDetail = 'The request did not match the expected schema'
export const unexpectedErrorDetail = 'An unexpected error occurred'

export type ProblemBodyOptions = {
	readonly type?: string | undefined
	readonly title?: string | undefined
	readonly detail?: string | undefined
	readonly instance?: string | undefined
	readonly extensions?: Readonly<Record<string, unknown>> | undefined
}

/** Must stay in shape parity with `@ballatech/effect-problem-json` (covered by a parity test). */
export const makeProblemBody = (status: HttpStatusCode, options?: ProblemBodyOptions) => ({
	...options?.extensions,
	type: options?.type ?? 'about:blank',
	title: options?.title ?? httpStatusMessages[status],
	status,
	detail: options?.detail,
	instance: options?.instance,
})

const standardSchemaV1Formatter = SchemaIssue.makeFormatterStandardSchemaV1()

export const formatSchemaIssues = (
	error: Schema.SchemaError,
): Array<{ readonly detail: string; readonly pointer?: string }> =>
	standardSchemaV1Formatter(error.issue).issues.map(({ path, message }) =>
		path !== undefined && path.length > 0
			? { detail: message, pointer: `#/${path.join('/')}` }
			: { detail: message },
	)

export const makeInternalServerErrorResponse = () => ({
	statusCode: 500,
	body: JSON.stringify(makeProblemBody(500, { detail: unexpectedErrorDetail })),
	headers: { 'content-type': problemJsonContentType },
})
