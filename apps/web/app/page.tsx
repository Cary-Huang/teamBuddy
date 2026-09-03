import Link from "next/link";

import {
  getConfiguredTeamId,
  getServerApiClient,
  TeamScopeGuide,
} from "../src/lib/team-scope.js";
import { countInProgressProjects } from "../src/lib/dashboard.js";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const teamId = getConfiguredTeamId();
  if (!teamId) return <TeamScopeGuide />;
  try {
    const api = getServerApiClient();
    const [projects, schedule] = await Promise.all([
      api.listProjects(teamId),
      api.getLatestSchedule(teamId),
    ]);
    const details = await Promise.all(
      projects.map((project) => api.getProject(project.id)),
    );
    const activeProjects = countInProgressProjects(projects);
    const unassignedTasks = details
      .flatMap((detail) => detail.tasks)
      .filter((task) => !task.assigneeId).length;
    return (
      <section>
        <header className="page-heading">
          <div>
            <h1>驾驶舱</h1>
            <p>团队交付的当前工作面板。</p>
          </div>
          <Link className="button-link" href="/schedule">
            查看团队排期
          </Link>
        </header>
        <div className="metric-grid">
          <article className="metric-card">
            <span>进行中的项目</span>
            <strong>{activeProjects}</strong>
          </article>
          <article className="metric-card">
            <span>未分配任务</span>
            <strong>{unassignedTasks}</strong>
            <small>当前 API 要求任务必须指定负责人。</small>
          </article>
          <article className="metric-card">
            <span>最新排期状态</span>
            <strong>{schedule ? "草案已生成" : "尚无草案"}</strong>
            <small>
              {schedule
                ? `生成于 ${schedule.createdAt.slice(0, 16).replace("T", " ")}`
                : "可在团队排期页触发重算。"}
            </small>
          </article>
        </div>
        <section className="panel dashboard-note">
          <h2>本期范围</h2>
          <p>风险卡片、风险建议、AI 与提醒尚未纳入本增量。</p>
        </section>
      </section>
    );
  } catch {
    return (
      <section className="empty-state">
        <h1>驾驶舱数据暂不可用</h1>
        <p>请检查团队 ID、API 地址与服务状态后刷新。</p>
      </section>
    );
  }
}
