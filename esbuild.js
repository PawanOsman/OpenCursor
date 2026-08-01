const esbuild = require("esbuild");

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

/**
 * @type {import('esbuild').Plugin}
 */
const esbuildProblemMatcherPlugin = {
	name: 'esbuild-problem-matcher',

	setup(build) {
		build.onStart(() => {
			console.log('[watch] build started');
		});
		build.onEnd((result) => {
			result.errors.forEach(({ text, location }) => {
				console.error(`✘ [ERROR] ${text}`);
				console.error(`    ${location.file}:${location.line}:${location.column}:`);
			});
			console.log('[watch] build finished');
		});
	},
};

async function main() {
	const ctx = await esbuild.context({
		entryPoints: [
			'src/extension.ts'
		],
		bundle: true,
		format: 'cjs',
		minify: production,
		sourcemap: !production,
		sourcesContent: false,
		platform: 'node',
		outfile: 'dist/extension.js',
		external: ['vscode', '@huggingface/transformers', '@huggingface/hub', 'onnxruntime-node', 'sharp'],
		logLevel: 'silent',
		plugins: [
			esbuildProblemMatcherPlugin,
		],
	});	

	const vscodeShimPlugin = {
		name: 'vscode-shim',
		setup(build) {
			build.onResolve({ filter: /^vscode$/ }, () => ({
				path: require('path').resolve(__dirname, 'src/vscodeShim.ts'),
			}));
		},
	};

	// CLI binary bundle (node)
	const cliCtx = await esbuild.context({
		entryPoints: [
			'src/cli/bin.ts'
		],
		bundle: true,
		format: 'cjs',
		minify: production,
		sourcemap: !production,
		sourcesContent: false,
		platform: 'node',
		outfile: 'dist/cli.js',
		external: ['@huggingface/transformers', '@huggingface/hub', 'onnxruntime-node', 'sharp'],
		logLevel: 'silent',
		plugins: [
			vscodeShimPlugin,
			esbuildProblemMatcherPlugin,
		],
	});

	// React webview bundles (browser)
	const webviewCtx = await esbuild.context({
		entryPoints: {
			sidebar: 'webview-ui/sidebar/main.tsx',
			settings: 'webview-ui/settings/main.tsx',
		},
		bundle: true,
		format: 'iife',
		minify: production,
		sourcemap: !production,
		sourcesContent: false,
		platform: 'browser',
		target: ['es2020'],
		outdir: 'dist/webview',
		loader: { '.css': 'css' },
		define: { 'process.env.NODE_ENV': production ? '"production"' : '"development"' },
		logLevel: 'silent',
		plugins: [esbuildProblemMatcherPlugin],
	});

	if (watch) {
		await Promise.all([ctx.watch(), cliCtx.watch(), webviewCtx.watch()]);
	} else {
		await Promise.all([ctx.rebuild(), cliCtx.rebuild(), webviewCtx.rebuild()]);
		await ctx.dispose();
		await cliCtx.dispose();
		await webviewCtx.dispose();
	}
}

main().catch(e => {
	console.error(e);
	process.exit(1);
});
