import { ProjectCreateForm } from "../../../src/components/project-forms.js";
import {
  getConfiguredTeamId,
  getServerApiClient,
  TeamScopeGuide,
} from "../../../src/lib/team-scope.js";

export const dynamic = "force-dynamic";

export default async function NewProjectPage() {
  const teamId = getConfiguredTeamId();
  if (!teamId) return <TeamScopeGuide />;
  try {
    const api = getServerApiClient();
    const [members, taxonomy] = await Promise.all([
      api.listMembers(teamId),
      api.getTaxonomy(teamId),
    ]);
    return (
      <ProjectCreateForm
        members={members}
        teamId={teamId}
        taxonomy={taxonomy}
      />
    );
  } catch {
    return (
      <section className="empty-state">
        <h1>无法读取成员</h1>
        <p>请先确认 API 服务可用。</p>
      </section>
    );
  }
}
