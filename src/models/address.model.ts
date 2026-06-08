/** @format */

import mongoose, { Document, Schema, model } from "mongoose";

export interface AddressDocument extends Document {
  userId: mongoose.Types.ObjectId;
  label: "home" | "work" | "other";
  address?: string;
  city: string;
  state: string;
  country: string;
  postalCode: string;
  latitude: number;
  longitude: number;
  // GeoJSON point kept in sync with latitude/longitude for 2dsphere queries.
  // coordinates are stored as [longitude, latitude] per the GeoJSON spec.
  location?: { type: "Point"; coordinates: number[] };
  isDefault: boolean;
}

const toGeoPoint = (
  longitude?: number,
  latitude?: number,
): { type: "Point"; coordinates: number[] } | undefined => {
  if (typeof longitude !== "number" || typeof latitude !== "number") {
    return undefined;
  }

  if (Number.isNaN(longitude) || Number.isNaN(latitude)) {
    return undefined;
  }

  return { type: "Point", coordinates: [longitude, latitude] };
};

const AddressSchema = new Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  label: {
    type: String,
    required: true,
    enum: ["home", "work", "other"],
    default: "home",
  },
  address: {
    type: String,
    required: false,
  },
  city: {
    type: String,
    required: true,
  },
  state: {
    type: String,
    required: true,
  },
  country: {
    type: String,
    required: true,
  },
  postalCode: {
    type: String,
    required: true,
  },
  latitude: {
    type: Number,
    required: true,
  },
  longitude: {
    type: Number,
    required: true,
  },
  location: {
    type: {
      type: String,
      enum: ["Point"],
      default: "Point",
    },
    coordinates: {
      type: [Number],
      default: undefined,
    },
  },
  isDefault: {
    type: Boolean,
    required: false,
    default: false,
  },
});

AddressSchema.index({ location: "2dsphere" });

// Keep the GeoJSON location in sync on create and document saves.
AddressSchema.pre("save", function (next) {
  const point = toGeoPoint(this.longitude, this.latitude);

  if (point) {
    this.location = point;
  }

  next();
});

// Keep the GeoJSON location in sync on query-based updates (findOneAndUpdate, etc.).
AddressSchema.pre(
  ["findOneAndUpdate", "updateOne", "updateMany"],
  async function (next) {
    const update = this.getUpdate() as Record<string, any> | null;

    if (!update) {
      return next();
    }

    const set = update.$set ?? update;
    const hasLatitude = set.latitude !== undefined;
    const hasLongitude = set.longitude !== undefined;

    if (!hasLatitude && !hasLongitude) {
      return next();
    }

    let { latitude, longitude } = set as {
      latitude?: number;
      longitude?: number;
    };

    // A partial update may set only one coordinate; load the other from the doc.
    if (latitude === undefined || longitude === undefined) {
      const current = await this.model
        .findOne(this.getQuery())
        .select("latitude longitude");

      if (current) {
        latitude = latitude ?? current.latitude;
        longitude = longitude ?? current.longitude;
      }
    }

    const point = toGeoPoint(longitude, latitude);

    if (point) {
      if (update.$set) {
        update.$set.location = point;
      } else {
        update.location = point;
      }

      this.setUpdate(update);
    }

    next();
  },
);

export default model<AddressDocument>("Address", AddressSchema);
