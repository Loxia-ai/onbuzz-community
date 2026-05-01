import { BUDGET_LIMITS, USAGE_ALERTS } from '../utilities/constants.js';

/**
 * Budget and usage tracking service for monitoring AI model costs and token usage
 */
export class BudgetService {
  constructor(config, logger, modelsService = null) {
    this.config = config || {};
    this.logger = logger;
    this.modelsService = modelsService;
    this.usage = {
      daily: new Map(),
      weekly: new Map(), 
      monthly: new Map(),
      total: {
        tokens: 0,
        cost: 0,
        requests: 0
      }
    };
    
    this.budgets = {
      daily: BUDGET_LIMITS.DAILY,
      weekly: BUDGET_LIMITS.WEEKLY,
      monthly: BUDGET_LIMITS.MONTHLY
    };

    this.alerts = {
      enabled: true,
      thresholds: USAGE_ALERTS.THRESHOLDS,
      lastAlertTimes: new Map()
    };

    this.loadUsageData();
    this.setupPeriodicSave();
  }

  /**
   * Set models service reference (for dynamic pricing lookup)
   * @param {ModelsService} modelsService
   */
  setModelsService(modelsService) {
    this.modelsService = modelsService;
  }

  /**
   * Track token usage for a specific model and agent
   * @param {string} agentId - Agent identifier
   * @param {string} modelId - Model identifier  
   * @param {Object} tokenUsage - Token usage data
   * @param {number} tokenUsage.prompt_tokens - Input tokens used
   * @param {number} tokenUsage.completion_tokens - Output tokens used
   * @param {number} tokenUsage.total_tokens - Total tokens used
   * @returns {Object} Updated usage statistics and cost
   */
  trackUsage(agentId, modelId, tokenUsage) {
    try {
      const cost = this.calculateCost(modelId, tokenUsage);
      const now = new Date();
      const dayKey = this.getDayKey(now);
      const weekKey = this.getWeekKey(now);  
      const monthKey = this.getMonthKey(now);

      // Initialize usage entries if they don't exist
      this.initializeUsageEntry(this.usage.daily, dayKey);
      this.initializeUsageEntry(this.usage.weekly, weekKey);
      this.initializeUsageEntry(this.usage.monthly, monthKey);

      // Update usage statistics
      const usageData = {
        agentId,
        modelId,
        tokens: tokenUsage.total_tokens,
        cost,
        timestamp: now.toISOString()
      };

      this.updateUsageEntry(this.usage.daily.get(dayKey), usageData);
      this.updateUsageEntry(this.usage.weekly.get(weekKey), usageData);
      this.updateUsageEntry(this.usage.monthly.get(monthKey), usageData);

      // Update total usage
      this.usage.total.tokens += tokenUsage.total_tokens;
      this.usage.total.cost += cost;
      this.usage.total.requests += 1;

      // Check budget limits and send alerts if necessary
      this.checkBudgetLimits(dayKey, weekKey, monthKey);

      this.logger.info('Usage tracked', {
        agentId,
        modelId,
        tokens: tokenUsage.total_tokens,
        cost,
        totalCost: this.usage.total.cost
      });

      return {
        cost,
        totalCost: this.usage.total.cost,
        totalTokens: this.usage.total.tokens,
        dailyUsage: this.usage.daily.get(dayKey),
        budgetRemaining: this.getRemainingBudget()
      };

    } catch (error) {
      this.logger.error('Failed to track usage', { error: error.message, agentId, modelId });
      throw error;
    }
  }

  /**
   * Calculate cost based on model and token usage
   * @param {string} modelId - Model identifier
   * @param {Object} tokenUsage - Token usage data
   * @returns {number} Cost in USD
   */
  calculateCost(modelId, tokenUsage) {
    // Look up pricing from modelsService (single source of truth from /models API)
    const pricing = this._getModelPricing(modelId);

    if (!pricing) {
      this.logger.debug('No pricing available for model', { modelId });
      return 0;
    }

    // pricing.input and pricing.output are per-1K-token rates from the API
    const inputCost = (tokenUsage.prompt_tokens || 0) * (pricing.input / 1000);
    const outputCost = (tokenUsage.completion_tokens || 0) * (pricing.output / 1000);

    return inputCost + outputCost;
  }

  /**
   * Get pricing for a model from modelsService.
   * @private
   */
  _getModelPricing(modelId) {
    if (!this.modelsService) return null;
    try {
      const models = this.modelsService.getModels();
      const modelInfo = models.find(m => m.name === modelId);
      return modelInfo?.pricing || null;
    } catch {
      return null;
    }
  }

