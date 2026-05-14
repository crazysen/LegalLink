const path = require('path');
const fs = require('fs');

/**
 * Load EXPO_PUBLIC_* before Metro bundles. Expo only reads `.env` beside `package.json`;
 * this also loads the monorepo root `.env` so keys are not missed when only the repo root is configured.
 */
function loadEnvFile(filePath, override) {
  if (!fs.existsSync(filePath)) {
    return;
  }
  try {
    require('dotenv').config({path: filePath, override: Boolean(override)});
  } catch {
    /* optional */
  }
}

const workspaceEnv = path.join(__dirname, '..', '.env');
const appEnv = path.join(__dirname, '.env');
loadEnvFile(workspaceEnv, false);
loadEnvFile(appEnv, true);

module.exports = require('./app.json');
