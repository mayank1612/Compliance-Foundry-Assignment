/**
 * TaskCard.tsx — one card on the board (presentational: props in, markup out).
 *
 * Shows identifier, title, priority, labels, due date and assignee. Every visual
 * cue has a text equivalent: the priority icon has an accessible name, and an
 * overdue date shows the word "Overdue" plus an icon in the critical color —
 * never color alone.
 * `SortableTaskCard` wraps it for drag-and-drop (dnd-kit); drag is disabled for
 * viewers (read-only role).
 */
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { AlertIcon, CalendarIcon } from '../../components/icons';
import type { TaskCardFieldsFragment, TaskPriority } from '../../gql/graphql';
import { cx } from '../../lib/cx';
import { formatDay } from '../../lib/dates';

const PRIORITY_LABEL: Record<TaskPriority, string> = {
  URGENT: 'Urgent',
  HIGH: 'High',
  MEDIUM: 'Medium',
  LOW: 'Low',
  NONE: 'No priority',
};

/** Signal-strength bars (Linear style); urgent is a filled "!" badge. */
export function PriorityIcon({ priority }: { priority: TaskPriority }) {
  const label = `Priority: ${PRIORITY_LABEL[priority]}`;
  if (priority === 'URGENT') {
    return (
      <span
        role="img"
        aria-label={label}
        title={label}
        className="grid size-4 place-items-center rounded-[4px] bg-critical text-[10px] leading-none font-bold text-white"
      >
        !
      </span>
    );
  }
  const level = { HIGH: 3, MEDIUM: 2, LOW: 1, NONE: 0 }[priority];
  return (
    <svg role="img" aria-label={label} width="16" height="16" viewBox="0 0 16 16">
      <title>{label}</title>
      {[0, 1, 2].map((bar) => (
        <rect
          key={bar}
          x={2 + bar * 4.5}
          y={11 - bar * 3.5}
          width="3"
          height={3 + bar * 3.5}
          rx="1"
          className={bar < level ? 'fill-ink-2' : 'fill-line-strong'}
        />
      ))}
    </svg>
  );
}

function DueDate({ dueDate, isOverdue }: { dueDate: string; isOverdue: boolean }) {
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs',
        isOverdue ? 'bg-critical/10 font-medium text-ink' : 'text-ink-2',
      )}
    >
      {isOverdue ? (
        <AlertIcon className="size-3.5 text-critical" />
      ) : (
        <CalendarIcon className="size-3.5" />
      )}
      {isOverdue && <span>Overdue ·</span>}
      <time dateTime={dueDate}>{formatDay(dueDate)}</time>
    </span>
  );
}

function Avatar({ name }: { name: string }) {
  const initials = name
    .split(/\s+/)
    .map((part) => part[0] ?? '')
    .join('')
    .slice(0, 2)
    .toUpperCase();
  return (
    <span
      title={name}
      aria-label={`Assigned to ${name}`}
      role="img"
      className="grid size-6 place-items-center rounded-full bg-surface-2 text-[10px] font-semibold text-ink-2 ring-1 ring-line"
    >
      {initials}
    </span>
  );
}

export function TaskCard({
  task,
  dragging = false,
}: {
  task: TaskCardFieldsFragment;
  dragging?: boolean;
}) {
  return (
    <article
      aria-label={`${task.identifier}: ${task.title}`}
      className={cx(
        'rounded-md border border-line bg-surface p-3 text-left',
        dragging ? 'rotate-1 shadow-lg ring-1 ring-accent' : 'shadow-xs hover:border-line-strong',
      )}
    >
      <div className="flex items-center justify-between gap-2 text-xs text-ink-2">
        <span className="tabular-nums">{task.identifier}</span>
        <PriorityIcon priority={task.priority} />
      </div>
      <h3 className="mt-1 text-sm leading-snug text-ink">{task.title}</h3>
      {task.labels.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-1" aria-label="Labels">
          {task.labels.map((label) => (
            <li
              key={label.id}
              className="inline-flex items-center gap-1 rounded-full border border-line px-1.5 py-px text-[11px] text-ink-2"
            >
              <span
                className="size-1.5 rounded-full"
                style={{ background: label.color }}
                aria-hidden
              />
              {label.name}
            </li>
          ))}
        </ul>
      )}
      {(task.dueDate ?? task.assignee) && (
        <div className="mt-2 flex items-center justify-between gap-2">
          {task.dueDate ? <DueDate dueDate={task.dueDate} isOverdue={task.isOverdue} /> : <span />}
          {task.assignee && <Avatar name={task.assignee.displayName} />}
        </div>
      )}
    </article>
  );
}

/** The card as a dnd-kit sortable item (keyboard: focus, Space to lift, arrows, Space to drop). */
export function SortableTaskCard({
  task,
  statusId,
  canEdit,
}: {
  task: TaskCardFieldsFragment;
  statusId: string;
  canEdit: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
    data: { type: 'card', statusId },
    disabled: !canEdit,
  });
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cx('list-none', isDragging && 'opacity-40', canEdit && 'cursor-grab touch-none')}
      {...attributes}
      {...listeners}
    >
      <TaskCard task={task} />
    </li>
  );
}
