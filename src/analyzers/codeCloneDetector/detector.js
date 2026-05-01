/**
 * Detects code clones across files (async, non-blocking)
 */
export class CloneDetector {
  constructor(config, parser) {
    this.config = config;
    this.parser = parser;
    this.comparisonBatchSize = config.comparisonBatchSize || 1000; // Yield after this many comparisons
  }

  /**
   * Find all clones in parsed files (async)
   * @param {Array} parsedFiles - Array of parsed file objects
   * @returns {Promise<Array>} Array of clone groups
   */
  async detectClones(parsedFiles) {
    console.log('Detecting clones...');

    const clones = [];
    const allBlocks = [];

    // Collect all code blocks
    for (const file of parsedFiles) {
      allBlocks.push(...file.blocks);
    }

    console.log(`Analyzing ${allBlocks.length} code blocks`);

    // Group blocks by hash for exact clones
    const hashGroups = this.groupByHash(allBlocks);

    // Find exact clones
    for (const [hash, blocks] of Object.entries(hashGroups)) {
      if (blocks.length > 1) {
        clones.push({
          type: 'exact',
          confidence: 1.0,
          blocks,
          tokenCount: blocks[0].tokens.length
        });
      }
    }

    // Find similar clones (more expensive) - now async
    const similarClones = await this.findSimilarClones(allBlocks);
    clones.push(...similarClones);

    console.log(`Found ${clones.length} clone groups`);
    return clones;
  }

  /**
   * Group blocks by hash
   */
  groupByHash(blocks) {
    const groups = {};

    for (const block of blocks) {
      if (block.tokens.length < this.config.minTokens) continue;

      if (!groups[block.hash]) {
        groups[block.hash] = [];
      }
      groups[block.hash].push(block);
    }

    return groups;
  }

  /**
   * Find similar (but not exact) clones - async with batching
   */
  async findSimilarClones(blocks) {
    const similarClones = [];
    const processed = new Set();

    // Filter blocks that meet minimum size
    const eligibleBlocks = blocks.filter(b =>
      b.tokens.length >= this.config.minTokens
    );

    let comparisonCount = 0;
    const totalPossibleComparisons = (eligibleBlocks.length * (eligibleBlocks.length - 1)) / 2;

    // Log progress periodically
    const logInterval = Math.max(1000, Math.floor(totalPossibleComparisons / 10));
    let lastLogCount = 0;

    for (let i = 0; i < eligibleBlocks.length; i++) {
      const block1 = eligibleBlocks[i];
      const cloneGroup = [block1];

      if (processed.has(block1.id)) continue;

      for (let j = i + 1; j < eligibleBlocks.length; j++) {
        const block2 = eligibleBlocks[j];

        if (processed.has(block2.id)) continue;

        // Skip if already exact match
        if (block1.hash === block2.hash) continue;

        // Calculate similarity
        const similarity = this.calculateBlockSimilarity(block1, block2);
        comparisonCount++;

        if (similarity >= this.config.similarityThreshold) {
          cloneGroup.push(block2);
          processed.add(block2.id);
        }

        // Yield to event loop periodically to prevent blocking
        if (comparisonCount % this.comparisonBatchSize === 0) {
          await new Promise(resolve => setImmediate(resolve));

          // Log progress
          if (comparisonCount - lastLogCount >= logInterval) {
            const progress = ((comparisonCount / totalPossibleComparisons) * 100).toFixed(1);
            console.log(`Clone detection progress: ${progress}% (${comparisonCount}/${totalPossibleComparisons} comparisons)`);
            lastLogCount = comparisonCount;
          }
        }
      }

      if (cloneGroup.length > 1) {
        processed.add(block1.id);

        similarClones.push({
          type: 'similar',
          confidence: this.calculateGroupConfidenceFast(cloneGroup),
          blocks: cloneGroup,
          tokenCount: Math.max(...cloneGroup.map(b => b.tokens.length))
        });
      }
    }

    return similarClones;
  }

  /**
   * Calculate similarity between two blocks
   */
  calculateBlockSimilarity(block1, block2) {
    const tokens1 = block1.tokens;
    const tokens2 = block2.tokens;

    // Length similarity check (quick rejection)
    const lengthRatio = Math.min(tokens1.length, tokens2.length) /
                       Math.max(tokens1.length, tokens2.length);

    if (lengthRatio < 0.7) return 0; // Too different in size

    // Token sequence similarity using longest common subsequence
    const lcs = this.longestCommonSubsequence(tokens1, tokens2);
    const lcsRatio = (2 * lcs) / (tokens1.length + tokens2.length);

    return lcsRatio;
  }

  /**
   * Longest common subsequence length - optimized
   */
  longestCommonSubsequence(seq1, seq2) {
    const m = seq1.length;
    const n = seq2.length;

    // Use approximate version for large sequences (lower threshold for performance)
    if (m * n > 10000) {
      return this.approximateLCS(seq1, seq2);
    }

    // Space-optimized LCS using only two rows
    let prev = new Array(n + 1).fill(0);
    let curr = new Array(n + 1).fill(0);

    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        if (seq1[i - 1] === seq2[j - 1]) {
          curr[j] = prev[j - 1] + 1;
        } else {
          curr[j] = Math.max(prev[j], curr[j - 1]);
        }
      }
      // Swap rows
      [prev, curr] = [curr, prev];
    }

    return prev[n];
  }

  /**
   * Approximate LCS for large sequences - faster heuristic
   */
  approximateLCS(seq1, seq2) {
    // Use set intersection as a fast approximation
    const set1 = new Set(seq1);
    const set2 = new Set(seq2);

    let commonTokens = 0;
    for (const token of set1) {
      if (set2.has(token)) {
        commonTokens++;
      }
    }

    // Scale by average occurrence frequency
    const avgLen = (seq1.length + seq2.length) / 2;
    const uniqueAvg = (set1.size + set2.size) / 2;
    const frequencyFactor = avgLen / uniqueAvg;

    return Math.min(commonTokens * frequencyFactor, Math.min(seq1.length, seq2.length));
  }

  /**
   * Calculate confidence for a clone group - fast version without full pairwise comparison
   */
  calculateGroupConfidenceFast(blocks) {
    if (blocks.length < 2) return 0;

    // Sample-based confidence instead of full pairwise
    const first = blocks[0];
    let totalSimilarity = 0;

    for (let i = 1; i < Math.min(blocks.length, 5); i++) {
      totalSimilarity += this.calculateBlockSimilarity(first, blocks[i]);
    }

    return totalSimilarity / Math.min(blocks.length - 1, 4);
  }

  /**
   * Calculate confidence for a clone group (original full version)
   */
  calculateGroupConfidence(blocks) {
    if (blocks.length === 0) return 0;

    // Calculate average pairwise similarity
    let totalSimilarity = 0;
    let comparisons = 0;

    for (let i = 0; i < blocks.length; i++) {
      for (let j = i + 1; j < blocks.length; j++) {
        totalSimilarity += this.calculateBlockSimilarity(blocks[i], blocks[j]);
        comparisons++;
      }
    }

    return comparisons > 0 ? totalSimilarity / comparisons : 0;
  }
}
