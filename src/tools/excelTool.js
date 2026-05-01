/**
 * Spreadsheet (Excel) Tool - Read and create Excel files
 *
 * Purpose:
 * - Get spreadsheet metadata (sheet names, row/column counts)
 * - Read data from specific sheets and ranges
 * - Create Excel workbooks with formatting, formulas, and styling
 */

import { BaseTool } from './baseTool.js';
import TagParser from '../utilities/tagParser.js';
import fs from 'fs/promises';
import path from 'path';

// Lazy-loaded dependency
let ExcelJS = null;

class ExcelTool extends BaseTool {
  constructor(config = {}, logger = null) {
    super(config, logger);
    this.id = 'spreadsheet';
    this.name = 'Spreadsheet Tool';
    this.description = 'Read and create Excel (XLSX) spreadsheets';
    this.version = '1.0.0';
    this.requiresProject = false;
    this.isAsync = false;
    this.excelLoaded = false;
    this.excelError = null;
  }

  /**
   * Lazily load ExcelJS module
   * @returns {Promise<boolean>}
   */
  async loadExcelJS() {
    if (this.excelLoaded) return true;
    if (this.excelError) return false;

    try {
      const mod = await import('exceljs');
      ExcelJS = mod.default || mod;
      this.excelLoaded = true;
      return true;
    } catch (error) {
      this.excelError = error.message;
      this.logger?.error('Failed to load exceljs module', { error: error.message });
      return false;
    }
  }

