import {
  Injectable,
  ConflictException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { User } from './entities/user.entity';
import { Profile } from '../profiles/entities/profile.entity';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { RewardsService } from '../rewards/rewards.service';
import { TransactionType } from '../rewards/entities/point-transaction.entity';

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User)
    private usersRepo: Repository<User>,
    @InjectRepository(Profile)
    private profilesRepo: Repository<Profile>,
    private jwtService: JwtService,
    private rewardsService: RewardsService,
  ) {}

  async register(dto: RegisterDto) {
    const existing = await this.usersRepo.findOne({ where: { email: dto.email } });
    if (existing) throw new ConflictException('Email already in use');

    const hashed = await bcrypt.hash(dto.password, 10);
    const user = this.usersRepo.create({
      email: dto.email,
      password: hashed,
      displayName: dto.displayName,
    });
    await this.usersRepo.save(user);

    // Auto-create profile
    const profile = this.profilesRepo.create({
      id: user.id,
      displayName: dto.displayName || dto.email,
    });
    await this.profilesRepo.save(profile);

    // Award welcome points
    await this.rewardsService.earnPoints(
      user.id,
      50,
      TransactionType.SIGNUP,
      'Welcome to Skinevora! 🎉',
    );

    return this.issueToken(user);
  }

  async login(dto: LoginDto) {
    const user = await this.usersRepo.findOne({ where: { email: dto.email } });
    if (!user) throw new UnauthorizedException('Invalid credentials');

    const valid = await bcrypt.compare(dto.password, user.password);
    if (!valid) throw new UnauthorizedException('Invalid credentials');

    return this.issueToken(user);
  }

  async me(userId: string) {
    const user = await this.usersRepo.findOne({
      where: { id: userId },
      relations: ['profile'],
    });
    if (!user) throw new UnauthorizedException();

    const { password, ...result } = user;
    return result;
  }

  private issueToken(user: User) {
    const payload = { sub: user.id, email: user.email, isAdmin: user.isAdmin };
    return {
      accessToken: this.jwtService.sign(payload),
      user: {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        isAdmin: user.isAdmin,
      },
    };
  }
}
