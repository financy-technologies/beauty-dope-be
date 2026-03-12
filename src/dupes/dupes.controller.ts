import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { DupesService } from './dupes.service';
import { CreateDupeDto } from './dto/create-dupe.dto';
import { QueryDupesDto } from './dto/query-dupes.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('dupes')
export class DupesController {
  constructor(private dupesService: DupesService) {}

  @Get()
  findAll(@Query() query: QueryDupesDto) {
    return this.dupesService.findAll(query);
  }

  @Get('featured')
  findFeatured(@Query('limit') limit?: number) {
    return this.dupesService.findFeatured(limit ? Number(limit) : 4);
  }

  @Get('trending')
  findTrending(@Query('limit') limit?: number) {
    return this.dupesService.findTrending(limit ? Number(limit) : 5);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.dupesService.findOne(id);
  }

  @UseGuards(JwtAuthGuard)
  @Post()
  create(@Body() dto: CreateDupeDto) {
    return this.dupesService.create(dto);
  }

  @UseGuards(JwtAuthGuard)
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: Partial<CreateDupeDto>) {
    return this.dupesService.update(id, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string) {
    return this.dupesService.remove(id);
  }
}
