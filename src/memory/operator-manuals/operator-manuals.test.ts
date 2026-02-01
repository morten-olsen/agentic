import { describe, it, beforeEach, afterEach, expect } from 'vitest';

import { Services } from '../../services/services.ts';
import { DatabaseService, createDatabaseService } from '../../database/database.ts';

import { OperatorManualService, ManualNotFoundError } from './operator-manuals.ts';

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
// Tests
// ============================================================================

describe('OperatorManualService', () => {
  let services: Services;
  let manualService: OperatorManualService;

  beforeEach(async () => {
    services = await createTestServices();
    manualService = new OperatorManualService(services);
  });

  afterEach(async () => {
    await services.destroy();
  });

  describe('create', () => {
    it('creates a manual with required fields', async () => {
      const manual = await manualService.create({
        name: 'Expense Reports',
        domain: 'finance',
        steps: [
          { order: 1, description: 'Gather receipts' },
          { order: 2, description: 'Fill expense form' },
          { order: 3, description: 'Submit for approval' },
        ],
      });

      expect(manual.id).toBeDefined();
      expect(manual.name).toBe('Expense Reports');
      expect(manual.domain).toBe('finance');
      expect(manual.steps).toHaveLength(3);
      expect(manual.useCount).toBe(0);
      expect(manual.successRate).toBe(1.0);
    });

    it('creates a manual with all fields', async () => {
      const manual = await manualService.create({
        name: 'Weekly Report',
        domain: 'communication',
        description: 'How to prepare weekly status reports',
        steps: [
          { order: 1, description: 'Collect metrics', toolsUsed: ['analytics'] },
          { order: 2, description: 'Write summary', example: 'This week we shipped...' },
        ],
        bestPractices: ['Include visuals', 'Keep it brief'],
        commonMistakes: ['Missing deadlines', 'Too much detail'],
      });

      expect(manual.description).toBe('How to prepare weekly status reports');
      expect(manual.steps[0].toolsUsed).toEqual(['analytics']);
      expect(manual.steps[1].example).toBe('This week we shipped...');
      expect(manual.bestPractices).toHaveLength(2);
      expect(manual.commonMistakes).toHaveLength(2);
    });
  });

  describe('get', () => {
    it('returns null for non-existent manual', async () => {
      const manual = await manualService.get('non-existent');
      expect(manual).toBeNull();
    });

    it('retrieves an existing manual', async () => {
      const created = await manualService.create({
        name: 'Test Manual',
        domain: 'test',
        steps: [{ order: 1, description: 'Step one' }],
      });

      const retrieved = await manualService.get(created.id);
      expect(retrieved).not.toBeNull();
      expect(retrieved?.name).toBe('Test Manual');
    });
  });

  describe('update', () => {
    it('updates manual fields', async () => {
      const manual = await manualService.create({
        name: 'Original Name',
        domain: 'test',
        steps: [{ order: 1, description: 'Step' }],
      });

      const updated = await manualService.update(manual.id, {
        name: 'Updated Name',
        description: 'New description',
      });

      expect(updated.name).toBe('Updated Name');
      expect(updated.description).toBe('New description');
    });

    it('throws ManualNotFoundError for non-existent manual', async () => {
      await expect(manualService.update('non-existent', { name: 'Test' })).rejects.toThrow(ManualNotFoundError);
    });
  });

  describe('delete', () => {
    it('deletes an existing manual', async () => {
      const manual = await manualService.create({
        name: 'To Delete',
        domain: 'test',
        steps: [{ order: 1, description: 'Step' }],
      });

      const deleted = await manualService.delete(manual.id);
      expect(deleted).toBe(true);

      const retrieved = await manualService.get(manual.id);
      expect(retrieved).toBeNull();
    });

    it('returns false for non-existent manual', async () => {
      const deleted = await manualService.delete('non-existent');
      expect(deleted).toBe(false);
    });
  });

  describe('findByName', () => {
    it('finds a manual by exact name', async () => {
      await manualService.create({
        name: 'Exact Name',
        domain: 'test',
        steps: [{ order: 1, description: 'Step' }],
      });

      const found = await manualService.findByName('Exact Name');
      expect(found).not.toBeNull();
      expect(found?.name).toBe('Exact Name');
    });

    it('returns null if name not found', async () => {
      const found = await manualService.findByName('Non-existent');
      expect(found).toBeNull();
    });
  });

  describe('findByDomain', () => {
    it('finds manuals by domain', async () => {
      await manualService.create({
        name: 'Finance 1',
        domain: 'finance',
        steps: [{ order: 1, description: 'Step' }],
      });
      await manualService.create({
        name: 'Finance 2',
        domain: 'finance',
        steps: [{ order: 1, description: 'Step' }],
      });
      await manualService.create({
        name: 'Travel 1',
        domain: 'travel',
        steps: [{ order: 1, description: 'Step' }],
      });

      const financeManuals = await manualService.findByDomain('finance');
      expect(financeManuals).toHaveLength(2);
      expect(financeManuals.every((m) => m.domain === 'finance')).toBe(true);
    });
  });

  describe('search', () => {
    it('searches manuals by name and description', async () => {
      await manualService.create({
        name: 'Expense Report',
        domain: 'finance',
        description: 'How to submit expenses',
        steps: [{ order: 1, description: 'Step' }],
      });
      await manualService.create({
        name: 'Travel Booking',
        domain: 'travel',
        description: 'How to book travel with expense guidelines',
        steps: [{ order: 1, description: 'Step' }],
      });

      const results = await manualService.search('expense');
      expect(results).toHaveLength(2);
    });
  });

  describe('recordUsage', () => {
    it('updates use count and success rate on success', async () => {
      const manual = await manualService.create({
        name: 'Test',
        domain: 'test',
        steps: [{ order: 1, description: 'Step' }],
      });

      await manualService.recordUsage(manual.id, true);
      await manualService.recordUsage(manual.id, true);

      const updated = await manualService.get(manual.id);
      expect(updated?.useCount).toBe(2);
      expect(updated?.successRate).toBe(1.0);
    });

    it('updates success rate on failure', async () => {
      const manual = await manualService.create({
        name: 'Test',
        domain: 'test',
        steps: [{ order: 1, description: 'Step' }],
      });

      await manualService.recordUsage(manual.id, true);
      await manualService.recordUsage(manual.id, false);

      const updated = await manualService.get(manual.id);
      expect(updated?.useCount).toBe(2);
      expect(updated?.successRate).toBe(0.5);
    });
  });

  describe('addCorrection', () => {
    it('adds a correction to the manual', async () => {
      const manual = await manualService.create({
        name: 'Test',
        domain: 'test',
        steps: [{ order: 1, description: 'Step' }],
      });

      const updated = await manualService.addCorrection(manual.id, {
        originalBehavior: 'Sent email without CC',
        correctedBehavior: 'Always CC finance department',
        context: 'Expense report submission',
      });

      expect(updated.userCorrections).toHaveLength(1);
      expect(updated.userCorrections[0].originalBehavior).toBe('Sent email without CC');
      expect(updated.userCorrections[0].timestamp).toBeDefined();
    });

    it('throws ManualNotFoundError for non-existent manual', async () => {
      await expect(
        manualService.addCorrection('non-existent', {
          originalBehavior: 'x',
          correctedBehavior: 'y',
          context: 'z',
        }),
      ).rejects.toThrow(ManualNotFoundError);
    });
  });

  describe('addBestPractice', () => {
    it('adds a best practice to the manual', async () => {
      const manual = await manualService.create({
        name: 'Test',
        domain: 'test',
        steps: [{ order: 1, description: 'Step' }],
      });

      const updated = await manualService.addBestPractice(manual.id, 'Always double-check totals');

      expect(updated.bestPractices).toContain('Always double-check totals');
    });
  });

  describe('addCommonMistake', () => {
    it('adds a common mistake to the manual', async () => {
      const manual = await manualService.create({
        name: 'Test',
        domain: 'test',
        steps: [{ order: 1, description: 'Step' }],
      });

      const updated = await manualService.addCommonMistake(manual.id, 'Forgetting attachments');

      expect(updated.commonMistakes).toContain('Forgetting attachments');
    });
  });

  describe('list', () => {
    it('lists manuals with domain filter', async () => {
      await manualService.create({
        name: 'Finance 1',
        domain: 'finance',
        steps: [{ order: 1, description: 'Step' }],
      });
      await manualService.create({
        name: 'Travel 1',
        domain: 'travel',
        steps: [{ order: 1, description: 'Step' }],
      });

      const all = await manualService.list();
      expect(all).toHaveLength(2);

      const financeOnly = await manualService.list({ domain: 'finance' });
      expect(financeOnly).toHaveLength(1);
    });

    it('respects limit parameter', async () => {
      await manualService.create({
        name: 'Manual 1',
        domain: 'test',
        steps: [{ order: 1, description: 'Step' }],
      });
      await manualService.create({
        name: 'Manual 2',
        domain: 'test',
        steps: [{ order: 1, description: 'Step' }],
      });
      await manualService.create({
        name: 'Manual 3',
        domain: 'test',
        steps: [{ order: 1, description: 'Step' }],
      });

      const limited = await manualService.list({ limit: 2 });
      expect(limited).toHaveLength(2);
    });
  });
});
