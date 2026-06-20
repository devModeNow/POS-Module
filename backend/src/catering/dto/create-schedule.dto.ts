import {
  IsNotEmpty,
  IsString,
  MaxLength,
  Matches,
  IsDateString,
  IsInt,
  Min,
  IsArray,
  IsOptional,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class MenuSelectionDto {
  @IsInt()
  @Type(() => Number)
  menuItemId: number;

  @IsNotEmpty()
  @IsString()
  category: string;
}

export class CreateScheduleDto {
  @IsNotEmpty()
  @IsString()
  @MaxLength(100)
  customerName: string;

  @IsNotEmpty()
  @IsString()
  @MaxLength(15)
  @Matches(/^\d+$/, { message: 'contactNumber must contain only digits' })
  contactNumber: string;

  @IsNotEmpty()
  @IsString()
  @MaxLength(200)
  venue: string;

  @IsDateString()
  eventDate: string;

  @IsInt()
  @Min(1)
  @Type(() => Number)
  pax: number;

  @IsInt()
  @Type(() => Number)
  packageId: number;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MenuSelectionDto)
  menuSelections?: MenuSelectionDto[];
}
