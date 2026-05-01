/**
 * Document (DOCX) Tool - Read and create Word documents
 *
 * Purpose:
 * - Get document metadata and word count
 * - Extract text or HTML from DOCX files
 * - Create DOCX documents from structured JSON content
 */

import { BaseTool } from './baseTool.js';
import TagParser from '../utilities/tagParser.js';
import fs from 'fs/promises';
import path from 'path';

// Lazy-loaded dependencies
let docxModule = null;
let mammothModule = null;

class DocxTool extends BaseTool {
  constructor(config = {}, logger = null) {
    super(config, logger);
    this.id = 'doc';
    this.name = 'Document Tool';
    this.description = 'Read and create Word (DOCX) documents';
    this.version = '1.0.0';
    this.requiresProject = false;
    this.isAsync = false;
    this.docxLoaded = false;
    this.docxError = null;
    this.mammothLoaded = false;
    this.mammothError = null;
  }

  /**
   * Lazily load the docx module (for creation)
   * @returns {Promise<boolean>}
   */
  async loadDocx() {
    if (this.docxLoaded) return true;
    if (this.docxError) return false;

    try {
      docxModule = await import('docx');
      this.docxLoaded = true;
      return true;
    } catch (error) {
      this.docxError = error.message;
      this.logger?.error('Failed to load docx module', { error: error.message });
      return false;
    }
  }

  /**
   * Lazily load the mammoth module (for reading)
   * @returns {Promise<boolean>}
   */
  async loadMammoth() {
    if (this.mammothLoaded) return true;
    if (this.mammothError) return false;

    try {
      const mod = await import('mammoth');
      mammothModule = mod.default || mod;
      this.mammothLoaded = true;
      return true;
    } catch (error) {
      this.mammothError = error.message;
      this.logger?.error('Failed to load mammoth module', { error: error.message });
      return false;
    }
  }

  /**
   * Get tool description for LLM consumption
   * @returns {string}
   */
  getDescription() {
    return `
Document Tool: Read and create Word (DOCX) documents.

USAGE:
\`\`\`json
{
  "toolId": "doc",
  "actions": [{
    "action": "get-info",
    "filePath": "documents/report.docx"
  }]
}
\`\`\`

ACTIONS:

1. **get-info** - Get document metadata and word count
   - filePath: Path to DOCX file (required)

2. **read** - Extract text or HTML content from a DOCX file
   - filePath: Path to DOCX file (required)
   - format: "text" (default) or "html"

3. **create** - Create a new DOCX document from structured content
   - outputPath: Output file path (required)
   - content: Document content object (required):
     - title: Document title (optional)
     - author: Document author (optional)
     - sections: Array of sections, each with:
       - children: Array of content elements:
         - { type: "heading", level: 1-6, text: "..." }
         - { type: "paragraph", text: "...", bold: false, italic: false, fontSize: 24, alignment: "left" }
         - { type: "table", headers: ["Col1", "Col2"], rows: [["val1", "val2"]], widths: [50, 50] }
         - { type: "list", ordered: false, items: ["Item 1", "Item 2"] }
         - { type: "pageBreak" }

EXAMPLES:

1. Get document info:
\`\`\`json
{
  "toolId": "doc",
  "actions": [{
    "action": "get-info",
    "filePath": "documents/report.docx"
  }]
}
\`\`\`

2. Read document as text:
\`\`\`json
{
  "toolId": "doc",
  "actions": [{
    "action": "read",
    "filePath": "documents/report.docx",
    "format": "text"
  }]
}
\`\`\`

3. Create a document:
\`\`\`json
{
  "toolId": "doc",
  "actions": [{
    "action": "create",
    "outputPath": "output/report.docx",
    "content": {
      "title": "Project Report",
      "author": "Loxia Agent",
      "sections": [{
        "children": [
          { "type": "heading", "level": 1, "text": "Introduction" },
          { "type": "paragraph", "text": "This is the introduction paragraph." },
          { "type": "heading", "level": 2, "text": "Data Summary" },
          { "type": "table", "headers": ["Metric", "Value"], "rows": [["Users", "1000"], ["Revenue", "$50K"]] },
          { "type": "list", "ordered": true, "items": ["First point", "Second point", "Third point"] }
        ]
      }]
    }
  }]
}
\`\`\`

NOTES:
- For reading, mammoth provides clean text/HTML extraction
- For creation, the docx package supports rich formatting
- fontSize is in half-points (24 = 12pt, 28 = 14pt, etc.)
- alignment options: "left", "center", "right", "justified"
- Table widths are percentages that should sum to 100
    `.trim();
  }

  /**
   * Parse parameters from tool command content
   * @param {string} content
   * @returns {Object}
   */
  parseParameters(content) {
    try {
      const actionMatches = TagParser.extractContent(content, 'action');
      const filePathMatches = TagParser.extractContent(content, 'filePath');
      const formatMatches = TagParser.extractContent(content, 'format');

      return {
        actions: [{
          action: actionMatches.length > 0 ? actionMatches[0].trim() : 'get-info',
          filePath: filePathMatches.length > 0 ? filePathMatches[0].trim() : '',
          format: formatMatches.length > 0 ? formatMatches[0].trim() : 'text'
        }]
      };
    } catch (error) {
      throw new Error(`Failed to parse Document tool parameters: ${error.message}`);
    }
  }

