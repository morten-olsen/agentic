import { describe, it, beforeEach, afterEach, expect } from 'vitest';

import { Services } from '../services/services.ts';
import { DatabaseService, createDatabaseService } from '../database/database.ts';

import {
  DayPlanService,
  DayPlanNotFoundError,
  DayPlanAlreadyExistsError,
  PriorityNotFoundError,
  FocusBlockNotFoundError,
  InvalidDayPlanStateError,
} from './day-planner.ts';

// ============================================================================
// Test Setup
// ============================================================================

const createTestServices = async (): Promise<Services> => {
  const services = new Services();
  const db = createDatabaseService(services, { path: ':memory:' });
  services.set(DatabaseService, db);
  await db.migrate();
  return services;
};

// ============================================================================
// Day Plan CRUD Tests
// ============================================================================

describe('DayPlanService - CRUD', () => {
  let services: Services;
  let dayPlanService: DayPlanService;

  beforeEach(async () => {
    services = await createTestServices();
    dayPlanService = new DayPlanService(services);
  });

  afterEach(async () => {
    await services.destroy();
  });

  describe('createPlan', () => {
    it('creates a basic day plan', async () => {
      const plan = await dayPlanService.createPlan({
        date: '2024-03-15',
      });

      expect(plan.id).toBeDefined();
      expect(plan.date).toBe('2024-03-15');
      expect(plan.status).toBe('draft');
      expect(plan.intentions).toEqual([]);
      expect(plan.priorities).toEqual([]);
      expect(plan.focusBlocks).toEqual([]);
    });

    it('creates a plan with intentions', async () => {
      const plan = await dayPlanService.createPlan({
        date: '2024-03-15',
        intentions: ['Make progress on API', 'Follow up on timeline'],
      });

      expect(plan.intentions).toHaveLength(2);
      expect(plan.intentions[0].intention).toBe('Make progress on API');
      expect(plan.intentions[1].intention).toBe('Follow up on timeline');
    });

    it('creates a plan with priorities', async () => {
      const plan = await dayPlanService.createPlan({
        date: '2024-03-15',
        priorities: [
          { description: 'Complete API auth', category: 'work' },
          { description: 'Exercise', category: 'health' },
        ],
      });

      expect(plan.priorities).toHaveLength(2);
      expect(plan.priorities[0].description).toBe('Complete API auth');
      expect(plan.priorities[0].category).toBe('work');
      expect(plan.priorities[0].completed).toBe(false);
      expect(plan.priorities[1].description).toBe('Exercise');
    });

    it('creates a plan with focus blocks', async () => {
      const plan = await dayPlanService.createPlan({
        date: '2024-03-15',
        focusBlocks: [
          { label: 'Deep work', startTime: '08:00', duration: 120 },
          { label: 'Reading', duration: 60 },
        ],
      });

      expect(plan.focusBlocks).toHaveLength(2);
      expect(plan.focusBlocks[0].label).toBe('Deep work');
      expect(plan.focusBlocks[0].startTime).toBe('08:00');
      expect(plan.focusBlocks[0].duration).toBe(120);
      expect(plan.focusBlocks[1].startTime).toBeUndefined();
    });

    it('creates a plan with energy level and notes', async () => {
      const plan = await dayPlanService.createPlan({
        date: '2024-03-15',
        energyLevel: 'medium',
        notes: 'Feeling okay today',
      });

      expect(plan.energyLevel).toBe('medium');
      expect(plan.notes).toBe('Feeling okay today');
    });

    it('throws DayPlanAlreadyExistsError for duplicate date', async () => {
      await dayPlanService.createPlan({ date: '2024-03-15' });

      await expect(dayPlanService.createPlan({ date: '2024-03-15' })).rejects.toThrow(DayPlanAlreadyExistsError);
    });
  });

  describe('getPlan', () => {
    it('returns null for non-existent plan', async () => {
      const plan = await dayPlanService.getPlan('non-existent');
      expect(plan).toBeNull();
    });

    it('retrieves an existing plan', async () => {
      const created = await dayPlanService.createPlan({
        date: '2024-03-15',
        intentions: ['Test intention'],
        priorities: [{ description: 'Test priority' }],
      });

      const retrieved = await dayPlanService.getPlan(created.id);
      expect(retrieved).not.toBeNull();
      expect(retrieved?.date).toBe('2024-03-15');
      expect(retrieved?.intentions).toHaveLength(1);
      expect(retrieved?.priorities).toHaveLength(1);
    });
  });

  describe('getPlanByDate', () => {
    it('returns null for non-existent date', async () => {
      const plan = await dayPlanService.getPlanByDate('2024-03-15');
      expect(plan).toBeNull();
    });

    it('retrieves plan by date', async () => {
      await dayPlanService.createPlan({ date: '2024-03-15' });

      const plan = await dayPlanService.getPlanByDate('2024-03-15');
      expect(plan).not.toBeNull();
      expect(plan?.date).toBe('2024-03-15');
    });
  });

  describe('requirePlan', () => {
    it('throws DayPlanNotFoundError for non-existent plan', async () => {
      await expect(dayPlanService.requirePlan('non-existent')).rejects.toThrow(DayPlanNotFoundError);
    });
  });

  describe('updatePlan', () => {
    it('updates energy level', async () => {
      const plan = await dayPlanService.createPlan({ date: '2024-03-15' });

      const updated = await dayPlanService.updatePlan(plan.id, { energyLevel: 'high' });
      expect(updated.energyLevel).toBe('high');
    });

    it('updates notes', async () => {
      const plan = await dayPlanService.createPlan({ date: '2024-03-15' });

      const updated = await dayPlanService.updatePlan(plan.id, { notes: 'Updated notes' });
      expect(updated.notes).toBe('Updated notes');
    });

    it('clears energy level with null', async () => {
      const plan = await dayPlanService.createPlan({ date: '2024-03-15', energyLevel: 'high' });

      const updated = await dayPlanService.updatePlan(plan.id, { energyLevel: null });
      expect(updated.energyLevel).toBeUndefined();
    });

    it('throws DayPlanNotFoundError for non-existent plan', async () => {
      await expect(dayPlanService.updatePlan('non-existent', { notes: 'Test' })).rejects.toThrow(DayPlanNotFoundError);
    });
  });

  describe('deletePlan', () => {
    it('deletes an existing plan', async () => {
      const plan = await dayPlanService.createPlan({ date: '2024-03-15' });

      const deleted = await dayPlanService.deletePlan(plan.id);
      expect(deleted).toBe(true);

      const retrieved = await dayPlanService.getPlan(plan.id);
      expect(retrieved).toBeNull();
    });

    it('returns false for non-existent plan', async () => {
      const deleted = await dayPlanService.deletePlan('non-existent');
      expect(deleted).toBe(false);
    });
  });

  describe('upsertPlan', () => {
    it('creates a new plan if none exists', async () => {
      const plan = await dayPlanService.upsertPlan({
        date: '2024-03-15',
        intentions: ['Test'],
      });

      expect(plan.date).toBe('2024-03-15');
      expect(plan.intentions).toHaveLength(1);
    });

    it('updates existing plan', async () => {
      await dayPlanService.createPlan({
        date: '2024-03-15',
        intentions: ['Old intention'],
        priorities: [{ description: 'Old priority' }],
      });

      const updated = await dayPlanService.upsertPlan({
        date: '2024-03-15',
        intentions: ['New intention 1', 'New intention 2'],
        priorities: [{ description: 'New priority' }],
        energyLevel: 'high',
      });

      expect(updated.intentions).toHaveLength(2);
      expect(updated.intentions[0].intention).toBe('New intention 1');
      expect(updated.priorities).toHaveLength(1);
      expect(updated.priorities[0].description).toBe('New priority');
      expect(updated.energyLevel).toBe('high');
    });
  });
});

