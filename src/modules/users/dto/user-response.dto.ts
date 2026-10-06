import { ApiProperty } from '@nestjs/swagger';
import {
  Role,
  type User,
  UserStatus,
} from '../../../generated/prisma/client.js';

/** Public view of a user: never exposes the password hash. */
export class UserResponseDto {
  @ApiProperty() id: string;
  @ApiProperty() email: string;
  @ApiProperty({ required: false, nullable: true }) phone: string | null;
  @ApiProperty() firstName: string;
  @ApiProperty() lastName: string;
  @ApiProperty({ enum: Role }) role: Role;
  @ApiProperty({ enum: UserStatus }) status: UserStatus;
  @ApiProperty() createdAt: Date;

  static from(user: User): UserResponseDto {
    const { id, email, phone, firstName, lastName, role, status, createdAt } =
      user;
    return Object.assign(new UserResponseDto(), {
      id,
      email,
      phone,
      firstName,
      lastName,
      role,
      status,
      createdAt,
    });
  }
}
