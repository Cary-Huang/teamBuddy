import { ScheduleView } from "../../src/components/schedule-view.js";
import {
  getConfiguredTeamId,
  getServerApiClient,
  TeamScopeGuide,
} from "../../src/lib/team-scope.js";

export const dynamic = "force-dynamic";

export default async function SchedulePage() {
  const teamId = getConfiguredTeamId();
  if (!teamId) return <TeamScopeGuide />;
  try {
    const api = getServerApiClient();
    const [members, projects, schedule] = await Promise.all([
      api.listMembers(teamId),
      api.listProjects(teamId),
      api.getLatestSchedule(teamId),
    ]);
    const activeMembers = members.filter(({ status }) => status === "ACTIVE");
    const activeProjects = projects.filter(
      ({ status }) => status === "PLANNING" || status === "IN_PROGRESS",
    );
    const details = await Promise.all(
      activeProjects.map((project) => api.getProject(project.id)),
    );
    return (
      <ScheduleView
        initialSchedule={schedule}
        members={activeMembers}
        projects={activeProjects}
        tasks={details
          .flatMap((detail) => detail.tasks)
          .filter(({ assigneeId }) =>
            activeMembers.some(({ id }) => id === assigneeId),
          )}
        teamId={teamId}
      />
    );
  } catch {
    return (
      <section className="empty-state">
        <h1>排期数据暂不可用</h1>
        <p>请检查团队 ID、API 与 Worker 服务后刷新。</p>
      </section>
    );
  }
}
