import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { logger } from './logger.js';

/**
 * Loads and parses a YAML configuration file
 * @param fileName Name of the file in the config/ directory
 * @returns Parsed configuration object
 */
export function loadConfig<T>(fileName: string): T {
  try {
    const configPath = path.resolve(process.cwd(), 'config', fileName);
    
    if (!fs.existsSync(configPath)) {
      logger.warn(`Config file not found: ${configPath}, using defaults`);
      return {} as T;
    }

    const fileContents = fs.readFileSync(configPath, 'utf8');
    
    // Interpolate environment variables: ${VAR_NAME} or ${VAR_NAME:-default}
    const interpolated = fileContents.replace(/\${(\w+)(?::-([^}]*))?}/g, (_, name, defaultValue) => {
      return process.env[name] || defaultValue || '';
    });

    const config = yaml.load(interpolated) as T;
    
    logger.debug(`Loaded configuration from ${fileName}`);
    return config;
  } catch (error) {
    logger.error(`Error loading config file ${fileName}:`, error as Error);
    return {} as T;
  }
}

/**
 * Watch a config file for changes and reload (optional)
 */
export function watchConfig<T>(fileName: string, onUpdate: (config: T) => void): fs.FSWatcher {
  const configPath = path.resolve(process.cwd(), 'config', fileName);
  
  return fs.watch(configPath, (eventType) => {
    if (eventType === 'change') {
      logger.info(`Config file changed: ${fileName}, reloading...`);
      const newConfig = loadConfig<T>(fileName);
      onUpdate(newConfig);
    }
  });
}
