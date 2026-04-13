import {
  Injectable,
  ConflictException,
  UnauthorizedException,
  BadRequestException,
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

    const profile = this.profilesRepo.create({
      id: user.id,
      displayName: dto.displayName || dto.email,
    });
    await this.profilesRepo.save(profile);

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

  // credential = Google OAuth access token OR One Tap ID token
  async googleLogin(credential: string) {
    let googleUser: { sub: string; email: string; name?: string; picture?: string };

    // One Tap returns a JWT (3 dot-separated parts); popup returns an access token
    const isIdToken = credential.split('.').length === 3;

    try {
      if (isIdToken) {
        // Verify ID token via Google's tokeninfo endpoint
        const res = await fetch(
          `https://oauth2.googleapis.com/tokeninfo?id_token=${credential}`,
        );
        if (!res.ok) throw new Error();
        const data = await res.json();
        googleUser = { sub: data.sub, email: data.email, name: data.name, picture: data.picture };
      } else {
        // Exchange access token for user info
        const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
          headers: { Authorization: `Bearer ${credential}` },
        });
        if (!res.ok) throw new Error();
        googleUser = await res.json();
      }
    } catch {
      throw new BadRequestException('Invalid Google credential');
    }

    const { sub: googleId, email, name, picture } = googleUser;
    if (!email) throw new BadRequestException('Google account has no email');

    // Find by googleId first, then fall back to email (to link existing accounts)
    let user = await this.usersRepo.findOne({ where: { googleId } });
    if (!user) {
      user = await this.usersRepo.findOne({ where: { email } });
    }

    if (user) {
      if (!user.googleId) {
        user.googleId = googleId;
        user.avatarUrl = picture ?? user.avatarUrl;
        await this.usersRepo.save(user);
      }
    } else {
      user = this.usersRepo.create({
        email,
        googleId,
        displayName: name ?? email.split('@')[0],
        avatarUrl: picture,
        password: null,
      });
      await this.usersRepo.save(user);

      const profile = this.profilesRepo.create({
        id: user.id,
        displayName: user.displayName,
        avatarUrl: picture,
      });
      await this.profilesRepo.save(profile);

      await this.rewardsService.earnPoints(
        user.id,
        50,
        TransactionType.SIGNUP,
        'Welcome to Skinevora! 🎉',
      );
    }

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
