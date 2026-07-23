/** @format */

// One-off: seeds four real, approved vendors spread across Rivers, Lagos,
// Ogun, and Nasarawa states, each with a small menu of regionally-flavored
// Nigerian meals — for manually testing location/discovery behavior across
// states rather than Lagos alone. Additive only: never touches existing
// data. Safe to rerun — matches on each vendor's email/phone and updates
// in place instead of duplicating; matches meals by (vendorId, name) and
// skips ones that already exist.
//
// Run with: NODE_ENV=production npx tsx src/scripts/seed-location-test-vendors.ts

import mongoose from "mongoose";
import { Db } from "../config/db.config.js";
import User from "../models/user.model.js";
import Vendor from "../models/vendor.model.js";
import Address from "../models/address.model.js";
import Meal from "../models/meal.model.js";
import MealCategory, { CategoryType } from "../models/mealCategory.model.js";

const DEFAULT_PASSWORD = "TestPass123!";

interface VendorSeed {
  storeName: string;
  email: string;
  phoneNumber: string;
  state: string;
  city: string;
  address: string;
  postalCode: string;
  latitude: number;
  longitude: number;
  businessDescription: string;
  meals: Array<{
    name: string;
    description: string;
    price: number;
    primaryImageUrl: string;
    tags: string[];
    preparationTime: number;
    servingSize: string;
  }>;
}

