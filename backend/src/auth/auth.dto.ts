import { IsIn, IsOptional, IsString, Length, Matches } from 'class-validator';
import { Role } from '../users/user.entity';

export class RegisterDto {
  /** 3–50 characters: letters, digits, underscore, dot or hyphen. */
  @IsString()
  @Length(3, 50)
  @Matches(/^[A-Za-z0-9_.-]+$/, {
    message: 'username may contain letters, digits, underscore, dot and hyphen only',
  })
  username: string;

  @IsString()
  @Length(8, 72, { message: 'password must be 8–72 characters' })
  password: string;

  @IsOptional()
  @IsString()
  @Matches(/^\+?[0-9 -]{6,20}$/, { message: 'phone must be 6–20 digits' })
  phone?: string;

  /** Sign up to buy, or to sell. Admin accounts cannot be self-registered. */
  @IsOptional()
  @IsIn([Role.BUYER, Role.SELLER])
  role?: Role.BUYER | Role.SELLER;
}

export class LoginDto {
  @IsString()
  @Length(1, 50)
  username: string;

  @IsString()
  @Length(1, 72)
  password: string;
}
