import { IsNotEmpty, IsString, MaxLength, IsIn } from 'class-validator';

export class CreateMenuItemDto {
  @IsNotEmpty()
  @IsString()
  @MaxLength(100)
  name: string;

  @IsNotEmpty()
  @IsString()
  @IsIn([
    'chicken',
    'pork',
    'vegetable',
    'seafood',
    'beef',
    'soup',
    'pasta',
    'salad',
    'drinks',
    'dessert',
    'appetizer',
    'freebie',
  ])
  category: string;
}
