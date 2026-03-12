import 'dotenv/config';
import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { User } from '../../auth/entities/user.entity';
import { Profile } from '../../profiles/entities/profile.entity';
import { Product } from '../../products/entities/product.entity';
import { Category } from '../../categories/entities/category.entity';
import { Dupe } from '../../dupes/entities/dupe.entity';
import { Review } from '../../reviews/entities/review.entity';
import { UserFavorite } from '../../favorites/entities/favorite.entity';
import * as bcrypt from 'bcrypt';

const AppDataSource = new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST || process.env.PGHOST || 'localhost',
  port: parseInt(process.env.DB_PORT || process.env.PGPORT) || 5432,
  username: process.env.DB_USERNAME || process.env.PGUSER || 'postgres',
  password: process.env.DB_PASSWORD || process.env.PGPASSWORD || '',
  database: process.env.DB_NAME || process.env.PGDATABASE || 'beautydope',
  entities: [User, Profile, Product, Category, Dupe, Review, UserFavorite],
  synchronize: false,
});

async function seed() {
  await AppDataSource.initialize();
  console.log('Seeding database...');

  const categoryRepo = AppDataSource.getRepository(Category);
  const productRepo = AppDataSource.getRepository(Product);
  const dupeRepo = AppDataSource.getRepository(Dupe);
  const userRepo = AppDataSource.getRepository(User);
  const profileRepo = AppDataSource.getRepository(Profile);

  // Categories
  const categories = await categoryRepo.save([
    {
      name: 'Skincare',
      slug: 'skincare',
      subcategories: ['Serums', 'Moisturizers', 'Cleansers', 'Sunscreen', 'Eye Cream'],
      imageUrl: 'https://images.unsplash.com/photo-1556228720-195a672e8a03?w=400&h=500&fit=crop',
    },
    {
      name: 'Makeup',
      slug: 'makeup',
      subcategories: ['Lipstick', 'Foundation', 'Mascara', 'Blush', 'Eyeshadow', 'Primer'],
      imageUrl: 'https://images.unsplash.com/photo-1596462502278-27bfdc403348?w=400&h=500&fit=crop',
    },
    {
      name: 'Fragrance',
      slug: 'fragrance',
      subcategories: ['Perfume', 'Body Mist', 'Cologne'],
      imageUrl: 'https://images.unsplash.com/photo-1541643600914-78b084683601?w=400&h=500&fit=crop',
    },
  ]);
  console.log(`Seeded ${categories.length} categories`);

  // Original products
  const originals = await productRepo.save([
    { name: 'Pillow Talk Lipstick', brand: 'Charlotte Tilbury', price: 34.0, imageUrl: 'https://images.unsplash.com/photo-1586495777744-4413f21062fa?w=300&h=300&fit=crop', category: 'Makeup', subcategory: 'Lipstick' },
    { name: 'C.E. Ferulic Serum', brand: 'SkinCeuticals', price: 182.0, imageUrl: 'https://images.unsplash.com/photo-1620916566398-39f1143ab7be?w=300&h=300&fit=crop', category: 'Skincare', subcategory: 'Serums' },
    { name: 'Crème de la Mer', brand: 'La Mer', price: 380.0, imageUrl: 'https://images.unsplash.com/photo-1611930022073-b7a4ba5fcccd?w=300&h=300&fit=crop', category: 'Skincare', subcategory: 'Moisturizers' },
    { name: 'Hollywood Flawless Filter', brand: 'Charlotte Tilbury', price: 49.0, imageUrl: 'https://images.unsplash.com/photo-1631730486572-226d1f595b68?w=300&h=300&fit=crop', category: 'Makeup', subcategory: 'Primer' },
    { name: 'Protini Polypeptide Cream', brand: 'Drunk Elephant', price: 68.0, imageUrl: 'https://images.unsplash.com/photo-1611930022073-b7a4ba5fcccd?w=300&h=300&fit=crop', category: 'Skincare', subcategory: 'Moisturizers' },
    { name: 'Lost Cherry', brand: 'Tom Ford', price: 320.0, imageUrl: 'https://images.unsplash.com/photo-1541643600914-78b084683601?w=300&h=300&fit=crop', category: 'Fragrance', subcategory: 'Perfume' },
    { name: 'Skin Fetish Foundation', brand: 'Pat McGrath', price: 68.0, imageUrl: 'https://images.unsplash.com/photo-1631730486572-226d1f595b68?w=300&h=300&fit=crop', category: 'Makeup', subcategory: 'Foundation' },
    { name: 'Dewy Skin Cream', brand: 'Tatcha', price: 68.0, imageUrl: 'https://images.unsplash.com/photo-1611930022073-b7a4ba5fcccd?w=300&h=300&fit=crop', category: 'Skincare', subcategory: 'Moisturizers' },
    { name: 'Gloss Bomb', brand: 'Fenty Beauty', price: 22.0, imageUrl: 'https://images.unsplash.com/photo-1586495777744-4413f21062fa?w=300&h=300&fit=crop', category: 'Makeup', subcategory: 'Lipstick' },
  ]);
  console.log(`Seeded ${originals.length} original products`);

  // Dupe products
  const dupeProducts = await productRepo.save([
    { name: 'Lip Lingerie XXL', brand: 'NYX', price: 10.0, imageUrl: 'https://images.unsplash.com/photo-1631214524020-7e18db9a8f92?w=300&h=300&fit=crop', category: 'Makeup', subcategory: 'Lipstick' },
    { name: 'Vitamin C Serum', brand: 'Timeless', price: 28.0, imageUrl: 'https://images.unsplash.com/photo-1608248543803-ba4f8c70ae0b?w=300&h=300&fit=crop', category: 'Skincare', subcategory: 'Serums' },
    { name: 'Marine Hyaluronics', brand: 'The Ordinary', price: 12.0, imageUrl: 'https://images.unsplash.com/photo-1617897903246-719242758050?w=300&h=300&fit=crop', category: 'Skincare', subcategory: 'Moisturizers' },
    { name: 'Luminous Silk Glow', brand: 'e.l.f.', price: 14.0, imageUrl: 'https://images.unsplash.com/photo-1596755389378-c31d21fd1273?w=300&h=300&fit=crop', category: 'Makeup', subcategory: 'Primer' },
    { name: 'Peptide Moisturizer', brand: 'The Inkey List', price: 16.0, imageUrl: 'https://images.unsplash.com/photo-1617897903246-719242758050?w=300&h=300&fit=crop', category: 'Skincare', subcategory: 'Moisturizers' },
    { name: 'Woody Cherry', brand: 'Dossier', price: 35.0, imageUrl: 'https://images.unsplash.com/photo-1541643600914-78b084683601?w=300&h=300&fit=crop', category: 'Fragrance', subcategory: 'Perfume' },
    { name: 'True Match Lumi', brand: "L'Oreal", price: 14.0, imageUrl: 'https://images.unsplash.com/photo-1631730486572-226d1f595b68?w=300&h=300&fit=crop', category: 'Makeup', subcategory: 'Foundation' },
    { name: 'Moisturizing Cream', brand: 'CeraVe', price: 20.0, imageUrl: 'https://images.unsplash.com/photo-1617897903246-719242758050?w=300&h=300&fit=crop', category: 'Skincare', subcategory: 'Moisturizers' },
    { name: 'Lifter Gloss', brand: 'Maybelline', price: 10.0, imageUrl: 'https://images.unsplash.com/photo-1631214524020-7e18db9a8f92?w=300&h=300&fit=crop', category: 'Makeup', subcategory: 'Lipstick' },
  ]);
  console.log(`Seeded ${dupeProducts.length} dupe products`);

  // Dupe relationships
  const dupeRelationships = [
    { orig: 0, dupe: 0, similarity: 92, savings: 71, category: 'Lipstick', isFeatured: true,  isTrending: false, totalVotes: 1250, avgRating: 4.5 },
    { orig: 1, dupe: 1, similarity: 87, savings: 85, category: 'Serum',    isFeatured: true,  isTrending: false, totalVotes: 980,  avgRating: 4.3 },
    { orig: 2, dupe: 2, similarity: 78, savings: 97, category: 'Moisturizer', isFeatured: true, isTrending: false, totalVotes: 2100, avgRating: 4.1 },
    { orig: 3, dupe: 3, similarity: 89, savings: 71, category: 'Primer',   isFeatured: true,  isTrending: false, totalVotes: 1567, avgRating: 4.6 },
    { orig: 4, dupe: 4, similarity: 85, savings: 76, category: 'Moisturizer', isFeatured: false, isTrending: true, totalVotes: 2340, avgRating: 4.8 },
    { orig: 5, dupe: 5, similarity: 82, savings: 89, category: 'Perfume',  isFeatured: false, isTrending: true, totalVotes: 1890, avgRating: 4.6 },
    { orig: 6, dupe: 6, similarity: 80, savings: 79, category: 'Foundation', isFeatured: false, isTrending: true, totalVotes: 1654, avgRating: 4.5 },
    { orig: 7, dupe: 7, similarity: 83, savings: 71, category: 'Moisturizer', isFeatured: false, isTrending: true, totalVotes: 1432, avgRating: 4.7 },
    { orig: 8, dupe: 8, similarity: 88, savings: 55, category: 'Lipstick', isFeatured: false, isTrending: true, totalVotes: 1289, avgRating: 4.4 },
  ];

  for (const rel of dupeRelationships) {
    await dupeRepo.save(
      dupeRepo.create({
        originalProduct: originals[rel.orig],
        dupeProduct: dupeProducts[rel.dupe],
        similarityScore: rel.similarity,
        savingsPercent: rel.savings,
        category: rel.category,
        isFeatured: rel.isFeatured,
        isTrending: rel.isTrending,
        totalVotes: rel.totalVotes,
        avgRating: rel.avgRating,
      }),
    );
  }
  console.log(`Seeded ${dupeRelationships.length} dupes`);

  // Demo user
  const hashedPassword = await bcrypt.hash('password123', 10);
  const user = await userRepo.save(
    userRepo.create({
      email: 'demo@beautydope.com',
      password: hashedPassword,
      displayName: 'Beauty Lover',
    }),
  );
  await profileRepo.save(
    profileRepo.create({
      id: user.id,
      displayName: 'Beauty Lover',
      username: 'beauty_lover',
      bio: 'Finding dupes so you don\'t have to!',
    }),
  );
  console.log('Seeded demo user: demo@beautydope.com / password123');

  await AppDataSource.destroy();
  console.log('Seeding complete!');
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
