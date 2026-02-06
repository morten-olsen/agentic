/**
 * GLaDOS - General Learning and Decision Orchestration System
 *
 * Phase 1: Foundation Layer exports
 */

// Services container
export { Services, destroySymbol } from './services/services.ts';
export type { ServiceConstructor, Destroyable } from './services/services.ts';

// Database
export { DatabaseService, createDatabaseService, databaseConfigSchema } from './database/database.ts';
export type { DatabaseConfig } from './database/database.ts';

// User Model
export { UserModelService, getTimeOfDay, isWorkingHours } from './user-model/user-model.ts';
export type {
  Identity,
  IdentityInput,
  Project,
  CreateProjectInput,
  UpdateProjectInput,
  ProjectStatus,
  ProjectPriority,
  Goal,
  CreateGoalInput,
  UpdateGoalInput,
  GoalTimeframe,
  Routine,
  CreateRoutineInput,
  UpdateRoutineInput,
  WorkingHours,
  Preferences,
  TimeOfDay,
} from './user-model/user-model.ts';

// Contacts
export { ContactsService } from './contacts/contacts.ts';
export type {
  Contact,
  CreateContactInput,
  UpdateContactInput,
  ContactGroup,
  CreateContactGroupInput,
  UpdateContactGroupInput,
  RelationshipType,
  RelationshipImportance,
  Relationship,
} from './contacts/contacts.ts';

// Location
export { LocationService, isAtHome, isAtWork, isTraveling, getLocationTimezone } from './location/location.ts';
export type {
  Location,
  CreateLocationInput,
  UpdateLocationInput,
  CurrentLocation,
  LocationType,
  LocationSource,
  LocationConfidence,
  Coordinates,
  Address,
} from './location/location.ts';

// Calendar
export {
  CalendarService,
  startOfDay,
  endOfDay,
  addHours,
  minutesBetween,
  isEventAt,
  isFutureEvent,
  eventOverlapsRange,
  sortEventsByStart,
  formatEventTime,
  getEventDuration,
} from './calendar/calendar.ts';
export type {
  CalendarEvent,
  CreateCalendarEventInput,
  UpdateCalendarEventInput,
  CalendarContext,
  EventSource,
  AttendeeStatus,
  Attendee,
  Recurrence,
  TimeBlockType,
  TimeBlock,
} from './calendar/calendar.ts';

// Context Builder
export { ContextBuilderService } from './context/context.ts';
export type { AgentContext, LocationContext, CalendarAgentContext, UserContext } from './context/context.ts';

// ═══════════════════════════════════════════════════════════════════════════════
// Phase 2: Core Orchestration Layer
// ═══════════════════════════════════════════════════════════════════════════════

// Tools
export {
  ToolRegistry,
  riskLevelSchema,
  riskCategorySchema,
  riskProfileSchema,
  toolContextSchema,
  toolResultSchema,
  ToolNotFoundError,
  ToolAlreadyRegisteredError,
  ToolExecutionError,
  ToolInputValidationError,
  ToolOutputValidationError,
  ToolTimeoutError,
} from './tools/tools.ts';
export type {
  RiskLevel,
  RiskCategory,
  RiskProfile,
  ToolContext,
  ToolResult,
  ToolDefinition,
  RegisteredTool,
  ToolExecutionOptions,
  ToolExecutionEvent,
} from './tools/tools.ts';

// Tool Adapters
export {
  toLangChainTool,
  toLangChainTools,
  toLangChainToolsFiltered,
  toLangChainToolsByCategory,
  toLangChainToolsByTag,
  getToolJsonSchema,
} from './tools/adapters/adapters.langchain.ts';

// Builtin Tools
export { registerBuiltinTools, echoTool } from './tools/builtin/builtin.ts';
export type { EchoInput, EchoOutput } from './tools/builtin/builtin.ts';

// Personality
export {
  PersonalityService,
  buildSystemPrompt,
  styleSchema,
  traitsSchema,
  personalityExampleSchema,
  personalityConfigSchema,
  createPersonalityInputSchema,
  updatePersonalityInputSchema,
} from './personality/personality.ts';
export type {
  Style,
  Traits,
  PersonalityExample,
  PersonalityConfig,
  CreatePersonalityInput,
  UpdatePersonalityInput,
} from './personality/personality.ts';

// Orchestrator
export {
  OrchestratorService,
  OrchestratorAnnotation,
  DatabaseCheckpointer,
  orchestratorConfigSchema,
  llmConfigSchema,
  messageSchema,
  conversationSchema,
  ConversationNotFoundError,
  OrchestratorNotConfiguredError,
  LLMInvocationError,
} from './orchestrator/orchestrator.ts';
export type {
  OrchestratorState,
  LLMConfig,
  OrchestratorConfig,
  MessageRole,
  Message,
  Conversation,
  ToolCall,
  ChatChunk,
} from './orchestrator/orchestrator.ts';

// CLI (for programmatic access)
export { Repl } from './cli/cli.repl.ts';
export type { ReplConfig } from './cli/cli.repl.ts';

// Configuration
export {
  loadConfig,
  getConfig,
  getLoadedConfigFiles,
  getAllConfigPaths,
  isLLMConfigured,
  getConfigDisplay,
  getGlobalConfigDir,
  getUserConfigDir,
  configSchema,
} from './config/config.ts';
export type { Config } from './config/config.ts';

