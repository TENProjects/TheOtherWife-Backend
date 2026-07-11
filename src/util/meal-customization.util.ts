/** @format */

import type { SpiceLevel } from "./spice-level.util.js";

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
