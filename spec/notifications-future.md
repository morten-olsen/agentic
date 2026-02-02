# Advanced Notifications Specification (Future)

> Multi-channel routing with attention management

**Version**: Draft (Future Enhancement)
**Status**: Not Implemented
**Depends On**: Trigger System v2

## Overview

This document captures advanced notification features that were part of the original v1 implementation but are deferred to simplify the initial trigger system rewrite. These features should be considered for a future enhancement phase.

### Features Covered

1. **Multi-Channel Routing**: Deliver notifications via multiple channels (Telegram, email, SMS, Slack, webhook)
2. **Attention Budget**: Limit interruptions to prevent notification fatigue
3. **Smart Routing**: Route based on urgency, time of day, and user state
4. **Quiet Hours**: Suppress non-critical notifications during defined periods
5. **Focus Blocks**: Manual do-not-disturb with automatic expiry

---

## Multi-Channel Architecture

### Channel Types

```typescript
type ChannelType = 'cli' | 'telegram' | 'email' | 'sms' | 'slack' | 'webhook';

type NotificationChannel = {
  id: string;
  type: ChannelType;
  name: string;
  enabled: boolean;
  minUrgency: Urgency;              // Only deliver if urgency >= this
  priority: number;                  // Higher = preferred when multiple match
  config: Record<string, unknown>;   // Channel-specific configuration
  createdAt: string;
  updatedAt: string;
};
```

### Channel Configuration Examples

**Telegram**:
```json
{
  "type": "telegram",
  "config": {
    "chatId": 123456789
  }
}
```

**Email**:
```json
{
  "type": "email",
  "config": {
    "address": "user@example.com",
    "smtpServer": "smtp.example.com"
  }
}
```

**Slack**:
```json
{
  "type": "slack",
  "config": {
    "webhookUrl": "https://hooks.slack.com/...",
    "channel": "#alerts"
  }
}
```

**Webhook**:
```json
{
  "type": "webhook",
  "config": {
    "url": "https://example.com/webhook",
    "headers": { "Authorization": "Bearer ..." },
    "method": "POST"
  }
}
```

### Routing Logic

```
For each notification:
  1. Get all enabled channels
  2. Filter by minUrgency (channel.minUrgency <= notification.urgency)
  3. Sort by priority (descending)
  4. Apply attention budget rules
  5. Attempt delivery to highest priority channel
  6. If failed, try next channel (cascade)
```

---

## Attention Budget

### Concept

The attention budget tracks interruption frequency and prevents notification fatigue. It's a singleton that maintains state about recent interruptions and user responsiveness.

### Schema

```typescript
type UserResponsiveness = 'high' | 'medium' | 'low';

type AttentionBudget = {
  // Interruption tracking
  recentInterruptions: number;       // Count in current window
  lastInterruptionAt?: string;       // ISO8601
  lastResetAt: string;               // When counter was reset

  // User state
  userResponsiveness: UserResponsiveness;  // Learned from behavior
  quietHoursActive: boolean;
  focusBlockActive: boolean;
  manualDndUntil?: string;           // Manual do-not-disturb until time
};
```

### Configuration

```typescript
type AttentionConfig = {
  // Limits
  maxInterruptionsPerHour: number;   // Default: 5
  batchingThresholdMinutes: number;  // Default: 15 (batch medium/low within this)

  // Quiet hours
  quietHoursStart: string;           // Default: "22:00"
  quietHoursEnd: string;             // Default: "07:00"

  // Tier thresholds
  criticalAlwaysNotifies: boolean;   // Default: true
  highBypassesQuietHours: boolean;   // Default: false
};
```

### Decision Algorithm

