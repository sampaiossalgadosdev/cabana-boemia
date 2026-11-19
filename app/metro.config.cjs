// Metro do Expo já se configura para monorepo (SDK 52+): observa a raiz do
// repositório e procura pacotes em app/node_modules e depois na raiz. Assim
// resolve @restaurante/shared (workspace, com os subpaths do "exports":
// "@restaurante/shared/frete" etc.) e as imagens de shared/assets.
// NÃO pôr watchFolders/nodeModulesPaths/disableHierarchicalLookup à mão: a
// documentação do Expo manda tirar.
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Subpaths do "exports" do package.json (já é o padrão do Metro atual; fica
// explícito porque o shared não tem "main").
config.resolver.unstable_enablePackageExports = true;

module.exports = config;
