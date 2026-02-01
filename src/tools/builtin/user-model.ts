import { z } from 'zod';

import type { ToolDefinition, ToolContext, ToolRegistry } from '../tools.ts';
import { UserModelService } from '../../user-model/user-model.ts';
import {
  projectStatusSchema,
  projectPrioritySchema,
  goalTimeframeSchema,
  projectSchema,
  goalSchema,
} from '../../user-model/user-model.schemas.ts';

// ============================================================================
// Projects
// ============================================================================

// List Projects
const listProjectsInputSchema = z.object({
  status: projectStatusSchema.optional().describe('Filter by project status'),
});

const listProjectsOutputSchema = z.object({
  projects: z.array(projectSchema),
  count: z.number(),
});

type ListProjectsInput = z.infer<typeof listProjectsInputSchema>;
type ListProjectsOutput = z.infer<typeof listProjectsOutputSchema>;

const listProjectsTool: ToolDefinition<ListProjectsInput, ListProjectsOutput> = {
  id: 'user_model.list_projects',
  name: 'ListProjects',
  description: "List the user's projects. Can optionally filter by status (active, paused, completed).",
  category: 'user_model',
  inputSchema: listProjectsInputSchema,
  outputSchema: listProjectsOutputSchema,
  risk: {
    level: 'low',
    reason: 'Read-only operation',
    potentialImpact: 'None',
    reversible: true,
    categories: [],
  },
  tags: ['user', 'projects', 'read'],
  examples: [
    { input: {}, description: 'List all projects' },
    { input: { status: 'active' }, description: 'List only active projects' },
  ],
  execute: async (input: ListProjectsInput, context: ToolContext): Promise<ListProjectsOutput> => {
    const userModel = context.services.get(UserModelService);
    const projects = await userModel.getProjects(input.status ? { status: input.status } : undefined);
    return { projects, count: projects.length };
  },
};

// Create Project
const createProjectInputSchema = z.object({
  name: z.string().min(1).describe('Project name'),
  description: z.string().optional().describe('Project description'),
  status: projectStatusSchema.optional().describe('Project status'),
  priority: projectPrioritySchema.optional().describe('Project priority'),
  tags: z.array(z.string()).optional().describe('Tags for categorization'),
});

const createProjectOutputSchema = projectSchema;

type CreateProjectInput = z.infer<typeof createProjectInputSchema>;
type CreateProjectOutput = z.infer<typeof createProjectOutputSchema>;

const createProjectTool: ToolDefinition<CreateProjectInput, CreateProjectOutput> = {
  id: 'user_model.create_project',
  name: 'CreateProject',
  description: 'Create a new project for the user.',
  category: 'user_model',
  inputSchema: createProjectInputSchema,
  outputSchema: createProjectOutputSchema,
  risk: {
    level: 'low',
    reason: 'Creates a new record, easily reversible',
    potentialImpact: 'Adds a new project entry',
    reversible: true,
    categories: ['data_modification'],
  },
  tags: ['user', 'projects', 'write'],
  examples: [{ input: { name: 'Website Redesign', priority: 'high' }, description: 'Create a high-priority project' }],
  execute: async (input: CreateProjectInput, context: ToolContext): Promise<CreateProjectOutput> => {
    const userModel = context.services.get(UserModelService);
    return userModel.createProject(input);
  },
};

// Update Project
const updateProjectInputSchema = z.object({
  id: z.string().describe('Project ID to update'),
  name: z.string().optional().describe('New project name'),
  description: z.string().optional().describe('New project description'),
  status: projectStatusSchema.optional().describe('New project status'),
  priority: projectPrioritySchema.optional().describe('New project priority'),
  tags: z.array(z.string()).optional().describe('New tags'),
});

const updateProjectOutputSchema = projectSchema;

type UpdateProjectInput = z.infer<typeof updateProjectInputSchema>;
type UpdateProjectOutput = z.infer<typeof updateProjectOutputSchema>;

const updateProjectTool: ToolDefinition<UpdateProjectInput, UpdateProjectOutput> = {
  id: 'user_model.update_project',
  name: 'UpdateProject',
  description: 'Update an existing project.',
  category: 'user_model',
  inputSchema: updateProjectInputSchema,
  outputSchema: updateProjectOutputSchema,
  risk: {
    level: 'low',
    reason: 'Modifies existing record, changes are logged',
    potentialImpact: 'Modifies project data',
    reversible: true,
    categories: ['data_modification'],
  },
  tags: ['user', 'projects', 'write'],
  examples: [{ input: { id: '123', status: 'completed' }, description: 'Mark a project as completed' }],
  execute: async (input: UpdateProjectInput, context: ToolContext): Promise<UpdateProjectOutput> => {
    const userModel = context.services.get(UserModelService);
    const { id, ...updates } = input;
    return userModel.updateProject(id, updates);
  },
};

// Delete Project
const deleteProjectInputSchema = z.object({
  id: z.string().describe('Project ID to delete'),
});

const deleteProjectOutputSchema = z.object({
  success: z.boolean(),
  deletedId: z.string(),
});

type DeleteProjectInput = z.infer<typeof deleteProjectInputSchema>;
type DeleteProjectOutput = z.infer<typeof deleteProjectOutputSchema>;

