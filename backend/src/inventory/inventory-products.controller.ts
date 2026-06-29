import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { InventoryProductsService } from './inventory-products.service';

type AuthReq = { user?: Record<string, unknown> };
const orgId = (req: AuthReq) => Number(req.user?.['orgId'] ?? 0);

@Controller('inventory/products')
@UseGuards(JwtAuthGuard)
export class InventoryProductsController {
  constructor(private readonly svc: InventoryProductsService) {}

  @Get()
  listProducts(
    @Query('search') search: string,
    @Query('category') category: string,
    @Query('deleted') deleted: string,
    @Req() req: AuthReq,
  ) {
    return this.svc.listProducts(orgId(req), search, category, deleted === 'true');
  }

  @Get('variants')
  listVariants(
    @Query('search') search: string,
    @Query('category') category: string,
    @Query('deleted') deleted: string,
    @Req() req: AuthReq,
  ) {
    return this.svc.listAllVariants(orgId(req), search, category, deleted === 'true');
  }

  @Post('variant/:variantId/image')
  @UseInterceptors(FileInterceptor('image', { storage: memoryStorage() }))
  uploadVariantImage(
    @Param('variantId') variantId: string,
    @UploadedFile() file: Express.Multer.File,
    @Req() req: AuthReq,
  ) {
    if (!file) return { success: false, message: 'Image file is required' };
    return this.svc.uploadVariantImageFile(+variantId, orgId(req), file);
  }

  @Delete('variant/:variantId/image')
  removeVariantImage(@Param('variantId') variantId: string, @Req() req: AuthReq) {
    return this.svc.removeVariantImageFile(+variantId, orgId(req));
  }

  @Patch('variant/:variantId/restore')
  restoreVariant(@Param('variantId') variantId: string, @Req() req: AuthReq) {
    return this.svc.restoreVariant(+variantId, orgId(req));
  }

  @Patch(':id/restore')
  restoreProduct(@Param('id') id: string, @Req() req: AuthReq) {
    const numId = this.parseNumericId(id);
    if (numId == null) return { success: false, message: 'Product not found' };
    return this.svc.restoreProduct(numId, orgId(req));
  }

  @Get(':id')
  getOne(@Param('id') id: string, @Req() req: AuthReq) {
    const numId = this.parseNumericId(id);
    if (numId == null) return { success: false, message: 'Product not found' };
    return this.svc.getProductWithVariants(numId, orgId(req));
  }

  @Post()
  save(@Body() body: any, @Req() req: AuthReq) {
    return this.svc.saveProduct(orgId(req), body);
  }

  @Post(':id/image')
  @UseInterceptors(FileInterceptor('image', { storage: memoryStorage() }))
  uploadProductImage(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
    @Req() req: AuthReq,
  ) {
    if (!file) return { success: false, message: 'Image file is required' };
    const numId = this.parseNumericId(id);
    if (numId == null) return { success: false, message: 'Product not found' };
    return this.svc.uploadProductImageFile(numId, orgId(req), file);
  }

  @Delete(':id/image')
  removeProductImage(@Param('id') id: string, @Req() req: AuthReq) {
    const numId = this.parseNumericId(id);
    if (numId == null) return { success: false, message: 'Product not found' };
    return this.svc.removeProductImageFile(numId, orgId(req));
  }

  @Delete('variant/:variantId')
  deleteVariant(@Param('variantId') variantId: string, @Req() req: AuthReq) {
    return this.svc.deleteVariant(+variantId, orgId(req));
  }

  @Delete(':id')
  deleteProduct(@Param('id') id: string, @Req() req: AuthReq) {
    const numId = this.parseNumericId(id);
    if (numId == null) return { success: false, message: 'Product not found' };
    return this.svc.deleteProduct(numId, orgId(req));
  }

  private parseNumericId(raw: string): number | null {
    const id = Number(raw);
    return Number.isInteger(id) && id > 0 ? id : null;
  }
}
