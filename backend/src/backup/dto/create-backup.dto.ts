import { IsOptional, IsIn } from 'class-validator';

export class CreateBackupDto {
  @IsOptional()
  @IsIn(['full', 'schema-only', 'data-only'])
  type?: 'full' | 'schema-only' | 'data-only' = 'full';

  @IsOptional()
  @IsIn(['plain', 'custom'])
  format?: 'plain' | 'custom' = 'plain';
}
