import "dotenv/config";
import { supabase } from "./config/supabase.js";

const categories = [
  { name: "Home & Living", slug: "home-living", description: "Quiet essentials for considered spaces" },
  { name: "Accessories", slug: "accessories", description: "Useful details for every day" },
  { name: "Wellness", slug: "wellness", description: "Simple rituals for better living" },
];

const categoryProducts = {
  accessories: [
    "Linen Carry Tote", "Canvas Weekender", "Minimal Card Wallet", "Everyday Crossbody Bag",
    "Classic Leather Belt", "Polarized Sunglasses", "Travel Organizer Pouch", "Stainless Key Clip",
    "Cotton Baseball Cap", "Wool Blend Scarf", "Compact Umbrella", "Reusable Water Bottle",
    "Padded Laptop Sleeve", "Phone Sling Bag", "Braided Bracelet", "Analog Wrist Watch",
    "Packing Cube Set", "Passport Holder", "Foldable Shopping Bag", "Wireless Earbuds Case",
    "Metal Money Clip",
  ],
  "home-living": [
    "Stoneware Pour Set", "Everyday Desk Tray", "Ceramic Dinner Plate Set", "Linen Cushion Cover",
    "Cotton Throw Blanket", "Bamboo Storage Basket", "Glass Water Carafe", "Wooden Serving Board",
    "Minimal Wall Clock", "Modular Desk Organizer", "Bedside Table Lamp", "Stainless Cutlery Set",
    "Cotton Bath Towel", "Indoor Plant Pot", "Kitchen Canister Set", "Woven Floor Mat",
    "Reusable Food Container", "Coffee Mug Set", "Fabric Laundry Basket", "Wooden Photo Frame",
    "Natural Reed Diffuser",
  ],
  wellness: [
    "Amber Ritual Candle", "Botanical Bath Salts", "Essential Oil Blend", "Herbal Sleep Tea",
    "Natural Body Scrub", "Mineral Face Mask", "Lavender Eye Pillow", "Meditation Cushion",
    "Non Slip Yoga Mat", "Recovery Foam Roller", "Reusable Heat Pack", "Aromatherapy Diffuser",
    "Nourishing Hand Cream", "Natural Lip Balm Set", "Massage Ball Set", "Incense Stick Set",
    "Herbal Soap Bar", "Daily Wellness Journal", "Lavender Sleep Mist", "Hydrating Body Lotion",
    "Organic Green Tea Pack",
  ],
};

const slugify = (value) => value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

const imageOffsets = { accessories: 100, "home-living": 200, wellness: 300 };
const imageCategoryKeywords = {
  accessories: "fashion-accessory",
  "home-living": "home-decor",
  wellness: "self-care",
};

// LoremFlickr returns a real product photograph matching these name-based tags.
// The lock number keeps each product's image stable between page refreshes.
const productImageUrl = (name, categorySlug, index) => {
  const productKeywords = slugify(name).replaceAll("-", ",");
  const categoryKeyword = imageCategoryKeywords[categorySlug];
  const lock = imageOffsets[categorySlug] + index + 1;
  return `https://loremflickr.com/900/700/${productKeywords},${categoryKeyword}?lock=${lock}`;
};

const priceBases = { accessories: 690, "home-living": 590, wellness: 390 };
const descriptions = {
  accessories: "A practical everyday accessory designed for comfort, durability, and easy styling.",
  "home-living": "A thoughtfully made home essential that brings function and calm to everyday spaces.",
  wellness: "A simple self-care essential created to support a calm and balanced daily routine.",
};

const { data: savedCategories, error: categoryError } = await supabase
  .from("categories")
  .upsert(categories, { onConflict: "slug" })
  .select("id, slug");

if (categoryError) throw categoryError;

const categoryIds = Object.fromEntries(savedCategories.map((category) => [category.slug, category.id]));

const catalog = Object.entries(categoryProducts).flatMap(([categorySlug, names]) =>
  names.map((name, index) => {
    const price = priceBases[categorySlug] + index * 100;

    return {
      name,
      category_id: categoryIds[categorySlug],
      price,
      stock: 12 + ((index * 7) % 39),
      is_featured: index < 4,
      is_active: true,
      description: descriptions[categorySlug],
      image_url: productImageUrl(name, categorySlug, index),
    };
  }),
);

const seededNames = catalog.map((product) => product.name);
const { error: cleanupError } = await supabase.from("products").delete().in("name", seededNames);
if (cleanupError) throw cleanupError;
const { error: productError } = await supabase.from("products").insert(catalog);

if (productError) throw productError;

for (const category of categories) {
  const count = catalog.filter((product) => product.category_id === categoryIds[category.slug]).length;
  console.log(`${category.name}: ${count} products seeded`);
}

console.log(`Commerce catalog ready: ${catalog.length} products total`);
