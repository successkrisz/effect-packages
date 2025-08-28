#!/usr/bin/env node
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const [, , rawName, ...rest] = process.argv
if (!rawName) {
	console.error('Usage: pnpm new <package-name> [--scope @ballatech]')
	process.exit(1)
}

const args = new Map()
for (let i = 0; i < rest.length; i++) {
	const part = rest[i]
	if (part.startsWith('--')) {
		const [k, v] = part.split('=')
		args.set(k.replace(/^--/, ''), v ?? rest[++i])
	}
}

const scope = args.get('scope') ?? '@ballatech'
const pkgDir = join(process.cwd(), 'packages', rawName)
if (existsSync(pkgDir)) {
	console.error(`Package directory already exists: ${pkgDir}`)
	process.exit(1)
}

mkdirSync(pkgDir, { recursive: true })
mkdirSync(join(pkgDir, 'src'), { recursive: true })

const fullName = scope ? `${scope}/${rawName}` : rawName

const pkgJson = {
	name: fullName,
	version: '0.1.0',
	private: false,
	license: 'MIT',
	sideEffects: false,
	type: 'module',
	main: './dist/index.js',
	module: './dist/index.js',
	types: './dist/index.d.ts',
	exports: {
		'.': {
			types: './dist/index.d.ts',
			import: './dist/index.js',
		},
	},
	files: ['dist/**', 'README.md', 'LICENSE'],
	scripts: {
		build: 'tsup',
		prepack: 'pnpm run build',
	},
	devDependencies: {
		'@effect/platform': 'catalog:',
		effect: 'catalog:',
	},
	peerDependencies: {
		'@effect/platform': 'catalog:',
		effect: 'catalog:',
	},
	repository: {
		type: 'git',
		url: 'git+https://github.com/successkrisz/effect-packages.git',
		directory: `packages/${rawName}`,
	},
	bugs: {
		url: 'https://github.com/successkrisz/effect-packages/issues',
	},
	homepage: 'https://github.com/successkrisz/effect-packages#readme',
}

const tsupConfig = `import { defineConfig } from 'tsup'

export default defineConfig({
	entry: ['src/index.ts'],
	format: ['esm'],
	dts: true,
	sourcemap: true,
	clean: true,
	skipNodeModulesBundle: true,
	treeshake: true,
})
`

const tsconfig = {
	extends: '../tsconfig/tsconfig.base.json',
	compilerOptions: { outDir: 'dist' },
	include: ['src'],
}

const indexTs = `export const name = '${fullName}'
`

const readme = `# ${fullName}

Package scaffolded via scripts/new-package.mjs
`

writeFileSync(join(pkgDir, 'package.json'), `${JSON.stringify(pkgJson, null, '\t')}\n`)
writeFileSync(join(pkgDir, 'tsup.config.ts'), tsupConfig)
writeFileSync(join(pkgDir, 'tsconfig.json'), `${JSON.stringify(tsconfig, null, '\t')}\n`)
writeFileSync(join(pkgDir, 'src', 'index.ts'), indexTs)
writeFileSync(join(pkgDir, 'README.md'), readme)

console.log(`Created package at ${pkgDir}`)
console.log('Next steps:')
console.log(`  - pnpm -C ${pkgDir} build`)
console.log('  - pnpm changeset (to queue a release)')
