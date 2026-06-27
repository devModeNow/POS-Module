import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { PosDiscountsService } from '../services/discounts.service';
import { PosPaymentMethodsService } from '../services/payment-methods.service';
import { PosTerminalService } from '../services/terminal.service';

type AuthReq = { user?: Record<string, unknown> };
const orgId = (req: AuthReq) => Number(req.user?.['orgId'] ?? 0);
const userId = (req: AuthReq) => Number(req.user?.['sub'] ?? 0);

@Controller('api/pos')
@UseGuards(JwtAuthGuard)
export class PosTerminalController {
  constructor(
    private readonly terminalService: PosTerminalService,
    private readonly discountsService: PosDiscountsService,
    private readonly paymentMethodsService: PosPaymentMethodsService,
  ) {}

  @Get('products')
  listProducts(
    @Query('search') search: string,
    @Query('category') category: string,
    @Req() req: AuthReq,
  ) {
    return this.terminalService.listProducts(orgId(req), search, category);
  }

  @Get('products/:id/variants')
  listVariants(@Param('id') id: string, @Req() req: AuthReq) {
    return this.terminalService.listVariants(+id, orgId(req));
  }

  @Get('categories')
  listCategories(@Req() req: AuthReq) {
    return this.terminalService.listCategories(orgId(req));
  }

  @Get('discounts')
  listDiscounts(@Req() req: AuthReq) {
    return this.discountsService.listDiscounts(orgId(req));
  }

  @Get('payment-methods')
  listPaymentMethods(@Req() req: AuthReq) {
    return this.paymentMethodsService.listPaymentMethods(orgId(req));
  }

  @Post('checkout')
  checkout(
    @Body()
    body: {
      items: Array<{ variantId: number; quantity: number }>;
      discountId?: number | null;
      discountAmount?: number;
      amountPaid?: number;
      paymentMethodId?: number | null;
    },
    @Req() req: AuthReq,
  ) {
    return this.terminalService.checkout(orgId(req), userId(req), body);
  }
}
