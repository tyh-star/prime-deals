import { Body, Controller, Get, HttpCode, NotFoundException, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthUser, CurrentUser, Public } from '../common/auth.decorators';
import { UsersService } from '../users/users.service';
import { LoginDto, RegisterDto } from './auth.dto';
import { AuthService } from './auth.service';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly users: UsersService,
  ) {}

  @Public()
  @Post('register')
  register(@Body() dto: RegisterDto) {
    return this.auth.register(dto);
  }

  @Public()
  @Post('login')
  @HttpCode(200)
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto);
  }

  @ApiBearerAuth()
  @Post('logout')
  @HttpCode(204)
  async logout(@CurrentUser() user: AuthUser) {
    await this.auth.logout(user);
  }

  @ApiBearerAuth()
  @Get('me')
  async me(@CurrentUser() user: AuthUser) {
    const found = await this.users.findById(user.id);
    if (!found) throw new NotFoundException('User no longer exists');
    return found;
  }
}
