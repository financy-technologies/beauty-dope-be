import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  UseGuards,
  Req,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { FavoritesService } from './favorites.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('favorites')
@UseGuards(JwtAuthGuard)
export class FavoritesController {
  constructor(private favoritesService: FavoritesService) {}

  @Get()
  getFavoriteIds(@Req() req) {
    return this.favoritesService.getFavoriteIds(req.user.id);
  }

  @Get('dupes')
  getFavoriteDupes(@Req() req) {
    return this.favoritesService.getFavoriteDupes(req.user.id);
  }

  @Post(':dupeId')
  add(@Param('dupeId') dupeId: string, @Req() req) {
    return this.favoritesService.add(dupeId, req.user.id);
  }

  @Delete(':dupeId')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('dupeId') dupeId: string, @Req() req) {
    return this.favoritesService.remove(dupeId, req.user.id);
  }
}