  /**
   * Get current usage statistics
   * @param {string} period - 'daily', 'weekly', 'monthly', or 'total'
   * @param {Date} date - Date for the period (optional, defaults to now)
   * @returns {Object} Usage statistics
   */
  getUsage(period = 'daily', date = new Date()) {
    switch (period) {
      case 'daily':
        return this.usage.daily.get(this.getDayKey(date)) || this.createEmptyUsage();
      case 'weekly':
        return this.usage.weekly.get(this.getWeekKey(date)) || this.createEmptyUsage();
      case 'monthly':
        return this.usage.monthly.get(this.getMonthKey(date)) || this.createEmptyUsage();
      case 'total':
        return { ...this.usage.total };
      default:
        throw new Error(`Invalid period: ${period}`);
    }
  }

  /**
   * Get usage by agent
   * @param {string} agentId - Agent identifier
   * @param {string} period - 'daily', 'weekly', 'monthly', or 'total'
   * @returns {Object} Agent-specific usage statistics
   */
  getAgentUsage(agentId, period = 'daily') {
    const usage = this.getUsage(period);
    return usage.byAgent?.[agentId] || this.createEmptyUsage();
  }

  /**
   * Get usage by model
   * @param {string} modelId - Model identifier
   * @param {string} period - 'daily', 'weekly', 'monthly', or 'total'
   * @returns {Object} Model-specific usage statistics
   */
  getModelUsage(modelId, period = 'daily') {
    const usage = this.getUsage(period);
    return usage.byModel?.[modelId] || this.createEmptyUsage();
  }

  /**
   * Set budget limits
   * @param {Object} budgets - Budget configuration
   * @param {number} budgets.daily - Daily budget limit in USD
   * @param {number} budgets.weekly - Weekly budget limit in USD
   * @param {number} budgets.monthly - Monthly budget limit in USD
   */
  setBudgets(budgets) {
    if (budgets.daily !== undefined) this.budgets.daily = budgets.daily;
    if (budgets.weekly !== undefined) this.budgets.weekly = budgets.weekly;
    if (budgets.monthly !== undefined) this.budgets.monthly = budgets.monthly;

    this.logger.info('Budget limits updated', this.budgets);
    this.saveUsageData();
  }

  /**
   * Get remaining budget for each period
   * @returns {Object} Remaining budget amounts
   */
  getRemainingBudget() {
    const now = new Date();
    const dailyUsage = this.getUsage('daily', now);
    const weeklyUsage = this.getUsage('weekly', now);
    const monthlyUsage = this.getUsage('monthly', now);

    return {
      daily: Math.max(0, this.budgets.daily - dailyUsage.cost),
      weekly: Math.max(0, this.budgets.weekly - weeklyUsage.cost),
      monthly: Math.max(0, this.budgets.monthly - monthlyUsage.cost)
    };
  }

  /**
   * Check if usage is within budget limits
   * @param {string} period - 'daily', 'weekly', or 'monthly'
   * @returns {boolean} True if within budget
   */
  isWithinBudget(period = 'daily') {
    const usage = this.getUsage(period);
    const budget = this.budgets[period];
    return usage.cost <= budget;
  }

  /**
   * Get usage trends and analytics
   * @param {number} days - Number of days to analyze
   * @returns {Object} Usage trends and analytics
   */
  getUsageTrends(days = 30) {
    const trends = {
      dailyAverages: {
        cost: 0,
        tokens: 0,
        requests: 0
      },
      topAgents: [],
      topModels: [],
      costByDay: [],
      tokensByDay: []
    };

    const now = new Date();
    let totalCost = 0;
    let totalTokens = 0;
    let totalRequests = 0;
    const agentUsage = new Map();
    const modelUsage = new Map();

    // Analyze daily usage for the specified period
    for (let i = 0; i < days; i++) {
      const date = new Date(now);
      date.setDate(date.getDate() - i);
      const dayKey = this.getDayKey(date);
      const dayUsage = this.usage.daily.get(dayKey);

      if (dayUsage) {
        totalCost += dayUsage.cost;
        totalTokens += dayUsage.tokens;
        totalRequests += dayUsage.requests;

        trends.costByDay.unshift({ date: dayKey, cost: dayUsage.cost });
        trends.tokensByDay.unshift({ date: dayKey, tokens: dayUsage.tokens });

        // Aggregate agent usage
        Object.entries(dayUsage.byAgent || {}).forEach(([agentId, usage]) => {
          if (!agentUsage.has(agentId)) {
            agentUsage.set(agentId, { cost: 0, tokens: 0, requests: 0 });
          }
          const current = agentUsage.get(agentId);
          current.cost += usage.cost;
          current.tokens += usage.tokens;
          current.requests += usage.requests;
        });

        // Aggregate model usage
        Object.entries(dayUsage.byModel || {}).forEach(([modelId, usage]) => {
          if (!modelUsage.has(modelId)) {
            modelUsage.set(modelId, { cost: 0, tokens: 0, requests: 0 });
          }
          const current = modelUsage.get(modelId);
          current.cost += usage.cost;
          current.tokens += usage.tokens;
          current.requests += usage.requests;
        });
      } else {
        trends.costByDay.unshift({ date: dayKey, cost: 0 });
        trends.tokensByDay.unshift({ date: dayKey, tokens: 0 });
      }
    }

    // Calculate averages
    trends.dailyAverages.cost = totalCost / days;
    trends.dailyAverages.tokens = totalTokens / days;
    trends.dailyAverages.requests = totalRequests / days;

    // Sort and get top agents and models
    trends.topAgents = Array.from(agentUsage.entries())
      .map(([id, usage]) => ({ id, ...usage }))
      .sort((a, b) => b.cost - a.cost)
      .slice(0, 10);

    trends.topModels = Array.from(modelUsage.entries())
      .map(([id, usage]) => ({ id, ...usage }))
      .sort((a, b) => b.cost - a.cost)
      .slice(0, 10);

    return trends;
  }

