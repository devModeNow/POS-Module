import { IsNotEmpty, IsOptional, IsString, Matches } from 'class-validator';

export class MonthlyReportQueryDto {
  @IsNotEmpty({ message: 'Month is required' })
  @IsString()
  @Matches(/^\d{4}-\d{2}$/, { message: 'Month must be in YYYY-MM format' })
  month: string;

  @IsOptional()
  @IsString()
  category?: string;
}
