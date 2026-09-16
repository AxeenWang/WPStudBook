import { useCallback, useState } from 'react';
import { Button } from 'react-aria-components';
import { saveBreeding } from '../../services/breedings.ts';
import type { ServiceContext } from '../../services/context.ts';
import { listOpenableLines, type OpenableLine } from '../../services/lines.ts';
import { loadTaskBoard, type TaskMareOption, type TaskView } from '../../services/tasks.ts';
import { Feedback, useAction, type ActionState } from '../actions.tsx';
import { OpenLineForm } from '../lines/OpenLineForm.tsx';
import { useServiceQuery, useServices } from '../ServicesContext.tsx';
import { BLOCKER_LABELS, formatTask, formatTaskKind, PHASE_LABELS } from './labels.ts';

function MareRow({
  task,
  mare,
  currentYear,
  action,
}: {
  readonly task: TaskView;
  readonly mare: TaskMareOption;
  readonly currentYear: number;
  readonly action: ActionState;
}) {
  const { context } = useServices();
  const { sireId } = task;
  return (
    <li>
      <span>{mare.name}</span>
      {mare.lastBreedingAge && <span className="notice">最後值得配種的年齡</span>}
      {mare.recorded ? (
        <span role="status">{currentYear} 年已登記</span>
      ) : (
        <Button
          type="button"
          isDisabled={action.busy || sireId === undefined}
          onPress={() => {
            void action.run(async () => {
              await saveBreeding(context, {
                mareId: mare.id,
                gameYear: currentYear,
                breedingType: 'designated',
                stallionId: sireId,
                stallionName: '',
                conception: undefined,
                taskId: task.id,
              });
              return `已依任務登記「${mare.name}」的 ${String(currentYear)} 年指定配種`;
            });
          }}
        >
          登記指定配種
        </Button>
      )}
    </li>
  );
}

function TaskItem({
  task,
  currentYear,
  openable,
  action,
}: {
  readonly task: TaskView;
  readonly currentYear: number;
  readonly openable: OpenableLine | undefined;
  readonly action: ActionState;
}) {
  const [opening, setOpening] = useState(false);
  return (
    <li className="task-card" data-testid={`task-${task.id}`}>
      <h4>{formatTask(task)}</h4>
      <p>
        <span>{PHASE_LABELS[task.phase]}</span>
        <span>{formatTaskKind(task)}</span>
        {task.pairDistance !== undefined && <span>配對距離 {task.pairDistance}</span>}
        {task.highPriority && <span className="notice">高優先：現任本年度正式接任</span>}
      </p>
      <p>種牡馬：{task.sireName ?? '缺少現任種牡馬'}</p>
      {task.blockers.length > 0 && (
        <ul aria-label="缺項" className="reminders">
          {task.blockers.map((blocker) => (
            <li key={blocker} className="notice">
              {BLOCKER_LABELS[blocker]}
            </li>
          ))}
        </ul>
      )}
      {openable !== undefined && !opening && (
        <Button
          type="button"
          onPress={() => {
            setOpening(true);
          }}
        >
          開啟第 {openable.position} 系
        </Button>
      )}
      {openable !== undefined && opening && <OpenLineForm slot={openable} />}
      {task.mares.length > 0 && (
        <ul aria-label="可配母馬" className="task-mares">
          {task.mares.map((mare) => (
            <MareRow
              key={mare.id}
              task={task}
              mare={mare}
              currentYear={currentYear}
              action={action}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

/** 任務看板（需求規格 13.2）：建系期列出可開啟分支的兩條配對，循環期列出各代指定配種。 */
export function TaskBoard() {
  const load = useCallback(
    async (context: ServiceContext) => ({
      board: await loadTaskBoard(context),
      openable: await listOpenableLines(context),
    }),
    [],
  );
  const { data, error } = useServiceQuery(load);
  const action = useAction();
  if (data === undefined) {
    return error === undefined ? <p role="status">載入中…</p> : <p role="alert">{error}</p>;
  }
  const { board, openable } = data;
  // 高優先待辦排在前面（需求規格 7.7）；其餘維持規則順序。
  const tasks = [...board.tasks].sort((a, b) => Number(b.highPriority) - Number(a.highPriority));
  // 還沒有任何系時，第 1 系起點不對應任何任務，另外列出讓使用者開啟。
  const unlisted = openable.filter(
    (slot) => !tasks.some((task) => task.sire.position === slot.position),
  );
  return (
    <section aria-labelledby="task-board-heading">
      <h3 id="task-board-heading">任務看板</h3>
      {error !== undefined && <p role="alert">{error}</p>}
      <div data-testid="task-feedback">
        <Feedback message={action.message} error={action.error} />
      </div>
      {unlisted.map((slot) => (
        <OpenLineForm key={slot.position} slot={slot} />
      ))}
      {tasks.length === 0 && unlisted.length === 0 ? (
        <p>目前沒有可執行的任務。等母馬世代成立後，看板會自動列出下一批配對。</p>
      ) : (
        <ul className="task-list">
          {tasks.map((task) => (
            <TaskItem
              key={task.id}
              task={task}
              currentYear={board.currentYear}
              openable={openable.find((slot) => slot.position === task.sire.position)}
              action={action}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