  /**
   * Export usage data for reporting
   * @param {string} format - 'json' or 'csv'
   * @param {Date} startDate - Start date for export
   * @param {Date} endDate - End date for export
   * @returns {string} Exported data
   */
  exportUsageData(format = 'json', startDate = null, endDate = null) {
    const data = {
      budgets: this.budgets,
      total: this.usage.total,
      daily: {},
      weekly: {},
      monthly: {}
    };

    // Filter data by date range if specified
    const filterByDateRange = (entries, keyFormatter) => {
      const filtered = {};
      entries.forEach((usage, key) => {
        const date = keyFormatter(key);
        if ((!startDate || date >= startDate) && (!endDate || date <= endDate)) {
          filtered[key] = usage;
        }
      });
      return filtered;
    };

    if (startDate || endDate) {
      data.daily = filterByDateRange(this.usage.daily, key => new Date(key));
      data.weekly = filterByDateRange(this.usage.weekly, key => new Date(key));
      data.monthly = filterByDateRange(this.usage.monthly, key => new Date(key + '-01'));
    } else {
      this.usage.daily.forEach((usage, key) => data.daily[key] = usage);
      this.usage.weekly.forEach((usage, key) => data.weekly[key] = usage);
      this.usage.monthly.forEach((usage, key) => data.monthly[key] = usage);
    }

    if (format === 'csv') {
      return this.convertToCSV(data);
    }

    return JSON.stringify(data, null, 2);
  }

  // Private helper methods

  initializeUsageEntry(usageMap, key) {
    if (!usageMap.has(key)) {
      usageMap.set(key, this.createEmptyUsage());
    }
  }

  createEmptyUsage() {
    return {
      cost: 0,
      tokens: 0,
      requests: 0,
      byAgent: {},
      byModel: {}
    };
  }

  updateUsageEntry(entry, usageData) {
    entry.cost += usageData.cost;
    entry.tokens += usageData.tokens;
    entry.requests += 1;

    // Update by agent
    if (!entry.byAgent[usageData.agentId]) {
      entry.byAgent[usageData.agentId] = this.createEmptyUsage();
    }
    entry.byAgent[usageData.agentId].cost += usageData.cost;
    entry.byAgent[usageData.agentId].tokens += usageData.tokens;
    entry.byAgent[usageData.agentId].requests += 1;

    // Update by model
    if (!entry.byModel[usageData.modelId]) {
      entry.byModel[usageData.modelId] = this.createEmptyUsage();
    }
    entry.byModel[usageData.modelId].cost += usageData.cost;
    entry.byModel[usageData.modelId].tokens += usageData.tokens;
    entry.byModel[usageData.modelId].requests += 1;
  }

  checkBudgetLimits(dayKey, weekKey, monthKey) {
    const dailyUsage = this.usage.daily.get(dayKey);
    const weeklyUsage = this.usage.weekly.get(weekKey);
    const monthlyUsage = this.usage.monthly.get(monthKey);

    // Check daily budget
    if (dailyUsage.cost > this.budgets.daily) {
      this.sendBudgetAlert('daily', dailyUsage.cost, this.budgets.daily);
    }

    // Check weekly budget
    if (weeklyUsage.cost > this.budgets.weekly) {
      this.sendBudgetAlert('weekly', weeklyUsage.cost, this.budgets.weekly);
    }

    // Check monthly budget
    if (monthlyUsage.cost > this.budgets.monthly) {
      this.sendBudgetAlert('monthly', monthlyUsage.cost, this.budgets.monthly);
    }

    // Check threshold alerts
    this.checkThresholdAlerts(dailyUsage, weeklyUsage, monthlyUsage);
  }

