"use client";

import { useCallback, useState } from "react";
import { SprintBar } from "@/components/tasks/sprint-bar";
import { TaskKanban } from "@/components/tasks/task-kanban";
import { TeamPulseBar } from "@/components/tasks/team-pulse-bar";

export default function TasksPage() {
  // A single bump counter keeps the Sprint-Bar and the Kanban in sync: a
  // mutation in either (assigning a task to a sprint, closing a sprint,
  // dragging a card to Erledigt) bumps it, and both reload.
  const [refresh, setRefresh] = useState(0);
  const bump = useCallback(() => setRefresh((r) => r + 1), []);

  return (
    <div>
      <SprintBar refreshKey={refresh} onMutate={bump} />
      <div className="px-9 pt-2">
        <TeamPulseBar />
      </div>
      <TaskKanban refreshKey={refresh} onMutate={bump} />
    </div>
  );
}
