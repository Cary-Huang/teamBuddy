import type { PortfolioRepository } from "../portfolio/portfolio.repository.js";
import type { ProjectScopeReader } from "./work.repository.js";

export class PortfolioProjectScopeReader implements ProjectScopeReader {
  constructor(
    private readonly portfolioRepository: Pick<
      PortfolioRepository,
      "listProjects"
    >,
  ) {}

  async listProjectIds(teamId: string): Promise<string[]> {
    const projects = await this.portfolioRepository.listProjects(teamId);
    return projects.map(({ id }) => id);
  }
}
