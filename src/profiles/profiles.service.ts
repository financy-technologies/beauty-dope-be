import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Profile } from './entities/profile.entity';
import { UpdateProfileDto } from './dto/update-profile.dto';

@Injectable()
export class ProfilesService {
  constructor(
    @InjectRepository(Profile)
    private profilesRepo: Repository<Profile>,
  ) {}

  async findById(userId: string) {
    const profile = await this.profilesRepo.findOne({ where: { id: userId } });
    if (!profile) throw new NotFoundException(`Profile for user ${userId} not found`);
    return profile;
  }

  async updateMyProfile(userId: string, dto: UpdateProfileDto) {
    await this.profilesRepo.update(userId, dto);
    return this.findById(userId);
  }
}
