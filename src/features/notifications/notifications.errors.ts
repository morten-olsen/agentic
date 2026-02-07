// ============================================================================
// Notification Not Found Error
// ============================================================================

class NotificationNotFoundError extends Error {
  readonly notificationId: string;

  constructor(notificationId: string) {
    super(`Notification not found: ${notificationId}`);
    this.name = 'NotificationNotFoundError';
    this.notificationId = notificationId;
  }
}

// ============================================================================
// Channel Not Found Error
// ============================================================================

class ChannelNotFoundError extends Error {
  readonly channelId: string;

  constructor(channelId: string) {
    super(`Notification channel not found: ${channelId}`);
    this.name = 'ChannelNotFoundError';
    this.channelId = channelId;
  }
}

// ============================================================================
// Channel Not Registered Error
// ============================================================================

class ChannelNotRegisteredError extends Error {
  readonly channelId: string;

  constructor(channelId: string) {
    super(`Notification channel not registered (no sender): ${channelId}`);
    this.name = 'ChannelNotRegisteredError';
    this.channelId = channelId;
  }
}

// ============================================================================
// Notification Delivery Error
// ============================================================================

class NotificationDeliveryError extends Error {
  readonly notificationId: string;
  readonly channelId: string;
  readonly cause?: Error;

  constructor(notificationId: string, channelId: string, cause?: Error) {
    super(
      `Failed to deliver notification ${notificationId} via channel ${channelId}: ${cause?.message ?? 'unknown error'}`,
    );
    this.name = 'NotificationDeliveryError';
    this.notificationId = notificationId;
    this.channelId = channelId;
    this.cause = cause;
  }
}

// ============================================================================
// Invalid Notification State Error
// ============================================================================

class InvalidNotificationStateError extends Error {
  readonly notificationId: string;
  readonly currentStatus: string;
  readonly attemptedAction: string;

  constructor(notificationId: string, currentStatus: string, attemptedAction: string) {
    super(`Cannot ${attemptedAction} notification ${notificationId} in status ${currentStatus}`);
    this.name = 'InvalidNotificationStateError';
    this.notificationId = notificationId;
    this.currentStatus = currentStatus;
    this.attemptedAction = attemptedAction;
  }
}

// ============================================================================
// Exports
// ============================================================================

export {
  NotificationNotFoundError,
  ChannelNotFoundError,
  ChannelNotRegisteredError,
  NotificationDeliveryError,
  InvalidNotificationStateError,
};
