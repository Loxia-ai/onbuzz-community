import { QUALITY_INSPECTOR_CONFIG, AGENT_STATUS, MESSAGE_ROLES } from '../utilities/constants.js';
import { logger } from '../utilities/logger.js';

/**
 * Quality Inspector service for monitoring agent behavior and performance
 * Detects stuck patterns, infinite loops, and provides intervention mechanisms
 */
export class QualityInspector {
  constructor(orchestrator) {
    this.orchestrator = orchestrator;
    this.config = QUALITY_INSPECTOR_CONFIG;
    this.monitoringData = new Map();
    this.interventionHistory = new Map();
    this.isRunning = false;
    this.checkInterval = null;
    
    this.patterns = {
      repetitiveCommands: new PatternDetector('repetitive_commands', 5, 300000), // 5 occurrences in 5 minutes
      infiniteWaiting: new PatternDetector('infinite_waiting', 3, 600000), // 3 occurrences in 10 minutes
      errorLoops: new PatternDetector('error_loops', 4, 180000), // 4 occurrences in 3 minutes
      resourceExhaustion: new PatternDetector('resource_exhaustion', 2, 120000) // 2 occurrences in 2 minutes
    };

    this.metrics = {
      totalInterventions: 0,
      successfulInterventions: 0,
      falsePositives: 0,
      agentsMonitored: new Set(),
      patternsDetected: new Map()
    };
  }

  /**
   * Start the quality inspector monitoring
   */
  start() {
    if (this.isRunning) {
      logger.warn('Quality Inspector is already running');
      return;
    }

    this.isRunning = true;
    this.checkInterval = setInterval(() => {
      this.performQualityCheck();
    }, this.config.CHECK_INTERVAL_MESSAGES * 1000);

    logger.info('Quality Inspector started', {
      checkInterval: this.config.CHECK_INTERVAL_MESSAGES,
      stuckPatterns: this.config.STUCK_PATTERNS,
      interventionThreshold: this.config.INTERVENTION_THRESHOLD
    });
  }

  /**
   * Stop the quality inspector monitoring
   */
  stop() {
    if (!this.isRunning) {
      return;
    }

    this.isRunning = false;
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }

