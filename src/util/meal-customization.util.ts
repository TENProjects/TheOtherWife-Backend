/** @format */

import type { SpiceLevel } from "./spice-level.util.js";
import type { MealOption } from "../models/meal.model.js";

// Shared default catalogs — the brand's Figma design always shows a
// Packaging/Protein/Add-ons/Drinks picker on the meal-details screen, even
// for meals the vendor hasn't configured per-meal options for yet. These
// mirror the frontend's fallback lists exactly (MealDetailsScreen.tsx) so
// what the customer is shown a price for is always what they're charged —
// the server resolves against this same catalog rather than trusting any
// client-submitted price.
export const DEFAULT_PACKAGING_OPTIONS: MealOption[] = [
  { name: "Big Pack", price: 500 },
  { name: "Small Pack", price: 500 },
];

export const DEFAULT_PROTEIN_OPTIONS: MealOption[] = [
  { name: "Chicken", price: 500 },
  { name: "Beef", price: 500 },
  { name: "Ponmo", price: 500 },
  { name: "Chicken in Stew", price: 500 },
  { name: "Grilled Chicken", price: 500 },
  { name: "Fried Fish", price: 700 },
];

export const DEFAULT_ADDON_OPTIONS: MealOption[] = [
  { name: "Extra Sauce", price: 1500 },
  { name: "Extra Vegetables", price: 1500 },
  { name: "Extra Protein", price: 3500 },
  { name: "Side Salad", price: 1500 },
  { name: "Fried Plantain", price: 1000 },
];

export const DEFAULT_DRINK_OPTIONS: MealOption[] = [
  { name: "Coke", price: 500 },
  { name: "Chivita", price: 500 },
  { name: "Sprite", price: 500 },
  { name: "Five Alive", price: 500 },
  { name: "Fanta", price: 500 },
  { name: "Fresh Yo", price: 500 },
  { name: "Water", price: 300 },
];

export type MealCustomizationSelection = {
  name: string;
  price: number;
};

export type MealCustomizationSelectionWithQuantity = MealCustomizationSelection & {
  quantity?: number;
};

export type MealCustomization = {
  packaging?: MealCustomizationSelection;
  spiceLevel?: SpiceLevel;
  proteinSelections?: MealCustomizationSelectionWithQuantity[];
  addOnSelections?: MealCustomizationSelection[];
  drinkSelections?: MealCustomizationSelectionWithQuantity[];
  customProteinRequests?: string[];
  customAddOnRequests?: string[];
  customDrinkRequests?: string[];
  cookingInstructions?: {
    presets?: string[];
    note?: string;
  };
};

/**
 * Custom free-text requests (customProteinRequests etc.) are intentionally
 * excluded from the delta — their price is TBD/vendor-confirmed and must
 * never silently affect what the customer is charged.
 */
export const computeCustomizationDelta = (
  customization?: MealCustomization | null,
): number => {
  if (!customization) {
    return 0;
  }

  const packagingDelta = customization.packaging?.price ?? 0;

  const proteinDelta = (customization.proteinSelections ?? []).reduce(
    (total, selection) => total + selection.price * (selection.quantity ?? 1),
    0,
  );

  const addOnDelta = (customization.addOnSelections ?? []).reduce(
    (total, selection) => total + selection.price,
    0,
  );

  const drinkDelta = (customization.drinkSelections ?? []).reduce(
    (total, selection) => total + selection.price * (selection.quantity ?? 1),
    0,
  );

  return packagingDelta + proteinDelta + addOnDelta + drinkDelta;
};
