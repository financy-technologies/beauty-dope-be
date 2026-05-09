import { Controller, Post, Get, Delete, Req, Res, Headers } from '@nestjs/common';
import { Request, Response } from 'express';
import { McpService } from './mcp.service';

@Controller('mcp')
export class McpController {
  constructor(private readonly mcpService: McpService) {}

  @Post()
  async handlePost(
    @Req() req: Request,
    @Res() res: Response,
    @Headers('mcp-session-id') sessionId: string,
  ) {
    await this.mcpService.handleRequest(req, res);
  }

  @Get()
  async handleGet(
    @Req() req: Request,
    @Res() res: Response,
    @Headers('mcp-session-id') sessionId: string,
  ) {
    await this.mcpService.handleRequest(req, res);
  }

  @Delete()
  async handleDelete(
    @Req() req: Request,
    @Res() res: Response,
    @Headers('mcp-session-id') sessionId: string,
  ) {
    await this.mcpService.handleRequest(req, res);
  }
}
