"use client";

import { TaskKanban } from "@/components/tasks/task-kanban";
import { TeamPulseBar } from "@/components/tasks/team-pulse-bar";

export default function TasksPage() {
  return (
    <div className="space-y-4">
      <TeamPulseBar />
      <TaskKanban />
    </div>
  );
}
