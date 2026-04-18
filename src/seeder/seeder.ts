/** @format */

import mongoose from "mongoose";

import { Db } from "../config/db.config.js";
import Address from "../models/address.model.js";
import Cart from "../models/cart.model.js";
import Customer from "../models/customer.model.js";
import Favourites from "../models/favourites.model.js";
import Meal from "../models/meal.model.js";
import MealCategory, { CategoryType } from "../models/mealCategory.model.js";
import Order from "../models/order.model.js";
import Payment from "../models/payment.model.js";
import User from "../models/user.model.js";
import Vendor from "../models/vendor.model.js";

import type { ClientSession } from "mongoose";

const DEFAULT_PASSWORD = "TestPass123!";

export class Seeder {
  public db: Db | undefined;
  public session: ClientSession | undefined;

  constructor() {
    this.db = new Db();
  }

  startSession = async (): Promise<ClientSession> => {
    try {
      if (this.session) return this.session;
      await this.db?.connect();
      this.session = await mongoose.startSession();
      return this.session;
    } catch (error) {
      throw error;
    }
  };

  clearExistingData = async (session: ClientSession): Promise<void> => {
    try {
      await Payment.deleteMany({}, { session });
      await Order.deleteMany({}, { session });
      await Cart.deleteMany({}, { session });
      await Favourites.deleteMany({}, { session });
      await Meal.deleteMany({}, { session });
      await Vendor.deleteMany({}, { session });
      await Customer.deleteMany({}, { session });
      await Address.deleteMany({}, { session });
      await User.deleteMany({}, { session });
      await MealCategory.deleteMany({}, { session });
    } catch (error) {
      throw error;
    }
  };

  run = async (): Promise<void> => {
    let session: ClientSession | undefined;
    session = await this.startSession();

    try {
      session.startTransaction();

      await this.clearExistingData(session);

      const categories = await this.seedCategories(session);
      const users = await this.seedUsers(session);
      const addresses = await this.seedAddresses(session, users);
      const profiles = await this.seedProfiles(session, users, addresses);
      const meals = await this.seedMeals(session, categories, profiles.vendors);
      await this.seedCustomerData(session, users, profiles.customers, meals);
      await session.commitTransaction();
    } catch (error) {
      await session?.abortTransaction();
      console.log("Transaction aborted", error);
      throw error;
    } finally {
      await session?.endSession();
      await mongoose.disconnect();
    }
  };

  seedCategories = async (session: ClientSession) => {
    const CategoryArray = Object.values(CategoryType);
    const categories: Record<string, InstanceType<typeof MealCategory>> = {};

    for (const categoryValue of CategoryArray) {
      try {
        const [category] = await MealCategory.create(
          [
            {
              category: categoryValue as unknown as string,
              description: `${categoryValue} category`,
            },
          ],
          {
            session,
          },
        );
        categories[categoryValue] = category;
      } catch (error) {
        throw error;
      }
    }

    return categories;
  };

  seedUsers = async (session: ClientSession) => {
    const userDefinitions = [
      {
        firstName: "System",
        lastName: "Admin",
        email: "admin@theotherwife.test",
        phoneNumber: "+2347000000001",
        userType: "admin",
      },
      {
        firstName: "Amaka",
        lastName: "Bello",
        email: "vendor1@theotherwife.test",
        phoneNumber: "+2347000000002",
        userType: "vendor",
      },
      {
        firstName: "Tunde",
        lastName: "Aina",
        email: "vendor2@theotherwife.test",
        phoneNumber: "+2347000000003",
        userType: "vendor",
      },
      {
        firstName: "Lara",
        lastName: "Okafor",
        email: "customer1@theotherwife.test",
        phoneNumber: "+2347000000004",
        userType: "customer",
      },
      {
        firstName: "David",
        lastName: "Cole",
        email: "customer2@theotherwife.test",
        phoneNumber: "+2347000000005",
        userType: "customer",
      },
      {
        firstName: "Mina",
        lastName: "Stone",
        email: "customer3@theotherwife.test",
        phoneNumber: "+2347000000006",
        userType: "customer",
      },
    ] as const;

    const users = await Promise.all(
      userDefinitions.map(async (definition) => {
        const [user] = await User.create(
          [
            {
              ...definition,
              passwordHash: DEFAULT_PASSWORD,
              authType: "email",
              isEmailVerified: true,
              isPhoneVerified: true,
              status: "active",
              lastLogin: new Date(),
            },
          ],
          { session },
        );

        return user;
      }),
    );

    return {
      admin: users[0],
      vendors: [users[1], users[2]],
      customers: [users[3], users[4], users[5]],
    };
  };

