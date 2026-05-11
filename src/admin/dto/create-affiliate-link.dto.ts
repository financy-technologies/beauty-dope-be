import { IsUrl } from 'class-validator';

export class CreateAffiliateLinkDto {
  @IsUrl({ require_protocol: true })
  url: string;
}