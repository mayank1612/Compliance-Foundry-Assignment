/**
 * Board.tsx — the Kanban columns and drag-and-drop (dnd-kit).
 *
 * Interaction: pointer drag (after 6px, so clicks don't start drags), or keyboard —
 * focus a card, Space to lift, arrow keys to move, Space to drop, Escape to cancel.
 * Screen readers hear "Picked up WEB-42…", "WEB-42 moved over In Progress…".
 * On drop it computes the target column + neighbours and calls `onMove`; the
 * optimistic cache update lives in moveTask.ts. Viewers get a read-only board.
 */
import {
  closestCorners,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { useMemo, useState } from 'react';
import type { TaskCardFieldsFragment, TaskFilter } from '../../gql/graphql';
import { BoardColumn, type BoardStatus } from './BoardColumn';
import { neighboursAt, type MoveTarget } from './moveTask';
import { TaskCard } from './TaskCard';

/** What dnd-kit tells us about the element under the pointer (set in useSortable/useDroppable). */
interface DropData {
  type?: 'card' | 'column';
  statusId?: string;
}

export function Board({
  statuses,
  counts,
  filter,
  canEdit,
  onMove,
}: {
  statuses: BoardStatus[];
  counts: Map<string, number> | undefined;
  filter: TaskFilter | null;
  canEdit: boolean;
  onMove: (task: TaskCardFieldsFragment, target: MoveTarget) => void;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const [dragged, setDragged] = useState<TaskCardFieldsFragment | null>(null);

  const tasksById = useMemo(
    () =>
      new Map(
        statuses.flatMap((status) =>
          status.tasks.edges.map((edge) => [edge.node.id, edge.node] as const),
        ),
      ),
    [statuses],
  );
  const columnTaskIds = useMemo(
    () =>
      new Map(
        statuses.map((status) => [status.id, status.tasks.edges.map((edge) => edge.node.id)]),
      ),
    [statuses],
  );
  const statusNames = useMemo(
    () => new Map(statuses.map((status) => [status.id, status.name])),
    [statuses],
  );

  const identifierOf = (id: string | number) => tasksById.get(String(id))?.identifier ?? 'Task';
  const columnOf = (data: unknown) =>
    statusNames.get((data as DropData | undefined)?.statusId ?? '') ?? 'a column';
  const announcements: Announcements = {
    onDragStart: ({ active }) => `Picked up ${identifierOf(active.id)}.`,
    onDragOver: ({ active, over }) =>
      over ? `${identifierOf(active.id)} moved over ${columnOf(over.data.current)}.` : undefined,
    onDragEnd: ({ active, over }) =>
      over
        ? `${identifierOf(active.id)} dropped in ${columnOf(over.data.current)}.`
        : `${identifierOf(active.id)} returned to its place.`,
    onDragCancel: ({ active }) =>
      `Move cancelled. ${identifierOf(active.id)} returned to its place.`,
  };

  function handleDragStart({ active }: DragStartEvent) {
    setDragged(tasksById.get(String(active.id)) ?? null);
  }

  function handleDragEnd({ active, over }: DragEndEvent) {
    setDragged(null);
    const task = tasksById.get(String(active.id));
    const drop = over?.data.current as DropData | undefined;
    if (!task || !over || !drop?.statusId) return;

    const targetIds = columnTaskIds.get(drop.statusId) ?? [];
    // Dropped on a card: take that card's slot (same semantics as dnd-kit's arrayMove —
    // moving down lands after it, moving up lands before it; from another column,
    // before it). Dropped on a column's empty area: the end of that column.
    const overIndex = drop.type === 'card' ? targetIds.indexOf(String(over.id)) : -1;
    const index = overIndex >= 0 ? overIndex : targetIds.length;
    const target: MoveTarget = {
      toStatusId: drop.statusId,
      ...neighboursAt(targetIds, task.id, index),
    };

    // Nothing to do if the card would end up exactly where it already is.
    if (drop.statusId === task.status.id) {
      const current = neighboursAt(targetIds, task.id, targetIds.indexOf(task.id));
      if (
        current.afterTaskId === target.afterTaskId &&
        current.beforeTaskId === target.beforeTaskId
      )
        return;
    }
    onMove(task, target);
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={() => {
        setDragged(null);
      }}
      accessibility={{ announcements }}
    >
      <div className="flex h-[calc(100vh-19rem)] min-h-[28rem] gap-3 overflow-x-auto pb-2">
        {statuses.map((status) => (
          <BoardColumn
            key={status.id}
            status={status}
            total={counts?.get(status.id)}
            filter={filter}
            canEdit={canEdit}
          />
        ))}
      </div>
      <DragOverlay dropAnimation={null}>
        {dragged ? <TaskCard task={dragged} dragging /> : null}
      </DragOverlay>
    </DndContext>
  );
}
