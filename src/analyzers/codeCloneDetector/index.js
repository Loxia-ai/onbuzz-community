// import { Command } from 'commander'; // Not needed for programmatic use
import fs from 'fs';
import path from 'path';
import { FileScanner } from './scanner.js';
import { CodeParser } from './parser.js';
import { CloneDetector } from './detector.js';
import { RefactoringAnalyzer } from './analyzer.js';
import { Reporter } from './reporter.js';

/**
 * Main clone detection orchestrator
 */
class CloneDetectionTool {
  constructor(config) {
    this.config = config;
    this.scanner = new FileScanner(config);
    this.parser = new CodeParser(config);
    this.detector = new CloneDetector(config, this.parser);
    this.analyzer = new RefactoringAnalyzer(config);
    this.reporter = new Reporter();
    this.parseBatchSize = config.parseBatchSize || 50; // Parse files in batches
  }

  /**
   * Parse files in batches to avoid blocking the event loop
   * @param {Array} files - Array of file objects to parse
   * @returns {Promise<Array>} Array of parsed file objects
   */
  async parseFilesInBatches(files) {
    const parsedFiles = [];

    for (let i = 0; i < files.length; i += this.parseBatchSize) {
      const batch = files.slice(i, i + this.parseBatchSize);

      // Parse batch
      for (const file of batch) {
        parsedFiles.push(this.parser.parseFile(file));
      }

      // Yield to event loop between batches
      if (i + this.parseBatchSize < files.length) {
        await new Promise(resolve => setImmediate(resolve));
      }

      // Log progress for large projects
      if (files.length > 100 && (i + this.parseBatchSize) % 100 === 0) {
        const progress = Math.min(100, ((i + this.parseBatchSize) / files.length * 100)).toFixed(0);
        console.log(`  Parsing progress: ${progress}%`);
      }
    }

    return parsedFiles;
  }

  /**
   * Run the complete clone detection pipeline
   */
  async run(projectPath, outputPath) {
    console.log('Starting Code Clone Detection...\n');
    console.log(`Project: ${projectPath}`);
    console.log(`Config: minTokens=${this.config.minTokens}, minLines=${this.config.minLines}\n`);
    
    try {
      // Step 1: Scan files
      console.log('[1/5] Scanning project files...');
      const files = await this.scanner.scanProject(projectPath);
      
      if (files.length === 0) {
        console.log('No files found to analyze.');
        return null;
      }

      // Step 2: Parse and tokenize (with batching to avoid blocking)
      console.log('[2/5] Parsing and tokenizing code...');
      const parsedFiles = await this.parseFilesInBatches(files);

      // Step 3: Detect clones (async with yielding)
      console.log('[3/5] Detecting code clones...');
      const clones = await this.detector.detectClones(parsedFiles);
      
      if (clones.length === 0) {
        console.log('No significant clones detected.');
        return this.reporter.generateReport([], parsedFiles);
      }

      // Step 4: Analyze and generate refactoring advice
      console.log('[4/5] Analyzing clones and generating refactoring advice...');
      const analyzedClones = this.analyzer.analyzeClones(clones);

      // Step 5: Generate report
      console.log('[5/5] Generating report...');
      const report = this.reporter.generateReport(analyzedClones, parsedFiles);

      // Save report
      if (outputPath) {
        this.reporter.saveReport(report, outputPath);
      }

      // Print summary
      this.reporter.printSummary(report);

      // Print AI summary
      console.log('\n📋 AI Agent Summary:');
      console.log(this.reporter.generateAISummary(report));
      console.log();

      return report;
    } catch (error) {
      console.error('\n❌ Error during clone detection:', error.message);
      console.error(error.stack);
      throw error;
    }
  }
}

/**
 * CLI Interface (disabled for now)
 */
async function main() {
  // CLI functionality disabled - use CloneDetectionTool programmatically
  console.error('CLI not available in this version. Use CloneDetectionTool programmatically.');
  process.exit(1);
  // const program = new Command();

  program
    .name('code-clone-detector')
    .description('AI-powered code clone detection and refactoring advisor')
    .version('1.0.0')
    .argument('<project-path>', 'Path to the project directory to analyze')
    .option('-o, --output <path>', 'Output file path for JSON report', 'clone-report.json')
    .option('-c, --config <path>', 'Path to config file', 'config.json')
    .option('--min-tokens <number>', 'Minimum token count for clones', parseInt)
    .option('--min-lines <number>', 'Minimum line count for clones', parseInt)
    .action(async (projectPath, options) => {
      try {
        // Load config
        let config;
        const configPath = path.resolve(options.config);
        
        if (fs.existsSync(configPath)) {
          config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
          console.log(`Loaded config from: ${configPath}`);
        } else {
          console.log('Using default configuration');
          config = {
            minTokens: 50,
            minLines: 5,
            include: ['**/*.js', '**/*.jsx', '**/*.ts', '**/*.tsx'],
            exclude: ['**/node_modules/**', '**/dist/**', '**/build/**'],
            similarityThreshold: 0.85,
            maxFileSize: 500000
          };
        }

        // Override with CLI options
        if (options.minTokens) config.minTokens = options.minTokens;
        if (options.minLines) config.minLines = options.minLines;

        // Resolve paths
        const absProjectPath = path.resolve(projectPath);
        const absOutputPath = path.resolve(options.output);

        if (!fs.existsSync(absProjectPath)) {
          console.error(`Error: Project path does not exist: ${absProjectPath}`);
          process.exit(1);
        }

        // Run detection
        const tool = new CloneDetectionTool(config);
        const report = await tool.run(absProjectPath, absOutputPath);

        if (report) {
          console.log(`✅ Analysis complete! Review the report at: ${absOutputPath}`);
          process.exit(0);
        } else {
          process.exit(1);
        }
      } catch (error) {
        console.error('Fatal error:', error.message);
        process.exit(1);
      }
    });

  program.parse();
}

// Run CLI if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { CloneDetectionTool };
