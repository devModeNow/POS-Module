import {
  IsArray,
  ValidateNested,
  IsString,
  IsIn,
  IsNumber,
  Min,
  Max,
} from 'class-validator';
import { Type } from 'class-transformer';

export class ExpenseEntryDto {
  @IsString()
  @IsIn([
    'Purchases',
    'Rental',
    'Electricity & Water',
    'Communication',
    'Salaries & Wages',
    'Supplies & Materials',
    'Repair & Maintenance',
    'Travel & Transportation',
    'Representation',
    'SSS',
    'Philhealth',
    'Pag IBIG',
    'Taxes',
    'Licenses',
    'Professional Fee',
    'Miscellaneous',
  ])
  category: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(999999999.99)
  amount: number;
}

export class CompleteScheduleDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ExpenseEntryDto)
  expenses: ExpenseEntryDto[];
}
