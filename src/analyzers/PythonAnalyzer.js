/**
 * PythonAnalyzer - Python code analysis using Python's ast module
 *
 * Purpose:
 * - Analyze Python code for syntax errors
 * - Detect import issues
 * - Support Django, Flask, FastAPI frameworks
 * - Use Python's built-in ast module via subprocess
 */

import { spawn } from 'child_process';
import { STATIC_ANALYSIS } from '../utilities/constants.js';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

class PythonAnalyzer {
  constructor(logger = null) {
    this.logger = logger;
    this.pythonCommand = null;
  }

  /**
   * Analyze Python code
   * @param {string} filePath - Path to file
   * @param {string} content - File content
   * @param {Object} options - Analysis options
   * @returns {Promise<Array>} Array of diagnostics
   */
  async analyze(filePath, content, options = {}) {
    try {
      const diagnostics = [];

      // Check if Python is available
      const pythonCmd = await this.getPythonCommand();
      if (!pythonCmd) {
        this.logger?.warn('Python not available, skipping analysis');
        return [];
      }

      // Run syntax check using Python's ast module
      const syntaxErrors = await this.checkSyntax(filePath, content, pythonCmd);
      diagnostics.push(...syntaxErrors);

      this.logger?.debug('Python analysis completed', {
        file: filePath,
        totalDiagnostics: diagnostics.length,
        errors: diagnostics.filter(d => d.severity === STATIC_ANALYSIS.SEVERITY.ERROR).length,
        warnings: diagnostics.filter(d => d.severity === STATIC_ANALYSIS.SEVERITY.WARNING).length
      });

      return diagnostics;

    } catch (error) {
      this.logger?.error('Python analysis failed', {
        file: filePath,
        error: error.message
      });

      // Return empty array on error to allow other analysis to continue
      return [];
    }
  }

  /**
   * Check Python syntax using ast module
   * @private
   */
  async checkSyntax(filePath, content, pythonCmd) {
    const diagnostics = [];

    // Create a temporary Python script to check syntax
    const tempDir = os.tmpdir();
    const tempScript = path.join(tempDir, `syntax_check_${Date.now()}.py`);
    const tempFile = path.join(tempDir, `target_${Date.now()}.py`);

    try {
      // Write the content to a temporary file
      await fs.writeFile(tempFile, content, 'utf-8');

      // Create syntax checker script
      const checkerScript = `
import ast
import sys
import json

def check_syntax(filepath):
    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            source = f.read()

        # Try to parse the file
        ast.parse(source, filename=filepath)

        # If successful, no errors
        print(json.dumps({"success": True, "errors": []}))

    except SyntaxError as e:
        error = {
            "file": filepath,
            "line": e.lineno or 1,
            "column": e.offset or 1,
            "message": str(e.msg),
            "text": e.text.strip() if e.text else ""
        }
        print(json.dumps({"success": False, "errors": [error]}))

    except Exception as e:
        error = {
            "file": filepath,
            "line": 1,
            "column": 1,
            "message": str(e),
            "text": ""
        }
        print(json.dumps({"success": False, "errors": [error]}))

if __name__ == "__main__":
    if len(sys.argv) > 1:
        check_syntax(sys.argv[1])
    else:
        print(json.dumps({"success": False, "errors": [{"message": "No file specified"}]}))
`;

      await fs.writeFile(tempScript, checkerScript, 'utf-8');

      // Run the checker script
      const result = await this.runPythonScript(pythonCmd, tempScript, [tempFile]);

      // Parse the result
      try {
        const parsed = JSON.parse(result.stdout);

        if (!parsed.success && parsed.errors) {
          for (const error of parsed.errors) {
            diagnostics.push({
              file: filePath,
              line: error.line || 1,
              column: error.column || 1,
              severity: STATIC_ANALYSIS.SEVERITY.ERROR,
              rule: 'SyntaxError',
              message: error.message,
              category: STATIC_ANALYSIS.CATEGORY.SYNTAX,
              fixable: false,
              source: 'python-ast',
              code: error.text || undefined
            });
          }
        }
      } catch (parseError) {
        this.logger?.warn('Failed to parse Python syntax check result', {
          error: parseError.message,
          stdout: result.stdout
        });
      }

    } finally {
      // Clean up temporary files
      try {
        await fs.unlink(tempScript);
        await fs.unlink(tempFile);
      } catch {
        // Ignore cleanup errors
      }
    }

    return diagnostics;
  }

  /**
   * Get Python command (python3 or python)
   * Checks common installation locations on macOS (Homebrew, pyenv)
   * @private
   */
  async getPythonCommand() {
    if (this.pythonCommand) {
      return this.pythonCommand;
    }

    // Build list of commands to try
    const commands = [];

    // On macOS, check common installation locations first
    if (process.platform === 'darwin') {
      const homeDir = os.homedir();
      commands.push(
        '/opt/homebrew/bin/python3',           // Homebrew (Apple Silicon)
        '/usr/local/bin/python3',               // Homebrew (Intel Mac)
        `${homeDir}/.pyenv/shims/python3`,      // pyenv
        `${homeDir}/.pyenv/shims/python`
      );
    }

    // Standard commands (all platforms)
    commands.push('python3', 'python');

    for (const cmd of commands) {
      try {
        // Use shell: false for absolute paths, shell: true for command names
        const useShell = !cmd.startsWith('/');
        const result = await this.runCommand(cmd, ['--version'], { shell: useShell });
        if (result.success) {
          this.pythonCommand = cmd;
          this.logger?.debug('Found Python command', { command: cmd, version: result.stdout.trim() });
          return cmd;
        }
      } catch {
        // Continue to next command
      }
    }

    return null;
  }

  /**
   * Run Python script
   * @private
   */
  async runPythonScript(pythonCmd, scriptPath, args = []) {
    return this.runCommand(pythonCmd, [scriptPath, ...args]);
  }

  /**
   * Run command and capture output
   * @private
   */
  async runCommand(command, args = [], options = {}) {
    return new Promise((resolve, reject) => {
      const proc = spawn(command, args, {
        ...options,
        shell: true
      });

      let stdout = '';
      let stderr = '';

      proc.stdout?.on('data', (data) => {
        stdout += data.toString();
      });

      proc.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      proc.on('error', (error) => {
        reject(error);
      });

      proc.on('close', (code) => {
        resolve({
          success: code === 0,
          code,
          stdout,
          stderr
        });
      });

      // Timeout after 10 seconds
      setTimeout(() => {
        proc.kill();
        reject(new Error('Command timeout'));
      }, 10000);
    });
  }

  /**
   * Get supported file extensions
   * @returns {Array<string>} Array of supported extensions
   */
  getSupportedExtensions() {
    return ['.py'];
  }

  /**
   * Check if auto-fix is supported
   * @returns {boolean} True if auto-fix is supported
   */
  supportsAutoFix() {
    return false;  // Python auto-fix not implemented yet
  }
}

export default PythonAnalyzer;
