import React, { useRef, useCallback, useEffect, useMemo } from 'react';
import { Virtuoso } from 'react-virtuoso';
import { ChevronDownIcon } from '@heroicons/react/24/outline';
import MessageBubble from './MessageBubble.jsx';

/**
 * Height estimation for messages based on content type.
 * These are approximations used before actual measurement.
 */
const estimateMessageHeight = (message) => {
  let height = 80; // Base height (avatar, header, padding)

  // Text content estimation (~20px per line, ~80 chars per line)
  const contentStr = typeof message.content === 'string' ? message.content : '';
  if (contentStr) {
    const lines = Math.ceil(contentStr.length / 80);
    height += lines * 20;
  }

  // Code blocks add significant height
  if (contentStr.includes('```')) {
    const codeBlockCount = (contentStr.match(/```/g) || []).length / 2;
    height += codeBlockCount * 150;
  }

  // Tool executions
  if (message.toolExecutions?.length) {
    height += 60 + (message.toolExecutions.length * 30);
  }

  // Tool results
  if (message.toolResults?.length) {
    height += message.toolResults.length * 120;
  }

  // Images
  if (message.imageUrl) {
    height += 350;
  }

  // Videos
  if (message.videoUrl) {
    height += 450; // Video player is typically larger
  }

  // Agent redirects
  if (message.agentRedirects?.length) {
    height += message.agentRedirects.length * 80;
  }

  // Context references
  if (message.contextReferences?.length) {
    height += 40;
  }

  return Math.min(height, 1000); // Cap initial estimate
};

/**
 * Scroll to Bottom Button Component
 */
const ScrollToBottomButton = ({ onClick, newMessageCount }) => (
  <div className="sticky bottom-4 flex justify-center pointer-events-none z-10">
    <button
      onClick={onClick}
      className="flex items-center space-x-2 px-3 py-2 bg-loxia-600 hover:bg-loxia-700 text-white rounded-full shadow-lg transition-all duration-200 hover:scale-105 pointer-events-auto"
      title="Scroll to bottom"
    >
      <ChevronDownIcon className="w-5 h-5" />
      {newMessageCount > 0 && (
        <span className="text-sm font-medium">
          {newMessageCount} new
        </span>
      )}
    </button>
  </div>
);

/**
 * VirtualizedMessageList - Efficient rendering of chat messages using react-virtuoso
 *
 * Key features:
 * - Only renders visible messages (+ overscan buffer)
 * - Height caching for consistent scroll position
 * - Smart auto-scroll following new messages
 * - Supports dynamic content (images, tools, expanding sections)
 * - Auto-scroll during streaming when user is at bottom
 */
const VirtualizedMessageList = ({
  messages,
  userScrolledAway,
  setUserScrolledAway,
  newMessageCount,
  setNewMessageCount,
  headerContent,
  footerContent,
  isStreaming = false, // Whether AI is currently streaming a response
}) => {
  const virtuosoRef = useRef(null);
  const scrollContainerRef = useRef(null); // Ref to the actual scroll container
  const lastMessageCountRef = useRef(messages.length);
  const heightCache = useRef(new Map());
  const lastStreamingScrollRef = useRef(0); // Throttle streaming scrolls
  const userScrolledAwayRef = useRef(userScrolledAway); // Ref for async access
  const userScrollIntentRef = useRef(false); // Track user scroll intent during streaming

  // Keep ref in sync with state (for use in async callbacks)
  useEffect(() => {
    userScrolledAwayRef.current = userScrolledAway;
    // If user returned to bottom, clear scroll intent
    if (!userScrolledAway) {
      userScrollIntentRef.current = false;
    }
  }, [userScrolledAway]);

  // Detect user scroll intent during streaming via wheel/touch events
  // This fires BEFORE the programmatic scroll can override the position
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container || !isStreaming) return;

    const handleWheel = (e) => {
      // User scrolling up = intent to read previous messages
      if (e.deltaY < 0) {
        userScrollIntentRef.current = true;
        setUserScrolledAway(true);
      }
    };

    const handleTouchStart = () => {
      // Any touch during streaming = user wants to control scroll
      userScrollIntentRef.current = true;
      setUserScrolledAway(true);
    };

    container.addEventListener('wheel', handleWheel, { passive: true });
    container.addEventListener('touchstart', handleTouchStart, { passive: true });

    return () => {
      container.removeEventListener('wheel', handleWheel);
      container.removeEventListener('touchstart', handleTouchStart);
    };
  }, [isStreaming, setUserScrolledAway]);

  // Filter out null-rendering messages (system scheduler prompts)
  const visibleMessages = useMemo(() => {
    return messages.filter(message => {
      const isSystem = message.role === 'system';
      const msgContent = typeof message.content === 'string' ? message.content : '';
      if (isSystem && (message.type === 'scheduler-prompt' ||
          (msgContent && msgContent.includes('queued message(s) to process')))) {
        return false;
      }
      return true;
    });
  }, [messages]);

  // Smart scroll: follow output only when user hasn't scrolled away
  const followOutput = useCallback((isAtBottom) => {
    if (!userScrolledAway) {
      return 'smooth';
    }
    return false;
  }, [userScrolledAway]);

  // Handle scroll state changes from Virtuoso
  const handleAtBottomStateChange = useCallback((atBottom) => {
    if (atBottom && userScrolledAway) {
      setUserScrolledAway(false);
      setNewMessageCount(0);
      userScrollIntentRef.current = false; // User returned to bottom, resume auto-scroll
    } else if (!atBottom && !userScrolledAway) {
      setUserScrolledAway(true);
    }
  }, [userScrolledAway, setUserScrolledAway, setNewMessageCount]);

  // Track new messages when scrolled away
  useEffect(() => {
    if (userScrolledAway) {
      const newCount = visibleMessages.length - lastMessageCountRef.current;
      if (newCount > 0 && lastMessageCountRef.current > 0) {
        setNewMessageCount(prev => prev + newCount);
      }
    }
    lastMessageCountRef.current = visibleMessages.length;
  }, [visibleMessages.length, userScrolledAway, setNewMessageCount]);

  // Auto-scroll during streaming when user is at bottom
  // Only scroll when streaming content actually changes (footerContent)
  // Uses throttling to avoid performance issues with rapid updates
  useEffect(() => {
    // Only auto-scroll if:
    // 1. We're streaming
    // 2. User hasn't scrolled away (state check)
    // 3. User hasn't expressed scroll intent (ref check - catches race condition)
    // 4. We have a footer (streaming bubble)
    if (!isStreaming || userScrolledAway || userScrollIntentRef.current || !footerContent) {
      return;
    }

    const now = Date.now();
    // Throttle to max 5 scrolls per second (200ms intervals)
    if (now - lastStreamingScrollRef.current > 200) {
      lastStreamingScrollRef.current = now;
      // Use requestAnimationFrame to batch with render
      requestAnimationFrame(() => {
        // Double-check refs for current values (state might be stale in async callback)
        if (scrollContainerRef.current && !userScrolledAwayRef.current && !userScrollIntentRef.current) {
          scrollContainerRef.current.scrollTo({
            top: scrollContainerRef.current.scrollHeight,
            behavior: 'auto'
          });
        }
      });
    }
  }, [isStreaming, userScrolledAway, footerContent]);

  // Scroll to bottom programmatically
  const scrollToBottom = useCallback(() => {
    virtuosoRef.current?.scrollToIndex({
      index: visibleMessages.length - 1,
      behavior: 'smooth',
      align: 'end'
    });
    setUserScrolledAway(false);
    setNewMessageCount(0);
    userScrollIntentRef.current = false; // Resume auto-scroll after manual scroll-to-bottom
  }, [visibleMessages.length, setUserScrolledAway, setNewMessageCount]);

  // Get default item size from cache or estimate
  const defaultItemSize = useCallback((index) => {
    const message = visibleMessages[index];
    if (!message) return 100;

    // Check cache first
    if (heightCache.current.has(message.id)) {
      return heightCache.current.get(message.id);
    }

    // Return estimate
    return estimateMessageHeight(message);
  }, [visibleMessages]);

  // Render individual message
  const itemContent = useCallback((index, message) => {
    return <MessageBubble key={message.id} message={message} />;
  }, []);

  // Header component wrapper (CompactionIndicator)
  const Header = useCallback(() => {
    if (!headerContent) return null;
    return <div>{headerContent}</div>;
  }, [headerContent]);

  // Footer component wrapper (ThinkingBubble, WaitingIndicator)
  const Footer = useCallback(() => {
    if (!footerContent) return null;
    return <div>{footerContent}</div>;
  }, [footerContent]);

  // Track item sizes for caching
  const handleItemsRendered = useCallback((items) => {
    // Note: Virtuoso handles height tracking internally
    // This is mainly for debugging and potential custom caching
  }, []);

  // Empty state - handled by parent
  if (visibleMessages.length === 0) {
    return (
      <div className="flex-1 overflow-y-auto relative">
        {headerContent}
        {footerContent}
      </div>
    );
  }

  return (
    <div className="flex-1 relative" style={{ minHeight: 0 }}>
      <Virtuoso
        ref={virtuosoRef}
        scrollerRef={(ref) => { scrollContainerRef.current = ref; }}
        data={visibleMessages}
        itemContent={itemContent}
        alignToBottom={true}
        followOutput={followOutput}
        atBottomStateChange={handleAtBottomStateChange}
        atBottomThreshold={100}
        initialTopMostItemIndex={visibleMessages.length - 1}
        overscan={100}
        increaseViewportBy={{ top: 100, bottom: 100 }}
        defaultItemHeight={100}
        components={{
          Header,
          Footer,
        }}
        style={{ height: '100%' }}
        className="virtuoso-message-list"
      />

      {/* Scroll to Bottom Button */}
      {userScrolledAway && visibleMessages.length > 0 && (
        <ScrollToBottomButton
          onClick={scrollToBottom}
          newMessageCount={newMessageCount}
        />
      )}
    </div>
  );
};

export default React.memo(VirtualizedMessageList, (prevProps, nextProps) => {
  // Only re-render when meaningful props change
  return (
    prevProps.messages === nextProps.messages &&
    prevProps.userScrolledAway === nextProps.userScrolledAway &&
    prevProps.newMessageCount === nextProps.newMessageCount &&
    prevProps.headerContent === nextProps.headerContent &&
    prevProps.footerContent === nextProps.footerContent &&
    prevProps.isStreaming === nextProps.isStreaming
  );
});