  checkThresholdAlerts(dailyUsage, weeklyUsage, monthlyUsage) {
    const thresholds = this.alerts.thresholds;

    this.checkThreshold('daily', dailyUsage.cost, this.budgets.daily, thresholds);
    this.checkThreshold('weekly', weeklyUsage.cost, this.budgets.weekly, thresholds);
    this.checkThreshold('monthly', monthlyUsage.cost, this.budgets.monthly, thresholds);
  }

  checkThreshold(period, usage, budget, thresholds) {
    const percentage = (usage / budget) * 100;
    
    for (const threshold of thresholds) {
      if (percentage >= threshold) {
        const alertKey = `${period}_${threshold}`;
        const lastAlert = this.alerts.lastAlertTimes.get(alertKey);
        const now = Date.now();
        
        // Only send alert if we haven't sent one in the last hour
        if (!lastAlert || (now - lastAlert) > 3600000) {
          this.sendThresholdAlert(period, percentage, threshold, usage, budget);
          this.alerts.lastAlertTimes.set(alertKey, now);
        }
        break; // Only send the highest threshold alert
      }
    }
  }

  sendBudgetAlert(period, currentUsage, budgetLimit) {
    this.logger.warn('Budget limit exceeded', {
      period,
      currentUsage,
      budgetLimit,
      excess: currentUsage - budgetLimit
    });

    // Emit event for external handling
    if (typeof process !== 'undefined' && process.emit) {
      process.emit('budgetAlert', {
        type: 'budget_exceeded',
        period,
        currentUsage,
        budgetLimit,
        excess: currentUsage - budgetLimit
      });
    }
  }

  sendThresholdAlert(period, percentage, threshold, usage, budget) {
    this.logger.warn('Budget threshold reached', {
      period,
      percentage: Math.round(percentage),
      threshold,
      usage,
      budget
    });

    // Emit event for external handling
    if (typeof process !== 'undefined' && process.emit) {
      process.emit('budgetAlert', {
        type: 'threshold_reached',
        period,
        percentage: Math.round(percentage),
        threshold,
        usage,
        budget
      });
    }
  }

  getDayKey(date) {
    return date.toISOString().split('T')[0];
  }

  getWeekKey(date) {
    const year = date.getFullYear();
    const weekNum = this.getWeekNumber(date);
    return `${year}-W${weekNum.toString().padStart(2, '0')}`;
  }

  getMonthKey(date) {
    const year = date.getFullYear();
    const month = date.getMonth() + 1;
    return `${year}-${month.toString().padStart(2, '0')}`;
  }

  getWeekNumber(date) {
    const firstDayOfYear = new Date(date.getFullYear(), 0, 1);
    const pastDaysOfYear = (date - firstDayOfYear) / 86400000;
    return Math.ceil((pastDaysOfYear + firstDayOfYear.getDay() + 1) / 7);
  }

  convertToCSV(data) {
    const rows = [];
    rows.push(['Period', 'Date', 'Cost', 'Tokens', 'Requests', 'Agent', 'Model']);

    // Convert daily data
    Object.entries(data.daily).forEach(([date, usage]) => {
      rows.push(['Daily', date, usage.cost, usage.tokens, usage.requests, '', '']);
      
      Object.entries(usage.byAgent || {}).forEach(([agentId, agentUsage]) => {
        rows.push(['Daily', date, agentUsage.cost, agentUsage.tokens, agentUsage.requests, agentId, '']);
      });
    });

    return rows.map(row => row.join(',')).join('\n');
  }

  loadUsageData() {
    try {
      // In a real implementation, this would load from persistent storage
      // For now, we'll just initialize with empty data
      this.logger.info('Budget service initialized');
    } catch (error) {
      this.logger.error('Failed to load usage data', { error: error.message });
    }
  }

  saveUsageData() {
    try {
      // In a real implementation, this would save to persistent storage
      this.logger.debug('Usage data saved');
    } catch (error) {
      this.logger.error('Failed to save usage data', { error: error.message });
    }
  }

  setupPeriodicSave() {
    // Save usage data every 5 minutes
    setInterval(() => {
      this.saveUsageData();
    }, 300000);
  }
}

export default BudgetService;