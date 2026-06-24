import { Body, Controller, Get, Post, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { PosTerminalService } from '../services/terminal.service';

type AuthReq = { user?: Record<string, unknown> };
const orgId = (req: AuthReq) => Number(req.user?.['orgId'] ?? 0);
const userId = (req: AuthReq) => Number(req.user?.['sub'] ?? 0);

@Controller('api/pos')
@UseGuards(JwtAuthGuard)
export class PosTerminalController {
  constructor(private readonly terminalService: PosTerminalService) {}

  @Get('products')
  listProducts(@Query('search') search: string, @Req() req: AuthReq) {
    return this.terminalService.listProducts(orgId(req), search);
  }

  @Post('checkout')
  checkout(
    @Body()
    body: {
      items: Array<{ inventoryId: number; quantity: number }>;
      discountAmount?: number;
      amountPaid?: number;
    },
    @Req() req: AuthReq,
  ) {
    return this.terminalService.checkout(orgId(req), userId(req), body);
  }
}
