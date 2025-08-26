import { execSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

// Using globals from Vitest per repo config

const run = (cmd: string, cwd?: string) => {
	return execSync(cmd, {
		cwd,
		stdio: 'pipe',
		env: { ...process.env, CI: 'true' },
	}).toString()
}

const writeJson = (filePath: string, data: unknown) => {
	fs.mkdirSync(path.dirname(filePath), { recursive: true })
	fs.writeFileSync(filePath, JSON.stringify(data, null, 2))
}

const rootDir = path.resolve(__dirname, '..')

describe('package tarballs work in CJS, ESM, and TS projects', () => {
	it('installs and runs in CJS/ESM and type-checks in TS', async () => {
		// This can take a while due to packing and installs

		// 1) Build and pack both packages into ./.pack
		run('pnpm -w run build', rootDir)
		run('pnpm -w run pack:check', rootDir)

		const packDir = path.join(rootDir, '.pack')
		const files = fs.readdirSync(packDir)

		const lambdaTar = files.find((f) => /^effect-lambda-.*\.tgz$/.test(f))
		const oauthTar = files.find((f) =>
			/^ballatech-effect-oauth-client-.*\.tgz$/.test(f),
		)

		expect(lambdaTar, 'effect-lambda tarball not found').toBeTruthy()
		expect(oauthTar, 'effect-oauth-client tarball not found').toBeTruthy()

		const lambdaTarPath = path.join(packDir, lambdaTar as string)
		const oauthTarPath = path.join(packDir, oauthTar as string)

		// Prepare a base temp folder
		const baseTmp = fs.mkdtempSync(
			path.join(os.tmpdir(), 'effect-packages-compat-'),
		)

		// 2) CJS project
		{
			const proj = path.join(baseTmp, 'cjs-proj')
			fs.mkdirSync(proj)
			writeJson(path.join(proj, 'package.json'), {
				name: 'cjs-proj',
				version: '0.0.0',
				// CJS by default (no type: module)
			})

			// install peers and tarballs
			run('pnpm add effect @effect/platform', proj)
			run(`pnpm add ${lambdaTarPath} ${oauthTarPath}`.trim(), proj)

			fs.writeFileSync(
				path.join(proj, 'index.js'),
				[
					"const lambda = require('effect-lambda')",
					"const oauth = require('@ballatech/effect-oauth-client')",
					'if (!lambda || !oauth) throw new Error("imports failed")',
					'console.log("OK CJS")',
				].join('\n'),
			)

			const out = run('node index.js', proj)
			expect(out).toContain('OK CJS')
		}

		// 3) ESM project
		{
			const proj = path.join(baseTmp, 'esm-proj')
			fs.mkdirSync(proj)
			writeJson(path.join(proj, 'package.json'), {
				name: 'esm-proj',
				version: '0.0.0',
				type: 'module',
			})

			run('pnpm add effect @effect/platform', proj)
			run(`pnpm add ${lambdaTarPath} ${oauthTarPath}`.trim(), proj)

			fs.writeFileSync(
				path.join(proj, 'index.mjs'),
				[
					"import * as lambda from 'effect-lambda'",
					"import * as oauth from '@ballatech/effect-oauth-client'",
					'if (!lambda || !oauth) throw new Error("imports failed")',
					'console.log("OK ESM")',
				].join('\n'),
			)

			const out = run('node index.mjs', proj)
			expect(out).toContain('OK ESM')
		}

		// 4) TS project (type checking only)
		{
			const proj = path.join(baseTmp, 'ts-proj')
			fs.mkdirSync(proj)
			writeJson(path.join(proj, 'package.json'), {
				name: 'ts-proj',
				version: '0.0.0',
			})

			// deps: peers + typescript
			run('pnpm add effect @effect/platform @types/aws-lambda', proj)
			run('pnpm add -D typescript', proj)
			run(`pnpm add ${lambdaTarPath} ${oauthTarPath}`.trim(), proj)

			writeJson(path.join(proj, 'tsconfig.json'), {
				compilerOptions: {
					target: 'ES2022',
					module: 'NodeNext',
					moduleResolution: 'NodeNext',
					strict: true,
					skipLibCheck: true,
					declaration: false,
					noEmit: true,
				},
				include: ['index.ts'],
			})

			fs.writeFileSync(
				path.join(proj, 'index.ts'),
				[
					"import * as lambda from 'effect-lambda'",
					"import * as oauth from '@ballatech/effect-oauth-client'",
					'// Ensure types are accessible',
					'const x: Record<string, unknown> = { lambda, oauth }',
					'console.log(!!x)',
				].join('\n'),
			)

			// type-check only
			run('pnpm exec tsc --noEmit', proj)
		}
	}, 120_000)
})