```typescript
type NotificationTier = 'critical' | 'high' | 'medium' | 'low' | 'background';

type NotificationDecision = {
  shouldNotify: boolean;
  tier: NotificationTier;
  channel?: string;
  reason: string;
  delayUntil?: string;               // For batching
};

function makeRoutingDecision(
  notification: Notification,
  budget: AttentionBudget,
  config: AttentionConfig
): NotificationDecision {
  // Critical always notifies
  if (notification.urgency === 'critical') {
    return { shouldNotify: true, tier: 'critical', reason: 'Critical urgency' };
  }

  // Manual DND blocks everything except critical
  if (budget.manualDndUntil && new Date() < new Date(budget.manualDndUntil)) {
    return { shouldNotify: false, tier: 'background', reason: 'Manual DND active' };
  }

  // Focus block demotes high to medium
  if (budget.focusBlockActive && notification.urgency === 'high') {
    notification.urgency = 'medium';
  }

  // Quiet hours check
  if (budget.quietHoursActive) {
    if (notification.urgency === 'high' && !config.highBypassesQuietHours) {
      return { shouldNotify: false, tier: 'background', reason: 'Quiet hours' };
    }
    if (notification.urgency !== 'high') {
      return { shouldNotify: false, tier: 'background', reason: 'Quiet hours' };
    }
  }

  // Over budget check
  if (budget.recentInterruptions >= config.maxInterruptionsPerHour) {
    if (notification.urgency === 'high') {
      return { shouldNotify: true, tier: 'high', reason: 'High urgency bypasses budget' };
    }
    return { shouldNotify: false, tier: 'background', reason: 'Over interruption budget' };
  }

  // Batching for medium/low
  if (notification.urgency === 'medium' || notification.urgency === 'low') {
    const timeSinceLastInterruption = budget.lastInterruptionAt
      ? Date.now() - new Date(budget.lastInterruptionAt).getTime()
      : Infinity;

    if (timeSinceLastInterruption < config.batchingThresholdMinutes * 60 * 1000) {
      const delayUntil = new Date(
        new Date(budget.lastInterruptionAt!).getTime() +
        config.batchingThresholdMinutes * 60 * 1000
      ).toISOString();
      return {
        shouldNotify: false,
        tier: notification.urgency,
        reason: 'Batching',
        delayUntil
      };
    }
  }

  return {
    shouldNotify: true,
    tier: notification.urgency as NotificationTier,
    reason: 'Within budget'
  };
}
```

---

## Quiet Hours

### Behavior

During quiet hours (default 10 PM - 7 AM):
- Critical notifications always get through
- High urgency: configurable (default: blocked)
- Medium/Low: blocked

### Configuration

Quiet hours should respect user's timezone from UserModel.

```typescript
type QuietHoursConfig = {
  enabled: boolean;
  startTime: string;                 // "HH:MM" format
  endTime: string;                   // "HH:MM" format
  timezone: string;                  // From UserModel
  allowHigh: boolean;                // Let high urgency through
};
```

---

## Focus Blocks

### Concept

User-initiated do-not-disturb periods with automatic expiry. Unlike quiet hours (recurring schedule), focus blocks are one-time periods.

### Interface

```typescript
// Agent tool or slash command
function startFocusBlock(duration: number): FocusBlock;
function endFocusBlock(): void;

type FocusBlock = {
  startedAt: string;
  endsAt: string;
  reason?: string;                   // "Deep work", "Meeting", etc.
};
```

### Behavior

During focus block:
- Critical: always notifies
- High: demoted to medium behavior
- Medium/Low: blocked

---

## Notification Actions

### Interactive Notifications

Notifications can include actions the user can take:

```typescript
type NotificationAction = {
  id: string;
  label: string;                     // Button text
  type: 'primary' | 'secondary' | 'destructive';
  action: string;                    // Action identifier
  data?: Record<string, unknown>;    // Action parameters
};

// Example: Approval notification
{
  title: "Task Approval Required",
  body: "The agent wants to send an email to john@example.com",
  actions: [
    { id: "approve", label: "Approve", type: "primary", action: "approve_interrupt" },
    { id: "deny", label: "Deny", type: "destructive", action: "deny_interrupt" }
  ]
}
```

### Channel Support

| Channel | Actions Supported |
|---------|------------------|
| Telegram | Yes (inline keyboards) |
| CLI | Yes (numbered options) |
| Email | Limited (links only) |
| SMS | No |
| Slack | Yes (buttons) |
| Webhook | Depends on receiver |

---

## Database Schema

### Channels Table

