/**
 * validation.ts — business-rule validation of GraphQL arguments (zod).
 *
 * What: GraphQL already checks TYPES; these schemas check the rules types can't
 *       express: page-size caps, id formats, date-range order, list sizes.
 * Why:  `first` had no maximum in the design SDL (critique finding N2), so without
 *       this a client could ask for 100,000 cards in one request. Malformed UUIDs
 *       would otherwise reach Postgres and come back as masked "Unexpected error"s.
 */
import { z } from 'zod';
import type { StatusCategory, TaskPriority } from '../db/types.js';
import { apiError } from './errors.js';

/** Hard cap on any page, everywhere (GitHub's API uses the same number). */
export const MAX_PAGE_SIZE = 100;

export const uuid = z.uuid();

const priorities = ['none', 'low', 'medium', 'high', 'urgent'] as const satisfies TaskPriority[];
const categories = [
  'backlog',
  'unstarted',
  'started',
  'completed',
  'canceled',
] as const satisfies StatusCategory[];

export const TaskFilterSchema = z
  .object({
    statusIds: z.array(uuid).max(50).nullish(),
    statusCategories: z.array(z.enum(categories)).nullish(),
    assigneeIds: z.array(uuid).max(100).nullish(),
    includeUnassigned: z.boolean().nullish(),
    priorities: z.array(z.enum(priorities)).nullish(),
    labelIds: z.array(uuid).max(50).nullish(),
    dueDate: z
      .object({ from: z.iso.date().nullish(), to: z.iso.date().nullish() })
      .nullish()
      .refine((range) => !range?.from || !range.to || range.from <= range.to, {
        message: 'dueDate.from must be on or before dueDate.to',
      }),
    overdue: z.boolean().nullish(),
  })
  .nullish();
export type TaskFilter = z.infer<typeof TaskFilterSchema>;

export const TaskOrderSchema = z
  .object({
    field: z.enum(['RANK', 'PRIORITY', 'DUE_DATE', 'CREATED_AT', 'NUMBER']),
    direction: z.enum(['ASC', 'DESC']),
  })
  .nullish();
export type TaskOrder = z.infer<typeof TaskOrderSchema>;

export const PageSchema = z.object({
  first: z.number().int().min(1).max(MAX_PAGE_SIZE),
  after: z.string().max(512).nullish(),
});

export const TaskListArgsSchema = PageSchema.extend({
  filter: TaskFilterSchema,
  orderBy: TaskOrderSchema,
});
export type TaskListArgs = z.infer<typeof TaskListArgsSchema>;

export const MoveTaskInputSchema = z.object({
  id: uuid,
  statusId: uuid,
  afterTaskId: uuid.nullish(),
  beforeTaskId: uuid.nullish(),
});

/** Parse or throw BAD_USER_INPUT with a readable list of what's wrong. */
export function parseArgs<Schema extends z.ZodType>(
  schema: Schema,
  value: unknown,
): z.output<Schema> {
  const result = schema.safeParse(value);
  if (!result.success) throw apiError('BAD_USER_INPUT', z.prettifyError(result.error));
  return result.data;
}