    logger.info('Quality Inspector stopped', {
      totalInterventions: this.metrics.totalInterventions,
      successfulInterventions: this.metrics.successfulInterventions,
      agentsMonitored: this.metrics.agentsMonitored.size
    });
  }

  /**
   * Record agent activity for monitoring
   * @param {string} agentId - Agent identifier
   * @param {Object} activity - Activity data
   */
  recordActivity(agentId, activity) {
    if (!this.isRunning) {
      return;
    }

    try {
      if (!this.monitoringData.has(agentId)) {
        this.monitoringData.set(agentId, {
          activityHistory: [],
          messageCount: 0,
          lastActivity: Date.now(),
          currentPattern: null,
          stuckCount: 0,
          errors: [],
          performanceMetrics: {
            averageResponseTime: 0,
            totalMessages: 0,
            errorRate: 0
          }
        });
        this.metrics.agentsMonitored.add(agentId);
      }

      const agentData = this.monitoringData.get(agentId);
      agentData.activityHistory.push({
        ...activity,
        timestamp: Date.now()
      });

      // Keep only recent activity (last 100 activities)
      if (agentData.activityHistory.length > 100) {
        agentData.activityHistory = agentData.activityHistory.slice(-100);
      }

      agentData.lastActivity = Date.now();
      agentData.messageCount++;

      // Update performance metrics
      this.updatePerformanceMetrics(agentId, activity);

      // Check for patterns in real-time
      this.detectPatterns(agentId, activity);

      logger.debug('Activity recorded', {
        agentId,
        activityType: activity.type,
        messageCount: agentData.messageCount
      });

    } catch (error) {
      logger.error('Failed to record activity', { error: error.message, agentId });
    }
  }

  /**
   * Perform comprehensive quality check on all monitored agents
   */
  async performQualityCheck() {
    try {
      logger.debug('Performing quality check', {
        agentsMonitored: this.metrics.agentsMonitored.size
      });

      for (const [agentId, agentData] of this.monitoringData) {
        await this.checkAgentQuality(agentId, agentData);
      }

      // Cleanup old data
      this.cleanupOldData();

    } catch (error) {
      logger.error('Quality check failed', { error: error.message });
    }
  }

  /**
   * Check quality for a specific agent
   * @param {string} agentId - Agent identifier
   * @param {Object} agentData - Agent monitoring data
   */
  async checkAgentQuality(agentId, agentData) {
    try {
      // Check if agent is stuck
      const stuckPattern = this.detectStuckPattern(agentId, agentData);
      
      if (stuckPattern) {
        await this.handleStuckAgent(agentId, stuckPattern);
        return;
      }

      // Check performance degradation
      const performanceIssue = this.detectPerformanceIssue(agentId, agentData);
      
      if (performanceIssue) {
        await this.handlePerformanceIssue(agentId, performanceIssue);
        return;
      }

      // Check error patterns
      const errorPattern = this.detectErrorPattern(agentId, agentData);
      
      if (errorPattern) {
        await this.handleErrorPattern(agentId, errorPattern);
        return;
      }

      // Agent is healthy
      if (agentData.stuckCount > 0) {
        agentData.stuckCount = 0;
        logger.debug('Agent recovered', { agentId });
      }

    } catch (error) {
      logger.error('Agent quality check failed', { error: error.message, agentId });
    }
  }

  /**
   * Detect if an agent is stuck based on activity patterns
   * @param {string} agentId - Agent identifier
   * @param {Object} agentData - Agent monitoring data
   * @returns {Object|null} Stuck pattern details or null
   */
  detectStuckPattern(agentId, agentData) {
    const now = Date.now();
    const recentActivities = agentData.activityHistory.filter(
      activity => now - activity.timestamp < 600000 // Last 10 minutes
    );

    // Check for repetitive commands
    if (this.patterns.repetitiveCommands.check(recentActivities)) {
      return {
        type: 'repetitive_commands',
        description: 'Agent is repeating the same commands',
        severity: 'medium',
        activities: recentActivities
      };
    }

    // Check for infinite waiting
    if (this.patterns.infiniteWaiting.check(recentActivities)) {
      return {
        type: 'infinite_waiting',
        description: 'Agent appears to be waiting indefinitely',
        severity: 'high',
        activities: recentActivities
      };
    }

    // Check for error loops
    if (this.patterns.errorLoops.check(recentActivities)) {
      return {
        type: 'error_loops',
        description: 'Agent is stuck in an error loop',
        severity: 'high',
        activities: recentActivities
      };
    }

    // Check for resource exhaustion
    if (this.patterns.resourceExhaustion.check(recentActivities)) {
      return {
        type: 'resource_exhaustion',
        description: 'Agent is experiencing resource exhaustion',
        severity: 'critical',
        activities: recentActivities
      };
    }

    return null;
  }

  /**
   * Detect performance issues
   * @param {string} agentId - Agent identifier
   * @param {Object} agentData - Agent monitoring data
   * @returns {Object|null} Performance issue details or null
   */
  detectPerformanceIssue(agentId, agentData) {
    const metrics = agentData.performanceMetrics;
    
    // Check response time degradation
    if (metrics.averageResponseTime > 30000) { // 30 seconds
      return {
        type: 'slow_response',
        description: 'Agent response time is degraded',
        severity: 'medium',
        metrics: { averageResponseTime: metrics.averageResponseTime }
      };
    }

    // Check high error rate
    if (metrics.errorRate > 0.5) { // 50% error rate
      return {
        type: 'high_error_rate',
        description: 'Agent has high error rate',
        severity: 'high',
        metrics: { errorRate: metrics.errorRate }
      };
    }

    return null;
  }

  /**
   * Detect error patterns
   * @param {string} agentId - Agent identifier
   * @param {Object} agentData - Agent monitoring data
   * @returns {Object|null} Error pattern details or null
   */
  detectErrorPattern(agentId, agentData) {
    const recentErrors = agentData.errors.filter(
      error => Date.now() - error.timestamp < 300000 // Last 5 minutes
    );

    if (recentErrors.length >= 3) {
      const errorTypes = recentErrors.map(e => e.type);
      const uniqueErrorTypes = [...new Set(errorTypes)];

      if (uniqueErrorTypes.length === 1) {
        return {
          type: 'recurring_error',
          description: `Agent is experiencing recurring ${uniqueErrorTypes[0]} errors`,
          severity: 'high',
          errorType: uniqueErrorTypes[0],
          count: recentErrors.length
        };
      }
    }

    return null;
  }

  /**
   * Handle stuck agent intervention
   * @param {string} agentId - Agent identifier
   * @param {Object} stuckPattern - Stuck pattern details
   */
  async handleStuckAgent(agentId, stuckPattern) {
    try {
      const agentData = this.monitoringData.get(agentId);
      agentData.stuckCount++;

      // Record pattern detection
      if (!this.metrics.patternsDetected.has(stuckPattern.type)) {
        this.metrics.patternsDetected.set(stuckPattern.type, 0);
      }
      this.metrics.patternsDetected.set(
        stuckPattern.type,
        this.metrics.patternsDetected.get(stuckPattern.type) + 1
      );

      logger.warn('Stuck agent detected', {
        agentId,
        pattern: stuckPattern.type,
        severity: stuckPattern.severity,
        stuckCount: agentData.stuckCount
      });

      // Check if intervention is needed
      if (agentData.stuckCount >= this.config.INTERVENTION_THRESHOLD) {
        await this.performIntervention(agentId, stuckPattern);
      }

    } catch (error) {
      logger.error('Failed to handle stuck agent', { error: error.message, agentId });
    }
  }

  /**
   * Handle performance issue intervention
   * @param {string} agentId - Agent identifier
   * @param {Object} performanceIssue - Performance issue details
   */
  async handlePerformanceIssue(agentId, performanceIssue) {
    try {
      logger.warn('Performance issue detected', {
        agentId,
        issueType: performanceIssue.type,
        severity: performanceIssue.severity,
        metrics: performanceIssue.metrics
      });

      // Suggest optimization based on issue type
      const suggestion = this.generateOptimizationSuggestion(performanceIssue);
      
      if (suggestion) {
        await this.orchestrator.sendSystemMessage(agentId, {
          type: 'performance_optimization',
          content: suggestion,
          priority: 'medium'
        });
      }

    } catch (error) {
      logger.error('Failed to handle performance issue', { error: error.message, agentId });
    }
  }

  /**
   * Handle error pattern intervention
   * @param {string} agentId - Agent identifier
   * @param {Object} errorPattern - Error pattern details
   */
  async handleErrorPattern(agentId, errorPattern) {
    try {
      logger.warn('Error pattern detected', {
        agentId,
        patternType: errorPattern.type,
        errorType: errorPattern.errorType,
        count: errorPattern.count
      });

      // Provide error resolution guidance
      const guidance = this.generateErrorGuidance(errorPattern);
      
      if (guidance) {
        await this.orchestrator.sendSystemMessage(agentId, {
          type: 'error_guidance',
          content: guidance,
          priority: 'high'
        });
      }

    } catch (error) {
      logger.error('Failed to handle error pattern', { error: error.message, agentId });
    }
  }

  /**
   * Perform intervention on stuck agent
   * @param {string} agentId - Agent identifier
   * @param {Object} stuckPattern - Stuck pattern details
   */
  async performIntervention(agentId, stuckPattern) {
    try {
      this.metrics.totalInterventions++;

      // Check cooldown period
      const lastIntervention = this.interventionHistory.get(agentId);
      const now = Date.now();
      
      if (lastIntervention && (now - lastIntervention.timestamp) < this.config.COOLDOWN_PERIOD) {
        logger.debug('Intervention skipped due to cooldown', { agentId });
        return;
      }

      const intervention = {
        timestamp: now,
        pattern: stuckPattern.type,
        severity: stuckPattern.severity,
        action: null,
        success: false
      };

      // Determine intervention action based on pattern
      let action;
      switch (stuckPattern.type) {
        case 'repetitive_commands':
          action = await this.interventionBreakRepetition(agentId);
          break;
        case 'infinite_waiting':
          action = await this.interventionBreakWait(agentId);
          break;
        case 'error_loops':
          action = await this.interventionBreakErrorLoop(agentId);
          break;
        case 'resource_exhaustion':
          action = await this.interventionHandleResourceExhaustion(agentId);
          break;
        default:
          action = await this.interventionGeneric(agentId, stuckPattern);
      }

      intervention.action = action.type;
      intervention.success = action.success;

      if (action.success) {
        this.metrics.successfulInterventions++;
        logger.info('Intervention successful', {
          agentId,
          pattern: stuckPattern.type,
          action: action.type
        });
      } else {
        logger.warn('Intervention failed', {
          agentId,
          pattern: stuckPattern.type,
          action: action.type,
          reason: action.reason
        });
      }

      this.interventionHistory.set(agentId, intervention);

    } catch (error) {
      logger.error('Intervention failed', { error: error.message, agentId });
    }
  }

  /**
   * Break repetitive command pattern
   * @param {string} agentId - Agent identifier
   * @returns {Object} Intervention result
   */
  async interventionBreakRepetition(agentId) {
    try {
      const message = {
        role: MESSAGE_ROLES.SYSTEM,
        content: 'Quality Inspector detected repetitive behavior. Please try a different approach or ask for help if you are stuck.'
      };

      await this.orchestrator.sendMessage(agentId, message);
      
      return { type: 'break_repetition', success: true };
    } catch (error) {
      return { type: 'break_repetition', success: false, reason: error.message };
    }
  }

  /**
   * Break infinite wait pattern
   * @param {string} agentId - Agent identifier
   * @returns {Object} Intervention result
   */
  async interventionBreakWait(agentId) {
    try {
      const message = {
        role: MESSAGE_ROLES.SYSTEM,
        content: 'Quality Inspector detected that you may be waiting indefinitely. Please proceed with the next step or request assistance.'
      };

      await this.orchestrator.sendMessage(agentId, message);
      
      return { type: 'break_wait', success: true };
    } catch (error) {
      return { type: 'break_wait', success: false, reason: error.message };
    }
  }

  /**
   * Break error loop pattern
   * @param {string} agentId - Agent identifier
   * @returns {Object} Intervention result
   */
  async interventionBreakErrorLoop(agentId) {
    try {
      const message = {
        role: MESSAGE_ROLES.SYSTEM,
        content: 'Quality Inspector detected repeated errors. Please review your approach and consider alternative solutions.'
      };

      await this.orchestrator.sendMessage(agentId, message);
      
      return { type: 'break_error_loop', success: true };
    } catch (error) {
      return { type: 'break_error_loop', success: false, reason: error.message };
    }
  }

  /**
   * Handle resource exhaustion
   * @param {string} agentId - Agent identifier
   * @returns {Object} Intervention result
   */
  async interventionHandleResourceExhaustion(agentId) {
    try {
      // Pause agent temporarily
      await this.orchestrator.pauseAgent(agentId, 60, 'Resource exhaustion detected');
      
      return { type: 'pause_for_resources', success: true };
    } catch (error) {
      return { type: 'pause_for_resources', success: false, reason: error.message };
    }
  }

  /**
   * Generic intervention
   * @param {string} agentId - Agent identifier
   * @param {Object} stuckPattern - Stuck pattern details
   * @returns {Object} Intervention result
   */
  async interventionGeneric(agentId, stuckPattern) {
    try {
      const message = {
        role: MESSAGE_ROLES.SYSTEM,
        content: `Quality Inspector detected ${stuckPattern.description}. Please review your current approach.`
      };

      await this.orchestrator.sendMessage(agentId, message);
      
      return { type: 'generic_guidance', success: true };
    } catch (error) {
      return { type: 'generic_guidance', success: false, reason: error.message };
    }
  }

  /**
   * Generate optimization suggestion
   * @param {Object} performanceIssue - Performance issue details
   * @returns {string} Optimization suggestion
   */
  generateOptimizationSuggestion(performanceIssue) {
    switch (performanceIssue.type) {
      case 'slow_response':
        return 'Your response time is slower than usual. Consider breaking down complex tasks into smaller steps.';
      case 'high_error_rate':
        return 'You are experiencing frequent errors. Please review your approach and verify inputs before proceeding.';
      default:
        return 'Performance optimization suggested. Please review your current approach.';
    }
  }

  /**
   * Generate error guidance
   * @param {Object} errorPattern - Error pattern details
   * @returns {string} Error guidance
   */
  generateErrorGuidance(errorPattern) {
    return `Recurring ${errorPattern.errorType} errors detected (${errorPattern.count} times). Please review the error details and adjust your approach accordingly.`;
  }

  /**
   * Update performance metrics for an agent
   * @param {string} agentId - Agent identifier
   * @param {Object} activity - Activity data
   */
  updatePerformanceMetrics(agentId, activity) {
    const agentData = this.monitoringData.get(agentId);
    const metrics = agentData.performanceMetrics;

    // Update response time
    if (activity.responseTime) {
      const totalTime = metrics.averageResponseTime * metrics.totalMessages + activity.responseTime;
      metrics.totalMessages++;
      metrics.averageResponseTime = totalTime / metrics.totalMessages;
    }

    // Update error rate
    if (activity.error) {
      agentData.errors.push({
        type: activity.error.type || 'unknown',
        message: activity.error.message,
        timestamp: Date.now()
      });

      // Keep only recent errors
      agentData.errors = agentData.errors.filter(
        error => Date.now() - error.timestamp < 3600000 // Last hour
      );

      // Recalculate error rate
      const totalActivities = agentData.activityHistory.length;
      const errorCount = agentData.errors.length;
      metrics.errorRate = totalActivities > 0 ? errorCount / totalActivities : 0;
    }
  }

  /**
   * Detect patterns using pattern detectors
   * @param {string} agentId - Agent identifier
   * @param {Object} activity - Activity data
   */
  detectPatterns(agentId, activity) {
    // This method can be extended to trigger immediate pattern detection
    // For now, patterns are detected during quality checks
  }

  /**
   * Get quality metrics for reporting
   * @returns {Object} Quality metrics
   */
  getMetrics() {
    return {
      ...this.metrics,
      agentsMonitored: this.metrics.agentsMonitored.size,
      patternsDetected: Object.fromEntries(this.metrics.patternsDetected),
      interventionSuccessRate: this.metrics.totalInterventions > 0 
        ? this.metrics.successfulInterventions / this.metrics.totalInterventions 
        : 0,
      isRunning: this.isRunning
    };
  }

  /**
   * Get agent quality report
   * @param {string} agentId - Agent identifier
   * @returns {Object} Agent quality report
   */
  getAgentReport(agentId) {
    const agentData = this.monitoringData.get(agentId);
    
    if (!agentData) {
      return null;
    }

    const now = Date.now();
    const recentActivities = agentData.activityHistory.filter(
      activity => now - activity.timestamp < 3600000 // Last hour
    );

    return {
      agentId,
      messageCount: agentData.messageCount,
      lastActivity: agentData.lastActivity,
      stuckCount: agentData.stuckCount,
      recentActivityCount: recentActivities.length,
      performanceMetrics: { ...agentData.performanceMetrics },
      errorCount: agentData.errors.length,
      interventions: this.interventionHistory.get(agentId) || null
    };
  }

  /**
   * Clean up old monitoring data
   */
  cleanupOldData() {
    const now = Date.now();
    const maxAge = 86400000; // 24 hours

    for (const [agentId, agentData] of this.monitoringData) {
      // Remove old activities
      agentData.activityHistory = agentData.activityHistory.filter(
        activity => now - activity.timestamp < maxAge
      );

      // Remove old errors
      agentData.errors = agentData.errors.filter(
        error => now - error.timestamp < maxAge
      );

      // Remove agents with no recent activity
      if (now - agentData.lastActivity > maxAge) {
        this.monitoringData.delete(agentId);
        this.metrics.agentsMonitored.delete(agentId);
      }
    }
  }
}

