import React from 'react';
import { 
  CheckCircleIcon, 
  PauseCircleIcon, 
  ExclamationCircleIcon,
  ClockIcon 
} from '@heroicons/react/24/solid';

function AgentStatusIndicator({ agent, size = 'md', showLabel = true, className = '' }) {
  if (!agent) return null;

  const getStatus = () => {
    if (agent.status === 'paused' && agent.pausedUntil) {
      const pausedUntil = new Date(agent.pausedUntil);
      if (new Date() < pausedUntil) {
        return 'paused';
      }
    }
    return agent.status || 'idle';
  };

  const status = getStatus();

  const statusConfig = {
    active: {
      icon: CheckCircleIcon,
      color: 'text-agent-active',
      bgColor: 'bg-agent-active/10',
      label: 'Active'
    },
    paused: {
      icon: PauseCircleIcon,
      color: 'text-agent-paused',
      bgColor: 'bg-agent-paused/10',
      label: 'Paused'
    },
    error: {
      icon: ExclamationCircleIcon,
      color: 'text-agent-error',
      bgColor: 'bg-agent-error/10',
      label: 'Error'
    },
    idle: {
      icon: ClockIcon,
      color: 'text-agent-idle',
      bgColor: 'bg-agent-idle/10',
      label: 'Idle'
    }
  };

  const config = statusConfig[status] || statusConfig.idle;
  const IconComponent = config.icon;

  const sizeClasses = {
    xs: {
      icon: 'w-3 h-3',
      container: 'px-1.5 py-0.5 text-xs'
    },
    sm: {
      icon: 'w-4 h-4',
      container: 'px-2 py-1 text-xs'
    },
    md: {
      icon: 'w-5 h-5',
      container: 'px-2 py-1 text-sm'
    },
    lg: {
      icon: 'w-6 h-6',
      container: 'px-3 py-1.5 text-sm'
    }
  };

  const sizes = sizeClasses[size] || sizeClasses.md;

  return (
    <div className={`agent-status-indicator agent-status-${status} ${showLabel ? sizes.container : ''} ${className}`}>
      <IconComponent className={`${sizes.icon} ${config.color} ${showLabel ? 'mr-1' : ''}`} />
      {showLabel && (
        <>
          <span className="font-medium">{config.label}</span>
          {status === 'paused' && agent.pausedUntil && (
            <span className="ml-1 opacity-75">
              ({new Date(agent.pausedUntil).toLocaleTimeString()})
            </span>
          )}
        </>
      )}
    </div>
  );
}

export default AgentStatusIndicator;