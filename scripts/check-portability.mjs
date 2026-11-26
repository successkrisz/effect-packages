#!/usr/bin/env node
// Packs every package and checks the consumer fixture against the tarballs in
// an isolated pnpm install. It runs both fixture entry points and emits declarations
// to catch:
// - inferred types that need a reference to a transitive dependency (TS2742 / TS2883)
// - published `.d.ts` files importing modules a consumer cannot resolve (TS2307), which
//   `skipLibCheck` would otherwise hide by silently degrading the consumer's types to `any`
// - any `any` leaking into the consumer's emitted declarations
// Set EFFECT_VERSION to test a specific version or range instead of the workspace
// catalog. Set KEEP_FIXTURE=1 to keep the temporary project for inspection.
import { execFileSync } from 'node:child_process'
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const packDir = join(root, '.pack')
const run = (command, args, cwd) => execFileSync(command, args, { cwd, stdio: 'inherit' })

const { packageManager } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const workspace = readFileSync(join(root, 'pnpm-workspace.yaml'), 'utf8')
const catalogVersion = (name) => {
	const version = workspace.match(
		new RegExp(`^\\s+'?${name.replace('/', '\\/')}'?: (.+)$`, 'm'),
	)?.[1]
	if (version === undefined)
		throw new Error(`Could not find ${name} in the pnpm-workspace.yaml catalog`)
	return version
}

const effectVersion = process.env.EFFECT_VERSION || catalogVersion('effect')

run('pnpm', ['run', 'pack:check'], root)

const tarballs = Object.fromEntries(
	readdirSync(packDir)
		.filter((file) => file.endsWith('.tgz'))
		.map((file) => {
			const manifest = execFileSync('tar', ['-xOzf', join(packDir, file), 'package/package.json'], {
				encoding: 'utf8',
			})
			return [JSON.parse(manifest).name, `file:${join(packDir, file)}`]
		}),
)

const workDir = mkdtempSync(join(tmpdir(), 'effect-packages-portability-'))
try {
	// The checked-in package.json links workspace packages so the editor can resolve
	// imports. This check replaces it with the packed tarballs, and must not copy a
	// local install or declaration emit.
	const fixtureDir = join(root, 'fixtures/portability')
	cpSync(fixtureDir, workDir, {
		recursive: true,
		filter: (src) => {
			const relative = src.slice(fixtureDir.length)
			return !/(^|[/\\])(node_modules|dist)([/\\]|$)/.test(relative)
		},
	})
	writeFileSync(
		join(workDir, 'package.json'),
		JSON.stringify({
			name: 'portability-fixture',
			private: true,
			type: 'module',
			packageManager,
			dependencies: {
				...tarballs,
				effect: effectVersion,
				'@types/node': catalogVersion('@types/node'),
			},
		}),
	)
	writeFileSync(join(workDir, 'pnpm-workspace.yaml'), 'minimumReleaseAgeExclude:\n  - effect\n')
	run('pnpm', ['install', '--strict-peer-dependencies', '--config.node-linker=isolated'], workDir)
	const installedEffect = JSON.parse(
		readFileSync(join(workDir, 'node_modules/effect/package.json'), 'utf8'),
	).version
	console.log(`Checking packed packages with Effect ${installedEffect}`)
	run(process.execPath, ['src/root.ts'], workDir)
	run(process.execPath, ['src/subpath.ts'], workDir)
	run(join(root, 'node_modules/.bin/tsc'), ['-p', 'tsconfig.json'], workDir)

	const leaks = readdirSync(join(workDir, 'dist'))
		.filter((file) => file.endsWith('.d.ts'))
		.flatMap((file) =>
			readFileSync(join(workDir, 'dist', file), 'utf8')
				.split('\n')
				.map((line, index) => ({ file, line: index + 1, text: line }))
				.filter(({ text }) => /\bany\b/.test(text)),
		)
	if (leaks.length > 0) {
		console.error('`any` leaked into the emitted declarations:')
		for (const { file, line, text } of leaks) console.error(`  dist/${file}:${line} ${text.trim()}`)
		process.exitCode = 1
	} else {
		console.log('Portability check passed')
	}
} finally {
	if (process.env.KEEP_FIXTURE) console.log(`Fixture kept at ${workDir}`)
	else rmSync(workDir, { recursive: true, force: true })
}
