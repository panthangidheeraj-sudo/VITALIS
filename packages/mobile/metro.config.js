// Metro configuration for a workspace package.
//
// Metro assumes a single project root with one node_modules. In an npm
// workspace neither holds: `@triage/shared` lives at ../shared and its
// dependencies are hoisted to the repo root. Without the three settings below
// the bundler reports "Unable to resolve module @triage/shared" and there is
// no obvious clue why.
//
//   watchFolders        — let Metro read files outside packages/mobile, so it
//                         can actually bundle ../shared's source.
//   nodeModulesPaths    — resolve hoisted dependencies from the root, since
//                         npm installs most packages there rather than here.
//   unstable_enablePackageExports
//                       — @triage/shared declares an `exports` map and ships
//                         ESM with explicit .js extensions (NodeNext). Without
//                         exports support Metro falls back to `main` and can
//                         mis-resolve the deep relative imports inside it.
//
// disableHierarchicalLookup is deliberately NOT set: Expo's own packages still
// rely on ordinary upward node_modules lookup.

const { getDefaultConfig } = require('expo/metro-config');
const path = require('node:path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];

config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

config.resolver.unstable_enablePackageExports = true;

module.exports = config;