const deleteProjectTool: ToolDefinition<DeleteProjectInput, DeleteProjectOutput> = {
  id: 'user_model.delete_project',
  name: 'DeleteProject',
  description: 'Delete a project. This action is irreversible.',
  category: 'user_model',
  inputSchema: deleteProjectInputSchema,
  outputSchema: deleteProjectOutputSchema,
  risk: {
    level: 'medium',
    reason: 'Permanently deletes data',
    potentialImpact: 'Project data will be lost',
    reversible: false,
    categories: ['data_modification'],
  },
  tags: ['user', 'projects', 'write', 'destructive'],
  examples: [{ input: { id: '123' }, description: 'Delete a project by ID' }],
  execute: async (input: DeleteProjectInput, context: ToolContext): Promise<DeleteProjectOutput> => {
    const userModel = context.services.get(UserModelService);
    await userModel.deleteProject(input.id);
    return { success: true, deletedId: input.id };
  },
};

// ============================================================================
// Goals
// ============================================================================

// List Goals
const listGoalsInputSchema = z.object({
  timeframe: goalTimeframeSchema.optional().describe('Filter by timeframe (short, medium, long)'),
});

const listGoalsOutputSchema = z.object({
  goals: z.array(goalSchema),
  count: z.number(),
});

type ListGoalsInput = z.infer<typeof listGoalsInputSchema>;
type ListGoalsOutput = z.infer<typeof listGoalsOutputSchema>;

const listGoalsTool: ToolDefinition<ListGoalsInput, ListGoalsOutput> = {
  id: 'user_model.list_goals',
  name: 'ListGoals',
  description: "List the user's goals. Can optionally filter by timeframe.",
  category: 'user_model',
  inputSchema: listGoalsInputSchema,
  outputSchema: listGoalsOutputSchema,
  risk: {
    level: 'low',
    reason: 'Read-only operation',
    potentialImpact: 'None',
    reversible: true,
    categories: [],
  },
  tags: ['user', 'goals', 'read'],
  examples: [
    { input: {}, description: 'List all goals' },
    { input: { timeframe: 'short' }, description: 'List short-term goals' },
  ],
  execute: async (input: ListGoalsInput, context: ToolContext): Promise<ListGoalsOutput> => {
    const userModel = context.services.get(UserModelService);
    const goals = await userModel.getGoals(input.timeframe ? { timeframe: input.timeframe } : undefined);
    return { goals, count: goals.length };
  },
};

// Create Goal
const createGoalInputSchema = z.object({
  description: z.string().min(1).describe('Goal description'),
  timeframe: goalTimeframeSchema.describe('Goal timeframe: short (weeks), medium (months), long (years)'),
  progress: z.string().optional().describe('Current progress status'),
  relatedProjects: z.array(z.string()).optional().describe('IDs of related projects'),
});

const createGoalOutputSchema = goalSchema;

type CreateGoalInput = z.infer<typeof createGoalInputSchema>;
type CreateGoalOutput = z.infer<typeof createGoalOutputSchema>;

const createGoalTool: ToolDefinition<CreateGoalInput, CreateGoalOutput> = {
  id: 'user_model.create_goal',
  name: 'CreateGoal',
  description: 'Create a new goal for the user.',
  category: 'user_model',
  inputSchema: createGoalInputSchema,
  outputSchema: createGoalOutputSchema,
  risk: {
    level: 'low',
    reason: 'Creates a new record, easily reversible',
    potentialImpact: 'Adds a new goal entry',
    reversible: true,
    categories: ['data_modification'],
  },
  tags: ['user', 'goals', 'write'],
  examples: [
    {
      input: { description: 'Learn Spanish', timeframe: 'long' },
      description: 'Create a long-term goal',
    },
  ],
  execute: async (input: CreateGoalInput, context: ToolContext): Promise<CreateGoalOutput> => {
    const userModel = context.services.get(UserModelService);
    return userModel.createGoal(input);
  },
};

// Update Goal
const updateGoalInputSchema = z.object({
  id: z.string().describe('Goal ID to update'),
  description: z.string().optional().describe('New goal description'),
  timeframe: goalTimeframeSchema.optional().describe('New timeframe'),
  progress: z.string().optional().describe('Updated progress status'),
  relatedProjects: z.array(z.string()).optional().describe('Updated related project IDs'),
});

const updateGoalOutputSchema = goalSchema;

type UpdateGoalInput = z.infer<typeof updateGoalInputSchema>;
type UpdateGoalOutput = z.infer<typeof updateGoalOutputSchema>;

const updateGoalTool: ToolDefinition<UpdateGoalInput, UpdateGoalOutput> = {
  id: 'user_model.update_goal',
  name: 'UpdateGoal',
  description: 'Update an existing goal.',
  category: 'user_model',
  inputSchema: updateGoalInputSchema,
  outputSchema: updateGoalOutputSchema,
  risk: {
    level: 'low',
    reason: 'Modifies existing record',
    potentialImpact: 'Modifies goal data',
    reversible: true,
    categories: ['data_modification'],
  },
  tags: ['user', 'goals', 'write'],
  examples: [{ input: { id: '123', progress: '50% complete' }, description: 'Update goal progress' }],
  execute: async (input: UpdateGoalInput, context: ToolContext): Promise<UpdateGoalOutput> => {
    const userModel = context.services.get(UserModelService);
    const { id, ...updates } = input;
    return userModel.updateGoal(id, updates);
  },
};

// ============================================================================
// Registration
// ============================================================================

const registerUserModelTools = (registry: ToolRegistry): void => {
  registry.register(listProjectsTool);
  registry.register(createProjectTool);
  registry.register(updateProjectTool);
  registry.register(deleteProjectTool);
  registry.register(listGoalsTool);
  registry.register(createGoalTool);
  registry.register(updateGoalTool);
};

export {
  listProjectsTool,
  createProjectTool,
  updateProjectTool,
  deleteProjectTool,
  listGoalsTool,
  createGoalTool,
  updateGoalTool,
  registerUserModelTools,
};
