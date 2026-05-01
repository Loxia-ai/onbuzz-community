/**
 * PDF Tool - Read, extract, and create PDF files
 *
 * Purpose:
 * - Get PDF metadata (page count, info)
 * - Extract text content from specific page ranges
 * - Create PDF files from HTML content using Puppeteer
 * - Provide structured access to PDF documents
 */

import { BaseTool } from './baseTool.js';
import TagParser from '../utilities/tagParser.js';
import fs from 'fs/promises';
import path from 'path';

// Dynamic import for pdf2json
let PDFParser = null;

// Dynamic import for puppeteer (used for PDF creation)
let puppeteerModule = null;

class PdfTool extends BaseTool {
  constructor(config = {}, logger = null) {
    super(config, logger);
    this.id = 'pdf';
    this.name = 'PDF Tool';
    this.description = 'Read, extract, and create PDF files';
    this.version = '2.0.0';
    this.capabilities = ['pdf-read', 'pdf-info', 'pdf-create'];
    this.requiresProject = false;
    this.isAsync = false;
    this.pdfParserLoaded = false;
    this.pdfParserError = null;
    this.puppeteerLoaded = false;
    this.puppeteerError = null;
  }

  /**
   * Lazily load pdf2json module
   * @returns {Promise<boolean>} Whether loading succeeded
   */
  async loadPdfParser() {
    if (this.pdfParserLoaded) return true;
    if (this.pdfParserError) return false;

    try {
      const module = await import('pdf2json');
      PDFParser = module.default;
      this.pdfParserLoaded = true;
      return true;
    } catch (error) {
      this.pdfParserError = error.message;
      this.logger?.error('Failed to load pdf2json', { error: error.message });
      return false;
    }
  }

  /**
   * Lazily load puppeteer module for PDF creation
   * @returns {Promise<boolean>} Whether loading succeeded
   */
  async loadPuppeteer() {
    if (this.puppeteerLoaded) return true;
    if (this.puppeteerError) return false;

    try {
      const module = await import('puppeteer');
      puppeteerModule = module.default;
      this.puppeteerLoaded = true;
      return true;
    } catch (error) {
      this.puppeteerError = error.message;
      this.logger?.error('Failed to load puppeteer', { error: error.message });
      return false;
    }
  }

  /**
   * Get tool description for LLM consumption
   * @returns {string} Tool description
   */
  getDescription() {
    return `
PDF Tool: Read, extract, and create PDF files.

USAGE:
\`\`\`json
{
  "toolId": "pdf",
  "actions": [{
    "action": "get-info",
    "filePath": "/path/to/document.pdf"
  }]
}
\`\`\`

ACTIONS:

1. **get-info** - Get PDF metadata (page count, title, author, etc.)
   - filePath: Path to PDF file (required)

2. **read-pages** - Extract text content from specific pages
   - filePath: Path to PDF file (required)
   - startPage: First page to read, 1-indexed, inclusive (default: 1)
   - endPage: Last page to read, exclusive (default: startPage + 10)
   - IMPORTANT: Read max 10 pages at once for optimal performance

3. **create-pdf** - Create a PDF from HTML content
   - outputPath: Output file path (required, relative to project dir or absolute)
   - htmlContent: Full HTML string to render (required)
   - pageSize: Page size - A4 (default), Letter, Legal, Tabloid, A3, A5
   - orientation: portrait (default) or landscape
   - margins: Object with top, right, bottom, left in CSS units (default: 1cm each)
   - printBackground: Whether to print background colors/images (default: true)
   - displayHeaderFooter: Show header/footer (default: false)
   - headerTemplate: HTML template for header
   - footerTemplate: HTML template for footer

EXAMPLES:

1. Get PDF info:
\`\`\`json
{
  "toolId": "pdf",
  "actions": [{
    "action": "get-info",
    "filePath": "documents/report.pdf"
  }]
}
\`\`\`

2. Read pages 1-10:
\`\`\`json
{
  "toolId": "pdf",
  "actions": [{
    "action": "read-pages",
    "filePath": "documents/report.pdf",
    "startPage": 1,
    "endPage": 11
  }]
}
\`\`\`

3. Create a PDF from HTML:
\`\`\`json
{
  "toolId": "pdf",
  "actions": [{
    "action": "create-pdf",
    "outputPath": "output/report.pdf",
    "htmlContent": "<html><head><style>body{font-family:Arial;margin:2cm}h1{color:#333}</style></head><body><h1>Report</h1><p>Content here...</p></body></html>",
    "pageSize": "A4",
    "orientation": "portrait"
  }]
}
\`\`\`

4. Create a landscape PDF with custom margins:
\`\`\`json
{
  "toolId": "pdf",
  "actions": [{
    "action": "create-pdf",
    "outputPath": "output/wide-report.pdf",
    "htmlContent": "<html><body><h1>Wide Report</h1><table>...</table></body></html>",
    "pageSize": "Letter",
    "orientation": "landscape",
    "margins": { "top": "2cm", "right": "1.5cm", "bottom": "2cm", "left": "1.5cm" }
  }]
}
\`\`\`

NOTES:
- Page numbers are 1-indexed (first page is 1)
- endPage is exclusive (like Python range)
- Recommend reading max 10 pages at a time to avoid token limits
- For create-pdf: Design full HTML with CSS styling for best results
- The HTML is rendered in a headless browser, so all CSS features are supported
- Use inline styles or <style> blocks in the HTML for styling
    `.trim();
  }

