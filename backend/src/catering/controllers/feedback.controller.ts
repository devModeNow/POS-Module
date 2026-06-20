import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { FeedbackService } from '../services/feedback.service';
import { CreateFeedbackDto } from '../dto/create-feedback.dto';

type AuthReq = { user?: Record<string, unknown> };
const orgId = (req: AuthReq) => Number(req.user?.['orgId'] ?? 0);

@Controller('api/catering/feedback')
export class FeedbackController {
  constructor(private readonly feedbackService: FeedbackService) {}

  // ── Public: Submit scheduling experience feedback ─────────────────────────

  @Post('scheduling/:scheduleId')
  @UsePipes(new ValidationPipe({ whitelist: true }))
  submitSchedulingFeedback(
    @Param('scheduleId') scheduleId: string,
    @Body() dto: CreateFeedbackDto,
  ) {
    return this.feedbackService.submitSchedulingFeedback(+scheduleId, dto);
  }

  // ── Authenticated: Generate rating link for completed schedule ────────────

  @Post('generate-link/:scheduleId')
  @UseGuards(JwtAuthGuard)
  generateRatingLink(
    @Param('scheduleId') scheduleId: string,
    @Req() req: AuthReq,
  ) {
    return this.feedbackService.generateRatingLink(+scheduleId, orgId(req));
  }

  // ── Public: Get rating page data (validate token) ─────────────────────────

  @Get('rating/:token')
  validateRatingLink(@Param('token') token: string) {
    return this.feedbackService.validateRatingLink(token);
  }

  // ── Public: Submit satisfaction rating via link ────────────────────────────

  @Post('rating/:token')
  @UsePipes(new ValidationPipe({ whitelist: true }))
  submitRating(@Param('token') token: string, @Body() dto: CreateFeedbackDto) {
    return this.feedbackService.submitRating(token, dto);
  }
}
