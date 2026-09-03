import { Body, Controller, Get, Param, Patch, Post, Req } from "@nestjs/common";
import {
  createTaskDependencyRequestSchema,
  createTaskRequestSchema,
  projectIdSchema,
  taskIdSchema,
  updateTaskSchema,
  type CreateTaskDependencyRequestDto,
  type CreateTaskRequestDto,
  type UpdateTaskDto,
} from "@teambuddy/contracts";

import {
  getCorrelationId,
  type CorrelatedRequest,
} from "../../platform/http/correlation-id.js";
import { ZodValidationPipe } from "../../platform/http/zod-validation.pipe.js";
import { WorkService } from "./work.service.js";

@Controller("v1")
export class WorkController {
  constructor(private readonly workService: WorkService) {}

  @Get("projects/:projectId")
  getProjectDetail(
    @Param("projectId", new ZodValidationPipe(projectIdSchema))
    projectId: string,
  ) {
    return this.workService.getProjectDetail(projectId);
  }

  @Get("projects/:projectId/tasks")
  listTasks(
    @Param("projectId", new ZodValidationPipe(projectIdSchema))
    projectId: string,
  ) {
    return this.workService.listTasks(projectId);
  }

  @Post("projects/:projectId/tasks")
  createTask(
    @Param("projectId", new ZodValidationPipe(projectIdSchema))
    projectId: string,
    @Body(new ZodValidationPipe(createTaskRequestSchema))
    input: CreateTaskRequestDto,
    @Req() request: CorrelatedRequest,
  ) {
    return this.workService.createTask(projectId, input, {
      correlationId: getCorrelationId(request),
    });
  }

  @Patch("projects/:projectId/tasks/:taskId")
  updateTask(
    @Param("projectId", new ZodValidationPipe(projectIdSchema))
    projectId: string,
    @Param("taskId", new ZodValidationPipe(taskIdSchema)) taskId: string,
    @Body(new ZodValidationPipe(updateTaskSchema)) input: UpdateTaskDto,
    @Req() request: CorrelatedRequest,
  ) {
    return this.workService.updateTask(projectId, taskId, input, {
      correlationId: getCorrelationId(request),
    });
  }

  @Post("tasks/:taskId/dependencies")
  addDependency(
    @Param("taskId", new ZodValidationPipe(taskIdSchema)) taskId: string,
    @Body(new ZodValidationPipe(createTaskDependencyRequestSchema))
    input: CreateTaskDependencyRequestDto,
    @Req() request: CorrelatedRequest,
  ) {
    return this.workService.addDependency(taskId, input, {
      correlationId: getCorrelationId(request),
    });
  }
}
