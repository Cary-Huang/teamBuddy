import { TeamManager } from "../../src/components/team-manager.js";
import {
  getConfiguredTeamId,
  getServerApiClient,
  TeamScopeGuide,
} from "../../src/lib/team-scope.js";

export const dynamic = "force-dynamic";

export default async function TeamPage() {
  const teamId = getConfiguredTeamId();
  if (!teamId) return <TeamScopeGuide />;
  try {
    const members = await getServerApiClient().listMembers(teamId);
    return (
      <>
        <header className="page-heading">
          <div>
            <h1>团队成员</h1>
            <p>维护默认产能与特定日期例外。</p>
          </div>
        </header>
        <TeamManager members={members} teamId={teamId} />
      </>
    );
  } catch {
    return (
      <section className="empty-state">
        <h1>团队数据暂不可用</h1>
        <p>请检查团队 ID、API 地址与服务状态后刷新。</p>
      </section>
    );
  }
}
