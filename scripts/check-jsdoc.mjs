#!/usr/bin/env node
// Enforces Effect-style JSDoc on the public API of every package:
// - each public module starts with a JSDoc block carrying `@since`
// - each exported declaration carries `@since` and `@category`
// - each re-export specifier / `export * as` carries `@since`
// Declarations tagged `@internal` are skipped.
// Public modules are the `./src/*.ts` targets of each package's `exports` map; local
// `export *` and named re-exports are followed so re-exported declarations are checked too.
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { SyntaxKind } from 'typescript/unstable/ast'
import {
	isExportDeclaration,
	isNamedExports,
	isStringLiteral,
	isVariableStatement,
} from 'typescript/unstable/ast/is'
import { API } from 'typescript/unstable/sync'

const root = resolve(import.meta.dirname, '..')
const packagesDir = join(root, 'packages')

const declarationKinds = new Set([
	SyntaxKind.VariableStatement,
	SyntaxKind.FunctionDeclaration,
	SyntaxKind.ClassDeclaration,
	SyntaxKind.TypeAliasDeclaration,
	SyntaxKind.InterfaceDeclaration,
	SyntaxKind.EnumDeclaration,
	SyntaxKind.ModuleDeclaration,
])

const hasExportModifier = (node) =>
	node.modifiers?.some((modifier) => modifier.kind === SyntaxKind.ExportKeyword) ?? false

const jsDocText = (node, text) =>
	(node.jsDoc ?? []).map((doc) => text.slice(doc.pos, doc.end)).join('\n')

const declarationName = (node) => {
	if (isVariableStatement(node)) {
		return node.declarationList.declarations.map((declaration) => declaration.name.text).join(', ')
	}
	return node.name?.text ?? '<anonymous>'
}

const lineOf = (text, pos) => text.slice(0, pos).split('\n').length

const resolveLocal = (fromFile, specifier) => {
	if (!specifier.startsWith('.')) return undefined
	const target = resolve(dirname(fromFile), specifier)
	for (const candidate of [target, `${target}.ts`, target.replace(/\.js$/, '.ts')]) {
		if (candidate.endsWith('.ts') && existsSync(candidate)) return candidate
	}
	return undefined
}

const publicEntrypoints = (packageDir) => {
	const { exports = {} } = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8'))
	return Object.values(exports)
		.map((target) => (typeof target === 'string' ? target : (target?.import ?? target?.default)))
		.filter((target) => typeof target === 'string' && target.startsWith('./src/'))
		.map((target) => join(packageDir, target))
}

const problems = []
const report = (file, text, pos, message) =>
	problems.push(`${file.slice(root.length + 1)}:${lineOf(text, pos)} ${message}`)

const checkPackage = (api, packageDir) => {
	const configFile = join(packageDir, 'tsconfig.json')
	const snapshot = api.updateSnapshot({ openProjects: [configFile] })
	const program = snapshot.getProject(configFile).program

	const visitedModules = new Set()
	const checkedNames = new Set()

	const sourceOf = (fileName) => {
		const sourceFile = program.getSourceFile(fileName)
		if (sourceFile === undefined) throw new Error(`${fileName} is not part of ${configFile}`)
		return sourceFile
	}

	const checkDeclarations = (fileName, names, { exportedOnly = true } = {}) => {
		const sourceFile = sourceOf(fileName)
		const { text } = sourceFile
		for (const statement of sourceFile.statements) {
			if (!declarationKinds.has(statement.kind)) continue
			if (exportedOnly && !hasExportModifier(statement)) continue
			const name = declarationName(statement)
			if (names !== undefined && !names.has(name)) continue
			const key = `${fileName}#${name}`
			if (checkedNames.has(key)) continue
			const doc = jsDocText(statement, text)
			if (/@internal\b/.test(doc)) continue
			// Overload signatures share one doc block; only the first declaration must carry it.
			if (
				statement.kind === SyntaxKind.FunctionDeclaration &&
				statement.body === undefined &&
				doc === ''
			) {
				continue
			}
			checkedNames.add(key)
			if (!/@since\s+\d/.test(doc)) report(fileName, text, statement.pos, `${name}: missing @since`)
			if (!/@category\s+\S/.test(doc))
				report(fileName, text, statement.pos, `${name}: missing @category`)
		}
	}

	const checkModule = (fileName) => {
		if (visitedModules.has(fileName)) return
		visitedModules.add(fileName)
		const sourceFile = sourceOf(fileName)
		const { text } = sourceFile

		if (!/^\s*\/\*\*[\s\S]*?@since\s+\d[\s\S]*?\*\//.test(text.replace(/^#!.*\n/, ''))) {
			report(fileName, text, 0, 'missing module-level JSDoc with @since')
		}

		checkDeclarations(fileName, undefined)

		for (const statement of sourceFile.statements) {
			if (!isExportDeclaration(statement)) continue
			const specifier =
				statement.moduleSpecifier && isStringLiteral(statement.moduleSpecifier)
					? statement.moduleSpecifier.text
					: undefined
			const target = specifier === undefined ? fileName : resolveLocal(fileName, specifier)
			const clause = statement.exportClause

			if (clause === undefined || clause.kind === SyntaxKind.NamespaceExport) {
				if (!/@since\s+\d/.test(jsDocText(statement, text))) {
					report(fileName, text, statement.pos, `export * from '${specifier}': missing @since`)
				}
				if (target !== undefined) checkModule(target)
				continue
			}

			if (!isNamedExports(clause)) continue
			const localNames = new Set()
			for (const element of clause.elements) {
				localNames.add((element.propertyName ?? element.name).text)
				// `export { a, b }` without a module specifier: the docs live on the local declarations.
				if (target === fileName) continue
				const exported = element.name.text
				const doc = jsDocText(element, text)
				if (/@internal\b/.test(doc)) continue
				if (!/@since\s+\d/.test(doc))
					report(fileName, text, element.pos, `${exported}: missing @since`)
				if (target === undefined && !/@category\s+\S/.test(doc)) {
					report(fileName, text, element.pos, `${exported}: missing @category`)
				}
			}
			if (target === fileName) checkDeclarations(fileName, localNames, { exportedOnly: false })
			else if (target !== undefined) checkDeclarations(target, localNames)
		}
	}

	for (const entrypoint of publicEntrypoints(packageDir)) checkModule(entrypoint)
}

const api = new API({ cwd: root })
try {
	for (const entry of readdirSync(packagesDir, { withFileTypes: true })) {
		const packageDir = join(packagesDir, entry.name)
		if (entry.isDirectory() && existsSync(join(packageDir, 'package.json')))
			checkPackage(api, packageDir)
	}
} finally {
	api.close()
}

if (problems.length > 0) {
	console.error(
		`JSDoc check failed (${problems.length}):\n${problems.map((p) => `  ${p}`).join('\n')}`,
	)
	process.exit(1)
}
console.log('JSDoc check passed')
