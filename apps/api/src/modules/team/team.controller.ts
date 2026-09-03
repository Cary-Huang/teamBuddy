import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
  Req,
} from "@nestjs/common";
import {
  createMemberRequestSchema,
  createTeamSchema,
  dateKeySchema,
  memberIdSchema,
  teamIdSchema,
  updateMemberSchema,
  upsertCapacityExceptionRequestSchema,
  type CreateMemberRequestDto,
  type CreateTeamDto,
  type UpdateMemberDto,
  type UpsertCapacityExceptionRequestDto,
} from "@teambuddy/contracts";

import {
  getCorrelationId,
  type CorrelatedRequest,
} from "../../platform/http/correlation-id.js";
import { ZodValidationPipe } from "../../platform/http/zod-validation.pipe.js";
import { TeamService } from "./team.service.js";

@Controller("v1")
export class TeamController {
  constructor(private readonly teamService: TeamService) {}

  @Post("teams")
  createTeam(
    @Body(new ZodValidationPipe(createTeamSchema)) input: CreateTeamDto,
  ) {
    return this.teamService.createTeam(input);
  }

  @Get("teams/:teamId/members")
  listMembers(
    @Param("teamId", new ZodValidationPipe(teamIdSchema)) teamId: string,
  ) {
    return this.teamService.listMembers(teamId);
  }

  @Post("teams/:teamId/members")
  createMember(
    @Param("teamId", new ZodValidationPipe(teamIdSchema)) teamId: string,
    @Body(new ZodValidationPipe(createMemberRequestSchema))
    input: CreateMemberRequestDto,
    @Req() request: CorrelatedRequest,
  ) {
    return this.teamService.createMember(teamId, input, {
      correlationId: getCorrelationId(request),
    });
  }

  @Patch("teams/:teamId/members/:memberId")
  updateMember(
    @Param("teamId", new ZodValidationPipe(teamIdSchema)) teamId: string,
    @Param("memberId", new ZodValidationPipe(memberIdSchema)) memberId: string,
    @Body(new ZodValidationPipe(updateMemberSchema)) input: UpdateMemberDto,
    @Req() request: CorrelatedRequest,
  ) {
    return this.teamService.updateMember(teamId, memberId, input, {
      correlationId: getCorrelationId(request),
    });
  }

  @Put("members/:memberId/capacity-exceptions/:date")
  @HttpCode(HttpStatus.OK)
  upsertCapacityException(
    @Param("memberId", new ZodValidationPipe(memberIdSchema)) memberId: string,
    @Param("date", new ZodValidationPipe(dateKeySchema)) date: string,
    @Body(new ZodValidationPipe(upsertCapacityExceptionRequestSchema))
    input: UpsertCapacityExceptionRequestDto,
    @Req() request: CorrelatedRequest,
  ) {
    return this.teamService.upsertCapacityException(memberId, date, input, {
      correlationId: getCorrelationId(request),
    });
  }
}