  /**
   * Parse parameters from tool command content
   * @param {string} content - Raw tool command content
   * @returns {Object} Parsed parameters object
   */
  parseParameters(content) {
    try {
      // Try to extract structured content using TagParser
      const actionMatches = TagParser.extractContent(content, 'action');
      const filePathMatches = TagParser.extractContent(content, 'filePath');
      const startPageMatches = TagParser.extractContent(content, 'startPage');
      const endPageMatches = TagParser.extractContent(content, 'endPage');

      const action = actionMatches.length > 0 ? actionMatches[0].trim() : 'get-info';
      const filePath = filePathMatches.length > 0 ? filePathMatches[0].trim() : '';
      const startPage = startPageMatches.length > 0 ? parseInt(startPageMatches[0], 10) : 1;
      const endPage = endPageMatches.length > 0 ? parseInt(endPageMatches[0], 10) : startPage + 10;

      return {
        actions: [{
          action,
          filePath,
          startPage,
          endPage
        }]
      };
    } catch (error) {
      throw new Error(`Failed to parse PDF tool parameters: ${error.message}`);
    }
  }

  /**
   * Get supported actions
   * @returns {Array<string>}
   */
  getSupportedActions() {
    return ['get-info', 'read-pages', 'create-pdf'];
  }

  /**
   * Execute PDF tool action
   * @param {Object} params - Parsed parameters
   * @param {Object} context - Execution context
   * @returns {Promise<Object>} Execution result
   */
  async execute(params, context) {
    const { actions } = params;

    if (!actions || actions.length === 0) {
      return {
        success: false,
        error: 'No actions provided',
        output: 'Please specify an action (get-info, read-pages, or create-pdf)'
      };
    }

    const action = actions[0];
    const { projectDir } = context;

    // Handle create-pdf early (it doesn't need read-oriented validation)
    if (action.action === 'create-pdf') {
      try {
        return await this.createPdf(action, context);
      } catch (error) {
        this.logger?.error('PDF creation error', { error: error.message });
        return {
          success: false,
          error: error.message,
          output: `Failed to create PDF: ${error.message}`
        };
      }
    }

    // --- Read-oriented actions below: require filePath, file existence, pdf2json ---

    // Resolve file path
    let filePath = action.filePath;
    if (!filePath) {
      return {
        success: false,
        error: 'File path is required',
        output: 'Please provide a filePath parameter'
      };
    }

    // Make path absolute if relative
    if (!path.isAbsolute(filePath)) {
      filePath = path.resolve(projectDir || process.cwd(), filePath);
    }

    // Check file exists
    try {
      await fs.access(filePath);
    } catch {
      return {
        success: false,
        error: `File not found: ${filePath}`,
        output: `The PDF file does not exist: ${filePath}`
      };
    }

    // Check file extension
    if (!filePath.toLowerCase().endsWith('.pdf')) {
      return {
        success: false,
        error: 'Not a PDF file',
        output: `The file must have a .pdf extension: ${filePath}`
      };
    }

    // Load pdf2json module
    const loaded = await this.loadPdfParser();
    if (!loaded) {
      return {
        success: false,
        error: 'PDF parsing not available',
        output: `PDF parsing module could not be loaded: ${this.pdfParserError}`
      };
    }

    try {
      switch (action.action) {
        case 'get-info':
          return await this.getInfo(filePath);
        case 'read-pages':
          return await this.readPages(filePath, action.startPage, action.endPage);
        default:
          return {
            success: false,
            error: `Unknown action: ${action.action}`,
            output: `Supported actions: get-info, read-pages, create-pdf`
          };
      }
    } catch (error) {
      this.logger?.error('PDF tool error', { action: action.action, filePath, error: error.message });
      return {
        success: false,
        error: error.message,
        output: `Failed to process PDF: ${error.message}`
      };
    }
  }

