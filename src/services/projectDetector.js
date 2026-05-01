/**
 * @file services/projectDetector.js
 * @description Detects project type, entry points, and suggests
 * appropriate server commands for serving the project.
 */

import fs from 'fs/promises';
import path from 'path';

/**
 * Project types with their characteristics
 */
export const PROJECT_TYPES = {
  REACT_CRA: 'react-cra',           // Create React App
  REACT_VITE: 'react-vite',         // React with Vite
  NEXTJS: 'nextjs',                 // Next.js
  VUE_VITE: 'vue-vite',             // Vue with Vite
  VUE_CLI: 'vue-cli',               // Vue CLI
  ANGULAR: 'angular',               // Angular
  SVELTE: 'svelte',                 // Svelte/SvelteKit
  ASTRO: 'astro',                   // Astro
  REMIX: 'remix',                   // Remix
  STATIC_HTML: 'static-html',       // Plain HTML/CSS/JS
  PYTHON_FLASK: 'python-flask',     // Python Flask
  PYTHON_DJANGO: 'python-django',   // Python Django
  NODE_EXPRESS: 'node-express',     // Node.js Express
  UNKNOWN: 'unknown'
};

/**
 * Server commands for each project type
 */
const SERVER_COMMANDS = {
  [PROJECT_TYPES.REACT_CRA]: { command: 'npm start', defaultPort: 3000 },
  [PROJECT_TYPES.REACT_VITE]: { command: 'npm run dev', defaultPort: 5173 },
  [PROJECT_TYPES.NEXTJS]: { command: 'npm run dev', defaultPort: 3000 },
  [PROJECT_TYPES.VUE_VITE]: { command: 'npm run dev', defaultPort: 5173 },
  [PROJECT_TYPES.VUE_CLI]: { command: 'npm run serve', defaultPort: 8080 },
  [PROJECT_TYPES.ANGULAR]: { command: 'npm start', defaultPort: 4200 },
  [PROJECT_TYPES.SVELTE]: { command: 'npm run dev', defaultPort: 5173 },
  [PROJECT_TYPES.ASTRO]: { command: 'npm run dev', defaultPort: 4321 },
  [PROJECT_TYPES.REMIX]: { command: 'npm run dev', defaultPort: 3000 },
  [PROJECT_TYPES.STATIC_HTML]: { command: 'npx serve .', defaultPort: 3000 },
  [PROJECT_TYPES.PYTHON_FLASK]: { command: 'python app.py', defaultPort: 5000 },
  [PROJECT_TYPES.PYTHON_DJANGO]: { command: 'python manage.py runserver', defaultPort: 8000 },
  [PROJECT_TYPES.NODE_EXPRESS]: { command: 'node server.js', defaultPort: 3000 },
  [PROJECT_TYPES.UNKNOWN]: { command: 'npx serve .', defaultPort: 3000 }
};

/**
 * Project Detector - analyzes project structure to determine type
 */
class ProjectDetector {
  /**
   * Detect project type and get server info
   * @param {string} projectDir - Project directory path
   * @returns {Promise<Object>} Detection result
   */
  async detect(projectDir) {
    const result = {
      projectDir,
      projectType: PROJECT_TYPES.UNKNOWN,
      framework: null,
      entryPoints: [],
      packageJson: null,
      serverCommand: null,
      defaultPort: 3000,
      isStatic: false,
      confidence: 'low'
    };

    try {
      // Check for package.json first
      const packageJsonPath = path.join(projectDir, 'package.json');
      const hasPackageJson = await this._fileExists(packageJsonPath);

      if (hasPackageJson) {
        result.packageJson = await this._readJSON(packageJsonPath);
        await this._detectFromPackageJson(result);
      } else {
        // Check for other project indicators
        await this._detectNonNodeProject(result, projectDir);
      }

      // Find entry points
      result.entryPoints = await this._findEntryPoints(projectDir, result.projectType);

      // Set server command based on project type
      const serverInfo = SERVER_COMMANDS[result.projectType] || SERVER_COMMANDS[PROJECT_TYPES.UNKNOWN];
      result.serverCommand = serverInfo.command;
      result.defaultPort = serverInfo.defaultPort;

      // Override with package.json scripts if available
      if (result.packageJson?.scripts) {
        result.availableScripts = this._extractServerScripts(result.packageJson.scripts);
      }

      return result;

    } catch (error) {
      result.error = error.message;
      return result;
    }
  }