// ============================================================================
// Status Management Tests
// ============================================================================

describe('DayPlanService - Status', () => {
  let services: Services;
  let dayPlanService: DayPlanService;

  beforeEach(async () => {
    services = await createTestServices();
    dayPlanService = new DayPlanService(services);
  });

  afterEach(async () => {
    await services.destroy();
  });

  describe('activatePlan', () => {
    it('activates a draft plan', async () => {
      const plan = await dayPlanService.createPlan({ date: '2024-03-15' });

      const activated = await dayPlanService.activatePlan(plan.id);
      expect(activated.status).toBe('active');
    });

    it('throws InvalidDayPlanStateError for non-draft plan', async () => {
      const plan = await dayPlanService.createPlan({ date: '2024-03-15' });
      await dayPlanService.activatePlan(plan.id);

      await expect(dayPlanService.activatePlan(plan.id)).rejects.toThrow(InvalidDayPlanStateError);
    });
  });

  describe('completePlan', () => {
    it('completes a plan', async () => {
      const plan = await dayPlanService.createPlan({ date: '2024-03-15' });
      await dayPlanService.activatePlan(plan.id);

      const completed = await dayPlanService.completePlan(plan.id);
      expect(completed.status).toBe('completed');
      expect(completed.completedAt).toBeDefined();
    });

    it('throws InvalidDayPlanStateError for already completed plan', async () => {
      const plan = await dayPlanService.createPlan({ date: '2024-03-15' });
      await dayPlanService.completePlan(plan.id);

      await expect(dayPlanService.completePlan(plan.id)).rejects.toThrow(InvalidDayPlanStateError);
    });
  });

  describe('abandonPlan', () => {
    it('abandons a plan', async () => {
      const plan = await dayPlanService.createPlan({ date: '2024-03-15' });

      const abandoned = await dayPlanService.abandonPlan(plan.id);
      expect(abandoned.status).toBe('abandoned');
      expect(abandoned.completedAt).toBeDefined();
    });

    it('throws InvalidDayPlanStateError for already abandoned plan', async () => {
      const plan = await dayPlanService.createPlan({ date: '2024-03-15' });
      await dayPlanService.abandonPlan(plan.id);

      await expect(dayPlanService.abandonPlan(plan.id)).rejects.toThrow(InvalidDayPlanStateError);
    });
  });
});

