import { ApiProperty } from '@nestjs/swagger';
import { Trim } from '../../../core/common/trim.transform.js';
import {
  IsBoolean,
  IsEmail,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class LoginDto {
  @ApiProperty() @Trim() @IsEmail() @MaxLength(254) email: string;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(128) password: string;
  @ApiProperty({ required: false, description: 'Keep the session for 30 days' })
  @IsOptional()
  @IsBoolean()
  remember?: boolean;
}
