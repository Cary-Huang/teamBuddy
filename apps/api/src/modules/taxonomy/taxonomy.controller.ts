import { Body, Controller, Get, Param, Patch, Post, Put } from "@nestjs/common";
import {
  createTagGroupRequestSchema,
  createTagRequestSchema,
  replaceProjectTagsRequestSchema,
  projectIdSchema,
  tagGroupIdSchema,
  tagIdSchema,
  teamIdSchema,
  updateTagGroupRequestSchema,
  updateTagRequestSchema,
  type CreateTagGroupRequestDto,
  type CreateTagRequestDto,
  type ReplaceProjectTagsRequestDto,
  type UpdateTagGroupRequestDto,
  type UpdateTagRequestDto,
} from "@teambuddy/contracts";

import { ZodValidationPipe } from "../../platform/http/zod-validation.pipe.js";
import { TaxonomyService } from "./taxonomy.service.js";

@Controller("v1/teams/:teamId")
export class TaxonomyController {
  constructor(private readonly service: TaxonomyService) {}

  @Get("taxonomy")
  list(@Param("teamId", new ZodValidationPipe(teamIdSchema)) teamId: string) {
    return this.service.list(teamId);
  }

  @Post("tag-groups")
  createGroup(
    @Param("teamId", new ZodValidationPipe(teamIdSchema)) teamId: string,
    @Body(new ZodValidationPipe(createTagGroupRequestSchema))
    input: CreateTagGroupRequestDto,
  ) {
    return this.service.createGroup(teamId, input);
  }

  @Patch("tag-groups/:groupId")
  updateGroup(
    @Param("teamId", new ZodValidationPipe(teamIdSchema)) teamId: string,
    @Param("groupId", new ZodValidationPipe(tagGroupIdSchema)) groupId: string,
    @Body(new ZodValidationPipe(updateTagGroupRequestSchema))
    input: UpdateTagGroupRequestDto,
  ) {
    return this.service.updateGroup(teamId, groupId, input);
  }

  @Post("tags")
  createTag(
    @Param("teamId", new ZodValidationPipe(teamIdSchema)) teamId: string,
    @Body(new ZodValidationPipe(createTagRequestSchema))
    input: CreateTagRequestDto,
  ) {
    return this.service.createTag(teamId, input);
  }

  @Patch("tags/:tagId")
  updateTag(
    @Param("teamId", new ZodValidationPipe(teamIdSchema)) teamId: string,
    @Param("tagId", new ZodValidationPipe(tagIdSchema)) tagId: string,
    @Body(new ZodValidationPipe(updateTagRequestSchema))
    input: UpdateTagRequestDto,
  ) {
    return this.service.updateTag(teamId, tagId, input);
  }

  @Put("projects/:projectId/tags")
  replaceProjectTags(
    @Param("teamId", new ZodValidationPipe(teamIdSchema)) teamId: string,
    @Param("projectId", new ZodValidationPipe(projectIdSchema))
    projectId: string,
    @Body(new ZodValidationPipe(replaceProjectTagsRequestSchema))
    input: ReplaceProjectTagsRequestDto,
  ) {
    return this.service.replaceProjectTags(teamId, projectId, input);
  }
}
