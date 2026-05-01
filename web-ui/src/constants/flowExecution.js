/**
 * Flow Execution Constants
 * Defines execution status values and display labels
 */

// Node execution statuses
export const NODE_EXECUTION_STATUS = {
  PENDING: 'pending',
  RUNNING: 'running',
  COMPLETED: 'completed',
  FAILED: 'failed'
};

// Flow run statuses
export const FLOW_RUN_STATUS = {
  PENDING: 'pending',
  RUNNING: 'running',
  COMPLETED: 'completed',
  FAILED: 'failed',
  STOPPED: 'stopped'
};

// Display labels for execution statuses
export const STATUS_LABELS = {
  [NODE_EXECUTION_STATUS.PENDING]: 'Pending',
  [NODE_EXECUTION_STATUS.RUNNING]: 'Running',
  [NODE_EXECUTION_STATUS.COMPLETED]: 'Done',
  [NODE_EXECUTION_STATUS.FAILED]: 'Failed'
};

// Helper to get status label
export const getStatusLabel = (status) => {
  return STATUS_LABELS[status] || status;
};
