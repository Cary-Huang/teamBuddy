import { Body, Controller, Get, Param, Post, Put, Req } from "@nestjs/common";
import {
  taskIdSchema,
  taskScheduleWindowRequestSchema,
  teamIdSchema,
  type TaskScheduleWindowRequestDto,
} from "@teambuddy/contracts";

import {
  getCorrelationId,
  type CorrelatedRequest,
} from "../../platform/http/correlation-id.js";
import { ZodValidationPipe } from "../../platform/http/zod-validation.pipe.js";
import { PlanningService } from "./planning.service.js";

@Controller("v1")
export class PlanningController {
  constructor(private readonly planningService: PlanningService) {}

  @Post("teams/:teamId/planning/recalculate")
  queueRecalculation(
    @Param("teamId", new ZodValidationPipe(teamIdSchema)) teamId: string,
    @Req() request: CorrelatedRequest,
  ) {
    return this.planningService.queueRecalculation(teamId, {
      correlationId: getCorrelationId(request),
    });
  }

  @Get("teams/:teamId/schedules/latest")
  getLatest(
    @Param("teamId", new ZodValidationPipe(teamIdSchema)) teamId: string,
  ) {
    return this.planningService.getLatest(teamId);
  }

  @Put("teams/:teamId/planning/tasks/:taskId/window")
  setTaskWindow(
    @Param("teamId", new ZodValidationPipe(teamIdSchema)) teamId: string,
    @Param("taskId", new ZodValidationPipe(taskIdSchema)) taskId: string,
    @Body(new ZodValidationPipe(taskScheduleWindowRequestSchema))
    input: TaskScheduleWindowRequestDto,
    @Req() request: CorrelatedRequest,
  ) {
    return this.planningService.setTaskWindow(teamId, taskId, input, {
      correlationId: getCorrelationId(request),
    });
  }
}