  /**
   * Get supported actions
   * @returns {Array<string>}
   */
  getSupportedActions() {
    return ['get-info', 'read', 'create'];
  }

  /**
   * Execute document tool action
   * @param {Object} params
   * @param {Object} context
   * @returns {Promise<Object>}
   */
  async execute(params, context) {
    const { actions } = params;

    if (!actions || actions.length === 0) {
      return {
        success: false,
        error: 'No actions provided',
        output: 'Please specify an action (get-info, read, or create)'
      };
    }

    const action = actions[0];

    // Handle create action (no existing file required)
    if (action.action === 'create') {
      try {
        return await this.createDocument(action, context);
      } catch (error) {
        this.logger?.error('DOCX creation error', { error: error.message });
        return {
          success: false,
          error: error.message,
          output: `Failed to create document: ${error.message}`
        };
      }
    }

    // Read-oriented actions require file path
    const { projectDir } = context;
    let filePath = action.filePath;

    if (!filePath) {
      return {
        success: false,
        error: 'File path is required',
        output: 'Please provide a filePath parameter'
      };
    }

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
        output: `The DOCX file does not exist: ${filePath}`
      };
    }

    // Check extension
    if (!filePath.toLowerCase().endsWith('.docx') && !filePath.toLowerCase().endsWith('.doc')) {
      return {
        success: false,
        error: 'Not a DOCX file',
        output: `The file must have a .docx or .doc extension: ${filePath}`
      };
    }

    try {
      switch (action.action) {
        case 'get-info':
          return await this.getInfo(filePath);
        case 'read':
          return await this.readDocument(filePath, action.format || 'text');
        default:
          return {
            success: false,
            error: `Unknown action: ${action.action}`,
            output: 'Supported actions: get-info, read, create'
          };
      }
    } catch (error) {
      this.logger?.error('DOCX tool error', { action: action.action, filePath, error: error.message });
      return {
        success: false,
        error: error.message,
        output: `Failed to process document: ${error.message}`
      };
    }
  }

  /**
   * Get document info (file stats + word count)
   * @param {string} filePath
   * @returns {Promise<Object>}
   */
  async getInfo(filePath) {
    const loaded = await this.loadMammoth();
    if (!loaded) {
      return {
        success: false,
        error: 'mammoth module not available',
        output: `Document reading module could not be loaded: ${this.mammothError}`
      };
    }

    const stats = await fs.stat(filePath);
    const buffer = await fs.readFile(filePath);
    const result = await mammothModule.extractRawText({ buffer });
    const text = result.value || '';
    const wordCount = text.split(/\s+/).filter(w => w.length > 0).length;

    const info = {
      fileName: path.basename(filePath),
      fileSize: stats.size,
      modified: stats.mtime.toISOString(),
      wordCount
    };

    let output = `Document Info: ${info.fileName}\n`;
    output += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
    output += `File size: ${(info.fileSize / 1024).toFixed(1)} KB\n`;
    output += `Word count: ${info.wordCount}\n`;
    output += `Last modified: ${info.modified}\n`;

    return {
      success: true,
      action: 'get-info',
      filePath,
      info,
      output,
      message: `Document: ${info.fileName} (${info.wordCount} words)`
    };
  }

  /**
   * Read document content as text or HTML
   * @param {string} filePath
   * @param {string} format - "text" or "html"
   * @returns {Promise<Object>}
   */
  async readDocument(filePath, format = 'text') {
    const loaded = await this.loadMammoth();
    if (!loaded) {
      return {
        success: false,
        error: 'mammoth module not available',
        output: `Document reading module could not be loaded: ${this.mammothError}`
      };
    }

    const buffer = await fs.readFile(filePath);
    let result;

    if (format === 'html') {
      result = await mammothModule.convertToHtml({ buffer });
    } else {
      result = await mammothModule.extractRawText({ buffer });
    }

    const content = result.value || '';
    const warnings = result.messages?.filter(m => m.type === 'warning').map(m => m.message) || [];

    let output = `Document Content: ${path.basename(filePath)} (${format})\n`;
    output += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
    output += content;

    if (warnings.length > 0) {
      output += `\n\n⚠️ Warnings:\n${warnings.map(w => `- ${w}`).join('\n')}`;
    }

    return {
      success: true,
      action: 'read',
      filePath,
      format,
      content,
      warnings,
      output,
      message: `Read ${path.basename(filePath)} as ${format} (${content.length} chars)`
    };
  }

  /**
   * Create a DOCX document from structured content
   * @param {Object} action - Action parameters
   * @param {Object} context - Execution context
   * @returns {Promise<Object>}
   */
  async createDocument(action, context) {
    const { projectDir } = context;
    const { outputPath, content } = action;

    if (!outputPath) {
      return {
        success: false,
        error: 'Output path is required',
        output: 'Please provide an outputPath parameter'
      };
    }

    if (!content || !content.sections || !Array.isArray(content.sections)) {
      return {
        success: false,
        error: 'Content with sections array is required',
        output: 'Please provide content with a "sections" array containing document elements'
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

    // Ensure .docx extension
    if (!resolvedPath.toLowerCase().endsWith('.docx')) {
      resolvedPath += '.docx';
    }

    // Load docx module
    const loaded = await this.loadDocx();
    if (!loaded) {
      return {
        success: false,
        error: 'docx module not available',
        output: `Document creation module could not be loaded: ${this.docxError}`
      };
    }

    const { Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType, AlignmentType, BorderStyle, PageBreak, LevelFormat } = docxModule;

    // Map alignment strings to AlignmentType
    const alignmentMap = {
      'left': AlignmentType.LEFT,
      'center': AlignmentType.CENTER,
      'right': AlignmentType.RIGHT,
      'justified': AlignmentType.JUSTIFIED
    };

    // Map heading levels
    const headingMap = {
      1: HeadingLevel.HEADING_1,
      2: HeadingLevel.HEADING_2,
      3: HeadingLevel.HEADING_3,
      4: HeadingLevel.HEADING_4,
      5: HeadingLevel.HEADING_5,
      6: HeadingLevel.HEADING_6
    };

    // Build sections
    const docSections = [];

    for (const section of content.sections) {
      const children = [];

      if (!section.children || !Array.isArray(section.children)) continue;

      for (const element of section.children) {
        switch (element.type) {
          case 'heading': {
            children.push(new Paragraph({
              text: element.text || '',
              heading: headingMap[element.level] || HeadingLevel.HEADING_1,
              alignment: alignmentMap[element.alignment] || undefined
            }));
            break;
          }

          case 'paragraph': {
            const runs = [new TextRun({
              text: element.text || '',
              bold: element.bold || false,
              italics: element.italic || false,
              size: element.fontSize || undefined
            })];
            children.push(new Paragraph({
              children: runs,
              alignment: alignmentMap[element.alignment] || undefined
            }));
            break;
          }

          case 'table': {
            const rows = [];

            // Header row
            if (element.headers && Array.isArray(element.headers)) {
              rows.push(new TableRow({
                children: element.headers.map((header, i) => new TableCell({
                  children: [new Paragraph({
                    children: [new TextRun({ text: String(header), bold: true })]
                  })],
                  width: element.widths?.[i]
                    ? { size: element.widths[i], type: WidthType.PERCENTAGE }
                    : undefined
                }))
              }));
            }

            // Data rows
            if (element.rows && Array.isArray(element.rows)) {
              for (const row of element.rows) {
                rows.push(new TableRow({
                  children: (Array.isArray(row) ? row : []).map((cell, i) => new TableCell({
                    children: [new Paragraph({ text: String(cell) })],
                    width: element.widths?.[i]
                      ? { size: element.widths[i], type: WidthType.PERCENTAGE }
                      : undefined
                  }))
                }));
              }
            }

            if (rows.length > 0) {
              children.push(new Table({ rows }));
            }
            break;
          }

          case 'list': {
            const items = element.items || [];
            for (let i = 0; i < items.length; i++) {
              children.push(new Paragraph({
                text: String(items[i]),
                numbering: element.ordered
                  ? { reference: 'ordered-list', level: 0 }
                  : { reference: 'bullet-list', level: 0 }
              }));
            }
            break;
          }

          case 'pageBreak': {
            children.push(new Paragraph({
              children: [new PageBreak()]
            }));
            break;
          }

          default:
            // Unknown element type, skip
            break;
        }
      }

      docSections.push({ children });
    }

    // Create document
    const doc = new Document({
      title: content.title || undefined,
      creator: content.author || 'Loxia Agent',
      numbering: {
        config: [
          {
            reference: 'bullet-list',
            levels: [{
              level: 0,
              format: LevelFormat.BULLET,
              text: '\u2022',
              alignment: AlignmentType.LEFT,
              style: { paragraph: { indent: { left: 720, hanging: 360 } } }
            }]
          },
          {
            reference: 'ordered-list',
            levels: [{
              level: 0,
              format: LevelFormat.DECIMAL,
              text: '%1.',
              alignment: AlignmentType.LEFT,
              style: { paragraph: { indent: { left: 720, hanging: 360 } } }
            }]
          }
        ]
      },
      sections: docSections
    });

    // Generate and write file
    const buffer = await Packer.toBuffer(doc);
    await fs.writeFile(resolvedPath, buffer);

    const stats = await fs.stat(resolvedPath);

    const output = `Document created successfully!\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `File: ${resolvedPath}\n` +
      `Size: ${(stats.size / 1024).toFixed(1)} KB\n` +
      (content.title ? `Title: ${content.title}\n` : '') +
      `Sections: ${content.sections.length}`;

    return {
      success: true,
      action: 'create',
      outputPath: resolvedPath,
      fileSize: stats.size,
      output,
      message: `Document created: ${resolvedPath} (${(stats.size / 1024).toFixed(1)} KB)`
    };
  }
}

export default DocxTool;