  /**
   * Detect project type from package.json
   * @private
   */
  async _detectFromPackageJson(result) {
    const pkg = result.packageJson;
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };

    // Next.js
    if (deps.next) {
      result.projectType = PROJECT_TYPES.NEXTJS;
      result.framework = 'Next.js';
      result.confidence = 'high';
      return;
    }

    // Remix
    if (deps['@remix-run/react']) {
      result.projectType = PROJECT_TYPES.REMIX;
      result.framework = 'Remix';
      result.confidence = 'high';
      return;
    }

    // Astro
    if (deps.astro) {
      result.projectType = PROJECT_TYPES.ASTRO;
      result.framework = 'Astro';
      result.confidence = 'high';
      return;
    }

    // SvelteKit
    if (deps['@sveltejs/kit'] || deps.svelte) {
      result.projectType = PROJECT_TYPES.SVELTE;
      result.framework = deps['@sveltejs/kit'] ? 'SvelteKit' : 'Svelte';
      result.confidence = 'high';
      return;
    }

    // Vue
    if (deps.vue) {
      if (deps.vite || deps['@vitejs/plugin-vue']) {
        result.projectType = PROJECT_TYPES.VUE_VITE;
        result.framework = 'Vue (Vite)';
      } else {
        result.projectType = PROJECT_TYPES.VUE_CLI;
        result.framework = 'Vue CLI';
      }
      result.confidence = 'high';
      return;
    }

    // Angular
    if (deps['@angular/core']) {
      result.projectType = PROJECT_TYPES.ANGULAR;
      result.framework = 'Angular';
      result.confidence = 'high';
      return;
    }

    // React - check if Vite or CRA
    if (deps.react) {
      if (deps.vite || deps['@vitejs/plugin-react']) {
        result.projectType = PROJECT_TYPES.REACT_VITE;
        result.framework = 'React (Vite)';
      } else if (deps['react-scripts']) {
        result.projectType = PROJECT_TYPES.REACT_CRA;
        result.framework = 'Create React App';
      } else {
        // Generic React - assume Vite-style
        result.projectType = PROJECT_TYPES.REACT_VITE;
        result.framework = 'React';
      }
      result.confidence = 'high';
      return;
    }

    // Express server
    if (deps.express) {
      result.projectType = PROJECT_TYPES.NODE_EXPRESS;
      result.framework = 'Express.js';
      result.confidence = 'medium';
      return;
    }

