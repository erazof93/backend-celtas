import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Request } from 'express';
import { AuthService } from './auth.service';
import { GoogleAuthDto } from './dto/google-auth.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshDto } from './dto/refresh.dto';
import { RegisterDto } from './dto/register.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';

interface AuthenticatedRequest extends Request {
  user: { userId: string; email: string; role: string };
}

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  @UseGuards(ThrottlerGuard)
  @ApiOperation({ summary: 'Registro tradicional (email + password)' })
  @ApiResponse({ status: 201, description: 'Usuario creado, devuelve tokens' })
  @ApiResponse({ status: 400, description: 'Payload inválido' })
  @ApiResponse({ status: 409, description: 'El email ya está registrado' })
  @ApiResponse({ status: 429, description: 'Demasiados intentos (rate limit)' })
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Post('login')
  @UseGuards(ThrottlerGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Login tradicional (email + password)' })
  @ApiResponse({ status: 200, description: 'Login exitoso, devuelve tokens' })
  @ApiResponse({
    status: 401,
    description: 'Credenciales inválidas o cuenta de Google',
  })
  @ApiResponse({ status: 429, description: 'Demasiados intentos (rate limit)' })
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @Post('google')
  @UseGuards(ThrottlerGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Login/registro con Google (recibe un idToken)',
  })
  @ApiResponse({ status: 200, description: 'Login exitoso, devuelve tokens' })
  @ApiResponse({
    status: 401,
    description: 'Token de Google inválido o expirado',
  })
  @ApiResponse({
    status: 409,
    description:
      'El email ya está registrado con contraseña (no se fusionan cuentas)',
  })
  @ApiResponse({ status: 429, description: 'Demasiados intentos (rate limit)' })
  google(@Body() dto: GoogleAuthDto) {
    return this.authService.googleLogin(dto);
  }

  @Post('refresh')
  @UseGuards(ThrottlerGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Renueva el access token con un refresh token' })
  @ApiResponse({ status: 200, description: 'Nuevo access token emitido' })
  @ApiResponse({
    status: 401,
    description: 'Refresh token inválido o expirado',
  })
  refresh(@Body() dto: RefreshDto) {
    return this.authService.refresh(dto);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Perfil del usuario autenticado (protegido)' })
  @ApiResponse({ status: 200, description: 'Usuario actual' })
  @ApiResponse({ status: 401, description: 'Sin token o token inválido' })
  me(@Req() req: AuthenticatedRequest) {
    return this.authService.getProfile(req.user.userId);
  }
}
