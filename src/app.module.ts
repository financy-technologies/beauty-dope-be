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
      type: 'mysql',
      // Support both local DB_* vars and Railway's MYSQL* vars
      host: process.env.DB_HOST || process.env.MYSQLHOST || 'localhost',
      port: parseInt(process.env.DB_PORT || process.env.MYSQLPORT) || 3306,
      username: process.env.DB_USERNAME || process.env.MYSQLUSER || 'root',
      password: process.env.DB_PASSWORD || process.env.MYSQLPASSWORD || '',
      database: process.env.DB_NAME || process.env.MYSQLDATABASE || 'beautydope',
      entities: [__dirname + '/**/*.entity{.ts,.js}'],
      synchronize: true, // auto-create tables (safe for this project)
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
