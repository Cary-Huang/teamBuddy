export const countInProgressProjects = (
  projects: ReadonlyArray<{ status: string }>,
): number =>
  projects.filter((project) => project.status === "IN_PROGRESS").length;
