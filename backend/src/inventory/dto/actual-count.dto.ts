import { IsNotEmpty, IsInt, IsString, Matches, Min } from 'class-validator';

export class ActualCountDto {
  @IsNotEmpty({ message: 'Product ID is required' })
  @IsInt()
  productId: number;

  @IsNotEmpty({ message: 'Month is required' })
  @IsString()
  @Matches(/^\d{4}-\d{2}$/, { message: 'Month must be in YYYY-MM format' })
  month: string;

  @IsInt()
  @Min(0, { message: 'Count must be a non-negative integer' })
  count: number;
}