  seedAddresses = async (
    session: ClientSession,
    users: Awaited<ReturnType<Seeder["seedUsers"]>>,
  ) => {
    const addressDefinitions = [
      {
        userId: users.vendors[0]._id,
        label: "work" as const,
        address: "12 Admiralty Way",
        city: "Lekki",
        state: "Lagos",
        country: "Nigeria",
        postalCode: "101233",
        latitude: 6.4474,
        longitude: 3.4723,
        isDefault: true,
      },
      {
        userId: users.vendors[1]._id,
        label: "work" as const,
        address: "7 Isaac John Street",
        city: "Ikeja",
        state: "Lagos",
        country: "Nigeria",
        postalCode: "100271",
        latitude: 6.6018,
        longitude: 3.3515,
        isDefault: true,
      },
      {
        userId: users.customers[0]._id,
        label: "home" as const,
        address: "18 Fola Osibo Road",
        city: "Lekki",
        state: "Lagos",
        country: "Nigeria",
        postalCode: "101241",
        latitude: 6.4351,
        longitude: 3.4509,
        isDefault: true,
      },
      {
        userId: users.customers[1]._id,
        label: "home" as const,
        address: "44 Bode Thomas Street",
        city: "Surulere",
        state: "Lagos",
        country: "Nigeria",
        postalCode: "101283",
        latitude: 6.5005,
        longitude: 3.3538,
        isDefault: true,
      },
      {
        userId: users.customers[2]._id,
        label: "home" as const,
        address: "9 Gana Street",
        city: "Maitama",
        state: "Abuja",
        country: "Nigeria",
        postalCode: "904101",
        latitude: 9.0765,
        longitude: 7.4951,
        isDefault: true,
      },
    ];

    const addresses = await Address.create(addressDefinitions, {
      session,
      ordered: true,
    });

    return {
      vendors: [addresses[0], addresses[1]],
      customers: [addresses[2], addresses[3], addresses[4]],
    };
  };

  seedProfiles = async (
    session: ClientSession,
    users: Awaited<ReturnType<Seeder["seedUsers"]>>,
    addresses: Awaited<ReturnType<Seeder["seedAddresses"]>>,
  ) => {
    const [vendorOne, vendorTwo] = await Vendor.create(
      [
        {
          userId: users.vendors[0]._id,
          addressId: addresses.vendors[0]._id,
          businessName: "Amaka's Kitchen",
          businessDescription: "Local and continental dishes for lunch rush.",
          businessLogoUrl: "https://images.unsplash.com/photo-1555396273-367ea4eb4db5",
          approvalStatus: "approved",
          isAvailable: true,
          openingHours: {
            monday: { isOpen: true, openTime: "08:00", closeTime: "22:00" },
            tuesday: { isOpen: true, openTime: "08:00", closeTime: "22:00" },
            wednesday: { isOpen: true, openTime: "08:00", closeTime: "22:00" },
            thursday: { isOpen: true, openTime: "08:00", closeTime: "22:00" },
            friday: { isOpen: true, openTime: "08:00", closeTime: "23:00" },
            saturday: { isOpen: true, openTime: "09:00", closeTime: "23:00" },
            sunday: { isOpen: true, openTime: "10:00", closeTime: "20:00" },
          },
          approvedBy: users.admin._id,
          approvedAt: new Date(),
        },
        {
          userId: users.vendors[1]._id,
          addressId: addresses.vendors[1]._id,
          businessName: "Aina Pastries",
          businessDescription: "Pastries, vegan bowls, and quick breakfasts.",
          businessLogoUrl: "https://images.unsplash.com/photo-1517248135467-4c7edcad34c4",
          approvalStatus: "approved",
          isAvailable: true,
          openingHours: {
            monday: { isOpen: true, openTime: "07:00", closeTime: "20:00" },
            tuesday: { isOpen: true, openTime: "07:00", closeTime: "20:00" },
            wednesday: { isOpen: true, openTime: "07:00", closeTime: "20:00" },
            thursday: { isOpen: true, openTime: "07:00", closeTime: "20:00" },
            friday: { isOpen: true, openTime: "07:00", closeTime: "21:00" },
            saturday: { isOpen: true, openTime: "08:00", closeTime: "21:00" },
            sunday: { isOpen: true, openTime: "08:00", closeTime: "18:00" },
          },
          approvedBy: users.admin._id,
          approvedAt: new Date(),
        },
      ],
      { session, ordered: true },
    );

    const customers = await Customer.create(
      [
        {
          userId: users.customers[0]._id,
          addressId: addresses.customers[0]._id,
          profileImageUrl: "https://images.unsplash.com/photo-1494790108377-be9c29b29330",
        },
        {
          userId: users.customers[1]._id,
          addressId: addresses.customers[1]._id,
          profileImageUrl: "https://images.unsplash.com/photo-1500648767791-00dcc994a43e",
        },
        {
          userId: users.customers[2]._id,
          addressId: addresses.customers[2]._id,
          profileImageUrl: "https://images.unsplash.com/photo-1438761681033-6461ffad8d80",
        },
      ],
      { session, ordered: true },
    );

    return {
      vendors: [vendorOne, vendorTwo],
      customers,
    };
  };

