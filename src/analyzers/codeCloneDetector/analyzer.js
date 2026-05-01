/**
 * Analyzes clones and provides refactoring recommendations
 */
export class RefactoringAnalyzer {
  constructor(config) {
    this.config = config;
  }

  /**
   * Analyze clones and provide refactoring advice
   * @param {Array} clones - Array of detected clones
   * @returns {Array} Enriched clones with refactoring advice
   */
  analyzeClones(clones) {
    console.log('Analyzing clones for refactoring opportunities...');
    
    return clones.map((clone, index) => {
      const metrics = this.calculateMetrics(clone);
      const advice = this.generateRefactoringAdvice(clone, metrics);
      
      return {
        id: `clone-${index + 1}`,
        type: clone.type,
        confidence: clone.confidence,
        instances: clone.blocks.map(block => ({
          file: block.file,
          startLine: block.startLine,
          endLine: block.endLine,
          code: this.truncateCode(block.code),
          fullCode: block.code,
          blockType: block.type
        })),
        metrics,
        refactoringAdvice: advice
      };
    }).sort((a, b) => b.metrics.impactScore - a.metrics.impactScore);
  }

  /**
   * Calculate metrics for a clone
   */
  calculateMetrics(clone) {
    const blocks = clone.blocks;
    const tokenCount = clone.tokenCount;
    const lineCount = this.averageLineCount(blocks);
    const instanceCount = blocks.length;
    
    // Calculate impact score (higher = more important to refactor)
    const impactScore = this.calculateImpactScore(
      tokenCount,
      lineCount,
      instanceCount,
      clone.confidence
    );
    
    // Calculate duplication overhead
    const duplicatedLines = lineCount * (instanceCount - 1);
    const duplicatedTokens = tokenCount * (instanceCount - 1);
    
    return {
      tokenCount,
      lineCount,
      instanceCount,
      duplicatedLines,
      duplicatedTokens,
      impactScore: parseFloat(impactScore.toFixed(2)),
      filesCovered: new Set(blocks.map(b => b.file)).size
    };
  }

  /**
   * Calculate impact score for prioritization
   */
  calculateImpactScore(tokenCount, lineCount, instanceCount, confidence) {
    // Weighted formula:
    // - Size matters (more tokens = more important)
    // - Instances matter (more copies = more important)
    // - Confidence matters
    // - Line count matters (user visibility)
    
    const sizeScore = Math.log10(tokenCount + 1) * 2;
    const instanceScore = Math.log2(instanceCount + 1) * 3;
    const confidenceScore = confidence * 2;
    const lineScore = Math.min(lineCount / 10, 3);
    
    return sizeScore + instanceScore + confidenceScore + lineScore;
  }

  /**
   * Generate refactoring advice
   */
  generateRefactoringAdvice(clone, metrics) {
    const strategy = this.determineRefactoringStrategy(clone, metrics);
    const priority = this.determinePriority(metrics);
    const suggestedName = this.suggestName(clone);
    const reasoning = this.generateReasoning(clone, metrics, strategy);
    const estimatedEffort = this.estimateEffort(metrics, strategy);
    const benefits = this.describeBenefits(metrics);
    
    return {
      priority,
      strategy,
      suggestedName,
      reasoning,
      estimatedEffort,
      benefits,
      actionableSteps: this.generateActionableSteps(strategy, suggestedName, metrics)
    };
  }

  /**
   * Determine refactoring strategy
   */
  determineRefactoringStrategy(clone, metrics) {
    const { tokenCount, lineCount, instanceCount, filesCovered } = metrics;
    const blockTypes = clone.blocks.map(b => b.type);
    
    // Check if it's a function/method
    const isFunctionLike = blockTypes.some(type => 
      type.includes('Function') || type.includes('Method')
    );
    
    // Check if it's a class
    const isClassLike = blockTypes.some(type => 
      type.includes('Class')
    );
    
    // Decision tree
    if (isClassLike && lineCount > 50) {
      return 'extract-module';
    } else if (filesCovered > 2 && tokenCount > 100) {
      return 'extract-module';
    } else if (isFunctionLike || (lineCount >= 10 && lineCount <= 50)) {
      return 'extract-function';
    } else if (lineCount > 50) {
      return 'extract-class';
    } else if (lineCount < 10) {
      return 'extract-constant-or-utility';
    } else {
      return 'extract-function';
    }
  }

  /**
   * Determine priority level
   */
  determinePriority(metrics) {
    const { impactScore } = metrics;
    
    if (impactScore >= 8) return 'high';
    if (impactScore >= 5) return 'medium';
    return 'low';
  }

  /**
   * Suggest a name based on code analysis
   */
  suggestName(clone) {
    // Extract common words from the code
    const allCode = clone.blocks.map(b => b.code).join(' ');
    
    // Look for common identifiers
    const identifiers = allCode.match(/[a-zA-Z_$][a-zA-Z0-9_$]*/g) || [];
    const frequency = {};
    
    identifiers.forEach(id => {
      // Skip common keywords
      if (['const', 'let', 'var', 'function', 'return', 'if', 'else', 'for', 'while'].includes(id)) {
        return;
      }
      frequency[id] = (frequency[id] || 0) + 1;
    });
    
    // Find most common meaningful identifier
    const sorted = Object.entries(frequency)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3);
    
