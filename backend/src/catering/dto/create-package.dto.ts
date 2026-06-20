import {
  IsNotEmpty,
  IsString,
  MaxLength,
  IsNumber,
  Min,
  Max,
  IsInt,
  IsArray,
  ArrayMinSize,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class PackageItemDto {
  @IsInt()
  @Type(() => Number)
  menuItemId: number;

  @IsInt()
  @Min(1)
  @Type(() => Number)
  selectionLimit: number;
}

export class CreatePackageDto {
  @IsNotEmpty()
  @IsString()
  @MaxLength(100)
  name: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(999999999.99)
  @Type(() => Number)
  pricePerHead: number;

  @IsInt()
  @Min(1)
  @Max(10000)
  @Type(() => Number)
  minPax: number;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => PackageItemDto)
  items: PackageItemDto[];
}