  /**
   * Parse PDF file using pdf2json
   * @param {string} filePath - Path to PDF file
   * @returns {Promise<Object>} Parsed PDF data
   */
  async parsePdf(filePath) {
    return new Promise((resolve, reject) => {
      const pdfParser = new PDFParser();

      pdfParser.on('pdfParser_dataError', (errData) => {
        reject(new Error(errData.parserError || 'PDF parsing failed'));
      });

      pdfParser.on('pdfParser_dataReady', (pdfData) => {
        resolve(pdfData);
      });

      pdfParser.loadPDF(filePath);
    });
  }

  /**
   * Extract text from a PDF page
   * @param {Object} page - Page data from pdf2json
   * @returns {string} Extracted text
   */
  extractPageText(page) {
    if (!page || !page.Texts) return '';

    const texts = [];
    for (const textItem of page.Texts) {
      if (textItem.R) {
        for (const run of textItem.R) {
          if (run.T) {
            // Decode URI-encoded text
            texts.push(decodeURIComponent(run.T));
          }
        }
      }
    }
    return texts.join(' ');
  }

  /**
   * Get PDF info (page count, metadata)
   * @param {string} filePath - Path to PDF file
   * @returns {Promise<Object>} PDF info
   */
  async getInfo(filePath) {
    const pdfData = await this.parsePdf(filePath);

    const pageCount = pdfData.Pages ? pdfData.Pages.length : 0;
    const meta = pdfData.Meta || {};

    const info = {
      pageCount,
      title: meta.Title || null,
      author: meta.Author || null,
      subject: meta.Subject || null,
      creator: meta.Creator || null,
      producer: meta.Producer || null,
      creationDate: meta.CreationDate || null,
      modificationDate: meta.ModDate || null
    };

    // Build output message
    let output = `PDF Info for: ${path.basename(filePath)}\n`;
    output += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
    output += `Pages: ${info.pageCount}\n`;
    if (info.title) output += `Title: ${info.title}\n`;
    if (info.author) output += `Author: ${info.author}\n`;
    if (info.subject) output += `Subject: ${info.subject}\n`;
    if (info.creator) output += `Creator: ${info.creator}\n`;
    if (info.creationDate) output += `Created: ${info.creationDate}\n`;

    return {
      success: true,
      action: 'get-info',
      filePath,
      info,
      output,
      message: `PDF has ${info.pageCount} pages`
    };
  }

  /**
   * Create a PDF from HTML content using Puppeteer
   * @param {Object} action - Action parameters
   * @param {Object} context - Execution context
   * @returns {Promise<Object>} Creation result
   */
  async createPdf(action, context) {
    const { projectDir } = context;
    const { outputPath, htmlContent, pageSize, orientation, margins, printBackground, displayHeaderFooter, headerTemplate, footerTemplate } = action;

    // Validate required parameters
    if (!outputPath) {
      return {
        success: false,
        error: 'Output path is required',
        output: 'Please provide an outputPath parameter for the PDF file'
      };
    }

    if (!htmlContent) {
      return {
        success: false,
        error: 'HTML content is required',
        output: 'Please provide htmlContent parameter with the HTML to render as PDF'
      };
    }

    // Resolve output path
    let resolvedPath = outputPath;
    if (!path.isAbsolute(resolvedPath)) {
      resolvedPath = path.resolve(projectDir || process.cwd(), resolvedPath);
    }

    // Security: prevent path traversal
    const baseDir = projectDir || process.cwd();
    const normalizedPath = path.normalize(resolvedPath);
    if (!normalizedPath.startsWith(path.normalize(baseDir))) {
      return {
        success: false,
        error: 'Path traversal detected',
        output: 'Output path must be within the project directory'
      };
    }

    // Ensure output directory exists
    const outputDir = path.dirname(resolvedPath);
    await fs.mkdir(outputDir, { recursive: true });

    // Ensure .pdf extension
    if (!resolvedPath.toLowerCase().endsWith('.pdf')) {
      resolvedPath += '.pdf';
    }

    // Load puppeteer
    const loaded = await this.loadPuppeteer();
    if (!loaded) {
      return {
        success: false,
        error: 'Puppeteer not available',
        output: `Puppeteer could not be loaded for PDF creation: ${this.puppeteerError}`
      };
    }

    // Map page size names to Puppeteer format
    const pageSizeMap = {
      'A4': 'A4',
      'A3': 'A3',
      'A5': 'A5',
      'Letter': 'Letter',
      'Legal': 'Legal',
      'Tabloid': 'Tabloid'
    };

    const format = pageSizeMap[pageSize] || 'A4';
    const landscape = orientation === 'landscape';
    const defaultMargin = '1cm';
    const pdfMargins = {
      top: margins?.top || defaultMargin,
      right: margins?.right || defaultMargin,
      bottom: margins?.bottom || defaultMargin,
      left: margins?.left || defaultMargin
    };

    let browser = null;
    try {
      browser = await puppeteerModule.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
      });