  seedMeals = async (
    session: ClientSession,
    categories: Awaited<ReturnType<Seeder["seedCategories"]>>,
    vendors: Awaited<ReturnType<Seeder["seedProfiles"]>>["vendors"],
  ) => {
    return await Meal.create(
      [
        {
          vendorId: vendors[0]._id,
          categoryId: categories[CategoryType.LOCAL]._id,
          categoryName: CategoryType.LOCAL,
          name: "Jollof Rice Combo",
          description: "Smoky jollof rice with chicken and fried plantain.",
          price: 6500,
          isAvailable: true,
          primaryImageUrl: "https://images.unsplash.com/photo-1604908176997-125f25cc6f3d",
          additionalImages: [],
          tags: ["rice", "spicy", "lunch"],
          preparationTime: 25,
          servingSize: "1 bowl",
        },
        {
          vendorId: vendors[0]._id,
          categoryId: categories[CategoryType.CONTINENTAL]._id,
          categoryName: CategoryType.CONTINENTAL,
          name: "Grilled Chicken Alfredo",
          description: "Creamy alfredo pasta topped with grilled chicken.",
          price: 8200,
          isAvailable: true,
          primaryImageUrl: "https://images.unsplash.com/photo-1645112411341-6c4fd023882c",
          additionalImages: [],
          tags: ["pasta", "dinner", "creamy"],
          preparationTime: 30,
          servingSize: "1 plate",
        },
        {
          vendorId: vendors[0]._id,
          categoryId: categories[CategoryType.OTHER]._id,
          categoryName: CategoryType.OTHER,
          name: "Peppered Turkey Bites",
          description: "Tender turkey tossed in a rich pepper sauce.",
          price: 4800,
          isAvailable: true,
          primaryImageUrl: "https://images.unsplash.com/photo-1529042410759-befb1204b468",
          additionalImages: [],
          tags: ["protein", "snack", "pepper"],
          preparationTime: 20,
          servingSize: "12 pieces",
        },
        {
          vendorId: vendors[1]._id,
          categoryId: categories[CategoryType.PASTRY]._id,
          categoryName: CategoryType.PASTRY,
          name: "Butter Croissant Box",
          description: "Freshly baked croissants with whipped butter.",
          price: 3900,
          isAvailable: true,
          primaryImageUrl: "https://images.unsplash.com/photo-1555507036-ab794f4afe5a",
          additionalImages: [],
          tags: ["breakfast", "pastry", "light"],
          preparationTime: 15,
          servingSize: "4 pieces",
        },
        {
          vendorId: vendors[1]._id,
          categoryId: categories[CategoryType.VEGAN]._id,
          categoryName: CategoryType.VEGAN,
          name: "Green Power Bowl",
          description: "Quinoa, avocado, roasted vegetables, and tahini.",
          price: 5600,
          isAvailable: true,
          primaryImageUrl: "https://images.unsplash.com/photo-1547592180-85f173990554",
          additionalImages: [],
          tags: ["vegan", "healthy", "bowl"],
          preparationTime: 18,
          servingSize: "1 bowl",
        },
        {
          vendorId: vendors[1]._id,
          categoryId: categories[CategoryType.PASTRY]._id,
          categoryName: CategoryType.PASTRY,
          name: "Cinnamon Roll Tray",
          description: "Soft cinnamon rolls glazed with vanilla icing.",
          price: 4500,
          isAvailable: true,
          primaryImageUrl: "https://images.unsplash.com/photo-1509440159596-0249088772ff",
          additionalImages: [],
          tags: ["dessert", "pastry", "sweet"],
          preparationTime: 22,
          servingSize: "6 pieces",
        },
        {
          vendorId: vendors[1]._id,
          categoryId: categories[CategoryType.CONTINENTAL]._id,
          categoryName: CategoryType.CONTINENTAL,
          name: "Turkey Club Sandwich",
          description: "Stacked sandwich with turkey, egg, and greens.",
          price: 4100,
          isAvailable: true,
          primaryImageUrl: "https://images.unsplash.com/photo-1528735602780-2552fd46c7af",
          additionalImages: [],
          tags: ["sandwich", "lunch", "quick"],
          preparationTime: 12,
          servingSize: "1 sandwich",
        },
        {
          vendorId: vendors[0]._id,
          categoryId: categories[CategoryType.LOCAL]._id,
          categoryName: CategoryType.LOCAL,
          name: "Egusi Soup Bowl",
          description: "Rich egusi served with assorted meat and swallow.",
          price: 7200,
          isAvailable: false,
          primaryImageUrl: "https://images.unsplash.com/photo-1625943555419-56a2cb596640",
          additionalImages: [],
          tags: ["soup", "local", "dinner"],
          preparationTime: 35,
          servingSize: "1 bowl",
        },
      ],
      { session, ordered: true },
    );
  };

