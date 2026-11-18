/**
 * App.tsx — the shell: header (project picker + "view as" user switcher) and the board.
 *
 * Which project is open lives in the URL (`?project=<id>`), next to the filters.
 * Switching project or user clears the filters: assignee and label ids belong to one
 * organization, so they'd silently match nothing elsewhere.
 */
import { useQuery } from '@apollo/client/react';
import { BoardIcon } from './components/icons';
import { BoardSkeleton, EmptyState, ErrorState } from './components/states';
import { SessionQuery } from './features/board/documents';
import { NO_FILTERS, writeFilters } from './features/board/filters';
import { TaskBoard } from './features/board/TaskBoard';
import { describeError } from './lib/errors';
import { useSearchParams } from './lib/useSearchParams';
import { useSession } from './session/session-context';

export function App() {
  const session = useSession();
  if (session.status === 'loading') {
    return (
      <p role="status" className="mt-24 text-center text-sm text-ink-2">
        Connecting to the API…
      </p>
    );
  }
  if (session.status === 'error' || !session.currentUser) {
    return (
      <ErrorState
        title="The API is not reachable"
        message={session.error ?? 'No users found. Run `npm run setup` to load the demo data.'}
        onRetry={session.retry}
      />
    );
  }
  return <Workspace />;
}

function Workspace() {
  const { users, currentUser, switchUser } = useSession();
  const { data, previousData, loading, error, refetch } = useQuery(SessionQuery);
  const [params, updateParams] = useSearchParams();

  const memberships = (data ?? previousData)?.viewer.memberships ?? [];
  const projects = memberships.flatMap((membership) =>
    membership.organization.projects.edges.map((edge) => edge.node),
  );
  const selected = projects.find((project) => project.id === params.get('project')) ?? projects[0];

  const selectProject = (projectId: string) => {
    updateParams((next) => {
      next.set('project', projectId);
      writeFilters(next, NO_FILTERS);
    });
  };
  const selectUser = (userId: string) => {
    updateParams(
      (next) => {
        next.delete('project');
        writeFilters(next, NO_FILTERS);
      },
      { replace: true },
    );
    void switchUser(userId);
  };

  return (
    <div className="min-h-screen">
      <header className="border-b border-line bg-surface">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5">
          <div className="flex items-center gap-2 font-semibold">
            <BoardIcon className="size-5 text-accent" /> Task Board
          </div>

          <label className="flex items-center gap-2 text-sm text-ink-2">
            Project
            <select
              value={selected?.id ?? ''}
              disabled={projects.length === 0}
              onChange={(event) => {
                selectProject(event.target.value);
              }}
              className="rounded-md border border-line-strong bg-surface px-2 py-1 text-ink"
            >
              {memberships.map((membership) => (
                <optgroup key={membership.organization.id} label={membership.organization.name}>
                  {membership.organization.projects.edges.map(({ node }) => (
                    <option key={node.id} value={node.id}>
                      {node.key} · {node.name}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>

          <label className="ml-auto flex items-center gap-2 text-sm text-ink-2">
            View as
            <select
              value={currentUser?.id ?? ''}
              onChange={(event) => {
                selectUser(event.target.value);
              }}
              className="max-w-80 rounded-md border border-line-strong bg-surface px-2 py-1 text-ink"
            >
              {users.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.displayName} —{' '}
                  {user.memberships.map((m) => `${m.role} @ ${m.organization}`).join(', ') ||
                    'no organization'}
                </option>
              ))}
            </select>
          </label>
        </div>
      </header>

      <main className="p-4">
        {selected ? (
          // key: a different project starts with fresh component state.
          <TaskBoard key={selected.id} projectId={selected.id} />
        ) : loading ? (
          <BoardSkeleton />
        ) : error ? (
          <ErrorState message={describeError(error)} onRetry={() => void refetch()} />
        ) : (
          <EmptyState
            title="No projects"
            message={`${currentUser?.displayName ?? 'This user'} isn't a member of any organization with projects.`}
          />
        )}
      </main>
    </div>
  );
}