const VENDORS: VendorSeed[] = [
  {
    storeName: "Longjohn",
    email: "longjohn.kitchen@gmail.com",
    phoneNumber: "+2348090001101",
    state: "Rivers",
    city: "Port Harcourt",
    address: "15 Aba Road",
    postalCode: "500272",
    latitude: 4.8156,
    longitude: 7.0498,
    businessDescription: "Niger Delta home cooking — banga, seafood, and peppersoup specialists.",
    meals: [
      {
        name: "Banga Soup & Starch",
        description: "Rich palm-nut soup with assorted meat and fish, served with smooth starch.",
        price: 7500,
        primaryImageUrl: "https://images.unsplash.com/photo-1604908176997-125f25cc6f3d",
        tags: ["soup", "local", "rivers"],
        preparationTime: 35,
        servingSize: "1 bowl",
      },
      {
        name: "Seafood Okra Soup",
        description: "Okra soup loaded with prawns, periwinkle, and fresh croaker fish.",
        price: 8200,
        primaryImageUrl: "https://images.unsplash.com/photo-1625943555419-56a2cb596640",
        tags: ["soup", "seafood", "okra"],
        preparationTime: 30,
        servingSize: "1 bowl",
      },
      {
        name: "Fisherman's Peppersoup",
        description: "Spicy catfish peppersoup, Niger Delta style, served hot.",
        price: 5500,
        primaryImageUrl: "https://images.unsplash.com/photo-1529042410759-befb1204b468",
        tags: ["peppersoup", "fish", "spicy"],
        preparationTime: 25,
        servingSize: "1 bowl",
      },
    ],
  },
  {
    storeName: "Peace",
    email: "peace.eats@gmail.com",
    phoneNumber: "+2348090001102",
    state: "Lagos",
    city: "Lagos",
    address: "22 Allen Avenue",
    postalCode: "100281",
    latitude: 6.5244,
    longitude: 3.3792,
    businessDescription: "Lagos street-food favorites — ofada, amala, and smoky party jollof.",
    meals: [
      {
        name: "Ofada Rice & Ayamase Sauce",
        description: "Local ofada rice with spicy green pepper (ayamase) sauce and assorted meat.",
        price: 6500,
        primaryImageUrl: "https://images.unsplash.com/photo-1604908176997-125f25cc6f3d",
        tags: ["rice", "local", "spicy"],
        preparationTime: 30,
        servingSize: "1 plate",
      },
      {
        name: "Amala & Ewedu with Gbegiri",
        description: "Smooth amala served with ewedu and gbegiri soup and assorted meat.",
        price: 5800,
        primaryImageUrl: "https://images.unsplash.com/photo-1517248135467-4c7edcad34c4",
        tags: ["amala", "soup", "yoruba"],
        preparationTime: 25,
        servingSize: "1 plate",
      },
      {
        name: "Lagos Jollof & Grilled Chicken",
        description: "Smoky party-style jollof rice with grilled chicken and fried plantain.",
        price: 6800,
        primaryImageUrl: "https://images.unsplash.com/photo-1587248720327-8eb72564be1e",
        tags: ["jollof", "party", "chicken"],
        preparationTime: 25,
        servingSize: "1 plate",
      },
    ],
  },
  {
    storeName: "Jane",
    email: "jane.kitchen@gmail.com",
    phoneNumber: "+2348090001103",
    state: "Ogun",
    city: "Abeokuta",
    address: "9 Ake Road",
    postalCode: "110001",
    latitude: 7.1475,
    longitude: 3.3619,
    businessDescription: "Ogun/Ijebu classics — ogbono, ikokore, and freshly spiced asaro.",
    meals: [
      {
        name: "Ogbono Soup & Pounded Yam",
        description: "Draw soup made with ogbono and assorted meat, served with pounded yam.",
        price: 6200,
        primaryImageUrl: "https://images.unsplash.com/photo-1625943555419-56a2cb596640",
        tags: ["soup", "local", "swallow"],
        preparationTime: 35,
        servingSize: "1 bowl",
      },
      {
        name: "Ikokore (Water Yam Porridge)",
        description: "Ijebu-style grated water yam porridge cooked with fresh fish and pepper.",
        price: 5400,
        primaryImageUrl: "https://images.unsplash.com/photo-1547592180-85f173990554",
        tags: ["porridge", "ijebu", "fish"],
        preparationTime: 30,
        servingSize: "1 bowl",
      },
      {
        name: "Asaro with Fish",
        description: "Spiced yam porridge cooked with fresh fish and palm oil.",
        price: 4800,
        primaryImageUrl: "https://images.unsplash.com/photo-1509440159596-0249088772ff",
        tags: ["porridge", "yam", "fish"],
        preparationTime: 25,
        servingSize: "1 bowl",
      },
    ],
  },
  {
    storeName: "Opeyemi",
    email: "opeyemi.delicacies@gmail.com",
    phoneNumber: "+2348090001104",
    state: "Nasarawa",
    city: "Lafia",
    address: "4 Shendam Road",
    postalCode: "961101",
    latitude: 8.4933,
    longitude: 8.5167,
    businessDescription: "Middle-belt delicacies — tuwo, miyan kuka, and suya, done right.",
    meals: [
      {
        name: "Tuwo Shinkafa & Miyan Kuka",
        description: "Soft rice tuwo served with baobab-leaf (kuka) soup and assorted meat.",
        price: 5000,
        primaryImageUrl: "https://images.unsplash.com/photo-1604908176997-125f25cc6f3d",
        tags: ["tuwo", "local", "middle-belt"],
        preparationTime: 30,
        servingSize: "1 plate",
      },
      {
        name: "Miyan Taushe (Pumpkin Soup) & Tuwo",
        description: "Pumpkin-based soup cooked with assorted meat, served with tuwo shinkafa.",
        price: 5200,
        primaryImageUrl: "https://images.unsplash.com/photo-1528735602780-2552fd46c7af",
        tags: ["soup", "pumpkin", "tuwo"],
        preparationTime: 30,
        servingSize: "1 plate",
      },
      {
        name: "Suya Platter",
        description: "Grilled spiced beef skewers with onions, tomato, and yaji pepper mix.",
        price: 4500,
        primaryImageUrl: "https://images.unsplash.com/photo-1555396273-367ea4eb4db5",
        tags: ["suya", "grilled", "beef"],
        preparationTime: 20,
        servingSize: "10 sticks",
      },
    ],
  },
];

