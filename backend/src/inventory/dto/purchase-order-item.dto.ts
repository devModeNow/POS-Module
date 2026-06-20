import { IsOptional, IsNotEmpty, IsString, IsNumber, IsInt, Min } from 'class-validator';

export class PurchaseOrderItemDto {
  @IsOptional()
  @IsInt()
  inventoryId?: number;

  @IsNotEmpty({ message: 'Item name is required' })
  @IsString()
  itemName: string;

  @IsOptional()
  @IsString()
  brand?: string;

  @IsOptional()
  @IsString()
  category?: string;

  @IsInt()
  @Min(1, { message: 'Quantity must be at least 1' })
  quantity: number;

  @IsNumber()
  @Min(0, { message: 'Unit cost must be non-negative' })
  unitCost: number;
}
