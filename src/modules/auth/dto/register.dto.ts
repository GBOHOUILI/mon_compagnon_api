import { ApiProperty } from '@nestjs/swagger';
import { Trim } from '../../../core/common/trim.transform.js';
import {
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { Role } from '../../../generated/prisma/client.js';

export const SELF_SERVICE_ROLES = [
  Role.FAMILY,
  Role.SENIOR,
  Role.COMPANION,
] as const;

export class RegisterDto {
  @ApiProperty() @Trim() @IsEmail() @MaxLength(254) email: string;
  @ApiProperty({ minLength: 8 })
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password: string;
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(80) firstName: string;
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(80) lastName: string;
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string;
  @ApiProperty({ enum: SELF_SERVICE_ROLES })
  @IsIn(SELF_SERVICE_ROLES)
  role: (typeof SELF_SERVICE_ROLES)[number];
}