  seedCustomerData = async (
    session: ClientSession,
    users: Awaited<ReturnType<Seeder["seedUsers"]>>,
    customers: Awaited<ReturnType<Seeder["seedProfiles"]>>["customers"],
    meals: Awaited<ReturnType<Seeder["seedMeals"]>>,
  ) => {
    const cartDefinitions = [
      {
        customerId: users.customers[0]._id,
        meals: [
          {
            mealId: meals[0]._id,
            price: meals[0].price,
            quantity: 2,
            totalPrice: meals[0].price * 2,
          },
          {
            mealId: meals[4]._id,
            price: meals[4].price,
            quantity: 1,
            totalPrice: meals[4].price,
          },
        ],
        totalAmount: meals[0].price * 2 + meals[4].price,
      },
      {
        customerId: users.customers[1]._id,
        meals: [
          {
            mealId: meals[3]._id,
            price: meals[3].price,
            quantity: 1,
            totalPrice: meals[3].price,
          },
          {
            mealId: meals[6]._id,
            price: meals[6].price,
            quantity: 2,
            totalPrice: meals[6].price * 2,
          },
        ],
        totalAmount: meals[3].price + meals[6].price * 2,
      },
      {
        customerId: users.customers[2]._id,
        meals: [
          {
            mealId: meals[1]._id,
            price: meals[1].price,
            quantity: 1,
            totalPrice: meals[1].price,
          },
        ],
        totalAmount: meals[1].price,
      },
    ];

    const carts = await Cart.create(cartDefinitions, {
      session,
      ordered: true,
    });

    const orderDefinitions = [
      {
        customerId: users.customers[0]._id,
        vendorId: meals[0].vendorId,
        cartId: carts[0]._id,
        currency: "NGN",
        items: [
          {
            mealId: meals[0]._id,
            mealName: meals[0].name,
            quantity: 2,
            unitPrice: meals[0].price,
            lineTotal: meals[0].price * 2,
          },
        ],
        addressSnapshot: {
          label: "home",
          address: "18 Fola Osibo Road",
          city: "Lekki",
          state: "Lagos",
          country: "Nigeria",
          postalCode: "101241",
          latitude: 6.4351,
          longitude: 3.4509,
        },
        subtotal: meals[0].price * 2,
        deliveryFee: 1500,
        taxAmount: 750,
        discountAmount: 0,
        totalAmount: meals[0].price * 2 + 1500 + 750,
        status: "paid",
        paymentStatus: "succeeded",
        paidAt: new Date(),
      },
      {
        customerId: users.customers[1]._id,
        vendorId: meals[3].vendorId,
        cartId: carts[1]._id,
        currency: "NGN",
        items: [
          {
            mealId: meals[3]._id,
            mealName: meals[3].name,
            quantity: 1,
            unitPrice: meals[3].price,
            lineTotal: meals[3].price,
          },
          {
            mealId: meals[6]._id,
            mealName: meals[6].name,
            quantity: 2,
            unitPrice: meals[6].price,
            lineTotal: meals[6].price * 2,
          },
        ],
        addressSnapshot: {
          label: "home",
          address: "44 Bode Thomas Street",
          city: "Surulere",
          state: "Lagos",
          country: "Nigeria",
          postalCode: "101283",
          latitude: 6.5005,
          longitude: 3.3538,
        },
        subtotal: meals[3].price + meals[6].price * 2,
        deliveryFee: 1200,
        taxAmount: 500,
        discountAmount: 300,
        totalAmount: meals[3].price + meals[6].price * 2 + 1200 + 500 - 300,
        status: "confirmed",
        paymentStatus: "succeeded",
        paidAt: new Date(),
      },
      {
        customerId: users.customers[2]._id,
        vendorId: meals[1].vendorId,
        cartId: carts[2]._id,
        currency: "NGN",
        items: [
          {
            mealId: meals[1]._id,
            mealName: meals[1].name,
            quantity: 1,
            unitPrice: meals[1].price,
            lineTotal: meals[1].price,
          },
        ],
        addressSnapshot: {
          label: "home",
          address: "9 Gana Street",
          city: "Maitama",
          state: "Abuja",
          country: "Nigeria",
          postalCode: "904101",
          latitude: 9.0765,
          longitude: 7.4951,
        },
        subtotal: meals[1].price,
        deliveryFee: 2000,
        taxAmount: 400,
        discountAmount: 0,
        totalAmount: meals[1].price + 2000 + 400,
        status: "pending_payment",
        paymentStatus: "pending",
      },
    ];

    const orders = await Order.create(orderDefinitions, {
      session,
      ordered: true,
    });

    await Payment.create(
      [
        {
          orderId: orders[0]._id,
          customerId: users.customers[0]._id,
          provider: "paystack",
          reference: "seed-pay-001",
          amount: orders[0].totalAmount,
          currency: "NGN",
          status: "succeeded",
          providerTransactionId: "txn-seed-001",
          authorizationUrl: "https://checkout.paystack.com/seed-pay-001",
          paidAt: new Date(),
        },
        {
          orderId: orders[1]._id,
          customerId: users.customers[1]._id,
          provider: "paystack",
          reference: "seed-pay-002",
          amount: orders[1].totalAmount,
          currency: "NGN",
          status: "succeeded",
          providerTransactionId: "txn-seed-002",
          authorizationUrl: "https://checkout.paystack.com/seed-pay-002",
          paidAt: new Date(),
        },
        {
          orderId: orders[2]._id,
          customerId: users.customers[2]._id,
          provider: "paystack",
          reference: "seed-pay-003",
          amount: orders[2].totalAmount,
          currency: "NGN",
          status: "pending_customer_action",
          authorizationUrl: "https://checkout.paystack.com/seed-pay-003",
        },
      ],
      { session, ordered: true },
    );

    await Favourites.create(
      [
        {
          customerId: customers[0]._id,
          favouriteMeals: [{ mealId: meals[0]._id }, { mealId: meals[4]._id }],
        },
        {
          customerId: customers[1]._id,
          favouriteMeals: [{ mealId: meals[3]._id }, { mealId: meals[6]._id }],
        },
        {
          customerId: customers[2]._id,
          favouriteMeals: [{ mealId: meals[1]._id }],
        },
      ],
      { session, ordered: true },
    );
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  new Seeder()
    .run()
    .then(() => console.log("Seeding complete"))
    .catch((err) => console.log("Seeding failed", err));
}
