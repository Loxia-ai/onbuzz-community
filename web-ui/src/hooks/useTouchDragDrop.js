/**
 * Touch Drag and Drop Support
 *
 * Provides touch event handlers that mirror HTML5 drag-and-drop behavior.
 * Works alongside native drag-drop for mouse users.
 */

// Global state for tracking drag operation
let touchDragState = {
  isDragging: false,
  element: null,
  ghost: null,
  data: {},
  startX: 0,
  startY: 0,
  currentDropTarget: null,
  onDragEnd: null
};

// Threshold in pixels before drag starts (prevents accidental drags)
const DRAG_THRESHOLD = 10;

/**
 * Creates a ghost element that follows the finger during drag
 */
function createGhost(element) {
  const rect = element.getBoundingClientRect();
  const ghost = element.cloneNode(true);

  ghost.style.cssText = `
    position: fixed;
    width: ${rect.width}px;
    height: ${rect.height}px;
    pointer-events: none;
    z-index: 9999;
    opacity: 0.8;
    transform: rotate(2deg) scale(1.02);
    box-shadow: 0 10px 30px rgba(0,0,0,0.3);
    transition: transform 0.1s ease;
  `;

  document.body.appendChild(ghost);
  return ghost;
}

/**
 * Finds the drop target under the touch point
 */
function findDropTarget(x, y) {
  // Hide ghost temporarily to find element underneath
  if (touchDragState.ghost) {
    touchDragState.ghost.style.display = 'none';
  }

  const element = document.elementFromPoint(x, y);

  if (touchDragState.ghost) {
    touchDragState.ghost.style.display = '';
  }

  // Walk up the DOM to find an element with data-drop-zone attribute
  let target = element;
  while (target && target !== document.body) {
    if (target.hasAttribute('data-drop-zone')) {
      return target;
    }
    target = target.parentElement;
  }

  return null;
}

/**
 * Handle touch start - begin potential drag
 */
export function handleTouchStart(e, dragData, onDragStart) {
  const touch = e.touches[0];

  touchDragState = {
    isDragging: false,
    element: e.currentTarget,
    ghost: null,
    data: dragData,
    startX: touch.clientX,
    startY: touch.clientY,
    currentDropTarget: null,
    onDragEnd: null,
    onDragStart
  };
}

/**
 * Handle touch move - track drag and find drop targets
 */
export function handleTouchMove(e) {
  if (!touchDragState.element) return;

  const touch = e.touches[0];
  const deltaX = touch.clientX - touchDragState.startX;
  const deltaY = touch.clientY - touchDragState.startY;

  // Check if we've moved enough to start dragging
  if (!touchDragState.isDragging) {
    if (Math.abs(deltaX) > DRAG_THRESHOLD || Math.abs(deltaY) > DRAG_THRESHOLD) {
      touchDragState.isDragging = true;
      touchDragState.ghost = createGhost(touchDragState.element);

      // Trigger drag start callback
      if (touchDragState.onDragStart) {
        touchDragState.onDragStart(touchDragState.data);
      }

      // Prevent scrolling while dragging
      e.preventDefault();
    }
  }

  if (touchDragState.isDragging && touchDragState.ghost) {
    e.preventDefault();

    // Move ghost to follow finger (centered under touch point)
    const ghostRect = touchDragState.ghost.getBoundingClientRect();
    touchDragState.ghost.style.left = `${touch.clientX - ghostRect.width / 2}px`;
    touchDragState.ghost.style.top = `${touch.clientY - ghostRect.height / 2}px`;

    // Find drop target
    const dropTarget = findDropTarget(touch.clientX, touch.clientY);

    // Handle drop target changes
    if (dropTarget !== touchDragState.currentDropTarget) {
      // Remove highlight from previous target
      if (touchDragState.currentDropTarget) {
        touchDragState.currentDropTarget.classList.remove('touch-drag-over');
        const leaveEvent = new CustomEvent('touchdragleave', { detail: touchDragState.data });
        touchDragState.currentDropTarget.dispatchEvent(leaveEvent);
      }

      // Add highlight to new target
      if (dropTarget) {
        dropTarget.classList.add('touch-drag-over');
        const enterEvent = new CustomEvent('touchdragenter', { detail: touchDragState.data });
        dropTarget.dispatchEvent(enterEvent);
      }

      touchDragState.currentDropTarget = dropTarget;
    }
  }
}

/**
 * Handle touch end - complete or cancel drag
 */
export function handleTouchEnd(e, onDragEnd) {
  if (!touchDragState.element) return;

  if (touchDragState.isDragging) {
    // Remove ghost
    if (touchDragState.ghost) {
      touchDragState.ghost.remove();
    }

    // Trigger drop on current target
    if (touchDragState.currentDropTarget) {
      touchDragState.currentDropTarget.classList.remove('touch-drag-over');

      const dropEvent = new CustomEvent('touchdrop', {
        detail: touchDragState.data,
        bubbles: true
      });
      touchDragState.currentDropTarget.dispatchEvent(dropEvent);
    }

    // Trigger drag end callback
    if (onDragEnd) {
      onDragEnd();
    }
  }

  // Reset state
  touchDragState = {
    isDragging: false,
    element: null,
    ghost: null,
    data: {},
    startX: 0,
    startY: 0,
    currentDropTarget: null,
    onDragEnd: null
  };
}

/**
 * Hook to add touch drag capability to an element
 * Returns props to spread on the draggable element
 */
export function useTouchDraggable(dragData, { onDragStart, onDragEnd } = {}) {
  return {
    onTouchStart: (e) => handleTouchStart(e, dragData, onDragStart),
    onTouchMove: handleTouchMove,
    onTouchEnd: (e) => handleTouchEnd(e, onDragEnd)
  };
}

/**
 * Hook to make an element a drop zone for touch drag
 * Returns props to spread on the drop zone element
 */
export function useTouchDropZone(dropZoneId, { onDrop, onDragOver, onDragLeave } = {}) {
  const handleTouchDrop = (e) => {
    if (onDrop) {
      onDrop(e.detail, dropZoneId);
    }
  };

  const handleTouchDragEnter = (e) => {
    if (onDragOver) {
      onDragOver(dropZoneId);
    }
  };

  const handleTouchDragLeave = () => {
    if (onDragLeave) {
      onDragLeave();
    }
  };

  return {
    'data-drop-zone': dropZoneId,
    ref: (el) => {
      if (el) {
        el.addEventListener('touchdrop', handleTouchDrop);
        el.addEventListener('touchdragenter', handleTouchDragEnter);
        el.addEventListener('touchdragleave', handleTouchDragLeave);
      }
    }
  };
}