// ============================================================================
// Priority Management Tests
// ============================================================================

describe('DayPlanService - Priorities', () => {
  let services: Services;
  let dayPlanService: DayPlanService;

  beforeEach(async () => {
    services = await createTestServices();
    dayPlanService = new DayPlanService(services);
  });

  afterEach(async () => {
    await services.destroy();
  });

  describe('addPriority', () => {
    it('adds a priority to a plan', async () => {
      const plan = await dayPlanService.createPlan({ date: '2024-03-15' });

      const priority = await dayPlanService.addPriority(plan.id, {
        description: 'New priority',
        category: 'work',
      });

      expect(priority.description).toBe('New priority');
      expect(priority.category).toBe('work');
      expect(priority.completed).toBe(false);
    });

    it('adds priority at specific position', async () => {
      const plan = await dayPlanService.createPlan({
        date: '2024-03-15',
        priorities: [{ description: 'First' }, { description: 'Second' }],
      });

      await dayPlanService.addPriority(plan.id, {
        description: 'Inserted',
        position: 1,
      });

      const updated = await dayPlanService.getPlan(plan.id);
      expect(updated?.priorities[0].description).toBe('First');
      expect(updated?.priorities[1].description).toBe('Inserted');
      expect(updated?.priorities[2].description).toBe('Second');
    });

    it('adds priority at top with position 0', async () => {
      const plan = await dayPlanService.createPlan({
        date: '2024-03-15',
        priorities: [{ description: 'Existing' }],
      });

      await dayPlanService.addPriority(plan.id, {
        description: 'Top priority',
        position: 0,
      });

      const updated = await dayPlanService.getPlan(plan.id);
      expect(updated?.priorities[0].description).toBe('Top priority');
      expect(updated?.priorities[1].description).toBe('Existing');
    });

    it('throws DayPlanNotFoundError for non-existent plan', async () => {
      await expect(dayPlanService.addPriority('non-existent', { description: 'Test' })).rejects.toThrow(
        DayPlanNotFoundError,
      );
    });
  });

  describe('updatePriority', () => {
    it('updates priority description', async () => {
      const plan = await dayPlanService.createPlan({
        date: '2024-03-15',
        priorities: [{ description: 'Original' }],
      });

      const updated = await dayPlanService.updatePriority(plan.priorities[0].id, {
        description: 'Updated',
      });

      expect(updated.description).toBe('Updated');
    });

    it('throws PriorityNotFoundError for non-existent priority', async () => {
      await expect(dayPlanService.updatePriority('non-existent', { description: 'Test' })).rejects.toThrow(
        PriorityNotFoundError,
      );
    });
  });

  describe('completePriority', () => {
    it('marks priority as completed', async () => {
      const plan = await dayPlanService.createPlan({
        date: '2024-03-15',
        priorities: [{ description: 'To complete' }],
      });

      const completed = await dayPlanService.completePriority(plan.priorities[0].id);

      expect(completed.completed).toBe(true);
      expect(completed.completedAt).toBeDefined();
    });
  });

  describe('removePriority', () => {
    it('removes a priority', async () => {
      const plan = await dayPlanService.createPlan({
        date: '2024-03-15',
        priorities: [{ description: 'To remove' }],
      });

      const removed = await dayPlanService.removePriority(plan.priorities[0].id);
      expect(removed).toBe(true);

      const updated = await dayPlanService.getPlan(plan.id);
      expect(updated?.priorities).toHaveLength(0);
    });

    it('throws PriorityNotFoundError for non-existent priority', async () => {
      await expect(dayPlanService.removePriority('non-existent')).rejects.toThrow(PriorityNotFoundError);
    });
  });

  describe('reorderPriorities', () => {
    it('reorders priorities', async () => {
      const plan = await dayPlanService.createPlan({
        date: '2024-03-15',
        priorities: [{ description: 'First' }, { description: 'Second' }, { description: 'Third' }],
      });

      const ids = plan.priorities.map((p) => p.id);
      await dayPlanService.reorderPriorities(plan.id, [ids[2], ids[0], ids[1]]);

      const updated = await dayPlanService.getPlan(plan.id);
      expect(updated?.priorities[0].description).toBe('Third');
      expect(updated?.priorities[1].description).toBe('First');
      expect(updated?.priorities[2].description).toBe('Second');
    });
  });
});