/**
 * Pattern detector helper class
 */
class PatternDetector {
  constructor(patternType, threshold, timeWindow) {
    this.patternType = patternType;
    this.threshold = threshold;
    this.timeWindow = timeWindow;
  }

  check(activities) {
    const now = Date.now();
    const recentActivities = activities.filter(
      activity => now - activity.timestamp < this.timeWindow
    );

    switch (this.patternType) {
      case 'repetitive_commands':
        return this.checkRepetitiveCommands(recentActivities);
      case 'infinite_waiting':
        return this.checkInfiniteWaiting(recentActivities);
      case 'error_loops':
        return this.checkErrorLoops(recentActivities);
      case 'resource_exhaustion':
        return this.checkResourceExhaustion(recentActivities);
      default:
        return false;
    }
  }

  checkRepetitiveCommands(activities) {
    if (activities.length < this.threshold) return false;

    const commands = activities
      .filter(a => a.type === 'command')
      .map(a => a.content)
      .slice(-this.threshold);

    // Check if all recent commands are the same
    return commands.length >= this.threshold && 
           commands.every(cmd => cmd === commands[0]);
  }

  checkInfiniteWaiting(activities) {
    if (activities.length < this.threshold) return false;

    const waitingActivities = activities.filter(a => 
      a.type === 'waiting' || 
      a.content?.includes('waiting') ||
      a.content?.includes('pending')
    );

    return waitingActivities.length >= this.threshold;
  }

  checkErrorLoops(activities) {
    if (activities.length < this.threshold) return false;

    const errorActivities = activities.filter(a => a.error || a.type === 'error');
    return errorActivities.length >= this.threshold;
  }

  checkResourceExhaustion(activities) {
    if (activities.length < this.threshold) return false;

    const resourceActivities = activities.filter(a => 
      a.error?.type === 'resource_exhaustion' ||
      a.content?.includes('memory') ||
      a.content?.includes('timeout') ||
      a.content?.includes('limit exceeded')
    );

    return resourceActivities.length >= this.threshold;
  }
}

export default QualityInspector;