    // Fallback: check scripts for clues
    if (pkg.scripts) {
      if (pkg.scripts.dev?.includes('vite') || pkg.scripts.start?.includes('vite')) {
        result.projectType = PROJECT_TYPES.REACT_VITE;
        result.framework = 'Vite Project';
        result.confidence = 'medium';
        return;
      }
    }
  }

  /**
   * Detect non-Node.js projects (Python, static, etc.)
   * @private
   */
  async _detectNonNodeProject(result, projectDir) {
    // Check for Python projects
    const requirementsTxt = path.join(projectDir, 'requirements.txt');
    const appPy = path.join(projectDir, 'app.py');
    const managePy = path.join(projectDir, 'manage.py');

    if (await this._fileExists(managePy)) {
      result.projectType = PROJECT_TYPES.PYTHON_DJANGO;
      result.framework = 'Django';
      result.confidence = 'high';
      return;
    }

    if (await this._fileExists(appPy)) {
      const content = await fs.readFile(appPy, 'utf-8');
      if (content.includes('Flask')) {
        result.projectType = PROJECT_TYPES.PYTHON_FLASK;
        result.framework = 'Flask';
        result.confidence = 'high';
        return;
      }
    }

    // Check for static HTML
    const indexHtml = path.join(projectDir, 'index.html');
    if (await this._fileExists(indexHtml)) {
      result.projectType = PROJECT_TYPES.STATIC_HTML;
      result.framework = 'Static HTML';
      result.isStatic = true;
      result.confidence = 'high';
      return;
    }

    // Check in common subdirectories
    for (const subdir of ['public', 'dist', 'build', 'out', 'www', 'static']) {
      const subdirIndex = path.join(projectDir, subdir, 'index.html');
      if (await this._fileExists(subdirIndex)) {
        result.projectType = PROJECT_TYPES.STATIC_HTML;
        result.framework = 'Static HTML';
        result.isStatic = true;
        result.staticDir = path.join(projectDir, subdir);
        result.confidence = 'high';
        result.serverCommand = `npx serve ${subdir}`;
        return;
      }
    }
  }

  /**
   * Find entry points for the project
   * @private
   */
  async _findEntryPoints(projectDir, projectType) {
    const entryPoints = [];

    // Common entry point files
    const candidates = [
      'index.html',
      'public/index.html',
      'src/index.html',
      'src/index.js',
      'src/index.jsx',
      'src/index.ts',
      'src/index.tsx',
      'src/main.js',
      'src/main.jsx',
      'src/main.ts',
      'src/main.tsx',
      'src/App.js',
      'src/App.jsx',
      'src/App.tsx',
      'pages/index.js',
      'pages/index.tsx',
      'app/page.js',
      'app/page.tsx',
      'server.js',
      'app.js',
      'app.py',
      'manage.py',
      'main.py'
    ];

    for (const candidate of candidates) {
      const fullPath = path.join(projectDir, candidate);
      if (await this._fileExists(fullPath)) {
        entryPoints.push({
          file: candidate,
          path: fullPath,
          type: this._getEntryPointType(candidate)
        });
      }
    }

    return entryPoints;
  }

  /**
   * Get entry point type
   * @private
   */
  _getEntryPointType(filename) {
    if (filename.endsWith('.html')) return 'html';
    if (filename.includes('server') || filename === 'app.js') return 'server';
    if (filename.endsWith('.py')) return 'python';
    if (filename.includes('App')) return 'component';
    return 'entry';
  }

  /**
   * Extract server-related scripts from package.json
   * @private
   */
  _extractServerScripts(scripts) {
    const serverScripts = [];
    const serverKeywords = ['start', 'dev', 'serve', 'server', 'run', 'build'];

    for (const [name, command] of Object.entries(scripts)) {
      if (serverKeywords.some(kw => name.toLowerCase().includes(kw))) {
        serverScripts.push({ name, command });
      }
    }

    return serverScripts;
  }

  /**
   * Check if file exists
   * @private
   */
  async _fileExists(filePath) {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Read and parse JSON file
   * @private
   */
  async _readJSON(filePath) {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      return JSON.parse(content);
    } catch {
      return null;
    }
  }

  /**
   * Get suggested server command for project
   * @param {Object} detection - Detection result
   * @param {number} port - Preferred port (optional)
   * @returns {Object} Server command info
   */
  getSuggestedServerCommand(detection, port = null) {
    const info = SERVER_COMMANDS[detection.projectType] || SERVER_COMMANDS[PROJECT_TYPES.UNKNOWN];
    const actualPort = port || info.defaultPort;

    let command = detection.serverCommand || info.command;

    // Add port to command if needed
    if (detection.projectType === PROJECT_TYPES.STATIC_HTML) {
      command = `npx serve ${detection.staticDir || '.'} -l ${actualPort}`;
    } else if (detection.projectType === PROJECT_TYPES.REACT_VITE ||
               detection.projectType === PROJECT_TYPES.VUE_VITE ||
               detection.projectType === PROJECT_TYPES.SVELTE) {
      command = `npm run dev -- --port ${actualPort}`;
    } else if (detection.projectType === PROJECT_TYPES.NEXTJS) {
      command = `npm run dev -- -p ${actualPort}`;
    }

    return {
      command,
      port: actualPort,
      projectType: detection.projectType,
      framework: detection.framework
    };
  }
}

// Singleton instance
let detectorInstance = null;

/**
 * Get or create the project detector singleton
 * @returns {ProjectDetector}
 */
export function getProjectDetector() {
  if (!detectorInstance) {
    detectorInstance = new ProjectDetector();
  }
  return detectorInstance;
}

export default ProjectDetector;
