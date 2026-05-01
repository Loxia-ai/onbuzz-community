import fs from 'fs';

/**
 * Formats and outputs clone detection results
 */
export class Reporter {
  /**
   * Generate comprehensive report
   * @param {Array} clones - Analyzed clones with refactoring advice
   * @param {Array} files - Parsed files
   * @returns {Object} Report object
   */
  generateReport(clones, files) {
    const summary = this.generateSummary(clones, files);
    
    return {
      summary,
      clones: clones.map(clone => this.formatClone(clone)),
      metadata: {
        generatedAt: new Date().toISOString(),
        tool: 'code-clone-detector',
        version: '1.0.0'
      }
    };
  }

  /**
   * Generate summary statistics
   */
  generateSummary(clones, files) {
    const totalFiles = files.length;
    const totalClones = clones.length;
    
    // Calculate total duplicated lines
    const totalDuplicatedLines = clones.reduce((sum, clone) => 
      sum + clone.metrics.duplicatedLines, 0
    );
    
    // Calculate total lines of code
    const totalLines = files.reduce((sum, file) => 
      sum + file.content.split('\n').length, 0
    );
    
    const duplicationPercentage = totalLines > 0 
      ? ((totalDuplicatedLines / totalLines) * 100).toFixed(2)
      : 0;
    
    // Priority breakdown
    const priorityCounts = {
      high: clones.filter(c => c.refactoringAdvice.priority === 'high').length,
      medium: clones.filter(c => c.refactoringAdvice.priority === 'medium').length,
      low: clones.filter(c => c.refactoringAdvice.priority === 'low').length
    };
    
    return {
      totalFiles,
      totalClones,
      totalDuplicatedLines,
      duplicationPercentage: parseFloat(duplicationPercentage),
      priorityCounts,
      topRefactoringOpportunities: clones.slice(0, 5).map(c => c.id)
    };
  }

  /**
   * Format clone for output
   */
  formatClone(clone) {
    return {
      id: clone.id,
      type: clone.type,
      confidence: clone.confidence,
      instances: clone.instances,
      metrics: clone.metrics,
      refactoringAdvice: clone.refactoringAdvice
    };
  }

  /**
   * Save report to file
   */
  saveReport(report, outputPath) {
    try {
      fs.writeFileSync(outputPath, JSON.stringify(report, null, 2));
      console.log(`\nReport saved to: ${outputPath}`);
      return true;
    } catch (error) {
      console.error('Error saving report:', error.message);
      return false;
    }
  }

  /**
   * Print summary to console
   */
  printSummary(report) {
    const { summary } = report;
    
    console.log('\n' + '='.repeat(60));
    console.log('CODE CLONE DETECTION SUMMARY');
    console.log('='.repeat(60));
    console.log(`Total Files Analyzed: ${summary.totalFiles}`);
    console.log(`Total Clone Groups Found: ${summary.totalClones}`);
    console.log(`Total Duplicated Lines: ${summary.totalDuplicatedLines}`);
    console.log(`Duplication Percentage: ${summary.duplicationPercentage}%`);
    console.log('\nPriority Breakdown:');
    console.log(`  High Priority: ${summary.priorityCounts.high}`);
    console.log(`  Medium Priority: ${summary.priorityCounts.medium}`);
    console.log(`  Low Priority: ${summary.priorityCounts.low}`);
    
    if (report.clones.length > 0) {
      console.log('\n' + '-'.repeat(60));
      console.log('TOP REFACTORING OPPORTUNITIES');
      console.log('-'.repeat(60));
      
      report.clones.slice(0, 3).forEach((clone, idx) => {
        console.log(`\n${idx + 1}. ${clone.id} [${clone.refactoringAdvice.priority.toUpperCase()} PRIORITY]`);
        console.log(`   Type: ${clone.type} (${(clone.confidence * 100).toFixed(0)}% confidence)`);
        console.log(`   Instances: ${clone.metrics.instanceCount} copies across ${clone.metrics.filesCovered} files`);
        console.log(`   Size: ${clone.metrics.lineCount} lines, ${clone.metrics.tokenCount} tokens`);
        console.log(`   Impact Score: ${clone.metrics.impactScore}`);
        console.log(`   Strategy: ${clone.refactoringAdvice.strategy}`);
        console.log(`   Suggested Name: ${clone.refactoringAdvice.suggestedName}`);
        console.log(`   Reasoning: ${clone.refactoringAdvice.reasoning}`);
      });
    }
    
    console.log('\n' + '='.repeat(60));
  }

  /**
   * Generate AI-friendly summary
   */
  generateAISummary(report) {
    const topClone = report.clones[0];
    
    if (!topClone) {
      return 'No significant code duplication found in the project.';
    }
    
    let summary = `Found ${report.summary.totalClones} code clone groups with ${report.summary.duplicationPercentage}% duplication. `;
    summary += `Top priority: ${topClone.refactoringAdvice.suggestedName} appears ${topClone.metrics.instanceCount} times. `;
    summary += `Recommended action: ${topClone.refactoringAdvice.strategy}. `;
    summary += topClone.refactoringAdvice.reasoning;
    
    return summary;
  }
}