    if (sorted.length > 0) {
      // Create a descriptive name from top identifiers
      const topWords = sorted.map(([word]) => word);
      return this.createFunctionName(topWords);
    }
    
    return 'extractedFunction';
  }

  /**
   * Create a function name from words
   */
  createFunctionName(words) {
    if (words.length === 0) return 'extractedFunction';
    
    // Convert to camelCase
    return words[0] + words.slice(1).map(w => 
      w.charAt(0).toUpperCase() + w.slice(1)
    ).join('');
  }

  /**
   * Generate reasoning for refactoring
   */
  generateReasoning(clone, metrics, strategy) {
    const { instanceCount, duplicatedLines, filesCovered } = metrics;
    
    let reasoning = `This ${clone.type} code pattern appears ${instanceCount} times`;
    
    if (filesCovered > 1) {
      reasoning += ` across ${filesCovered} different files`;
    }
    
    reasoning += `, resulting in ${duplicatedLines} duplicated lines. `;
    
    reasoning += `Refactoring to ${strategy.replace(/-/g, ' ')} would improve maintainability`;
    
    if (instanceCount >= 3) {
      reasoning += ', reduce bugs from inconsistent changes';
    }
    
    reasoning += ', and reduce code size';
    
    if (metrics.impactScore >= 8) {
      reasoning += '. This is a high-impact refactoring opportunity';
    }
    
    return reasoning + '.';
  }

  /**
   * Estimate effort for refactoring
   */
  estimateEffort(metrics, strategy) {
    const { lineCount, instanceCount, filesCovered } = metrics;
    
    let effortPoints = 0;
    
    // Base effort on size
    effortPoints += Math.min(lineCount / 10, 5);
    
    // Effort increases with instances
    effortPoints += instanceCount * 0.5;
    
    // Effort increases with file spread
    effortPoints += filesCovered * 0.5;
    
    // Strategy-specific effort
    if (strategy === 'extract-module') {
      effortPoints += 3;
    } else if (strategy === 'extract-class') {
      effortPoints += 2;
    } else if (strategy === 'extract-function') {
      effortPoints += 1;
    }
    
    if (effortPoints <= 3) return 'low';
    if (effortPoints <= 7) return 'medium';
    return 'high';
  }

  /**
   * Describe benefits of refactoring
   */
  describeBenefits(metrics) {
    const benefits = [];
    
    benefits.push(`Eliminate ${metrics.duplicatedLines} duplicated lines of code`);
    benefits.push(`Improve maintainability by centralizing logic in one place`);
    
    if (metrics.instanceCount >= 3) {
      benefits.push(`Reduce risk of inconsistent changes across ${metrics.instanceCount} locations`);
    }
    
    if (metrics.filesCovered > 2) {
      benefits.push(`Improve code organization across ${metrics.filesCovered} files`);
    }
    
    benefits.push('Make future changes easier and less error-prone');
    
    return benefits;
  }

  /**
   * Generate actionable steps
   */
  generateActionableSteps(strategy, suggestedName, metrics) {
    const steps = [];
    
    switch (strategy) {
      case 'extract-function':
        steps.push(`1. Create a new function named '${suggestedName}'`);
        steps.push('2. Move the duplicated logic into this function');
        steps.push('3. Identify parameters needed from the surrounding context');
        steps.push('4. Replace all instances with calls to the new function');
        steps.push('5. Test to ensure behavior is preserved');
        break;
        
      case 'extract-class':
        steps.push(`1. Create a new class to encapsulate this functionality`);
        steps.push('2. Move related methods and properties into the class');
        steps.push('3. Update all instances to use the new class');
        steps.push('4. Consider dependency injection for better testability');
        break;
        
      case 'extract-module':
        steps.push(`1. Create a new module/file for this shared functionality`);
        steps.push('2. Move the duplicated code into the new module');
        steps.push('3. Export the necessary functions/classes');
        steps.push('4. Update all files to import from the new module');
        steps.push('5. Update any build configurations if needed');
        break;
        
      default:
        steps.push(`1. Extract the duplicated code using ${strategy.replace(/-/g, ' ')}`);
        steps.push('2. Replace all instances with the extracted version');
        steps.push('3. Test thoroughly');
    }
    
    return steps;
  }

  /**
   * Truncate code for display
   */
  truncateCode(code, maxLines = 10) {
    const lines = code.split('\n');
    
    if (lines.length <= maxLines) {
      return code;
    }
    
    return lines.slice(0, maxLines).join('\n') + '\n... (truncated)';
  }

  /**
   * Calculate average line count
   */
  averageLineCount(blocks) {
    const totalLines = blocks.reduce((sum, block) => 
      sum + (block.endLine - block.startLine + 1), 0
    );
    
    return Math.round(totalLines / blocks.length);
  }
}
