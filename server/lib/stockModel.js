// lib/stockModel.js
const fs = require('fs');
const path = require('path');

let cachedConfig = null;

function loadConfig() {
  if (cachedConfig) return cachedConfig;
  const configPath = process.env.STOCK_MODELS_CONFIG_PATH || path.join(__dirname, '..', 'config', 'stockModels.json');
  const raw = fs.readFileSync(configPath, 'utf8');
  cachedConfig = JSON.parse(raw);
  return cachedConfig;
}

/**
 * Returns a stock body photo URL to use as the "person" input for the
 * face-only fallback path. `category` is optional and only used if you've
 * filled in server/config/stockModels.json's categories.
 */
function getStockModelUrl(category) {
  const config = loadConfig();
  const url = (category && config.categories?.[category]) || config.default;
  if (!url || url.includes('REPLACE_ME')) {
    throw new Error(
      'No stock model photo configured — edit server/config/stockModels.json (or set STOCK_MODELS_CONFIG_PATH) with real, licensed photo URLs before the face-only fallback can run.'
    );
  }
  return url;
}

module.exports = { getStockModelUrl };
