import { TaxonomyManager } from "../../src/components/taxonomy-manager.js";
import {
  getConfiguredTeamId,
  getServerApiClient,
  TeamScopeGuide,
} from "../../src/lib/team-scope.js";

export const dynamic = "force-dynamic";

export default async function TagsPage() {
  const teamId = getConfiguredTeamId();
  if (!teamId) return <TeamScopeGuide />;
  try {
    return (
      <TaxonomyManager
        taxonomy={await getServerApiClient().getTaxonomy(teamId)}
        teamId={teamId}
      />
    );
  } catch {
    return (
      <section className="empty-state">
        <h1>标签数据暂不可用</h1>
        <p>请检查 API 服务和数据库迁移后刷新。</p>
      </section>
    );
  }
}
