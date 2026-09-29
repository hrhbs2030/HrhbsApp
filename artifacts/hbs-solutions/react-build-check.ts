import type { Plugin } from 'vite';

type ReactPackage = 'react' | 'react-dom';

function packageRoot(id: string, name: ReactPackage): string | undefined {
  // Rollup's CommonJS proxy modules can prefix a real file path with \0.
  const normalized = id.replaceAll('\\', '/').replace(/^\0+/, '');
  const match = normalized.match(
    /^(.*?\/node_modules\/(?:\.pnpm\/[^/]+\/node_modules\/)?)(react-dom|react)\//,
  );
  return match?.[2] === name ? `${match[1]}${name}` : undefined;
}

/** Count physical package roots, not individual entry points such as jsx-runtime or client. */
export function assertSingleReactInstances(bundledIds: readonly string[]): void {
  for (const name of ['react', 'react-dom'] as const) {
    const roots = new Set(
      bundledIds
        .map((id) => packageRoot(id, name))
        .filter((root): root is string => root !== undefined),
    );
    if (roots.size > 1) {
      throw new Error(
        `React build check: production bundle contains ${roots.size} ${name} instances from different package paths: ${[...roots].join(', ')}`,
      );
    }
  }
}

/** Inspect the emitted production chunks, including dynamically imported pages. */
export function reactBuildCheck(): Plugin {
  return {
    name: 'hbs-react-build-check',
    apply: 'build',
    generateBundle(_options, bundle) {
      const ids = Object.values(bundle).flatMap((output) =>
        output.type === 'chunk' ? Object.keys(output.modules) : [],
      );
      assertSingleReactInstances(ids);
    },
  };
}