// ============================================================================
// Focus Block Management Tests
// ============================================================================

describe('DayPlanService - Focus Blocks', () => {
  let services: Services;
  let dayPlanService: DayPlanService;

  beforeEach(async () => {
    services = await createTestServices();
    dayPlanService = new DayPlanService(services);
  });

  afterEach(async () => {
    await services.destroy();
  });

  describe('addFocusBlock', () => {
    it('adds a focus block to a plan', async () => {
      const plan = await dayPlanService.createPlan({ date: '2024-03-15' });

      const block = await dayPlanService.addFocusBlock(plan.id, {
        label: 'Deep work',
        startTime: '08:00',
        duration: 120,
      });

      expect(block.label).toBe('Deep work');
      expect(block.startTime).toBe('08:00');
      expect(block.duration).toBe(120);
      expect(block.completed).toBe(false);
    });

    it('throws DayPlanNotFoundError for non-existent plan', async () => {
      await expect(dayPlanService.addFocusBlock('non-existent', { label: 'Test', duration: 60 })).rejects.toThrow(
        DayPlanNotFoundError,
      );
    });
  });

  describe('updateFocusBlock', () => {
    it('updates focus block', async () => {
      const plan = await dayPlanService.createPlan({
        date: '2024-03-15',
        focusBlocks: [{ label: 'Original', duration: 60 }],
      });

      const updated = await dayPlanService.updateFocusBlock(plan.focusBlocks[0].id, {
        label: 'Updated',
        duration: 90,
      });

      expect(updated.label).toBe('Updated');
      expect(updated.duration).toBe(90);
    });

    it('throws FocusBlockNotFoundError for non-existent block', async () => {
      await expect(dayPlanService.updateFocusBlock('non-existent', { label: 'Test' })).rejects.toThrow(
        FocusBlockNotFoundError,
      );
    });
  });

  describe('completeFocusBlock', () => {
    it('marks focus block as completed', async () => {
      const plan = await dayPlanService.createPlan({
        date: '2024-03-15',
        focusBlocks: [{ label: 'To complete', duration: 60 }],
      });

      const completed = await dayPlanService.completeFocusBlock(plan.focusBlocks[0].id);
      expect(completed.completed).toBe(true);
    });
  });

  describe('removeFocusBlock', () => {
    it('removes a focus block', async () => {
      const plan = await dayPlanService.createPlan({
        date: '2024-03-15',
        focusBlocks: [{ label: 'To remove', duration: 60 }],
      });

      const removed = await dayPlanService.removeFocusBlock(plan.focusBlocks[0].id);
      expect(removed).toBe(true);

      const updated = await dayPlanService.getPlan(plan.id);
      expect(updated?.focusBlocks).toHaveLength(0);
    });

    it('throws FocusBlockNotFoundError for non-existent block', async () => {
      await expect(dayPlanService.removeFocusBlock('non-existent')).rejects.toThrow(FocusBlockNotFoundError);
    });
  });
});