  /**
   * Get tool description for LLM consumption
   * @returns {string}
   */
  getDescription() {
    return `
Spreadsheet Tool: Read and create Excel (XLSX) spreadsheets.

USAGE:
\`\`\`json
{
  "toolId": "spreadsheet",
  "actions": [{
    "action": "get-info",
    "filePath": "data/report.xlsx"
  }]
}
\`\`\`

ACTIONS:

1. **get-info** - Get spreadsheet metadata
   - filePath: Path to Excel file (required)
   - Returns: sheet names, row counts, column counts per sheet

2. **read** - Read data from a sheet
   - filePath: Path to Excel file (required)
   - sheetName: Sheet name (optional, defaults to first sheet)
   - startRow: Start row number, 1-indexed (optional, default: 1)
   - endRow: End row number, inclusive (optional, default: all rows)
   - includeFormulas: Return formulas instead of values (optional, default: false)

3. **create** - Create a new Excel workbook
   - outputPath: Output file path (required)
   - content: Workbook content object (required):
     - sheets: Array of sheet definitions:
       - name: Sheet name
       - columns: [{ header: "Name", key: "name", width: 20 }]
       - rows: [{ name: "John", age: 30 }] or [["John", 30]]
       - headerStyle: { bold: true, fill: "#4472C4", fontColor: "#FFFFFF" }
       - freezeRow: Freeze panes at this row (optional)
       - autoFilter: Enable auto-filter on headers (optional, default: false)
       - formulas: [{ cell: "C2", formula: "=A2+B2" }]

EXAMPLES:

1. Get spreadsheet info:
\`\`\`json
{
  "toolId": "spreadsheet",
  "actions": [{
    "action": "get-info",
    "filePath": "data/sales.xlsx"
  }]
}
\`\`\`

2. Read data from a specific sheet:
\`\`\`json
{
  "toolId": "spreadsheet",
  "actions": [{
    "action": "read",
    "filePath": "data/sales.xlsx",
    "sheetName": "Q1 Sales",
    "startRow": 1,
    "endRow": 50
  }]
}
\`\`\`

3. Create a spreadsheet with formatting:
\`\`\`json
{
  "toolId": "spreadsheet",
  "actions": [{
    "action": "create",
    "outputPath": "output/report.xlsx",
    "content": {
      "sheets": [{
        "name": "Sales Data",
        "columns": [
          { "header": "Product", "key": "product", "width": 25 },
          { "header": "Quantity", "key": "qty", "width": 12 },
          { "header": "Price", "key": "price", "width": 12 },
          { "header": "Total", "key": "total", "width": 15 }
        ],
        "rows": [
          { "product": "Widget A", "qty": 100, "price": 9.99 },
          { "product": "Widget B", "qty": 50, "price": 19.99 }
        ],
        "headerStyle": { "bold": true, "fill": "#4472C4", "fontColor": "#FFFFFF" },
        "freezeRow": 1,
        "autoFilter": true,
        "formulas": [
          { "cell": "D2", "formula": "=B2*C2" },
          { "cell": "D3", "formula": "=B3*C3" }
        ]
      }]
    }
  }]
}
\`\`\`

NOTES:
- Row numbers are 1-indexed (first row is 1, typically the header)
- Values starting with "=" in rows are treated as formulas
- Column widths are in approximate character widths
- Fill colors should be hex codes without # (or with #, both are accepted)
- Multiple sheets can be created in a single workbook
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
      const sheetNameMatches = TagParser.extractContent(content, 'sheetName');

      return {
        actions: [{
          action: actionMatches.length > 0 ? actionMatches[0].trim() : 'get-info',
          filePath: filePathMatches.length > 0 ? filePathMatches[0].trim() : '',
          sheetName: sheetNameMatches.length > 0 ? sheetNameMatches[0].trim() : undefined
        }]
      };
    } catch (error) {
      throw new Error(`Failed to parse Spreadsheet tool parameters: ${error.message}`);
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
   * Execute spreadsheet tool action
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
        return await this.createSpreadsheet(action, context);
      } catch (error) {
        this.logger?.error('Excel creation error', { error: error.message });
        return {
          success: false,
          error: error.message,
          output: `Failed to create spreadsheet: ${error.message}`
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
        output: `The Excel file does not exist: ${filePath}`
      };
    }

    // Check extension
    const ext = filePath.toLowerCase();
    if (!ext.endsWith('.xlsx') && !ext.endsWith('.xls') && !ext.endsWith('.csv')) {
      return {
        success: false,
        error: 'Not a spreadsheet file',
        output: `The file must have a .xlsx, .xls, or .csv extension: ${filePath}`
      };
    }

    // Load ExcelJS
    const loaded = await this.loadExcelJS();
    if (!loaded) {
      return {
        success: false,
        error: 'ExcelJS module not available',
        output: `Spreadsheet module could not be loaded: ${this.excelError}`
      };
    }

    try {
      switch (action.action) {
        case 'get-info':
          return await this.getInfo(filePath);
        case 'read':
          return await this.readSheet(filePath, action);
        default:
          return {
            success: false,
            error: `Unknown action: ${action.action}`,
            output: 'Supported actions: get-info, read, create'
          };
      }
    } catch (error) {
      this.logger?.error('Excel tool error', { action: action.action, filePath, error: error.message });
      return {
        success: false,
        error: error.message,
        output: `Failed to process spreadsheet: ${error.message}`
      };
    }
  }

  /**
   * Get spreadsheet info
   * @param {string} filePath
   * @returns {Promise<Object>}
   */
  async getInfo(filePath) {
    const workbook = new ExcelJS.Workbook();

    if (filePath.toLowerCase().endsWith('.csv')) {
      await workbook.csv.readFile(filePath);
    } else {
      await workbook.xlsx.readFile(filePath);
    }

    const sheets = [];
    workbook.eachSheet((worksheet) => {
      sheets.push({
        name: worksheet.name,
        rowCount: worksheet.rowCount,
        columnCount: worksheet.columnCount,
        actualRowCount: worksheet.actualRowCount
      });
    });

    let output = `Spreadsheet Info: ${path.basename(filePath)}\n`;
    output += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
    output += `Sheets: ${sheets.length}\n\n`;

    for (const sheet of sheets) {
      output += `📊 ${sheet.name}\n`;
      output += `   Rows: ${sheet.actualRowCount || sheet.rowCount}\n`;
      output += `   Columns: ${sheet.columnCount}\n\n`;
    }

    return {
      success: true,
      action: 'get-info',
      filePath,
      sheets,
      output,
      message: `Spreadsheet has ${sheets.length} sheet(s)`
    };
  }

  /**
   * Read data from a sheet
   * @param {string} filePath
   * @param {Object} action - Action parameters
   * @returns {Promise<Object>}
   */
  async readSheet(filePath, action) {
    const { sheetName, startRow = 1, endRow, includeFormulas = false } = action;

    const workbook = new ExcelJS.Workbook();

    if (filePath.toLowerCase().endsWith('.csv')) {
      await workbook.csv.readFile(filePath);
    } else {
      await workbook.xlsx.readFile(filePath);
    }

    // Get the requested sheet
    let worksheet;
    if (sheetName) {
      worksheet = workbook.getWorksheet(sheetName);
      if (!worksheet) {
        const available = [];
        workbook.eachSheet(ws => available.push(ws.name));
        return {
          success: false,
          error: `Sheet not found: ${sheetName}`,
          output: `Sheet "${sheetName}" not found. Available sheets: ${available.join(', ')}`
        };
      }
    } else {
      worksheet = workbook.worksheets[0];
      if (!worksheet) {
        return {
          success: false,
          error: 'No sheets in workbook',
          output: 'The workbook has no sheets'
        };
      }
    }

    const totalRows = worksheet.actualRowCount || worksheet.rowCount;
    const effectiveEnd = endRow ? Math.min(endRow, totalRows) : totalRows;
    const effectiveStart = Math.max(1, startRow);

    const rows = [];
    for (let r = effectiveStart; r <= effectiveEnd; r++) {
      const row = worksheet.getRow(r);
      const rowData = [];

      for (let c = 1; c <= worksheet.columnCount; c++) {
        const cell = row.getCell(c);
        if (includeFormulas && cell.formula) {
          rowData.push(`=${cell.formula}`);
        } else {
          rowData.push(cell.value !== null && cell.value !== undefined ? cell.value : '');
        }
      }

      rows.push(rowData);
    }

    // Build output
    let output = `Sheet: ${worksheet.name} (rows ${effectiveStart}-${effectiveEnd} of ${totalRows})\n`;
    output += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;

    // Format as text table
    for (let i = 0; i < rows.length; i++) {
      const rowNum = effectiveStart + i;
      const values = rows[i].map(v => {
        if (v === null || v === undefined) return '';
        if (typeof v === 'object' && v.result !== undefined) return String(v.result);
        return String(v);
      });
      output += `Row ${rowNum}: ${values.join(' | ')}\n`;
    }

    return {
      success: true,
      action: 'read',
      filePath,
      sheetName: worksheet.name,
      startRow: effectiveStart,
      endRow: effectiveEnd,
      totalRows,
      rowCount: rows.length,
      rows,
      output,
      message: `Read ${rows.length} rows from "${worksheet.name}"`
    };
  }

  /**
   * Create an Excel workbook
   * @param {Object} action - Action parameters
   * @param {Object} context - Execution context
   * @returns {Promise<Object>}
   */
  async createSpreadsheet(action, context) {
    const { projectDir } = context;
    const { outputPath, content } = action;

    if (!outputPath) {
      return {
        success: false,
        error: 'Output path is required',
        output: 'Please provide an outputPath parameter'
      };
    }

    if (!content || !content.sheets || !Array.isArray(content.sheets)) {
      return {
        success: false,
        error: 'Content with sheets array is required',
        output: 'Please provide content with a "sheets" array'
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

    // Ensure .xlsx extension
    if (!resolvedPath.toLowerCase().endsWith('.xlsx')) {
      resolvedPath += '.xlsx';
    }

    // Load ExcelJS
    const loaded = await this.loadExcelJS();
    if (!loaded) {
      return {
        success: false,
        error: 'ExcelJS module not available',
        output: `Spreadsheet module could not be loaded: ${this.excelError}`
      };
    }

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Loxia Agent';
    workbook.created = new Date();

    for (const sheetDef of content.sheets) {
      const worksheet = workbook.addWorksheet(sheetDef.name || 'Sheet');

      // Set columns
      if (sheetDef.columns && Array.isArray(sheetDef.columns)) {
        worksheet.columns = sheetDef.columns.map(col => ({
          header: col.header || '',
          key: col.key || col.header?.toLowerCase().replace(/\s+/g, '_') || '',
          width: col.width || 15
        }));
      }

      // Apply header styling
      if (sheetDef.headerStyle && worksheet.columns?.length > 0) {
        const headerRow = worksheet.getRow(1);
        const style = sheetDef.headerStyle;

        headerRow.eachCell((cell) => {
          if (style.bold) {
            cell.font = { ...cell.font, bold: true };
          }
          if (style.fontColor) {
            const color = style.fontColor.replace('#', '');
            cell.font = { ...cell.font, color: { argb: `FF${color}` } };
          }
          if (style.fill) {
            const fillColor = style.fill.replace('#', '');
            cell.fill = {
              type: 'pattern',
              pattern: 'solid',
              fgColor: { argb: `FF${fillColor}` }
            };
          }
        });
      }

      // Add rows
      if (sheetDef.rows && Array.isArray(sheetDef.rows)) {
        for (const row of sheetDef.rows) {
          if (Array.isArray(row)) {
            // Array format: [val1, val2, ...]
            const addedRow = worksheet.addRow(row);
            // Check for formula values
            row.forEach((val, i) => {
              if (typeof val === 'string' && val.startsWith('=')) {
                addedRow.getCell(i + 1).value = { formula: val.substring(1) };
              }
            });
          } else if (typeof row === 'object') {
            // Object format: { key: value }
            const addedRow = worksheet.addRow(row);
            // Check for formula values in object
            for (const [key, val] of Object.entries(row)) {
              if (typeof val === 'string' && val.startsWith('=')) {
                const colIndex = worksheet.columns.findIndex(c => c.key === key);
                if (colIndex >= 0) {
                  addedRow.getCell(colIndex + 1).value = { formula: val.substring(1) };
                }
              }
            }
          }
        }
      }

      // Apply formulas
      if (sheetDef.formulas && Array.isArray(sheetDef.formulas)) {
        for (const formulaDef of sheetDef.formulas) {
          if (formulaDef.cell && formulaDef.formula) {
            const cell = worksheet.getCell(formulaDef.cell);
            const formula = formulaDef.formula.startsWith('=')
              ? formulaDef.formula.substring(1)
              : formulaDef.formula;
            cell.value = { formula };
          }
        }
      }

      // Freeze panes
      if (sheetDef.freezeRow) {
        worksheet.views = [{
          state: 'frozen',
          ySplit: sheetDef.freezeRow
        }];
      }

      // Auto-filter
      if (sheetDef.autoFilter && worksheet.columns?.length > 0) {
        const lastCol = worksheet.columnCount;
        const lastColLetter = this._getColumnLetter(lastCol);
        worksheet.autoFilter = {
          from: 'A1',
          to: `${lastColLetter}1`
        };
      }
    }

    // Write file
    await workbook.xlsx.writeFile(resolvedPath);

    const stats = await fs.stat(resolvedPath);

    const sheetNames = content.sheets.map(s => s.name || 'Sheet');
    const output = `Spreadsheet created successfully!\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `File: ${resolvedPath}\n` +
      `Size: ${(stats.size / 1024).toFixed(1)} KB\n` +
      `Sheets: ${sheetNames.join(', ')}`;

    return {
      success: true,
      action: 'create',
      outputPath: resolvedPath,
      fileSize: stats.size,
      sheets: sheetNames,
      output,
      message: `Spreadsheet created: ${resolvedPath} (${sheetNames.length} sheet(s))`
    };
  }

  /**
   * Convert column number to letter (1=A, 2=B, ..., 27=AA)
   * @param {number} num
   * @returns {string}
   * @private
   */
  _getColumnLetter(num) {
    let letter = '';
    while (num > 0) {
      const remainder = (num - 1) % 26;
      letter = String.fromCharCode(65 + remainder) + letter;
      num = Math.floor((num - 1) / 26);
    }
    return letter;
  }
}

export default ExcelTool;
