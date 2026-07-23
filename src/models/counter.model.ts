/** @format */

import { Document, Schema, model } from "mongoose";

// Generic atomic-sequence counter — _id is the sequence name (e.g.
// "supportTicket"), seq is the last-issued value. Used wherever a
// human-readable, sequential identifier is needed (e.g. ticket numbers)
// alongside the document's real ObjectId.
export interface CounterDocument extends Document<string> {
  seq: number;
}

const CounterSchema = new Schema<CounterDocument>({
  _id: { type: String, required: true },
  seq: { type: Number, required: true, default: 0 },
});

export default model<CounterDocument>("Counter", CounterSchema);