// ═══════════════════════════════════════════════════════════════════════════════
// Phase 5: Long-Running Tasks
// ═══════════════════════════════════════════════════════════════════════════════

// Tasks
export {
  TaskService,
  TaskNotFoundError,
  InvalidStepError,
  TaskAlreadyCompletedError,
  InvalidTaskStateError,
  // Trigger schemas
  deadlineTriggerSchema,
  recurringTimeTriggerSchema,
  recurringCompletionTriggerSchema,
  opportunisticTriggerSchema,
  deferredTriggerSchema,
  conditionalTriggerSchema,
  taskTriggerSchema,
  // User task schemas
  userTaskStatusSchema,
  userTaskSchema,
  createUserTaskInputSchema,
  updateUserTaskInputSchema,
  // Delegated task schemas
  delegatedTaskStatusSchema,
  taskStepStatusSchema,
  taskStepSchema,
  taskEventTypeSchema,
  taskEventSchema,
  waitingForTypeSchema,
  timeoutActionSchema,
  waitingForSchema,
  delegatedTaskSchema,
  createStepInputSchema,
  createDelegatedTaskInputSchema,
  updateDelegatedTaskInputSchema,
  // Context schema
  pendingTaskContextSchema,
} from './tasks/tasks.ts';
export type {
  TaskTrigger,
  TaskTriggerType,
  UserTaskStatus,
  UserTask,
  CreateUserTaskInput,
  UpdateUserTaskInput,
  DelegatedTaskStatus,
  TaskStep,
  TaskStepStatus,
  TaskEvent,
  TaskEventType,
  WaitingFor,
  WaitingForType,
  TimeoutAction,
  DelegatedTask,
  CreateDelegatedTaskInput,
  UpdateDelegatedTaskInput,
  PendingTaskContext,
} from './tasks/tasks.ts';

// ═══════════════════════════════════════════════════════════════════════════════
// Phase 6: Notifications
// ═══════════════════════════════════════════════════════════════════════════════

// Notifications
export {
  NotificationRouter,
  NotificationNotFoundError,
  ChannelNotFoundError,
  ChannelNotRegisteredError,
  NotificationDeliveryError,
  InvalidNotificationStateError,
  urgencySchema,
  notificationTypeSchema,
  notificationStatusSchema,
  notificationActionSchema,
  notificationSchema,
  createNotificationInputSchema,
  updateNotificationInputSchema,
  channelTypeSchema,
  notificationChannelSchema,
  createChannelInputSchema,
  userResponsivenessSchema,
  attentionBudgetSchema,
  notificationTierSchema,
  notificationDecisionSchema,
  deliveryStatusSchema,
  notificationDeliverySchema,
  DEFAULT_CONFIG as NOTIFICATION_DEFAULT_CONFIG,
  isQuietHours,
  getQuietHoursEnd,
} from './notifications/notifications.ts';
export type {
  Urgency,
  NotificationType,
  NotificationStatus,
  NotificationAction,
  Notification,
  CreateNotificationInput,
  UpdateNotificationInput,
  ChannelType,
  NotificationChannel,
  CreateChannelInput,
  UserResponsiveness,
  AttentionBudget,
  NotificationTier,
  NotificationDecision,
  DeliveryStatus,
  NotificationDelivery,
  ChannelSender,
  AttentionConfig,
} from './notifications/notifications.ts';

// ═══════════════════════════════════════════════════════════════════════════════
// Artifacts
// ═══════════════════════════════════════════════════════════════════════════════

export { ArtifactService, DEFAULT_CONFIG as ARTIFACT_DEFAULT_CONFIG } from './artifacts/artifacts.ts';
export type { ArtifactServiceConfig } from './artifacts/artifacts.ts';
export {
  artifactMimeTypeSchema,
  artifactSchema,
  artifactMetaSchema,
  createArtifactInputSchema,
  createArtifactResultSchema,
  artifactRowSchema,
  rowToArtifact,
  rowToArtifactMeta,
} from './artifacts/artifacts.schemas.ts';
export type {
  ArtifactMimeType,
  Artifact,
  ArtifactMeta,
  CreateArtifactInput,
  CreateArtifactResult,
  ArtifactRow,
} from './artifacts/artifacts.schemas.ts';
export {
  ArtifactNotFoundError,
  ArtifactExpiredError,
  ArtifactSizeLimitError,
  ArtifactLimitExceededError,
} from './artifacts/artifacts.errors.ts';

// ═══════════════════════════════════════════════════════════════════════════════
// Logging
// ═══════════════════════════════════════════════════════════════════════════════

export {
  LogService,
  extractErrorDetails,
  logLevelSchema,
  logEntrySchema,
  logContextSchema,
  logQueryFiltersSchema,
  logStatsSchema,
  logConfigSchema,
  LOG_LEVEL_PRIORITY,
  formatLogEntry,
  writeToTerminal,
} from './logging/index.ts';
export type {
  Logger,
  LogLevel,
  LogEntry,
  LogContext,
  LogQueryFilters,
  LogStats,
  LogConfig,
  LogConfigInput,
} from './logging/index.ts';