// ============================================================================
// Intention Management Tests
// ============================================================================

describe('DayPlanService - Intentions', () => {
  let services: Services;
  let dayPlanService: DayPlanService;

  beforeEach(async () => {
    services = await createTestServices();
    dayPlanService = new DayPlanService(services);
  });

  afterEach(async () => {
    await services.destroy();
  });

  describe('addIntention', () => {
    it('adds an intention to a plan', async () => {
      const plan = await dayPlanService.createPlan({ date: '2024-03-15' });

      const intention = await dayPlanService.addIntention(plan.id, 'New intention');

      expect(intention.intention).toBe('New intention');
    });

    it('throws DayPlanNotFoundError for non-existent plan', async () => {
      await expect(dayPlanService.addIntention('non-existent', 'Test')).rejects.toThrow(DayPlanNotFoundError);
    });
  });

  describe('removeIntention', () => {
    it('removes an intention', async () => {
      const plan = await dayPlanService.createPlan({
        date: '2024-03-15',
        intentions: ['To remove'],
      });

      const removed = await dayPlanService.removeIntention(plan.intentions[0].id);
      expect(removed).toBe(true);

      const updated = await dayPlanService.getPlan(plan.id);
      expect(updated?.intentions).toHaveLength(0);
    });

    it('returns false for non-existent intention', async () => {
      const removed = await dayPlanService.removeIntention('non-existent');
      expect(removed).toBe(false);
    });
  });
});

// ============================================================================
// Context Tests
// ============================================================================

