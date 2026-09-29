import type { Plugin } from 'vite';

const appModule = '/artifacts/hbs-solutions/src/App.tsx';
const hooksModule = '/lib/api-client-react/src/generated/api.ts';

function queryPackageRoot(id: string): string | undefined {
  const normalized = id.replaceAll('\\', '/');
  const match = normalized.match(/^(.*?\/node_modules\/(?:\.pnpm\/[^/]+\/node_modules\/)?)@tanstack\/react-query\//);
  return match ? `${match[1]}@tanstack/react-query` : undefined;
}

function findModule(ids: readonly string[], suffix: string): string {
  const matches = ids.filter((id) => id.replaceAll('\\', '/').endsWith(suffix));
  if (matches.length !== 1) {
    throw new Error(`React Query build check: expected exactly one bundled ${suffix}, found ${matches.length}.`);
  }
  return matches[0];
}

export function assertSingleReactQueryContext(
  bundledIds: readonly string[],
  importedIds: (id: string) => readonly string[] | undefined,
): void {
  const app = findModule(bundledIds, appModule);
  const hooks = findModule(bundledIds, hooksModule);
  const roots = new Set(bundledIds.map(queryPackageRoot).filter((root): root is string => !!root));

  for (const [label, id] of [['app provider', app], ['generated API hooks', hooks]] as const) {
    const imports = importedIds(id);
    const directRoots = new Set(imports?.map(queryPackageRoot).filter((root): root is string => !!root));
    if (directRoots.size !== 1) {
      throw new Error(`React Query build check: ${label} must import exactly one bundled @tanstack/react-query instance.`);
    }
    const [root] = directRoots;
    if (!roots.has(root)) {
      throw new Error(`React Query build check: ${label} imports a React Query instance missing from the bundle.`);
    }
  }

  if (roots.size !== 1) {
    throw new Error(`React Query build check: production bundle contains ${roots.size} React Query instances; generated API hooks could lose QueryClientProvider context. ${[...roots].join(', ')}`);
  }
}

/** Runs against Rollup's actual emitted module graph, not the installed dependency tree. */
export function reactQueryBuildCheck(): Plugin {
  return {
    name: 'hbs-react-query-build-check',
    apply: 'build',
    generateBundle(_options, bundle) {
      const ids = Object.values(bundle).flatMap((output) =>
        output.type === 'chunk' ? Object.keys(output.modules) : [],
      );
      assertSingleReactQueryContext(ids, (id) => this.getModuleInfo(id)?.importedIds);
    },
  };
}