      const page = await browser.newPage();
      await page.setContent(htmlContent, { waitUntil: 'networkidle0', timeout: 30000 });

      const pdfOptions = {
        path: resolvedPath,
        format,
        landscape,
        margin: pdfMargins,
        printBackground: printBackground !== false,
        displayHeaderFooter: displayHeaderFooter || false
      };

      if (displayHeaderFooter) {
        if (headerTemplate) pdfOptions.headerTemplate = headerTemplate;
        if (footerTemplate) pdfOptions.footerTemplate = footerTemplate;
      }

      await page.pdf(pdfOptions);
      await browser.close();
      browser = null;

      // Get file stats
      const stats = await fs.stat(resolvedPath);

      const output = `PDF created successfully!\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `File: ${resolvedPath}\n` +
        `Size: ${(stats.size / 1024).toFixed(1)} KB\n` +
        `Page size: ${format}\n` +
        `Orientation: ${landscape ? 'landscape' : 'portrait'}\n` +
        `Margins: ${pdfMargins.top} / ${pdfMargins.right} / ${pdfMargins.bottom} / ${pdfMargins.left}`;

      return {
        success: true,
        action: 'create-pdf',
        outputPath: resolvedPath,
        fileSize: stats.size,
        format,
        landscape,
        output,
        message: `PDF created: ${resolvedPath} (${(stats.size / 1024).toFixed(1)} KB)`
      };

    } catch (error) {
      throw error;
    } finally {
      if (browser) {
        try { await browser.close(); } catch { /* ignore close errors */ }
      }
    }
  }

  /**
   * Read text content from specific pages
   * @param {string} filePath - Path to PDF file
   * @param {number} startPage - Start page (1-indexed, inclusive)
   * @param {number} endPage - End page (exclusive)
   * @returns {Promise<Object>} Page content
   */
  async readPages(filePath, startPage = 1, endPage = null) {
    const pdfData = await this.parsePdf(filePath);

    const totalPages = pdfData.Pages ? pdfData.Pages.length : 0;

    // Validate page range
    if (startPage < 1) startPage = 1;
    if (endPage === null) endPage = Math.min(startPage + 10, totalPages + 1);
    if (endPage > totalPages + 1) endPage = totalPages + 1;
    if (startPage > totalPages) {
      return {
        success: false,
        error: `Start page ${startPage} exceeds total pages ${totalPages}`,
        output: `The PDF only has ${totalPages} pages. Cannot start from page ${startPage}.`
      };
    }

    // Warn if requesting more than 10 pages
    const pageCount = endPage - startPage;
    const warnings = [];
    if (pageCount > 10) {
      warnings.push(`Reading ${pageCount} pages. Consider reading max 10 pages at a time for better performance.`);
    }

    // Extract requested pages (convert to 0-indexed)
    const requestedPages = [];
    for (let i = startPage - 1; i < Math.min(endPage - 1, totalPages); i++) {
      const page = pdfData.Pages[i];
      const content = this.extractPageText(page);
      requestedPages.push({
        pageNumber: i + 1,
        content: content.trim() || ''
      });
    }

    // Build output
    let output = `PDF Content: ${path.basename(filePath)}\n`;
    output += `Pages ${startPage} to ${endPage - 1} of ${totalPages}\n`;
    output += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;

    for (const page of requestedPages) {
      output += `── Page ${page.pageNumber} ──\n`;
      output += page.content || '(No text content on this page)';
      output += '\n\n';
    }

    if (warnings.length > 0) {
      output += `\n⚠️ Warnings:\n${warnings.map(w => `- ${w}`).join('\n')}`;
    }

    return {
      success: true,
      action: 'read-pages',
      filePath,
      totalPages,
      startPage,
      endPage,
      pagesRead: requestedPages.length,
      pages: requestedPages,
      warnings,
      output,
      message: `Read ${requestedPages.length} pages (${startPage}-${endPage - 1}) of ${totalPages} total`
    };
  }
}

export default PdfTool;