async function main() {
  const db = new Db();
  await db.connect();
  console.log(`Connected to ${mongoose.connection.name}`);

  const admin = await User.findOne({ userType: "admin" }).select("_id");

  let localCategory = await MealCategory.findOne({ category: CategoryType.LOCAL });
  if (!localCategory) {
    localCategory = await MealCategory.create({
      category: CategoryType.LOCAL,
      description: `${CategoryType.LOCAL} category`,
    });
    console.log("Created missing 'local' meal category.");
  }

  const summary: string[] = [];

  for (const def of VENDORS) {
    let user = await User.findOne({ email: def.email });

    if (user && user.userType !== "vendor") {
      throw new Error(
        `${def.email} already exists as a "${user.userType}" account — refusing to reuse it as a vendor.`,
      );
    }

    if (!user) {
      const [firstName, ...rest] = def.storeName.split(" ");
      user = await User.create({
        firstName: firstName || def.storeName,
        lastName: rest.join(" ") || "Kitchen",
        email: def.email,
        phoneNumber: def.phoneNumber,
        passwordHash: DEFAULT_PASSWORD,
        authType: "email",
        userType: "vendor",
        isEmailVerified: true,
        isPhoneVerified: true,
        status: "active",
        lastLogin: new Date(),
      });
      console.log(`Created user for ${def.storeName} (${def.email}).`);
    }

    let address = await Address.findOne({ userId: user._id });
    if (address) {
      address.label = "work";
      address.address = def.address;
      address.city = def.city;
      address.state = def.state;
      address.country = "Nigeria";
      address.postalCode = def.postalCode;
      address.latitude = def.latitude;
      address.longitude = def.longitude;
      address.isDefault = true;
      await address.save();
    } else {
      address = await Address.create({
        userId: user._id,
        label: "work",
        address: def.address,
        city: def.city,
        state: def.state,
        country: "Nigeria",
        postalCode: def.postalCode,
        latitude: def.latitude,
        longitude: def.longitude,
        isDefault: true,
      });
    }

    let vendor = await Vendor.findOne({ userId: user._id });
    if (vendor) {
      vendor.addressId = address._id;
      vendor.businessName = def.storeName;
      vendor.businessDescription = def.businessDescription;
      vendor.approvalStatus = "approved";
      vendor.isAvailable = true;
      vendor.inspectionStatus = "completed";
      if (!vendor.approvedAt) vendor.approvedAt = new Date();
      if (!vendor.approvedBy && admin) vendor.approvedBy = admin._id;
      await vendor.save();
    } else {
      vendor = await Vendor.create({
        userId: user._id,
        addressId: address._id,
        businessName: def.storeName,
        businessDescription: def.businessDescription,
        businessLogoUrl: "https://images.unsplash.com/photo-1555396273-367ea4eb4db5",
        approvalStatus: "approved",
        isAvailable: true,
        inspectionStatus: "completed",
        approvedBy: admin?._id,
        approvedAt: new Date(),
      });
    }

    let createdMeals = 0;
    for (const mealDef of def.meals) {
      const existing = await Meal.findOne({ vendorId: vendor._id, name: mealDef.name });
      if (existing) continue;

      await Meal.create({
        vendorId: vendor._id,
        categoryId: localCategory._id,
        categoryName: CategoryType.LOCAL,
        name: mealDef.name,
        description: mealDef.description,
        price: mealDef.price,
        publicationStatus: "published",
        isAvailable: true,
        primaryImageUrl: mealDef.primaryImageUrl,
        additionalImages: [],
        tags: mealDef.tags,
        preparationTime: mealDef.preparationTime,
        servingSize: mealDef.servingSize,
      });
      createdMeals++;
    }

    summary.push(
      `${def.storeName} (${def.state}) — user ${user._id.toString()}, vendor ${vendor._id.toString()}, ${createdMeals} new meal(s) added (${def.meals.length} total in menu).`,
    );
  }

  console.log("\nSeeded vendors:");
  summary.forEach((line) => console.log(`  ${line}`));
  console.log(`\nDefault password for all seeded vendor logins: ${DEFAULT_PASSWORD}`);
}

main()
  .then(() => console.log("\nSeed complete."))
  .catch((err) => {
    console.error("Seed failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