describe('DayPlanService - Context', () => {
  let services: Services;
  let dayPlanService: DayPlanService;

  beforeEach(async () => {
    services = await createTestServices();
    dayPlanService = new DayPlanService(services);
  });

  afterEach(async () => {
    await services.destroy();
  });

  describe('getPlanContext', () => {
    it('returns null for non-existent date', async () => {
      const context = await dayPlanService.getPlanContext('2024-03-15');
      expect(context).toBeNull();
    });

    it('returns context for existing plan', async () => {
      await dayPlanService.createPlan({
        date: '2024-03-15',
        intentions: ['Test intention'],
        priorities: [{ description: 'Priority 1' }, { description: 'Priority 2' }],
        focusBlocks: [{ label: 'Focus', duration: 60 }],
        energyLevel: 'high',
        notes: 'Test notes',
      });

      const context = await dayPlanService.getPlanContext('2024-03-15');

      expect(context).not.toBeNull();
      expect(context?.date).toBe('2024-03-15');
      expect(context?.status).toBe('draft');
      expect(context?.intentions).toEqual(['Test intention']);
      expect(context?.priorities).toHaveLength(2);
      expect(context?.priorities[0].description).toBe('Priority 1');
      expect(context?.focusBlocks).toHaveLength(1);
      expect(context?.energyLevel).toBe('high');
      expect(context?.notes).toBe('Test notes');
      expect(context?.progressSummary).toBe('0 of 2 priorities completed');
    });

    it('calculates progress summary correctly', async () => {
      const plan = await dayPlanService.createPlan({
        date: '2024-03-15',
        priorities: [{ description: 'Priority 1' }, { description: 'Priority 2' }, { description: 'Priority 3' }],
      });

      await dayPlanService.completePriority(plan.priorities[0].id);
      await dayPlanService.completePriority(plan.priorities[1].id);

      const context = await dayPlanService.getPlanContext('2024-03-15');
      expect(context?.progressSummary).toBe('2 of 3 priorities completed');
    });

    it('handles empty priorities', async () => {
      await dayPlanService.createPlan({ date: '2024-03-15' });

      const context = await dayPlanService.getPlanContext('2024-03-15');
      expect(context?.progressSummary).toBe('No priorities set');
    });
  });

  describe('getTodayPlanContext', () => {
    it('returns null when no plan exists', async () => {
      const context = await dayPlanService.getTodayPlanContext();
      expect(context).toBeNull();
    });

    it('returns context when plan exists', async () => {
      // Create a plan for today (defaults to today's date)
      await dayPlanService.createPlan({
        intentions: ['Today intention'],
      });

      const context = await dayPlanService.getTodayPlanContext();
      expect(context).not.toBeNull();
      expect(context?.intentions).toEqual(['Today intention']);
    });
  });
});

// ============================================================================
// History Tests
// ============================================================================

describe('DayPlanService - History', () => {
  let services: Services;
  let dayPlanService: DayPlanService;

  beforeEach(async () => {
    services = await createTestServices();
    dayPlanService = new DayPlanService(services);
  });

  afterEach(async () => {
    await services.destroy();
  });

  describe('getRecentPlans', () => {
    it('returns recent plans ordered by date descending', async () => {
      await dayPlanService.createPlan({ date: '2024-03-13' });
      await dayPlanService.createPlan({ date: '2024-03-15' });
      await dayPlanService.createPlan({ date: '2024-03-14' });

      const plans = await dayPlanService.getRecentPlans(10);

      expect(plans).toHaveLength(3);
      expect(plans[0].date).toBe('2024-03-15');
      expect(plans[1].date).toBe('2024-03-14');
      expect(plans[2].date).toBe('2024-03-13');
    });

    it('respects limit parameter', async () => {
      await dayPlanService.createPlan({ date: '2024-03-13' });
      await dayPlanService.createPlan({ date: '2024-03-14' });
      await dayPlanService.createPlan({ date: '2024-03-15' });

      const plans = await dayPlanService.getRecentPlans(2);

      expect(plans).toHaveLength(2);
    });
  });
});

// ============================================================================
// Today's Plan Tests
// ============================================================================

describe('DayPlanService - Today', () => {
  let services: Services;
  let dayPlanService: DayPlanService;

  beforeEach(async () => {
    services = await createTestServices();
    dayPlanService = new DayPlanService(services);
  });

  afterEach(async () => {
    await services.destroy();
  });

  describe('getTodayPlan', () => {
    it('returns null when no plan exists for today', async () => {
      const plan = await dayPlanService.getTodayPlan();
      expect(plan).toBeNull();
    });

    it('returns plan when one exists for today', async () => {
      // Create a plan without specifying date (defaults to today)
      await dayPlanService.createPlan({});

      const plan = await dayPlanService.getTodayPlan();
      expect(plan).not.toBeNull();
    });
  });
});
