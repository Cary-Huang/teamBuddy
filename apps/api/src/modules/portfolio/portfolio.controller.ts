import { Body, Controller, Get, Param, Patch, Post, Req } from "@nestjs/common";
import {
  createMilestoneRequestSchema,
  createProjectRequestSchema,
  milestoneIdSchema,
  projectIdSchema,
  teamIdSchema,
  updateMilestoneSchema,
  updateProjectSchema,
  type CreateMilestoneRequestDto,
  type CreateProjectRequestDto,
  type UpdateMilestoneDto,
  type UpdateProjectDto,
} from "@teambuddy/contracts";

import {
  getCorrelationId,
  type CorrelatedRequest,
} from "../../platform/http/correlation-id.js";
import { ZodValidationPipe } from "../../platform/http/zod-validation.pipe.js";
import { PortfolioService } from "./portfolio.service.js";

@Controller("v1")
export class PortfolioController {
  constructor(private readonly portfolioService: PortfolioService) {}

  @Get("teams/:teamId/projects")
  listProjects(
    @Param("teamId", new ZodValidationPipe(teamIdSchema)) teamId: string,
  ) {
    return this.portfolioService.listProjects(teamId);
  }

  @Post("teams/:teamId/projects")
  createProject(
    @Param("teamId", new ZodValidationPipe(teamIdSchema)) teamId: string,
    @Body(new ZodValidationPipe(createProjectRequestSchema))
    input: CreateProjectRequestDto,
    @Req() request: CorrelatedRequest,
  ) {
    return this.portfolioService.createProject(teamId, input, {
      correlationId: getCorrelationId(request),
    });
  }

  @Patch("teams/:teamId/projects/:projectId")
  updateProject(
    @Param("teamId", new ZodValidationPipe(teamIdSchema)) teamId: string,
    @Param("projectId", new ZodValidationPipe(projectIdSchema))
    projectId: string,
    @Body(new ZodValidationPipe(updateProjectSchema)) input: UpdateProjectDto,
    @Req() request: CorrelatedRequest,
  ) {
    return this.portfolioService.updateProject(teamId, projectId, input, {
      correlationId: getCorrelationId(request),
    });
  }

  @Get("projects/:projectId/milestones")
  listMilestones(
    @Param("projectId", new ZodValidationPipe(projectIdSchema))
    projectId: string,
  ) {
    return this.portfolioService.listMilestones(projectId);
  }

  @Post("projects/:projectId/milestones")
  createMilestone(
    @Param("projectId", new ZodValidationPipe(projectIdSchema))
    projectId: string,
    @Body(new ZodValidationPipe(createMilestoneRequestSchema))
    input: CreateMilestoneRequestDto,
    @Req() request: CorrelatedRequest,
  ) {
    return this.portfolioService.createMilestone(projectId, input, {
      correlationId: getCorrelationId(request),
    });
  }

  @Patch("projects/:projectId/milestones/:milestoneId")
  updateMilestone(
    @Param("projectId", new ZodValidationPipe(projectIdSchema))
    projectId: string,
    @Param("milestoneId", new ZodValidationPipe(milestoneIdSchema))
    milestoneId: string,
    @Body(new ZodValidationPipe(updateMilestoneSchema))
    input: UpdateMilestoneDto,
    @Req() request: CorrelatedRequest,
  ) {
    return this.portfolioService.updateMilestone(
      projectId,
      milestoneId,
      input,
      { correlationId: getCorrelationId(request) },
    );
  }
}