```sql
CREATE TABLE notification_channels (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  name TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  min_urgency TEXT NOT NULL DEFAULT 'low',
  priority INTEGER NOT NULL DEFAULT 0,
  config TEXT,                        -- JSON
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

### Attention Budget Table

```sql
CREATE TABLE attention_budget (
  id TEXT PRIMARY KEY DEFAULT 'singleton',
  recent_interruptions INTEGER NOT NULL DEFAULT 0,
  last_interruption_at TEXT,
  user_responsiveness TEXT NOT NULL DEFAULT 'medium',
  quiet_hours_active INTEGER NOT NULL DEFAULT 0,
  focus_block_active INTEGER NOT NULL DEFAULT 0,
  focus_block_ends_at TEXT,
  manual_dnd_until TEXT,
  last_reset_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

### Notifications Table (Enhanced)

```sql
CREATE TABLE notifications (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  urgency TEXT NOT NULL DEFAULT 'low',
  status TEXT NOT NULL DEFAULT 'pending',

  -- Delivery tracking
  delivered_via TEXT,                 -- Channel ID
  delivered_at TEXT,
  read_at TEXT,
  dismissed_at TEXT,

  -- Scheduling
  scheduled_for TEXT,                 -- For batched/delayed
  expires_at TEXT,
  snoozed_until TEXT,

  -- Actions
  actions TEXT,                       -- JSON array

  -- Source tracking
  source_type TEXT,                   -- 'trigger' | 'task' | 'user' | 'system'
  source_id TEXT,
  trigger_id TEXT REFERENCES triggers(id),
  conversation_id TEXT REFERENCES conversations(id),

  -- Metadata
  metadata TEXT,                      -- JSON

  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

### Delivery Attempts Table

```sql
CREATE TABLE notification_deliveries (
  id TEXT PRIMARY KEY,
  notification_id TEXT NOT NULL REFERENCES notifications(id),
  channel_id TEXT NOT NULL REFERENCES notification_channels(id),
  status TEXT NOT NULL,               -- 'pending' | 'sent' | 'delivered' | 'failed'
  attempted_at TEXT NOT NULL,
  delivered_at TEXT,
  error TEXT,
  external_id TEXT,                   -- ID from external system
  UNIQUE(notification_id, channel_id)
);
```

---

## Learning User Responsiveness

### Signals

Track user behavior to learn responsiveness:

```typescript
type ResponsivenessSignal = {
  notificationId: string;
  deliveredAt: string;
  readAt?: string;
  dismissedAt?: string;
  actionTakenAt?: string;
  actionTaken?: string;
};
```

### Calculation

```typescript
function calculateResponsiveness(signals: ResponsivenessSignal[]): UserResponsiveness {
  const recentSignals = signals.filter(s =>
    new Date(s.deliveredAt) > new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
  );

  const avgResponseTimeMs = average(
    recentSignals
      .filter(s => s.readAt)
      .map(s => new Date(s.readAt!).getTime() - new Date(s.deliveredAt).getTime())
  );

  if (avgResponseTimeMs < 5 * 60 * 1000) return 'high';      // < 5 min
  if (avgResponseTimeMs < 30 * 60 * 1000) return 'medium';   // < 30 min
  return 'low';
}
```

This informs batching decisions:
- High responsiveness: less batching, user wants real-time
- Low responsiveness: more batching, user checks infrequently

---

## Implementation Priority

When implementing these features, suggested order:

1. **Multi-channel delivery** - Most immediate value
2. **Quiet hours** - Simple, high impact
3. **Attention budget (basic)** - Counter + max per hour
4. **Focus blocks** - User-requested DND
5. **Notification actions** - Interactive notifications
6. **Cascade delivery** - Fallback channels
7. **Responsiveness learning** - Optimization

---

## Integration with Trigger System

When the trigger system sends notifications via the `notify` tool:

1. Create notification record with `source_type='trigger'`, `trigger_id=<id>`
2. Apply attention budget rules
3. Route to appropriate channel(s)
4. Track delivery attempts
5. Update notification status

The simplified v2 trigger system bypasses most of this, sending directly to Telegram. This spec describes how to enhance that flow later.
