const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// expo-image-manipulator ships with "main": "src/index.ts" which internally
// imports './ImageManipulator.types'. Metro treats '.types' as a file
// extension and cannot resolve 'ImageManipulator.types.ts'. This resolver
// intercepts those lookups and appends '.ts' so Metro finds the correct file.
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName.endsWith('.types')) {
    try {
      return context.resolveRequest(context, moduleName + '.ts', platform);
    } catch {
      // fall through to default resolution
    }
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
