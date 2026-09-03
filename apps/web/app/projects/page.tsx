import Link from "next/link";

import { ProjectListManager } from "../../src/components/project-list-manager.js";

import {
  getConfiguredTeamId,
  getServerApiClient,
  TeamScopeGuide,
} from "../../src/lib/team-scope.js";

export const dynamic = "force-dynamic";

export default async function ProjectsPage() {
  const teamId = getConfiguredTeamId();
  if (!teamId) return <TeamScopeGuide />;
  try {
    const api = getServerApiClient();
    const [projects, taxonomy] = await Promise.all([
      api.listProjects(teamId),
      api.getTaxonomy(teamId),
    ]);
    return (
      <section>
        <header className="page-heading">
          <div>
            <h1>项目组合</h1>
            <p>按优先级统筹项目、里程碑和任务。</p>
          </div>
          <Link className="button-link" href="/projects/new">
            创建项目
          </Link>
        </header>
        <ProjectListManager
          projects={projects}
          teamId={teamId}
          taxonomy={taxonomy}
        />
      </section>
    );
  } catch {
    return (
      <section className="empty-state">
        <h1>项目数据暂不可用</h1>
        <p>请检查 API 服务后刷新。</p>
      </section>
    );
  }
}
