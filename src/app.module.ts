import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from './auth/auth.module';
import { ProductsModule } from './products/products.module';
import { CategoriesModule } from './categories/categories.module';
import { DupesModule } from './dupes/dupes.module';
import { ReviewsModule } from './reviews/reviews.module';
import { FavoritesModule } from './favorites/favorites.module';
import { ProfilesModule } from './profiles/profiles.module';
import { SearchModule } from './search/search.module';

@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: 'postgres',
      // Use full connection URL if provided (Neon, Supabase, etc.)
      ...(process.env.DATABASE_URL
        ? {
            url: process.env.DATABASE_URL,
            ssl: { rejectUnauthorized: false },
          }
        : {
            host: process.env.DB_HOST || process.env.PGHOST || 'localhost',
            port: parseInt(process.env.DB_PORT || process.env.PGPORT) || 5432,
            username: process.env.DB_USERNAME || process.env.PGUSER || 'postgres',
            password: process.env.DB_PASSWORD || process.env.PGPASSWORD || '',
            database: process.env.DB_NAME || process.env.PGDATABASE || 'beautydope',
          }),
      entities: [__dirname + '/**/*.entity{.ts,.js}'],
      synchronize: true,
      logging: process.env.NODE_ENV === 'development',
    }),
    AuthModule,
    ProductsModule,
    CategoriesModule,
    DupesModule,
    ReviewsModule,
    FavoritesModule,
    ProfilesModule,
    SearchModule,
  ],
})
export class AppModule {}
