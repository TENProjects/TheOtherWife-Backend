/** @format */

import dns from "dns";
import mongoose from "mongoose";

import { mongoUri, nodeEnv } from "../constants/env.js";

// Some local dev machines' default DNS resolver (127.0.0.1) refuses the raw
// UDP SRV/TXT queries a `mongodb+srv://` URI needs, even though the OS-level
// resolver works fine for everything else (browsers, ping, etc.) — this
// breaks Atlas connections during local development with no indication why
// (`querySrv ECONNREFUSED`). Only applied outside production so it can never
// change DNS resolution behavior for the deployed app on Vercel.
if (nodeEnv !== "production") {
  dns.setServers(["8.8.8.8", "1.1.1.1"]);
}

export class Db {
  private connectionPromise: Promise<typeof mongoose> | null = null;

  connect = () => {
    if (!mongoUri) {
      throw new Error("MONGODB_URI is not defined");
    }

    if (mongoose.connection.readyState === 1) {
      return Promise.resolve(mongoose);
    }

    if (this.connectionPromise) {
      return this.connectionPromise;
    }

    try {
      this.connectionPromise = mongoose.connect(mongoUri);
      return this.connectionPromise.finally(() => {
        this.connectionPromise = null;
      });
    } catch (error) {
      console.error("Error connecting to MongoDB:", error);
      throw error;
    }
  };
}
