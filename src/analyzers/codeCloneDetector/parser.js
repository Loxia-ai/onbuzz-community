import * as parser from '@babel/parser';
import traverse from '@babel/traverse';
import crypto from 'crypto';

/**
 * Parses and tokenizes source code
 */
export class CodeParser {
  constructor(config) {
    this.config = config;
  }

  /**
   * Parse file and extract tokens
   * @param {Object} file - File object with content
   * @returns {Object} Parsed file with tokens and AST info
   */
  parseFile(file) {
    const extension = file.extension;
    
    // Handle JavaScript/TypeScript files
    if (['.js', '.jsx', '.ts', '.tsx', '.vue'].includes(extension)) {
      return this.parseJavaScript(file);
    }
    
    // Fallback to simple tokenization
    return this.simpleTokenize(file);
  }

  /**
   * Parse JavaScript/TypeScript with Babel
   */
  parseJavaScript(file) {
    try {
      const ast = parser.parse(file.content, {
        sourceType: 'module',
        plugins: [
          'jsx',
          'typescript',
          'decorators-legacy',
          'classProperties',
          'optionalChaining',
          'nullishCoalescingOperator'
        ],
        errorRecovery: true
      });

      const tokens = [];
      const blocks = [];
      let blockId = 0;

      // Extract meaningful code blocks (functions, classes, etc.)
      traverse.default(ast, {
        FunctionDeclaration: (path) => this.extractBlock(path, file, blocks, tokens, blockId++),
        FunctionExpression: (path) => this.extractBlock(path, file, blocks, tokens, blockId++),
        ArrowFunctionExpression: (path) => this.extractBlock(path, file, blocks, tokens, blockId++),
        ClassMethod: (path) => this.extractBlock(path, file, blocks, tokens, blockId++),
        ClassDeclaration: (path) => this.extractBlock(path, file, blocks, tokens, blockId++),
      });

      // Also create a flat token sequence for the entire file
      const fileTokens = this.extractTokenSequence(ast);

      return {
        ...file,
        ast,
        tokens: fileTokens,
        blocks,
        parsed: true
      };
    } catch (error) {
      console.error(`Parse error in ${file.path}:`, error.message);
      return this.simpleTokenize(file);
    }
  }

  /**
   * Extract a code block with token sequence
   */
  extractBlock(path, file, blocks, tokens, blockId) {
    const node = path.node;
    const loc = node.loc;
    
    if (!loc) return;

    // Get the source code for this block
    const lines = file.content.split('\n');
    const blockCode = lines.slice(loc.start.line - 1, loc.end.line).join('\n');
    
    // Create token sequence for this block
    const blockTokens = this.tokenizeCode(blockCode);
    
    if (blockTokens.length < this.config.minTokens) return;

    blocks.push({
      id: `${file.path}:block${blockId}`,
      file: file.path,
      startLine: loc.start.line,
      endLine: loc.end.line,
      code: blockCode,
      tokens: blockTokens,
      hash: this.hashTokens(blockTokens),
      type: node.type
    });
  }

  /**
   * Extract token sequence from AST
   */
  extractTokenSequence(ast) {
    const tokens = [];
    
    traverse.default(ast, {
      enter(path) {
        const node = path.node;
        
        // Normalize identifiers but keep structure
        if (node.type === 'Identifier') {
          tokens.push('IDENT');
        } else if (node.type === 'Literal' || node.type === 'StringLiteral' || 
                   node.type === 'NumericLiteral' || node.type === 'BooleanLiteral') {
          tokens.push('LIT');
        } else {
          tokens.push(node.type);
        }
      }
    });
    
    return tokens;
  }

  /**
   * Simple tokenization for non-JS files
   */
  simpleTokenize(file) {
    const tokens = this.tokenizeCode(file.content);
    
    return {
      ...file,
      tokens,
      blocks: [{
        id: `${file.path}:full`,
        file: file.path,
        startLine: 1,
        endLine: file.content.split('\n').length,
        code: file.content,
        tokens,
        hash: this.hashTokens(tokens),
        type: 'File'
      }],
      parsed: false
    };
  }

  /**
   * Tokenize code string (language-agnostic)
   */
  tokenizeCode(code) {
    // Remove comments and normalize
    const cleaned = code
      .replace(/\/\*[\s\S]*?\*\//g, '') // Block comments
      .replace(/\/\/.*/g, '') // Line comments
      .replace(/\s+/g, ' '); // Normalize whitespace

    // Simple tokenization
    const tokens = cleaned.match(/[a-zA-Z_$][a-zA-Z0-9_$]*|[{}()\[\];,.]|[+\-*/%=<>!&|]+|"[^"]*"|'[^']*'|`[^`]*`|\d+/g) || [];
    
    return tokens;
  }

  /**
   * Create hash of token sequence
   */
  hashTokens(tokens) {
    return crypto
      .createHash('md5')
      .update(tokens.join(','))
      .digest('hex');
  }

  /**
   * Calculate similarity between token sequences
   */
  calculateSimilarity(tokens1, tokens2) {
    const len1 = tokens1.length;
    const len2 = tokens2.length;
    
    if (len1 === 0 || len2 === 0) return 0;
    
    // Use Jaccard similarity for token sets
    const set1 = new Set(tokens1);
    const set2 = new Set(tokens2);
    
    const intersection = new Set([...set1].filter(x => set2.has(x)));
    const union = new Set([...set1, ...set2]);
    
    return intersection.size / union.size;
  }
}
