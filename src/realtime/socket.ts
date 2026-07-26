/** @format */

import type { Server as HttpServer } from "http";
import { Server as SocketIOServer, Socket } from "socket.io";
import { verifyToken } from "../util/generate-token.util.js";
import { jwtSecret, corsOrigin } from "../constants/env.js";
import User, { UserDocument } from "../models/user.model.js";
import Vendor from "../models/vendor.model.js";
import SupportTicket from "../models/supportTicket.model.js";

let io: SocketIOServer | null = null;

const extractCookie = (
  cookieHeader: string | undefined,
  name: string,
): string | undefined => {
  if (!cookieHeader) return undefined;
  const match = cookieHeader
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : undefined;
};

// A socket may only join the room for a ticket it's actually a party to —
// without this, any authenticated user could join any ticket's room by
// guessing an id and read a stranger's support conversation live.
const canAccessTicket = async (
  user: UserDocument,
  ticketId: string,
): Promise<boolean> => {
  if (user.userType === "admin") return true;

  const ticket = await SupportTicket.findById(ticketId).select(
    "customerId vendorId",
  );
  if (!ticket) return false;

  if (user.userType === "customer") {
    return ticket.customerId?.toString() === (user._id as any).toString();
  }

  if (user.userType === "vendor") {
    const vendor = await Vendor.findOne({ userId: user._id }).select("_id");
    return !!vendor && ticket.vendorId?.toString() === vendor._id.toString();
  }

  return false;
};

export const initializeSocket = (httpServer: HttpServer): SocketIOServer => {
  io = new SocketIOServer(httpServer, {
    cors: {
      origin: corsOrigin?.length ? corsOrigin : true,
      credentials: true,
    },
  });

  io.use(async (socket, next) => {
    try {
      const token = extractCookie(socket.handshake.headers.cookie, "token");
      if (!token) {
        return next(new Error("Unauthorized"));
      }

      const decoded = verifyToken(token, jwtSecret);
      if (!decoded || typeof decoded === "string") {
        return next(new Error("Unauthorized"));
      }

      const user = await User.findById((decoded as UserDocument)._id).select(
        "-passwordHash",
      );
      if (!user || user.status !== "active") {
        return next(new Error("Unauthorized"));
      }

      socket.data.user = user;
      next();
    } catch (_error) {
      next(new Error("Unauthorized"));
    }
  });

  io.on("connection", (socket: Socket) => {
    const user = socket.data.user as UserDocument;

    socket.on("join-ticket", async (ticketId: string, ack?: (ok: boolean) => void) => {
      if (typeof ticketId !== "string" || !ticketId.trim()) {
        ack?.(false);
        return;
      }
      const allowed = await canAccessTicket(user, ticketId);
      if (allowed) {
        socket.join(`ticket:${ticketId}`);
      }
      ack?.(allowed);
    });

    socket.on("leave-ticket", (ticketId: string) => {
      if (typeof ticketId === "string" && ticketId.trim()) {
        socket.leave(`ticket:${ticketId}`);
      }
    });
  });

  return io;
};

// Called after a ticket message is saved — broadcasts it to everyone
// currently viewing that ticket. Safe no-op if the socket server hasn't
// been initialized (e.g. a one-off script importing the service directly).
export const emitTicketMessage = (
  ticketId: string,
  payload: {
    senderType: "customer" | "vendor" | "admin";
    senderName: string;
    message: string;
    createdAt: Date;
  },
) => {
  io?.to(`ticket:${ticketId}`).emit("ticket:new-message", {
    ticketId,
    ...payload,
  });
};
